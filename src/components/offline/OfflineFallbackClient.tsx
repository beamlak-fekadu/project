'use client';

import Link from 'next/link';
import { RefreshCcw } from 'lucide-react';
import { useEffect, useState } from 'react';
import Button from '@/components/ui/Button';
import { useOnlineStatus } from '@/hooks/useOnlineStatus';
import { getOfflineQueueSummary } from '@/lib/offline/queue';
import type { OfflineQueueSummary } from '@/types/offline';
import NetworkStatusPill from './NetworkStatusPill';

const emptySummary: OfflineQueueSummary = {
  total: 0,
  queued: 0,
  syncing: 0,
  synced: 0,
  failed: 0,
  conflict: 0,
  under_review: 0,
  resolved_discarded: 0,
  needs_review: 0,
  lastCreatedAt: null,
  lastAttemptedAt: null,
  lastSyncedAt: null,
  lastError: null,
};

export default function OfflineFallbackClient() {
  const status = useOnlineStatus();
  const [summary, setSummary] = useState<OfflineQueueSummary>(emptySummary);

  useEffect(() => {
    void getOfflineQueueSummary().then(setSummary).catch(() => setSummary(emptySummary));
  }, []);

  return (
    <div className="mt-6 space-y-4">
      <div className="flex justify-center">
        <NetworkStatusPill />
      </div>

      <div className="grid gap-3 text-left sm:grid-cols-3">
        <div className="rounded-lg border border-[var(--border-subtle)] bg-[var(--surface-1)] p-3">
          <p className="text-xs text-[var(--text-muted)]">Queued actions</p>
          <p className="mt-1 text-2xl font-semibold text-[var(--foreground)]">{summary.queued}</p>
        </div>
        <div className="rounded-lg border border-[var(--border-subtle)] bg-[var(--surface-1)] p-3">
          <p className="text-xs text-[var(--text-muted)]">Failed</p>
          <p className="mt-1 text-2xl font-semibold text-[var(--foreground)]">{summary.failed}</p>
        </div>
        <div className="rounded-lg border border-[var(--border-subtle)] bg-[var(--surface-1)] p-3">
          <p className="text-xs text-[var(--text-muted)]">Conflict</p>
          <p className="mt-1 text-2xl font-semibold text-[var(--foreground)]">{summary.conflict}</p>
        </div>
      </div>

      <div className="flex flex-col gap-2 sm:flex-row sm:justify-center">
        <Button type="button" variant="primary" onClick={() => window.location.reload()}>
          <RefreshCcw className="h-4 w-4" />
          Retry
        </Button>
        <Link href="/command">
          <Button type="button" variant="outline" className="w-full sm:w-auto">
            Open Dashboard
          </Button>
        </Link>
      </div>

      <p className="text-xs text-[var(--text-muted)]">
        {status.isOnline
          ? 'Connection looks available. Retry to load fresh server data.'
          : 'This device must open BMERMS once online before the app shell can load during an outage.'}
      </p>
    </div>
  );
}
