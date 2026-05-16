'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { Database, CloudOff } from 'lucide-react';
import { formatCacheAge, getCacheSummary, type CacheSummary } from '@/lib/offline/cache';
import { OFFLINE_CACHE_CHANGED_EVENT } from '@/lib/offline/db';

const CACHE_KEY_LABELS: Record<string, { label: string; href: string; description: string }> = {
  'department.equipment': {
    label: 'Department Equipment',
    href: '/equipment',
    description: 'Your department asset list with condition and open work flags.',
  },
  'technician.assigned_work': {
    label: 'My Assigned Work',
    href: '/work-orders',
    description: 'Work orders currently assigned to you.',
  },
  'store.stock_list': {
    label: 'Spare Parts Stock',
    href: '/spare-parts',
    description: 'Parts catalog with current stock and reorder levels.',
  },
  'viewer.executive_summary': {
    label: 'Executive Snapshot',
    href: '/command',
    description: 'Read-only executive dashboard summary.',
  },
  'bme_head.operational_summary': {
    label: 'Operational Summary',
    href: '/command',
    description: 'BME Head operational overview snapshot.',
  },
};

export default function CachedSnapshotList() {
  const [summary, setSummary] = useState<CacheSummary | null>(null);

  useEffect(() => {
    void getCacheSummary().then(setSummary).catch(() => setSummary({ total: 0, entries: [], byProfile: [], byRole: [] }));
    const handle = () => {
      void getCacheSummary().then(setSummary).catch(() => undefined);
    };
    window.addEventListener(OFFLINE_CACHE_CHANGED_EVENT, handle);
    return () => window.removeEventListener(OFFLINE_CACHE_CHANGED_EVENT, handle);
  }, []);

  if (!summary) {
    return (
      <div className="mt-6 rounded-lg border border-[var(--border-subtle)] bg-[var(--surface-1)] p-4 text-left text-sm text-[var(--text-muted)]">
        Loading cached views…
      </div>
    );
  }

  if (summary.total === 0) {
    return (
      <div className="mt-6 rounded-lg border border-[var(--border-subtle)] bg-[var(--surface-1)] p-4 text-left text-sm text-[var(--text-muted)]">
        <p className="font-medium text-[var(--foreground)]">No cached views on this device yet.</p>
        <p className="mt-1 text-xs">
          When this device is online, open BMERMS pages relevant to your role so they can be cached for offline use.
        </p>
      </div>
    );
  }

  return (
    <div className="mt-6 space-y-3 text-left">
      <div className="flex items-center gap-2 text-xs text-[var(--text-muted)]">
        <Database className="h-3.5 w-3.5" />
        {summary.total} cached view{summary.total === 1 ? '' : 's'} on this device. Each entry is scoped to one profile/role/department.
      </div>
      <div className="grid gap-2">
        {summary.entries.map((entry) => {
          const meta = CACHE_KEY_LABELS[entry.cacheKey] ?? {
            label: entry.cacheKey,
            href: '/command',
            description: 'Cached snapshot.',
          };
          return (
            <Link
              key={entry.cacheKey + entry.profileId + (entry.departmentId ?? 'no-dept')}
              href={meta.href}
              className="block rounded-lg border border-[var(--border-subtle)] bg-[var(--surface-1)] p-3 transition-colors hover:border-[var(--brand)]/50"
            >
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-sm font-semibold text-[var(--foreground)]">{meta.label}</p>
                  <p className="mt-1 text-xs text-[var(--text-muted)]">{meta.description}</p>
                </div>
                <span className="shrink-0 text-[10px] uppercase tracking-wide text-[var(--text-muted)]">
                  {entry.isStale ? 'Stale' : 'Fresh'}
                </span>
              </div>
              <div className="mt-2 flex flex-wrap items-center gap-3 text-[10px] text-[var(--text-muted)]">
                <span className="inline-flex items-center gap-1">
                  <CloudOff className="h-3 w-3" />
                  {formatCacheAge(entry.cachedAt)}
                </span>
                <span>Role: {entry.roleName}</span>
                {entry.departmentId && <span>Dept: {entry.departmentId.slice(0, 8)}…</span>}
              </div>
            </Link>
          );
        })}
      </div>
      <p className="text-xs text-[var(--text-muted)]">
        Cached data is read-only. New work created while offline goes through the local queue and syncs after reconnect.
      </p>
    </div>
  );
}
