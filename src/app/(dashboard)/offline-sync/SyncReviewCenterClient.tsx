'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertTriangle, CheckCircle2, Download, ExternalLink, RefreshCw, Search, Trash2, Wrench } from 'lucide-react';
import { Badge, Button, Card, CardContent, CardHeader, CardTitle, AnimatedMetric } from '@/components/ui';
import { motion } from 'framer-motion';
import { cardItem, cardStagger } from '@/lib/ui/motion-presets';
import { useOfflineSync } from '@/components/offline/SyncEngineProvider';
import { OFFLINE_QUEUE_CHANGED_EVENT } from '@/lib/offline/db';
import {
  clearSyncedActions,
  getOfflineQueue,
  markResolvedDiscarded,
  markResolvedManual,
  markUnderReview,
  retryOfflineAction,
} from '@/lib/offline/queue';
import { recordOfflineConflictResolutionAction } from '@/actions/offline-sync.actions';
import { syncOfflineQueue } from '@/lib/offline/sync-engine';
import { conflictTypeLabel, deriveConflictDetail } from '@/lib/offline/conflicts';
import {
  OFFLINE_ACTION_TYPES,
  OFFLINE_CONFLICT_TYPES,
  OFFLINE_SYNC_STATUSES,
  type OfflineActionType,
  type OfflineConflictType,
  type OfflineQueueRecord,
  type OfflineSyncStatus,
} from '@/types/offline';
import type { OfflineSyncEventEnriched, OfflineSyncServerSummary } from '@/services/offline-sync.service';

type Props = {
  serverSummary: OfflineSyncServerSummary;
  serverEvents: OfflineSyncEventEnriched[];
  isDeveloper: boolean;
  currentProfileId: string;
};

const STATUS_FILTERS: Array<OfflineSyncStatus | 'all'> = ['all', ...OFFLINE_SYNC_STATUSES];

function statusVariant(status: string): 'default' | 'success' | 'warning' | 'error' | 'info' | 'purple' {
  if (status === 'synced' || status === 'resolved_synced') return 'success';
  if (status === 'failed') return 'warning';
  if (status === 'conflict') return 'error';
  if (status === 'under_review') return 'purple';
  if (status === 'syncing') return 'purple';
  if (status === 'queued' || status === 'pending') return 'info';
  if (status === 'resolved_discarded') return 'default';
  return 'default';
}

function formatDateTime(value: string | null | undefined) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleString();
}

function exactRouteForRecord(record: OfflineQueueRecord): string | null {
  if (record.action_type === 'maintenance_request.create' || record.action_type === 'department_issue.report') {
    if (record.asset_id) return `/equipment/${record.asset_id}`;
    return null;
  }
  if (record.action_type === 'maintenance_event.log' || record.action_type === 'work_order.complete_draft' || record.action_type === 'work_order.start_intent') {
    const workOrderId = (record.payload?.work_order_id as string | undefined) ?? record.entity_id ?? null;
    if (workOrderId) return `/maintenance/work-orders/${workOrderId}`;
    if (record.asset_id) return `/equipment/${record.asset_id}`;
    return null;
  }
  if (record.action_type === 'qr_note.create') {
    if (record.asset_id) return `/equipment/${record.asset_id}`;
    return null;
  }
  if (record.action_type === 'calibration_request.create') return '/calibration';
  if (record.action_type === 'training_request.create') return '/training';
  if (record.action_type === 'store_reorder.create') return '/procurement';
  if (record.action_type === 'stock_receipt.draft' || record.action_type === 'stock_issue.draft') return '/spare-parts';
  return null;
}

function exactRouteForEvent(event: OfflineSyncEventEnriched): string | null {
  if (event.entity_type === 'work_orders' && event.entity_id) return `/maintenance/work-orders/${event.entity_id}`;
  if (event.entity_type === 'maintenance_requests' && event.entity_id) return `/maintenance/requests/${event.entity_id}`;
  if (event.asset_id) return `/equipment/${event.asset_id}`;
  return null;
}

function downloadJson(filename: string, payload: unknown) {
  if (typeof window === 'undefined') return;
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

function exportCsv(filename: string, rows: Array<Record<string, unknown>>, columns: string[]) {
  if (typeof window === 'undefined') return;
  const escape = (value: unknown) => {
    if (value === null || value === undefined) return '';
    const text = typeof value === 'string' ? value : JSON.stringify(value);
    if (/[",\n]/.test(text)) return `"${text.replace(/"/g, '""')}"`;
    return text;
  };
  const header = columns.join(',');
  const body = rows.map((row) => columns.map((col) => escape(row[col])).join(',')).join('\n');
  const blob = new Blob([`${header}\n${body}`], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

export default function SyncReviewCenterClient({ serverSummary, serverEvents, isDeveloper, currentProfileId: _currentProfileId }: Props) {
  void _currentProfileId;
  const sync = useOfflineSync();
  const [queue, setQueue] = useState<OfflineQueueRecord[]>([]);
  const [statusFilter, setStatusFilter] = useState<OfflineSyncStatus | 'all'>('all');
  const [actionFilter, setActionFilter] = useState<OfflineActionType | 'all'>('all');
  const [conflictFilter, setConflictFilter] = useState<OfflineConflictType | 'all'>('all');
  const [roleFilter, setRoleFilter] = useState<string>('all');
  const [search, setSearch] = useState('');
  const [busyId, setBusyId] = useState<string | null>(null);
  const [activeRecord, setActiveRecord] = useState<OfflineQueueRecord | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);

  const refreshQueue = useCallback(async () => {
    try {
      setQueue(await getOfflineQueue());
      await sync.refreshSummary();
    } catch (error) {
      if (process.env.NODE_ENV !== 'production') {
        console.warn('[sync-review] Failed to refresh queue', error);
      }
    }
  }, [sync]);

  useEffect(() => {
    void refreshQueue();
    const handle = () => {
      void refreshQueue();
    };
    window.addEventListener(OFFLINE_QUEUE_CHANGED_EVENT, handle);
    return () => window.removeEventListener(OFFLINE_QUEUE_CHANGED_EVENT, handle);
  }, [refreshQueue]);

  const roleOptions = useMemo(() => {
    const set = new Set<string>();
    for (const record of queue) if (record.role_name) set.add(record.role_name);
    for (const event of serverEvents) if (event.role_name) set.add(event.role_name);
    return Array.from(set).sort();
  }, [queue, serverEvents]);

  const filteredQueue = useMemo(() => {
    return queue.filter((record) => {
      if (statusFilter !== 'all' && record.sync_status !== statusFilter) return false;
      if (actionFilter !== 'all' && record.action_type !== actionFilter) return false;
      if (conflictFilter !== 'all') {
        const detail = record.conflict_detail ?? deriveConflictDetail(record);
        if (!detail || detail.conflict_type !== conflictFilter) return false;
      }
      if (roleFilter !== 'all' && record.role_name !== roleFilter) return false;
      if (search.trim()) {
        const haystack = [
          record.client_action_id,
          record.action_type,
          record.entity_type,
          record.entity_id ?? '',
          record.asset_id ?? '',
          record.role_name ?? '',
          record.last_error ?? '',
          record.conflict_reason ?? '',
        ].join(' ').toLowerCase();
        if (!haystack.includes(search.trim().toLowerCase())) return false;
      }
      return true;
    });
  }, [actionFilter, conflictFilter, queue, roleFilter, search, statusFilter]);

  const filteredServerEvents = useMemo(() => {
    return serverEvents.filter((event) => {
      if (statusFilter !== 'all') {
        const eventStatus = event.reported_status;
        if (eventStatus !== statusFilter) return false;
      }
      if (actionFilter !== 'all' && event.action_type !== actionFilter) return false;
      if (conflictFilter !== 'all') {
        if (!event.conflict_detail || event.conflict_detail.conflict_type !== conflictFilter) return false;
      }
      if (roleFilter !== 'all' && event.role_name !== roleFilter) return false;
      if (search.trim()) {
        const haystack = [
          event.client_action_id,
          event.action_type,
          event.entity_type,
          event.entity_id ?? '',
          event.asset_id ?? '',
          event.role_name ?? '',
          event.actor_full_name ?? '',
          event.actor_email ?? '',
          event.conflict_reason ?? '',
          event.error_message ?? '',
        ].join(' ').toLowerCase();
        if (!haystack.includes(search.trim().toLowerCase())) return false;
      }
      return true;
    });
  }, [actionFilter, conflictFilter, roleFilter, search, serverEvents, statusFilter]);

  const onRetryFailed = useCallback(async () => {
    setFeedback(null);
    const failed = queue.filter((record) => record.sync_status === 'failed' && record.metadata?.pending_not_supported !== true);
    for (const record of failed) {
      await retryOfflineAction(record.client_action_id).catch(() => undefined);
    }
    if (failed.length > 0) {
      const result = await syncOfflineQueue();
      setFeedback(`Retried ${failed.length} action${failed.length === 1 ? '' : 's'}. Synced ${result.synced}, failed ${result.failed}, conflicts ${result.conflicts}.`);
    } else {
      setFeedback('No retryable failed actions on this device.');
    }
    await refreshQueue();
  }, [queue, refreshQueue]);

  const onRetrySingle = useCallback(async (record: OfflineQueueRecord) => {
    setBusyId(record.client_action_id);
    setFeedback(null);
    try {
      await retryOfflineAction(record.client_action_id, { allowConflict: record.sync_status === 'under_review' });
      const result = await syncOfflineQueue();
      setFeedback(`Retry attempted. Synced ${result.synced}, failed ${result.failed}, conflicts ${result.conflicts}.`);
      await refreshQueue();
    } finally {
      setBusyId(null);
    }
  }, [refreshQueue]);

  const onMarkUnderReview = useCallback(async (record: OfflineQueueRecord, note?: string) => {
    setBusyId(record.client_action_id);
    setFeedback(null);
    try {
      await markUnderReview(record.client_action_id, note ?? null);
      await recordOfflineConflictResolutionAction({
        client_action_id: record.client_action_id,
        resolution: 'under_review',
        note: note ?? null,
        action_type: record.action_type,
      });
      setFeedback('Marked under review.');
      await refreshQueue();
    } finally {
      setBusyId(null);
    }
  }, [refreshQueue]);

  const onDiscard = useCallback(async (record: OfflineQueueRecord, note?: string) => {
    if (typeof window !== 'undefined') {
      const confirmed = window.confirm('Discard this offline action? The original payload is kept for audit but the action will not be retried.');
      if (!confirmed) return;
    }
    setBusyId(record.client_action_id);
    setFeedback(null);
    try {
      await markResolvedDiscarded(record.client_action_id, note ?? null);
      await recordOfflineConflictResolutionAction({
        client_action_id: record.client_action_id,
        resolution: 'discarded',
        note: note ?? null,
        action_type: record.action_type,
      });
      setFeedback('Discarded local action and recorded resolution audit row.');
      await refreshQueue();
    } finally {
      setBusyId(null);
    }
  }, [refreshQueue]);

  const onMarkManualResolved = useCallback(async (record: OfflineQueueRecord, note?: string) => {
    if (typeof window !== 'undefined') {
      const confirmed = window.confirm('Mark this conflict as manually resolved? Use this only when the underlying record was fixed online and the offline draft no longer needs syncing.');
      if (!confirmed) return;
    }
    setBusyId(record.client_action_id);
    setFeedback(null);
    try {
      await markResolvedManual(record.client_action_id, note ?? null);
      await recordOfflineConflictResolutionAction({
        client_action_id: record.client_action_id,
        resolution: 'manual_resolved',
        note: note ?? null,
        action_type: record.action_type,
      });
      setFeedback('Marked manually resolved.');
      await refreshQueue();
    } finally {
      setBusyId(null);
    }
  }, [refreshQueue]);

  const onClearSynced = useCallback(async () => {
    await clearSyncedActions();
    setFeedback('Cleared local synced and discarded actions. Server evidence is preserved.');
    await refreshQueue();
  }, [refreshQueue]);

  function exportLocalCsv() {
    exportCsv(`bmedis-offline-queue-${new Date().toISOString().slice(0, 10)}.csv`, queue.map((record) => ({
      client_action_id: record.client_action_id,
      created_at: record.created_at,
      action_type: record.action_type,
      entity_type: record.entity_type,
      entity_id: record.entity_id ?? '',
      asset_id: record.asset_id ?? '',
      role_name: record.role_name ?? '',
      sync_status: record.sync_status,
      retry_count: record.retry_count,
      conflict_type: (record.conflict_detail ?? deriveConflictDetail(record))?.conflict_type ?? '',
      last_error: record.last_error ?? '',
      conflict_reason: record.conflict_reason ?? '',
      source_route: record.source_route ?? '',
    })), [
      'client_action_id', 'created_at', 'action_type', 'entity_type', 'entity_id', 'asset_id',
      'role_name', 'sync_status', 'retry_count', 'conflict_type', 'last_error', 'conflict_reason', 'source_route',
    ]);
  }

  function exportServerCsv() {
    exportCsv(`bmedis-sync-server-events-${new Date().toISOString().slice(0, 10)}.csv`, filteredServerEvents.map((event) => ({
      client_action_id: event.client_action_id,
      created_at: event.created_at,
      action_type: event.action_type,
      entity_type: event.entity_type,
      entity_id: event.entity_id ?? '',
      asset_id: event.asset_id ?? '',
      role_name: event.role_name ?? '',
      actor_full_name: event.actor_full_name ?? '',
      actor_email: event.actor_email ?? '',
      sync_status: event.sync_status,
      reported_status: event.reported_status,
      retry_count: event.retry_count ?? '',
      conflict_type: event.conflict_detail?.conflict_type ?? '',
      conflict_reason: event.conflict_reason ?? '',
      error_message: event.error_message ?? '',
      source_route: event.source_route ?? '',
      synced_at: event.synced_at ?? '',
    })), [
      'client_action_id', 'created_at', 'action_type', 'entity_type', 'entity_id', 'asset_id', 'role_name',
      'actor_full_name', 'actor_email', 'sync_status', 'reported_status', 'retry_count', 'conflict_type',
      'conflict_reason', 'error_message', 'source_route', 'synced_at',
    ]);
  }

  const localCounts = useMemo(() => ({
    total: queue.length,
    queued: sync.summary.queued,
    syncing: sync.summary.syncing,
    synced: sync.summary.synced,
    failed: sync.summary.failed,
    conflict: sync.summary.conflict,
    needsReview: sync.summary.needs_review,
  }), [queue.length, sync.summary]);

  return (
    <div className="space-y-6">
      <motion.div
        variants={cardStagger}
        initial="initial"
        animate="animate"
        className="grid gap-3 md:grid-cols-3 xl:grid-cols-6"
      >
        {[
          { label: 'Queued', value: localCounts.queued, variant: 'info' as const },
          { label: 'Syncing', value: localCounts.syncing, variant: 'purple' as const },
          { label: 'Synced', value: localCounts.synced, variant: 'success' as const },
          { label: 'Failed', value: localCounts.failed, variant: 'warning' as const },
          { label: 'Conflicts', value: localCounts.conflict, variant: 'error' as const },
          { label: 'Needs Review', value: localCounts.needsReview, variant: 'error' as const },
        ].map((item) => (
          <motion.div key={item.label} variants={cardItem}>
            <Card>
              <p className="text-xs text-[var(--text-muted)]">{item.label}</p>
              <div className="mt-2 flex items-center justify-between">
                <span className="text-2xl font-semibold text-[var(--foreground)]">
                  <AnimatedMetric value={item.value} />
                </span>
                <Badge variant={item.variant}>{item.label}</Badge>
              </div>
            </Card>
          </motion.div>
        ))}
      </motion.div>

      <Card>
        <CardHeader>
          <CardTitle>Filters</CardTitle>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="outline" onClick={() => void refreshQueue()}>
              <RefreshCw className="h-4 w-4" />
              Refresh
            </Button>
            <Button size="sm" variant="outline" onClick={() => void onRetryFailed()} disabled={localCounts.failed === 0 || !sync.isOnline}>
              <Wrench className="h-4 w-4" />
              Retry All Failed
            </Button>
            <Button size="sm" variant="outline" onClick={() => void onClearSynced()} disabled={localCounts.synced === 0 && sync.summary.resolved_discarded === 0}>
              <Trash2 className="h-4 w-4" />
              Clear Synced
            </Button>
            <Button size="sm" variant="outline" onClick={exportLocalCsv} disabled={queue.length === 0}>
              <Download className="h-4 w-4" />
              Export Local CSV
            </Button>
            <Button size="sm" variant="outline" onClick={exportServerCsv} disabled={filteredServerEvents.length === 0}>
              <Download className="h-4 w-4" />
              Export Server Events CSV
            </Button>
            <Button size="sm" variant="outline" onClick={() => downloadJson(`bmedis-offline-queue-${new Date().toISOString().slice(0, 10)}.json`, queue)} disabled={queue.length === 0}>
              <Download className="h-4 w-4" />
              Export Queue JSON
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-5">
            <label className="text-xs text-[var(--text-muted)]">
              Status
              <select
                value={statusFilter}
                onChange={(event) => setStatusFilter(event.target.value as OfflineSyncStatus | 'all')}
                className="mt-1 w-full rounded-md border border-[var(--border-subtle)] bg-[var(--surface-1)] px-2 py-1 text-sm text-[var(--foreground)]"
              >
                {STATUS_FILTERS.map((status) => (
                  <option key={status} value={status}>{status}</option>
                ))}
              </select>
            </label>
            <label className="text-xs text-[var(--text-muted)]">
              Action type
              <select
                value={actionFilter}
                onChange={(event) => setActionFilter(event.target.value as OfflineActionType | 'all')}
                className="mt-1 w-full rounded-md border border-[var(--border-subtle)] bg-[var(--surface-1)] px-2 py-1 text-sm text-[var(--foreground)]"
              >
                <option value="all">all</option>
                {OFFLINE_ACTION_TYPES.map((type) => (
                  <option key={type} value={type}>{type}</option>
                ))}
              </select>
            </label>
            <label className="text-xs text-[var(--text-muted)]">
              Conflict type
              <select
                value={conflictFilter}
                onChange={(event) => setConflictFilter(event.target.value as OfflineConflictType | 'all')}
                className="mt-1 w-full rounded-md border border-[var(--border-subtle)] bg-[var(--surface-1)] px-2 py-1 text-sm text-[var(--foreground)]"
              >
                <option value="all">all</option>
                {OFFLINE_CONFLICT_TYPES.map((type) => (
                  <option key={type} value={type}>{conflictTypeLabel(type)}</option>
                ))}
              </select>
            </label>
            <label className="text-xs text-[var(--text-muted)]">
              Role
              <select
                value={roleFilter}
                onChange={(event) => setRoleFilter(event.target.value)}
                className="mt-1 w-full rounded-md border border-[var(--border-subtle)] bg-[var(--surface-1)] px-2 py-1 text-sm text-[var(--foreground)]"
              >
                <option value="all">all</option>
                {roleOptions.map((role) => (
                  <option key={role} value={role}>{role}</option>
                ))}
              </select>
            </label>
            <label className="text-xs text-[var(--text-muted)]">
              Search
              <div className="relative mt-1">
                <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[var(--text-muted)]" />
                <input
                  type="search"
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder="ID, asset, role, error..."
                  className="w-full rounded-md border border-[var(--border-subtle)] bg-[var(--surface-1)] px-7 py-1 text-sm text-[var(--foreground)]"
                />
              </div>
            </label>
          </div>
          {feedback && (
            <p className="mt-3 rounded-md border border-[var(--border-subtle)] bg-[var(--surface-1)] p-2 text-xs text-[var(--foreground)]">
              {feedback}
            </p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Local Device Queue ({filteredQueue.length} of {queue.length})</CardTitle>
          <Badge variant="info">This device only</Badge>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[1100px] text-left text-sm">
              <thead>
                <tr className="border-b border-[var(--border-subtle)] text-xs uppercase tracking-wide text-[var(--text-muted)]">
                  <th className="px-3 py-2">Created</th>
                  <th className="px-3 py-2">User / Role</th>
                  <th className="px-3 py-2">Action</th>
                  <th className="px-3 py-2">Entity</th>
                  <th className="px-3 py-2">Asset</th>
                  <th className="px-3 py-2">Status</th>
                  <th className="px-3 py-2">Conflict / Error</th>
                  <th className="px-3 py-2">Retries</th>
                  <th className="px-3 py-2">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--border-subtle)]/60">
                {filteredQueue.length === 0 ? (
                  <tr><td colSpan={9} className="px-3 py-6 text-center text-[var(--text-muted)]">No local actions match the current filters.</td></tr>
                ) : filteredQueue.map((record) => {
                  const detail = record.conflict_detail ?? deriveConflictDetail(record);
                  const route = exactRouteForRecord(record);
                  const isBusy = busyId === record.client_action_id;
                  return (
                    <tr key={record.client_action_id} className="align-top">
                      <td className="px-3 py-2 text-xs text-[var(--text-muted)]">
                        {formatDateTime(record.created_at)}
                        <div className="text-[10px]">{record.client_action_id.slice(0, 16)}…</div>
                      </td>
                      <td className="px-3 py-2 text-xs text-[var(--text-muted)]">
                        <div>{record.role_name ?? 'Unknown role'}</div>
                        <div className="text-[10px]">{record.source_route ?? '—'}</div>
                      </td>
                      <td className="px-3 py-2 font-medium text-[var(--foreground)]">
                        <div>{record.action_type}</div>
                      </td>
                      <td className="px-3 py-2 text-[var(--text-muted)]">{record.entity_type}{record.entity_id ? ` / ${record.entity_id.slice(0, 8)}…` : ''}</td>
                      <td className="px-3 py-2 text-[var(--text-muted)]">{record.asset_id ? record.asset_id.slice(0, 8) + '…' : '—'}</td>
                      <td className="px-3 py-2"><Badge variant={statusVariant(record.sync_status)}>{record.sync_status}</Badge></td>
                      <td className="px-3 py-2 text-xs">
                        {detail ? (
                          <>
                            <Badge variant="error">{conflictTypeLabel(detail.conflict_type)}</Badge>
                            <p className="mt-1 text-[var(--text-muted)]">{detail.conflict_reason}</p>
                          </>
                        ) : (
                          <span className="text-[var(--text-muted)]">{record.last_error ?? '—'}</span>
                        )}
                      </td>
                      <td className="px-3 py-2 text-[var(--text-muted)]">{record.retry_count}</td>
                      <td className="px-3 py-2">
                        <div className="flex flex-wrap gap-1">
                          <button
                            type="button"
                            className="rounded-md border border-[var(--border-subtle)] px-2 py-1 text-xs hover:bg-[var(--surface-1)]"
                            onClick={() => setActiveRecord(record)}
                          >
                            Details
                          </button>
                          {route && (
                            <Link
                              href={route}
                              className="inline-flex items-center gap-1 rounded-md border border-[var(--border-subtle)] px-2 py-1 text-xs text-[var(--brand)] hover:bg-[var(--surface-1)]"
                            >
                              <ExternalLink className="h-3 w-3" />
                              Open
                            </Link>
                          )}
                          {(record.sync_status === 'failed' || record.sync_status === 'under_review') && record.metadata?.pending_not_supported !== true && (
                            <button
                              type="button"
                              disabled={isBusy || !sync.isOnline}
                              onClick={() => void onRetrySingle(record)}
                              className="rounded-md border border-[var(--border-subtle)] px-2 py-1 text-xs hover:bg-[var(--surface-1)] disabled:opacity-50"
                            >
                              Retry
                            </button>
                          )}
                          {record.sync_status === 'conflict' && (
                            <button
                              type="button"
                              disabled={isBusy}
                              onClick={() => void onMarkUnderReview(record)}
                              className="rounded-md border border-[var(--border-subtle)] px-2 py-1 text-xs hover:bg-[var(--surface-1)] disabled:opacity-50"
                            >
                              Under review
                            </button>
                          )}
                          {(record.sync_status === 'conflict' || record.sync_status === 'under_review' || record.sync_status === 'failed') && (
                            <>
                              <button
                                type="button"
                                disabled={isBusy}
                                onClick={() => void onMarkManualResolved(record)}
                                className="rounded-md border border-emerald-500/40 px-2 py-1 text-xs text-emerald-700 hover:bg-emerald-500/10 disabled:opacity-50 dark:text-emerald-300"
                              >
                                Manual resolve
                              </button>
                              <button
                                type="button"
                                disabled={isBusy}
                                onClick={() => void onDiscard(record)}
                                className="rounded-md border border-rose-500/40 px-2 py-1 text-xs text-rose-700 hover:bg-rose-500/10 disabled:opacity-50 dark:text-rose-300"
                              >
                                Discard
                              </button>
                            </>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Server Sync Events ({filteredServerEvents.length} of {serverSummary.totalEvents})</CardTitle>
          <Badge variant="info">Across users + devices</Badge>
        </CardHeader>
        <CardContent>
          <p className="mb-3 rounded-md border border-[var(--border-subtle)] bg-[var(--surface-1)] p-3 text-xs text-[var(--text-muted)]">
            {serverSummary.schemaNote}
          </p>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[1100px] text-left text-sm">
              <thead>
                <tr className="border-b border-[var(--border-subtle)] text-xs uppercase tracking-wide text-[var(--text-muted)]">
                  <th className="px-3 py-2">Created</th>
                  <th className="px-3 py-2">User / Role</th>
                  <th className="px-3 py-2">Action</th>
                  <th className="px-3 py-2">Entity</th>
                  <th className="px-3 py-2">Asset</th>
                  <th className="px-3 py-2">Reported status</th>
                  <th className="px-3 py-2">Conflict / Error</th>
                  <th className="px-3 py-2">Synced at</th>
                  <th className="px-3 py-2">Open</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--border-subtle)]/60">
                {filteredServerEvents.length === 0 ? (
                  <tr><td colSpan={9} className="px-3 py-6 text-center text-[var(--text-muted)]">No server sync events match the current filters.</td></tr>
                ) : filteredServerEvents.map((event) => {
                  const route = exactRouteForEvent(event);
                  return (
                    <tr key={event.id} className="align-top">
                      <td className="px-3 py-2 text-xs text-[var(--text-muted)]">{formatDateTime(event.created_at)}</td>
                      <td className="px-3 py-2 text-xs text-[var(--text-muted)]">
                        <div>{event.actor_full_name ?? event.actor_email ?? 'Unknown user'}</div>
                        <div className="text-[10px]">{event.role_name ?? '—'}</div>
                      </td>
                      <td className="px-3 py-2 font-medium text-[var(--foreground)]">{event.action_type}</td>
                      <td className="px-3 py-2 text-[var(--text-muted)]">{event.entity_type}{event.entity_id ? ` / ${event.entity_id.slice(0, 8)}…` : ''}</td>
                      <td className="px-3 py-2 text-[var(--text-muted)]">{event.asset_id ? event.asset_id.slice(0, 8) + '…' : '—'}</td>
                      <td className="px-3 py-2"><Badge variant={statusVariant(event.reported_status)}>{event.reported_status}</Badge></td>
                      <td className="px-3 py-2 text-xs">
                        {event.conflict_detail ? (
                          <>
                            <Badge variant="error">{conflictTypeLabel(event.conflict_detail.conflict_type)}</Badge>
                            <p className="mt-1 text-[var(--text-muted)]">{event.conflict_detail.conflict_reason}</p>
                          </>
                        ) : event.conflict_reason ? (
                          <span className="text-[var(--text-muted)]">{event.conflict_reason}</span>
                        ) : event.error_message ? (
                          <span className="text-[var(--text-muted)]">{event.error_message}</span>
                        ) : (
                          <span className="text-[var(--text-muted)]">—</span>
                        )}
                      </td>
                      <td className="px-3 py-2 text-xs text-[var(--text-muted)]">{event.synced_at ? formatDateTime(event.synced_at) : '—'}</td>
                      <td className="px-3 py-2">
                        {route ? (
                          <Link href={route} className="inline-flex items-center gap-1 text-xs text-[var(--brand)] hover:underline">
                            <ExternalLink className="h-3 w-3" />
                            Open
                          </Link>
                        ) : (
                          <span className="text-xs text-[var(--text-muted)]">—</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      {isDeveloper && (
        <Card>
          <CardHeader>
            <CardTitle>Developer Mismatch Diagnostics</CardTitle>
            <CheckCircle2 className="h-4 w-4 text-emerald-500" />
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <p className="text-[var(--text-muted)]">
              Compares this device&apos;s local queue against the most recent {serverSummary.totalEvents} server sync events. Local-only synced rows usually indicate they came from a prior session before clear-synced was used.
            </p>
            <ul className="list-disc space-y-1 pl-5 text-xs text-[var(--text-muted)]">
              <li>Local synced rows: {queue.filter((record) => record.sync_status === 'synced').length}</li>
              <li>Server synced events: {serverSummary.recentEvents.filter((event) => event.sync_status === 'synced').length}</li>
              <li>Local conflict / under review: {queue.filter((record) => record.sync_status === 'conflict' || record.sync_status === 'under_review').length}</li>
              <li>Server conflict-reasoned events: {serverSummary.inferredConflictEvents.length}</li>
            </ul>
            {sync.lastSyncAttemptAt && (
              <p className="text-xs text-[var(--text-muted)]">Last local sync attempt: {formatDateTime(sync.lastSyncAttemptAt)}</p>
            )}
            {sync.lastSyncError && (
              <p className="text-xs text-amber-700 dark:text-amber-300">Last sync error: {sync.lastSyncError}</p>
            )}
          </CardContent>
        </Card>
      )}

      {activeRecord && (
        <div
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 z-[100] flex items-end justify-center bg-black/40 p-0 sm:items-center sm:p-4"
          onClick={() => setActiveRecord(null)}
        >
          <div
            className="max-h-[100dvh] w-full max-w-2xl overflow-y-auto rounded-t-xl border border-[var(--border-subtle)] bg-[var(--surface-solid)] p-4 pb-[max(env(safe-area-inset-bottom),1rem)] sm:max-h-[90dvh] sm:rounded-lg"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="mb-3 flex items-start justify-between gap-3">
              <div>
                <p className="text-base font-semibold text-[var(--foreground)]">Offline action details</p>
                <p className="text-xs text-[var(--text-muted)]">{activeRecord.client_action_id}</p>
              </div>
              <button
                type="button"
                className="rounded-md border border-[var(--border-subtle)] px-2 py-1 text-xs"
                onClick={() => setActiveRecord(null)}
              >
                Close
              </button>
            </div>
            <div className="space-y-3 text-sm">
              <div className="grid grid-cols-1 gap-2 text-xs sm:grid-cols-2">
                <div><span className="text-[var(--text-muted)]">Action:</span> {activeRecord.action_type}</div>
                <div><span className="text-[var(--text-muted)]">Status:</span> {activeRecord.sync_status}</div>
                <div><span className="text-[var(--text-muted)]">Created:</span> {formatDateTime(activeRecord.created_at)}</div>
                <div><span className="text-[var(--text-muted)]">Role:</span> {activeRecord.role_name ?? '—'}</div>
                <div><span className="text-[var(--text-muted)]">Asset:</span> {activeRecord.asset_id ?? '—'}</div>
                <div><span className="text-[var(--text-muted)]">Entity:</span> {activeRecord.entity_type}{activeRecord.entity_id ? ` / ${activeRecord.entity_id}` : ''}</div>
                <div><span className="text-[var(--text-muted)]">Source route:</span> {activeRecord.source_route ?? '—'}</div>
                <div><span className="text-[var(--text-muted)]">Retries:</span> {activeRecord.retry_count}</div>
              </div>
              {(activeRecord.conflict_detail ?? deriveConflictDetail(activeRecord)) && (
                <div className="rounded-md border border-amber-500/30 bg-amber-500/5 p-3">
                  <p className="text-xs font-semibold text-amber-700 dark:text-amber-300">
                    {conflictTypeLabel((activeRecord.conflict_detail ?? deriveConflictDetail(activeRecord))!.conflict_type)}
                  </p>
                  <p className="mt-1 text-xs text-amber-700 dark:text-amber-300">
                    {(activeRecord.conflict_detail ?? deriveConflictDetail(activeRecord))!.conflict_reason}
                  </p>
                  {(activeRecord.conflict_detail ?? deriveConflictDetail(activeRecord))!.recommended_resolution && (
                    <p className="mt-2 text-xs text-amber-800 dark:text-amber-200">
                      Recommended: {(activeRecord.conflict_detail ?? deriveConflictDetail(activeRecord))!.recommended_resolution}
                    </p>
                  )}
                </div>
              )}
              {activeRecord.last_known_server_state && (
                <details>
                  <summary className="cursor-pointer text-xs font-medium text-[var(--text-muted)]">Last-known server state</summary>
                  <pre className="mt-2 max-h-48 overflow-auto rounded-md bg-[var(--surface-2)] p-2 text-[10px]">{JSON.stringify(activeRecord.last_known_server_state, null, 2)}</pre>
                </details>
              )}
              <details>
                <summary className="cursor-pointer text-xs font-medium text-[var(--text-muted)]">Local payload (read-only)</summary>
                <pre className="mt-2 max-h-72 overflow-auto rounded-md bg-[var(--surface-2)] p-2 text-[10px]">{JSON.stringify(activeRecord.payload, null, 2)}</pre>
              </details>
              {!isDeveloper && (
                <p className="rounded-md border border-[var(--border-subtle)] bg-[var(--surface-1)] p-2 text-[11px] text-[var(--text-muted)]">
                  Raw payload is shown read-only. Sync Review Center never lets users edit payloads — fix the
                  underlying server record first, then retry; or discard the local draft.
                </p>
              )}
            </div>
          </div>
        </div>
      )}

      {!sync.isOnline && (
        <p className="rounded-md border border-amber-500/30 bg-amber-500/5 p-3 text-xs text-amber-800 dark:text-amber-200">
          <AlertTriangle className="mr-1 inline h-3.5 w-3.5" />
          You are offline. Server sync events are loaded from the last server response. Retry, manual resolve, and
          server-side resolution audit will only run once the device is back online.
        </p>
      )}
    </div>
  );
}
