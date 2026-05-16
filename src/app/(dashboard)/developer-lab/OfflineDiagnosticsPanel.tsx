'use client';

import Link from 'next/link';
import { Download, ExternalLink, RefreshCw, RotateCcw, Trash2 } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { Badge, Button, Card, CardContent, CardHeader, CardTitle } from '@/components/ui';
import { useOfflineSync } from '@/components/offline/SyncEngineProvider';
import { OFFLINE_CACHE_CHANGED_EVENT, OFFLINE_QUEUE_CHANGED_EVENT } from '@/lib/offline/db';
import {
  clearSyncedActions,
  getFailedActions,
  getOfflineQueue,
  retryOfflineAction,
} from '@/lib/offline/queue';
import { clearOfflineReadCache, formatCacheAge, getCacheSummary, type CacheSummary } from '@/lib/offline/cache';
import { OFFLINE_ACTION_TYPES, type OfflineQueueRecord } from '@/types/offline';
import { conflictTypeLabel, deriveConflictDetail } from '@/lib/offline/conflicts';
import type { OfflineSyncServerSummary } from '@/services/offline-sync.service';

type Props = {
  serverSummary: OfflineSyncServerSummary;
};

type ServiceWorkerState = {
  supported: boolean;
  registered: boolean | null;
  state: string;
};

type CacheState = {
  supported: boolean;
  appShellCached: boolean | null;
};

function formatDateTime(value: string | null | undefined) {
  if (!value) return 'Not available';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Not available';
  return date.toLocaleString();
}

function statusVariant(status: string): 'default' | 'success' | 'warning' | 'error' | 'info' | 'purple' {
  if (status === 'synced') return 'success';
  if (status === 'failed') return 'warning';
  if (status === 'conflict') return 'error';
  if (status === 'syncing') return 'purple';
  if (status === 'queued' || status === 'pending') return 'info';
  return 'default';
}

function summarizePayload(payload: unknown) {
  if (!payload || typeof payload !== 'object') return 'No payload';
  const keys = Object.keys(payload as Record<string, unknown>);
  return keys.length > 0 ? keys.slice(0, 5).join(', ') : 'Empty payload';
}

function queueCountsBy(queue: OfflineQueueRecord[], key: 'action_type' | 'role_name') {
  const counts = new Map<string, number>();
  for (const action of queue) {
    const value = key === 'role_name' ? action.role_name ?? 'unknown' : action.action_type;
    counts.set(value, (counts.get(value) ?? 0) + 1);
  }
  return Array.from(counts.entries()).sort((a, b) => b[1] - a[1]);
}

export default function OfflineDiagnosticsPanel({ serverSummary }: Props) {
  const sync = useOfflineSync();
  const [queue, setQueue] = useState<OfflineQueueRecord[]>([]);
  const [serviceWorker, setServiceWorker] = useState<ServiceWorkerState>({
    supported: false,
    registered: null,
    state: 'Unknown',
  });
  const [cacheState, setCacheState] = useState<CacheState>({
    supported: false,
    appShellCached: null,
  });
  const [localError, setLocalError] = useState<string | null>(null);
  const [cacheSummary, setCacheSummary] = useState<CacheSummary | null>(null);
  const [appShellVersion, setAppShellVersion] = useState<string>('Unknown');

  const refreshCacheSummary = useCallback(async () => {
    try {
      setCacheSummary(await getCacheSummary());
    } catch (error) {
      if (process.env.NODE_ENV !== 'production') {
        console.warn('[offline-diagnostics] Failed to read cache summary', error);
      }
    }
  }, []);

  const refreshQueue = useCallback(async () => {
    try {
      setQueue(await getOfflineQueue());
      setLocalError(null);
      await sync.refreshSummary();
    } catch (error) {
      setLocalError(error instanceof Error ? error.message : 'Failed to read local offline queue');
    }
  }, [sync]);

  const refreshBrowserDiagnostics = useCallback(async () => {
    if (typeof navigator !== 'undefined' && 'serviceWorker' in navigator) {
      const registration = await navigator.serviceWorker.getRegistration().catch(() => null);
      setServiceWorker({
        supported: true,
        registered: registration !== undefined && registration !== null,
        state: registration?.active?.state ?? registration?.waiting?.state ?? registration?.installing?.state ?? 'Unknown',
      });
    } else {
      setServiceWorker({ supported: false, registered: null, state: 'Unsupported' });
    }

    if (typeof window !== 'undefined' && 'caches' in window) {
      const keys = await caches.keys().catch(() => null);
      if (keys === null) {
        setCacheState({ supported: true, appShellCached: null });
        setAppShellVersion('Unknown');
      } else {
        const shellKey = keys.find((key) => key.startsWith('bmerms-app-shell-')) ?? null;
        setCacheState({ supported: true, appShellCached: shellKey !== null });
        setAppShellVersion(shellKey ?? 'Not present');
      }
    } else {
      setCacheState({ supported: false, appShellCached: null });
      setAppShellVersion('Unsupported');
    }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void refreshQueue();
      void refreshBrowserDiagnostics();
      void refreshCacheSummary();
    }, 0);
    const handleQueueChange = () => {
      void refreshQueue();
    };
    const handleCacheChange = () => {
      void refreshCacheSummary();
    };
    window.addEventListener(OFFLINE_QUEUE_CHANGED_EVENT, handleQueueChange);
    window.addEventListener(OFFLINE_CACHE_CHANGED_EVENT, handleCacheChange);
    window.addEventListener('bmerms:service-worker-ready', refreshBrowserDiagnostics);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener(OFFLINE_QUEUE_CHANGED_EVENT, handleQueueChange);
      window.removeEventListener(OFFLINE_CACHE_CHANGED_EVENT, handleCacheChange);
      window.removeEventListener('bmerms:service-worker-ready', refreshBrowserDiagnostics);
    };
  }, [refreshBrowserDiagnostics, refreshCacheSummary, refreshQueue]);

  async function retryFailedActions() {
    const failed = await getFailedActions();
    for (const action of failed) {
      await retryOfflineAction(action.client_action_id).catch(() => undefined);
    }
    await refreshQueue();
    await sync.startSync();
  }

  async function clearSynced() {
    await clearSyncedActions();
    await refreshQueue();
  }

  function exportQueueJson() {
    const blob = new Blob([JSON.stringify(queue, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `bmerms-offline-queue-${new Date().toISOString().slice(0, 10)}.json`;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  const localActionsByType = queueCountsBy(queue, 'action_type');
  const localActionsByRole = queueCountsBy(queue, 'role_name');
  const unsupportedLocalActions = queue.filter((action) => {
    if (!OFFLINE_ACTION_TYPES.includes(action.action_type)) return true;
    return action.metadata?.pending_not_supported === true;
  });

  return (
    <section id="offline-sync-diagnostics" className="space-y-4 scroll-mt-20">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-[var(--foreground)]">Offline & Sync Diagnostics</h2>
          <p className="text-sm text-[var(--text-muted)]">
            Phase 3 oversight: service worker, app shell cache version, local IndexedDB queue, read cache summary, sync handlers, conflict resolution, and server sync event evidence.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link href="/offline-sync" className="inline-flex items-center gap-1 rounded-md border border-[var(--border-subtle)] bg-[var(--surface-1)] px-3 py-1.5 text-xs font-medium text-[var(--brand)] hover:bg-[var(--surface-2)]">
            <ExternalLink className="h-3.5 w-3.5" />
            Open Sync Review Center
          </Link>
          <Link href="/reports/offline-sync-evidence" className="inline-flex items-center gap-1 rounded-md border border-[var(--border-subtle)] bg-[var(--surface-1)] px-3 py-1.5 text-xs font-medium text-[var(--brand)] hover:bg-[var(--surface-2)]">
            <ExternalLink className="h-3.5 w-3.5" />
            Offline Sync Evidence Report
          </Link>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <Card>
          <p className="text-sm text-[var(--text-muted)]">Service worker</p>
          <div className="mt-2 flex items-center gap-2">
            <Badge variant={serviceWorker.registered ? 'success' : serviceWorker.registered === false ? 'warning' : 'default'}>
              {serviceWorker.supported ? serviceWorker.registered === null ? 'Unknown' : serviceWorker.registered ? 'Registered' : 'Not registered' : 'Unsupported'}
            </Badge>
            <span className="text-xs text-[var(--text-muted)]">{serviceWorker.state}</span>
          </div>
        </Card>
        <Card>
          <p className="text-sm text-[var(--text-muted)]">App shell cache</p>
          <div className="mt-2">
            <Badge variant={cacheState.appShellCached ? 'success' : cacheState.appShellCached === false ? 'warning' : 'default'}>
              {cacheState.supported ? cacheState.appShellCached === null ? 'Unknown' : cacheState.appShellCached ? 'Cached' : 'Not cached' : 'Unsupported'}
            </Badge>
          </div>
          <p className="mt-1 text-[10px] text-[var(--text-muted)]">Version: {appShellVersion}</p>
        </Card>
        <Card>
          <p className="text-sm text-[var(--text-muted)]">Network</p>
          <div className="mt-2">
            <Badge variant={sync.isOnline ? 'success' : 'warning'}>{sync.onlineStatus}</Badge>
          </div>
        </Card>
        <Card>
          <p className="text-sm text-[var(--text-muted)]">Last sync attempt</p>
          <p className="mt-2 text-sm font-medium text-[var(--foreground)]">{formatDateTime(sync.lastSyncAttemptAt)}</p>
        </Card>
      </div>

      <div className="grid gap-4 md:grid-cols-5">
        {([
          ['Queued', sync.summary.queued, 'info'],
          ['Syncing', sync.summary.syncing, 'purple'],
          ['Synced', sync.summary.synced, 'success'],
          ['Failed', sync.summary.failed, 'warning'],
          ['Conflict', sync.summary.conflict, 'error'],
        ] as const).map(([label, count, variant]) => (
          <Card key={label}>
            <p className="text-sm text-[var(--text-muted)]">{label}</p>
            <div className="mt-2 flex items-center justify-between">
              <p className="text-2xl font-semibold text-[var(--foreground)]">{count}</p>
              <Badge variant={variant}>{label}</Badge>
            </div>
          </Card>
        ))}
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Local Queue</CardTitle>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="outline" onClick={() => void refreshQueue()}>
              <RefreshCw className="h-4 w-4" />
              Refresh
            </Button>
            <Button size="sm" variant="outline" onClick={() => void retryFailedActions()} disabled={sync.summary.failed === 0}>
              <RotateCcw className="h-4 w-4" />
              Retry Failed
            </Button>
            <Button size="sm" variant="outline" onClick={() => void clearSynced()} disabled={sync.summary.synced === 0}>
              <Trash2 className="h-4 w-4" />
              Clear Synced
            </Button>
            <Button size="sm" variant="outline" onClick={exportQueueJson} disabled={queue.length === 0}>
              <Download className="h-4 w-4" />
              Export JSON
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {localError && (
            <p className="mb-3 rounded-md border border-rose-500/30 bg-rose-500/10 p-2 text-sm text-rose-700 dark:text-rose-200">
              {localError}
            </p>
          )}
          {sync.lastSyncError && (
            <p className="mb-3 rounded-md border border-amber-500/30 bg-amber-500/10 p-2 text-sm text-amber-800 dark:text-amber-200">
              Last sync error: {sync.lastSyncError}
            </p>
          )}
          <div className="overflow-x-auto">
            <div className="mb-4 grid gap-3 lg:grid-cols-3">
              <div className="rounded-lg border border-[var(--border-subtle)] p-3">
                <p className="text-xs font-medium uppercase tracking-wide text-[var(--text-muted)]">Queued by type</p>
                <div className="mt-2 space-y-1">
                  {localActionsByType.length === 0 ? <p className="text-xs text-[var(--text-muted)]">No local actions</p> : localActionsByType.map(([type, count]) => (
                    <div key={type} className="flex items-center justify-between gap-2 text-xs">
                      <span className="truncate text-[var(--foreground)]">{type}</span>
                      <Badge variant="info">{count}</Badge>
                    </div>
                  ))}
                </div>
              </div>
              <div className="rounded-lg border border-[var(--border-subtle)] p-3">
                <p className="text-xs font-medium uppercase tracking-wide text-[var(--text-muted)]">Queued by role</p>
                <div className="mt-2 space-y-1">
                  {localActionsByRole.length === 0 ? <p className="text-xs text-[var(--text-muted)]">No local role data</p> : localActionsByRole.map(([role, count]) => (
                    <div key={role} className="flex items-center justify-between gap-2 text-xs">
                      <span className="truncate text-[var(--foreground)]">{role}</span>
                      <Badge variant="purple">{count}</Badge>
                    </div>
                  ))}
                </div>
              </div>
              <div className="rounded-lg border border-[var(--border-subtle)] p-3">
                <p className="text-xs font-medium uppercase tracking-wide text-[var(--text-muted)]">Unsupported / future</p>
                <p className="mt-2 text-2xl font-semibold text-[var(--foreground)]">{unsupportedLocalActions.length}</p>
                <p className="mt-1 text-xs text-[var(--text-muted)]">Actions with no registered replay handler stay in the local queue.</p>
              </div>
            </div>
            <table className="w-full min-w-[960px] text-left text-sm">
              <thead>
                <tr className="border-b border-[var(--border-subtle)] text-xs uppercase tracking-wide text-[var(--text-muted)]">
                  <th className="px-3 py-2">Created</th>
                  <th className="px-3 py-2">Status</th>
                  <th className="px-3 py-2">Action</th>
                  <th className="px-3 py-2">Entity</th>
                  <th className="px-3 py-2">Route</th>
                  <th className="px-3 py-2">Retries</th>
                  <th className="px-3 py-2">Last Error</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--border-subtle)]/60">
                {queue.length === 0 ? (
                  <tr>
                    <td className="px-3 py-6 text-center text-[var(--text-muted)]" colSpan={7}>
                      No local offline actions on this device.
                    </td>
                  </tr>
                ) : queue.map((action) => {
                  const detail = action.conflict_detail ?? deriveConflictDetail(action);
                  return (
                    <tr key={action.client_action_id} className="align-top">
                      <td className="px-3 py-2 text-xs text-[var(--text-muted)]">{formatDateTime(action.created_at)}</td>
                      <td className="px-3 py-2"><Badge variant={statusVariant(action.sync_status)}>{action.sync_status}</Badge></td>
                      <td className="px-3 py-2 font-medium text-[var(--foreground)]">
                        <div>{action.action_type}</div>
                        <details className="mt-1 text-xs font-normal text-[var(--text-muted)]">
                          <summary className="cursor-pointer">Inspect payload</summary>
                          <pre className="mt-2 max-h-40 overflow-auto rounded-md bg-[var(--surface-2)] p-2 text-[10px]">{JSON.stringify(action.payload, null, 2)}</pre>
                        </details>
                      </td>
                      <td className="px-3 py-2 text-[var(--text-muted)]">{action.entity_type}{action.entity_id ? ` / ${action.entity_id}` : ''}</td>
                      <td className="px-3 py-2 text-[var(--text-muted)]">{action.source_route ?? 'Not captured'}</td>
                      <td className="px-3 py-2 text-[var(--text-muted)]">{action.retry_count}</td>
                      <td className="px-3 py-2 text-[var(--text-muted)]">
                        {detail ? (
                          <>
                            <Badge variant="error">{conflictTypeLabel(detail.conflict_type)}</Badge>
                            <div className="mt-1 text-[11px]">{detail.conflict_reason}</div>
                          </>
                        ) : (action.last_error ?? '—')}
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
          <CardTitle>Offline Read Cache</CardTitle>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="outline" onClick={() => void refreshCacheSummary()}>
              <RefreshCw className="h-4 w-4" />
              Refresh
            </Button>
            <Button size="sm" variant="outline" onClick={async () => { await clearOfflineReadCache(); await refreshCacheSummary(); }} disabled={(cacheSummary?.total ?? 0) === 0}>
              <Trash2 className="h-4 w-4" />
              Clear All Read Cache
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {!cacheSummary ? (
            <p className="text-sm text-[var(--text-muted)]">Loading cache summary…</p>
          ) : cacheSummary.total === 0 ? (
            <p className="text-sm text-[var(--text-muted)]">No read cache entries. Cache is populated by role-aware pages after a successful online load.</p>
          ) : (
            <div className="space-y-3">
              <div className="grid gap-3 md:grid-cols-3">
                <div className="rounded-lg border border-[var(--border-subtle)] p-3">
                  <p className="text-xs text-[var(--text-muted)]">Cached views</p>
                  <p className="mt-1 text-2xl font-semibold text-[var(--foreground)]">{cacheSummary.total}</p>
                </div>
                <div className="rounded-lg border border-[var(--border-subtle)] p-3">
                  <p className="text-xs text-[var(--text-muted)]">Profiles with cache</p>
                  <p className="mt-1 text-2xl font-semibold text-[var(--foreground)]">{cacheSummary.byProfile.length}</p>
                </div>
                <div className="rounded-lg border border-[var(--border-subtle)] p-3">
                  <p className="text-xs text-[var(--text-muted)]">Stale entries</p>
                  <p className="mt-1 text-2xl font-semibold text-[var(--foreground)]">{cacheSummary.entries.filter((e) => e.isStale).length}</p>
                </div>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[700px] text-left text-sm">
                  <thead>
                    <tr className="border-b border-[var(--border-subtle)] text-xs uppercase tracking-wide text-[var(--text-muted)]">
                      <th className="px-3 py-2">Cache key</th>
                      <th className="px-3 py-2">Role</th>
                      <th className="px-3 py-2">Department</th>
                      <th className="px-3 py-2">Cached at</th>
                      <th className="px-3 py-2">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[var(--border-subtle)]/60">
                    {cacheSummary.entries.slice(0, 25).map((entry) => (
                      <tr key={entry.cacheKey + entry.profileId + (entry.departmentId ?? 'no-dept')}>
                        <td className="px-3 py-2 font-medium text-[var(--foreground)]">{entry.cacheKey}</td>
                        <td className="px-3 py-2 text-[var(--text-muted)]">{entry.roleName}</td>
                        <td className="px-3 py-2 text-[var(--text-muted)]">{entry.departmentId ?? '—'}</td>
                        <td className="px-3 py-2 text-[var(--text-muted)]">{formatCacheAge(entry.cachedAt)}</td>
                        <td className="px-3 py-2"><Badge variant={entry.isStale ? 'warning' : 'success'}>{entry.isStale ? 'Stale' : 'Fresh'}</Badge></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Local ↔ Server Mismatch Warnings</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          {(() => {
            const localPendingNotSupported = queue.filter((record) => record.metadata?.pending_not_supported === true).length;
            const localConflicts = queue.filter((record) => record.sync_status === 'conflict' || record.sync_status === 'under_review').length;
            const serverFailures = serverSummary.recentFailedEvents.length;
            const serverConflictReasoned = serverSummary.inferredConflictEvents.length;
            const warnings: Array<{ label: string; tone: 'warning' | 'info' | 'error' }> = [];
            if (localConflicts > serverConflictReasoned) {
              warnings.push({ label: `${localConflicts} local conflicts vs ${serverConflictReasoned} server-reasoned conflicts: some conflicts have not been replayed online.`, tone: 'warning' });
            }
            if (serverFailures === 0 && queue.filter((r) => r.sync_status === 'synced').length > 0) {
              warnings.push({ label: 'Local queue contains synced rows but server has no recorded failures — confirm server schema accepts offline_sync_events from current user.', tone: 'info' });
            }
            if (localPendingNotSupported > 0) {
              warnings.push({ label: `${localPendingNotSupported} local actions have no registered sync handler and will never replay.`, tone: 'warning' });
            }
            const localActionTypes = new Set(queue.map((r) => r.action_type));
            const serverActionTypes = new Set(serverSummary.actionsByActionType.map((entry) => entry.actionType));
            const missingServerSide: string[] = [];
            for (const type of localActionTypes) {
              if (!serverActionTypes.has(type)) missingServerSide.push(type);
            }
            if (missingServerSide.length > 0) {
              warnings.push({ label: `Local action types with no server evidence: ${missingServerSide.slice(0, 5).join(', ')}`, tone: 'info' });
            }
            return warnings.length === 0 ? (
              <p className="text-[var(--text-muted)]">No local↔server mismatches detected.</p>
            ) : (
              <ul className="space-y-2">
                {warnings.map((warning) => (
                  <li key={warning.label} className="flex items-start gap-2">
                    <Badge variant={warning.tone === 'error' ? 'error' : warning.tone === 'warning' ? 'warning' : 'info'}>{warning.tone}</Badge>
                    <span className="text-[var(--text-muted)]">{warning.label}</span>
                  </li>
                ))}
              </ul>
            );
          })()}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Server Sync Event Evidence</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="rounded-md border border-[var(--border-subtle)] bg-[var(--surface-1)] p-3 text-xs text-[var(--text-muted)]">
            {serverSummary.schemaNote}
          </p>
          <div className="grid gap-3 md:grid-cols-3">
            <div className="rounded-lg border border-[var(--border-subtle)] p-3">
              <p className="text-xs text-[var(--text-muted)]">Recent events</p>
              <p className="mt-1 text-2xl font-semibold text-[var(--foreground)]">{serverSummary.recentEvents.length}</p>
            </div>
            <div className="rounded-lg border border-[var(--border-subtle)] p-3">
              <p className="text-xs text-[var(--text-muted)]">Failed events</p>
              <p className="mt-1 text-2xl font-semibold text-[var(--foreground)]">{serverSummary.recentFailedEvents.length}</p>
            </div>
            <div className="rounded-lg border border-[var(--border-subtle)] p-3">
              <p className="text-xs text-[var(--text-muted)]">Inferred conflicts</p>
              <p className="mt-1 text-2xl font-semibold text-[var(--foreground)]">{serverSummary.inferredConflictEvents.length}</p>
            </div>
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <div className="overflow-x-auto rounded-lg border border-[var(--border-subtle)]">
              <table className="w-full min-w-[620px] text-left text-sm">
                <thead>
                  <tr className="border-b border-[var(--border-subtle)] text-xs uppercase tracking-wide text-[var(--text-muted)]">
                    <th className="px-3 py-2">Created</th>
                    <th className="px-3 py-2">Status</th>
                    <th className="px-3 py-2">Action</th>
                    <th className="px-3 py-2">Payload keys</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--border-subtle)]/60">
                  {serverSummary.recentEvents.length === 0 ? (
                    <tr><td colSpan={4} className="px-3 py-6 text-center text-[var(--text-muted)]">No server sync events recorded yet.</td></tr>
                  ) : serverSummary.recentEvents.map((event) => (
                    <tr key={event.id}>
                      <td className="px-3 py-2 text-xs text-[var(--text-muted)]">{formatDateTime(event.created_at)}</td>
                      <td className="px-3 py-2"><Badge variant={statusVariant(event.sync_status)}>{event.sync_status}</Badge></td>
                      <td className="px-3 py-2 text-[var(--foreground)]">{event.action_type}</td>
                      <td className="px-3 py-2 text-[var(--text-muted)]">{summarizePayload(event.payload)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="rounded-lg border border-[var(--border-subtle)] p-3">
              <p className="text-sm font-semibold text-[var(--foreground)]">Actions by role</p>
              <div className="mt-3 space-y-2">
                {serverSummary.actionsByRole.length === 0 ? (
                  <p className="text-sm text-[var(--text-muted)]">No role evidence captured yet.</p>
                ) : serverSummary.actionsByRole.map((item) => (
                  <div key={item.roleName} className="flex items-center justify-between rounded-md border border-[var(--border-subtle)] px-3 py-2 text-sm">
                    <span className="text-[var(--foreground)]">{item.roleName}</span>
                    <Badge variant="info">{item.count}</Badge>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </CardContent>
      </Card>
    </section>
  );
}
