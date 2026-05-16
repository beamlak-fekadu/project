'use client';

import { useMemo, useState } from 'react';
import { Download, Printer } from 'lucide-react';
import { Badge, Button, Card, CardContent, CardHeader, CardTitle } from '@/components/ui';
import type { OfflineSyncEventEnriched, OfflineSyncServerSummary } from '@/services/offline-sync.service';
import { conflictTypeLabel } from '@/lib/offline/conflicts';

type Props = {
  summary: OfflineSyncServerSummary;
  events: OfflineSyncEventEnriched[];
};

function formatDateTime(value: string | null | undefined) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleString();
}

function exportCsv(filename: string, rows: Array<Record<string, unknown>>, columns: string[]) {
  if (typeof window === 'undefined') return;
  const escape = (value: unknown) => {
    if (value === null || value === undefined) return '';
    const text = typeof value === 'string' ? value : JSON.stringify(value);
    if (/[",\n]/.test(text)) return `"${text.replace(/"/g, '""')}"`;
    return text;
  };
  const meta = [
    `# BMERMS Offline Sync Evidence Report`,
    `# Generated: ${new Date().toISOString()}`,
    `# Source: offline_sync_events`,
    `# Total events in snapshot: ${rows.length}`,
  ].join('\n');
  const header = columns.join(',');
  const body = rows.map((row) => columns.map((col) => escape(row[col])).join(',')).join('\n');
  const blob = new Blob([`${meta}\n${header}\n${body}`], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

export default function OfflineSyncEvidenceClient({ summary, events }: Props) {
  const [filter, setFilter] = useState<'all' | 'failed' | 'conflict' | 'synced' | 'resolved_discarded'>('all');

  const filtered = useMemo(() => {
    if (filter === 'all') return events;
    if (filter === 'conflict') return events.filter((event) => event.conflict_reason || event.conflict_detail);
    if (filter === 'failed') return events.filter((event) => event.sync_status === 'failed');
    if (filter === 'synced') return events.filter((event) => event.sync_status === 'synced');
    return events.filter((event) => event.reported_status === 'resolved_discarded');
  }, [events, filter]);

  function exportAll() {
    exportCsv(`bmerms-offline-sync-evidence-${new Date().toISOString().slice(0, 10)}.csv`, filtered.map((event) => ({
      created_at: event.created_at,
      action_type: event.action_type,
      entity_type: event.entity_type,
      entity_id: event.entity_id ?? '',
      asset_id: event.asset_id ?? '',
      user: event.actor_full_name ?? event.actor_email ?? '',
      role: event.role_name ?? '',
      reported_status: event.reported_status,
      sync_status: event.sync_status,
      conflict_type: event.conflict_detail?.conflict_type ?? '',
      conflict_reason: event.conflict_reason ?? '',
      error_message: event.error_message ?? '',
      retry_count: event.retry_count ?? '',
      source_route: event.source_route ?? '',
      queued_at: event.queued_at ?? '',
      synced_at: event.synced_at ?? '',
    })), [
      'created_at', 'action_type', 'entity_type', 'entity_id', 'asset_id', 'user', 'role',
      'reported_status', 'sync_status', 'conflict_type', 'conflict_reason', 'error_message',
      'retry_count', 'source_route', 'queued_at', 'synced_at',
    ]);
  }

  return (
    <div className="space-y-6">
      <div className="grid gap-3 md:grid-cols-4">
        <Card>
          <p className="text-xs text-[var(--text-muted)]">Total events</p>
          <p className="mt-2 text-2xl font-semibold text-[var(--foreground)]">{summary.totalEvents}</p>
        </Card>
        <Card>
          <p className="text-xs text-[var(--text-muted)]">Failed</p>
          <p className="mt-2 text-2xl font-semibold text-[var(--foreground)]">{summary.recentFailedEvents.length}</p>
        </Card>
        <Card>
          <p className="text-xs text-[var(--text-muted)]">Conflict-reasoned</p>
          <p className="mt-2 text-2xl font-semibold text-[var(--foreground)]">{summary.inferredConflictEvents.length}</p>
        </Card>
        <Card>
          <p className="text-xs text-[var(--text-muted)]">Roles seen</p>
          <p className="mt-2 text-2xl font-semibold text-[var(--foreground)]">{summary.actionsByRole.length}</p>
        </Card>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex gap-2">
          {(['all', 'failed', 'conflict', 'synced', 'resolved_discarded'] as const).map((key) => (
            <button
              key={key}
              type="button"
              onClick={() => setFilter(key)}
              className={`rounded-md border px-3 py-1.5 text-xs font-medium ${filter === key ? 'border-[var(--brand)] bg-[var(--brand-soft)] text-[var(--brand)]' : 'border-[var(--border-subtle)] text-[var(--text-muted)] hover:bg-[var(--surface-1)]'}`}
            >
              {key.replace('_', ' ')}
            </button>
          ))}
        </div>
        <div className="flex gap-2">
          <Button size="sm" variant="outline" onClick={() => typeof window !== 'undefined' && window.print()}>
            <Printer className="h-4 w-4" />
            Print / Save as PDF
          </Button>
          <Button size="sm" variant="outline" onClick={exportAll}>
            <Download className="h-4 w-4" />
            Export CSV
          </Button>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Actions by Role</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid gap-2 md:grid-cols-2 lg:grid-cols-3">
            {summary.actionsByRole.length === 0 ? (
              <p className="text-sm text-[var(--text-muted)]">No role evidence yet.</p>
            ) : summary.actionsByRole.map((item) => (
              <div key={item.roleName} className="flex items-center justify-between rounded-md border border-[var(--border-subtle)] p-3">
                <span className="text-sm text-[var(--foreground)]">{item.roleName}</span>
                <Badge variant="info">{item.count}</Badge>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Actions by Action Type</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid gap-2 md:grid-cols-2 lg:grid-cols-3">
            {summary.actionsByActionType.length === 0 ? (
              <p className="text-sm text-[var(--text-muted)]">No action evidence yet.</p>
            ) : summary.actionsByActionType.map((item) => (
              <div key={item.actionType} className="flex items-center justify-between rounded-md border border-[var(--border-subtle)] p-3">
                <span className="font-mono text-xs text-[var(--foreground)]">{item.actionType}</span>
                <Badge variant="info">{item.count}</Badge>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Server Sync Events ({filtered.length})</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[1000px] text-left text-sm">
              <thead>
                <tr className="border-b border-[var(--border-subtle)] text-xs uppercase tracking-wide text-[var(--text-muted)]">
                  <th className="px-3 py-2">Created</th>
                  <th className="px-3 py-2">User / Role</th>
                  <th className="px-3 py-2">Action</th>
                  <th className="px-3 py-2">Entity</th>
                  <th className="px-3 py-2">Status</th>
                  <th className="px-3 py-2">Conflict / Error</th>
                  <th className="px-3 py-2">Source</th>
                  <th className="px-3 py-2">Synced at</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--border-subtle)]/60">
                {filtered.length === 0 ? (
                  <tr><td colSpan={8} className="px-3 py-6 text-center text-[var(--text-muted)]">No events match the current filter.</td></tr>
                ) : filtered.map((event) => (
                  <tr key={event.id} className="align-top">
                    <td className="px-3 py-2 text-xs text-[var(--text-muted)]">{formatDateTime(event.created_at)}</td>
                    <td className="px-3 py-2 text-xs text-[var(--text-muted)]">
                      <div>{event.actor_full_name ?? event.actor_email ?? 'Unknown user'}</div>
                      <div className="text-[10px]">{event.role_name ?? '—'}</div>
                    </td>
                    <td className="px-3 py-2 font-medium text-[var(--foreground)]">{event.action_type}</td>
                    <td className="px-3 py-2 text-[var(--text-muted)]">{event.entity_type}{event.entity_id ? ` / ${event.entity_id.slice(0, 8)}…` : ''}</td>
                    <td className="px-3 py-2"><Badge variant={event.sync_status === 'synced' ? 'success' : event.sync_status === 'failed' ? 'warning' : 'info'}>{event.reported_status}</Badge></td>
                    <td className="px-3 py-2 text-xs">
                      {event.conflict_detail ? (
                        <>
                          <Badge variant="error">{conflictTypeLabel(event.conflict_detail.conflict_type)}</Badge>
                          <div className="mt-1 text-[var(--text-muted)]">{event.conflict_detail.conflict_reason}</div>
                        </>
                      ) : event.conflict_reason ? (
                        <span className="text-[var(--text-muted)]">{event.conflict_reason}</span>
                      ) : event.error_message ? (
                        <span className="text-[var(--text-muted)]">{event.error_message}</span>
                      ) : (
                        <span className="text-[var(--text-muted)]">—</span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-xs text-[var(--text-muted)]">{event.source_route ?? '—'}</td>
                    <td className="px-3 py-2 text-xs text-[var(--text-muted)]">{event.synced_at ? formatDateTime(event.synced_at) : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
