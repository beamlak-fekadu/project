'use client';

import { AlertTriangle, CheckCircle2, Clock, RefreshCw } from 'lucide-react';
import type { OfflineActionRunResult } from '@/types/offline';

type Props = {
  result: OfflineActionRunResult | null;
  className?: string;
};

export function OfflineActionResult({ result, className = '' }: Props) {
  if (!result) return null;

  if (result.status === 'success') {
    return (
      <div className={`rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-3 text-sm text-emerald-800 dark:text-emerald-200 ${className}`}>
        <span className="inline-flex items-center gap-2 font-medium"><CheckCircle2 className="h-4 w-4" /> Synced.</span>
      </div>
    );
  }

  if (result.status === 'queued') {
    return (
      <div className={`rounded-lg border border-cyan-500/30 bg-cyan-500/10 p-3 text-sm text-cyan-800 dark:text-cyan-200 ${className}`}>
        <span className="inline-flex items-center gap-2 font-medium"><Clock className="h-4 w-4" /> Saved offline — will sync when connection returns.</span>
      </div>
    );
  }

  if (result.status === 'conflict') {
    return (
      <div className={`rounded-lg border border-rose-500/30 bg-rose-500/10 p-3 text-sm text-rose-800 dark:text-rose-200 ${className}`}>
        <span className="inline-flex items-center gap-2 font-medium"><AlertTriangle className="h-4 w-4" /> Needs review.</span>
        <p className="mt-1 text-xs">{result.error}</p>
      </div>
    );
  }

  return (
    <div className={`rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-sm text-amber-800 dark:text-amber-200 ${className}`}>
      <span className="inline-flex items-center gap-2 font-medium"><RefreshCw className="h-4 w-4" /> Sync failed — retry available.</span>
      <p className="mt-1 text-xs">{result.error}</p>
    </div>
  );
}

export function OfflineQueuedBadge({ status = 'queued' }: { status?: 'queued' | 'failed' | 'conflict' | 'synced' | 'syncing' }) {
  const styles = {
    queued: 'border-cyan-500/30 bg-cyan-500/10 text-cyan-800 dark:text-cyan-200',
    syncing: 'border-violet-500/30 bg-violet-500/10 text-violet-800 dark:text-violet-200',
    synced: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-800 dark:text-emerald-200',
    failed: 'border-amber-500/30 bg-amber-500/10 text-amber-800 dark:text-amber-200',
    conflict: 'border-rose-500/30 bg-rose-500/10 text-rose-800 dark:text-rose-200',
  } as const;
  const label = status === 'queued' ? 'Queued locally' : status === 'failed' ? 'Sync failed' : status === 'conflict' ? 'Needs review' : status;
  return <span className={`inline-flex rounded-full border px-2.5 py-0.5 text-xs font-medium ${styles[status]}`}>{label}</span>;
}
