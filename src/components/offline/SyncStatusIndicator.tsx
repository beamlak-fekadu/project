'use client';

import Link from 'next/link';
import { AlertTriangle, CheckCircle2, RefreshCw, Wifi, WifiOff } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useOfflineSync } from './SyncEngineProvider';

type Props = {
  userRoles?: string[];
};

function statusTone(summary: ReturnType<typeof useOfflineSync>['summary'], isOnline: boolean, isSyncing: boolean) {
  if (summary.conflict > 0) return 'border-rose-500/40 bg-rose-500/10 text-rose-700 dark:text-rose-200';
  if (summary.failed > 0) return 'border-amber-500/40 bg-amber-500/10 text-amber-800 dark:text-amber-200';
  if (isSyncing) return 'border-cyan-500/40 bg-cyan-500/10 text-cyan-800 dark:text-cyan-200';
  if (!isOnline) return 'border-slate-500/40 bg-slate-500/10 text-slate-800 dark:text-slate-200';
  return 'border-emerald-500/40 bg-emerald-500/10 text-emerald-800 dark:text-emerald-200';
}

export default function SyncStatusIndicator({ userRoles = [] }: Props) {
  const sync = useOfflineSync();
  const [open, setOpen] = useState(false);
  const canOpenReview = userRoles.some((role) => ['developer', 'admin', 'bme_head'].includes(role));
  const canOpenDiagnostics = userRoles.includes('developer');
  const needsReview = sync.summary.needs_review ?? (sync.summary.conflict + (sync.summary.under_review ?? 0));

  const label = useMemo(() => {
    if (sync.isSyncing) return `Syncing ${sync.summary.queued || sync.summary.syncing} action${(sync.summary.queued || sync.summary.syncing) === 1 ? '' : 's'}`;
    if (needsReview > 0) return `${needsReview} need${needsReview === 1 ? 's' : ''} review`;
    if (sync.summary.failed > 0) return `${sync.summary.failed} failed`;
    if (!sync.isOnline && sync.summary.queued > 0) return `Offline - ${sync.summary.queued} queued`;
    if (!sync.isOnline) return 'Offline';
    if (sync.summary.queued > 0) return `Online - ${sync.summary.queued} queued`;
    return 'Online';
  }, [needsReview, sync.isOnline, sync.isSyncing, sync.summary.failed, sync.summary.queued, sync.summary.syncing]);

  const Icon = sync.summary.conflict > 0 || sync.summary.failed > 0
    ? AlertTriangle
    : sync.isSyncing
      ? RefreshCw
      : sync.isOnline
        ? Wifi
        : WifiOff;

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        className={`inline-flex h-9 items-center gap-2 rounded-full border px-3 text-xs font-medium transition-colors ${statusTone(sync.summary, sync.isOnline, sync.isSyncing)}`}
        title="Offline queue and sync status"
      >
        <Icon className={`h-3.5 w-3.5 ${sync.isSyncing ? 'animate-spin' : ''}`} />
        <span className="hidden sm:inline">{label}</span>
        <span className="sm:hidden">{sync.isOnline ? 'Online' : 'Offline'}</span>
      </button>

      {open && (
        <div className="absolute right-0 z-50 mt-2 w-80 rounded-lg border border-[var(--border-subtle)] bg-[var(--surface-solid)] p-3 text-sm shadow-lg">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="font-semibold text-[var(--foreground)]">Offline Sync</p>
              <p className="mt-1 text-xs text-[var(--text-muted)]">
                Local queue on this device only. Server sync is confirmed before actions are marked synced.
              </p>
            </div>
            {sync.summary.total === 0 ? (
              <CheckCircle2 className="h-4 w-4 text-emerald-500" />
            ) : (
              <AlertTriangle className="h-4 w-4 text-amber-500" />
            )}
          </div>

          <div className="mt-3 grid grid-cols-4 gap-2 text-xs">
            <div className="rounded-md border border-[var(--border-subtle)] p-2">
              <p className="text-[var(--text-muted)]">Queued</p>
              <p className="text-base font-semibold text-[var(--foreground)]">{sync.summary.queued}</p>
            </div>
            <div className="rounded-md border border-[var(--border-subtle)] p-2">
              <p className="text-[var(--text-muted)]">Failed</p>
              <p className="text-base font-semibold text-[var(--foreground)]">{sync.summary.failed}</p>
            </div>
            <div className="rounded-md border border-[var(--border-subtle)] p-2">
              <p className="text-[var(--text-muted)]">Conflict</p>
              <p className="text-base font-semibold text-[var(--foreground)]">{sync.summary.conflict}</p>
            </div>
            <div className="rounded-md border border-[var(--border-subtle)] p-2">
              <p className="text-[var(--text-muted)]">Review</p>
              <p className="text-base font-semibold text-[var(--foreground)]">{sync.summary.under_review ?? 0}</p>
            </div>
          </div>
          {sync.lastSyncResult && (
            <p className="mt-3 text-[10px] text-[var(--text-muted)]">
              Last sync run: {sync.lastSyncResult.synced} synced · {sync.lastSyncResult.failed} failed · {sync.lastSyncResult.conflicts} conflicts
            </p>
          )}

          {sync.lastSyncError && (
            <p className="mt-3 rounded-md border border-amber-500/30 bg-amber-500/10 p-2 text-xs text-amber-800 dark:text-amber-200">
              {sync.lastSyncError}
            </p>
          )}

          <div className="mt-3 flex items-center justify-between gap-2">
            <button
              type="button"
              onClick={() => void sync.startSync()}
              disabled={!sync.isOnline || sync.isSyncing || sync.summary.queued === 0}
              className="rounded-md border border-[var(--border-subtle)] px-3 py-1.5 text-xs font-medium text-[var(--foreground)] disabled:cursor-not-allowed disabled:opacity-50"
            >
              Retry queued
            </button>
            <div className="flex items-center gap-3">
              {canOpenReview ? (
                <Link
                  href="/offline-sync"
                  className="text-xs font-medium text-[var(--brand)] hover:underline"
                  onClick={() => setOpen(false)}
                >
                  Sync Review
                </Link>
              ) : null}
              {canOpenDiagnostics && (
                <Link
                  href="/developer-lab#offline-sync-diagnostics"
                  className="text-xs font-medium text-[var(--brand)] hover:underline"
                  onClick={() => setOpen(false)}
                >
                  Diagnostics
                </Link>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
