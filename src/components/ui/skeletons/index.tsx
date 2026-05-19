'use client';

import Skeleton from './Skeleton';

/** Mimics the standard PageHeader (title + subtitle + optional action row). */
export function PageHeaderSkeleton() {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
      <div className="space-y-2">
        <Skeleton className="h-3 w-24" />
        <Skeleton className="h-7 w-64" />
        <Skeleton className="h-3.5 w-80 max-w-full" />
      </div>
      <div className="flex gap-2">
        <Skeleton className="h-9 w-28" />
        <Skeleton className="h-9 w-28" />
      </div>
    </div>
  );
}

/** Grid of stat tiles matching the StatCard layout. */
export function CardGridSkeleton({
  count = 4,
  columns = 'sm:grid-cols-2 lg:grid-cols-4',
}: {
  count?: number;
  columns?: string;
}) {
  return (
    <div className={`grid gap-3 ${columns}`}>
      {Array.from({ length: count }).map((_, i) => (
        <div
          key={i}
          className="panel-surface rounded-2xl p-5"
        >
          <div className="flex items-start justify-between gap-3">
            <div className="flex-1 space-y-2">
              <Skeleton className="h-3 w-20" />
              <Skeleton className="h-7 w-16" />
              <Skeleton className="h-3 w-28" />
            </div>
            <Skeleton className="h-10 w-10 rounded-lg" />
          </div>
        </div>
      ))}
    </div>
  );
}

/** Replaces a DataTable while the data is loading. */
export function TableSkeleton({
  rows = 6,
  columns = 5,
}: { rows?: number; columns?: number }) {
  return (
    <div className="panel-surface rounded-2xl p-4">
      <div className="mb-3 flex items-center justify-between">
        <Skeleton className="h-4 w-40" />
        <Skeleton className="h-8 w-28" />
      </div>
      <div className="overflow-hidden rounded-lg border border-[var(--border-subtle)]">
        {/* header row */}
        <div
          className="grid gap-3 border-b border-[var(--border-subtle)] bg-[var(--surface-2)] px-4 py-3"
          style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}
        >
          {Array.from({ length: columns }).map((_, i) => (
            <Skeleton key={i} className="h-3 w-20" />
          ))}
        </div>
        {Array.from({ length: rows }).map((_, r) => (
          <div
            key={r}
            className="grid gap-3 border-b border-[var(--border-subtle)] px-4 py-3 last:border-b-0"
            style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}
          >
            {Array.from({ length: columns }).map((_, c) => (
              <Skeleton key={c} className="h-3.5 w-full max-w-[140px]" />
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

/** Full dashboard page skeleton: header + card grid + table. */
export function PageSkeleton() {
  return (
    <div className="space-y-6">
      <PageHeaderSkeleton />
      <CardGridSkeleton count={4} />
      <TableSkeleton rows={6} columns={5} />
    </div>
  );
}

/** Detail page skeleton — header + two-column body. */
export function DetailPageSkeleton() {
  return (
    <div className="space-y-6">
      <PageHeaderSkeleton />
      <div className="grid gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          <div className="panel-surface rounded-2xl p-5">
            <Skeleton className="mb-4 h-4 w-32" />
            <div className="space-y-3">
              <Skeleton className="h-3 w-full" />
              <Skeleton className="h-3 w-11/12" />
              <Skeleton className="h-3 w-10/12" />
              <Skeleton className="h-3 w-9/12" />
            </div>
          </div>
          <div className="panel-surface rounded-2xl p-5">
            <Skeleton className="mb-4 h-4 w-40" />
            <div className="grid gap-3 sm:grid-cols-2">
              <Skeleton className="h-16 w-full" />
              <Skeleton className="h-16 w-full" />
              <Skeleton className="h-16 w-full" />
              <Skeleton className="h-16 w-full" />
            </div>
          </div>
        </div>
        <div className="space-y-4">
          <div className="panel-surface rounded-2xl p-5">
            <Skeleton className="mb-3 h-4 w-28" />
            <div className="space-y-2">
              <Skeleton className="h-3 w-full" />
              <Skeleton className="h-3 w-11/12" />
              <Skeleton className="h-3 w-9/12" />
            </div>
          </div>
          <div className="panel-surface rounded-2xl p-5">
            <Skeleton className="mb-3 h-4 w-24" />
            <Skeleton className="h-28 w-full" />
          </div>
        </div>
      </div>
    </div>
  );
}

/** Form page skeleton — header + a stack of fields + submit row. */
export function FormSkeleton({ fields = 6 }: { fields?: number }) {
  return (
    <div className="space-y-6">
      <PageHeaderSkeleton />
      <div className="panel-surface mx-auto max-w-2xl rounded-2xl p-6">
        <div className="space-y-4">
          {Array.from({ length: fields }).map((_, i) => (
            <div key={i} className="space-y-1.5">
              <Skeleton className="h-3 w-24" />
              <Skeleton className="h-10 w-full" />
            </div>
          ))}
          <div className="flex justify-end gap-2 pt-2">
            <Skeleton className="h-10 w-24" />
            <Skeleton className="h-10 w-32" />
          </div>
        </div>
      </div>
    </div>
  );
}

/** Reports landing skeleton — header + grouped report tiles. */
export function ReportsLandingSkeleton() {
  return (
    <div className="space-y-6">
      <PageHeaderSkeleton />
      {Array.from({ length: 3 }).map((_, section) => (
        <div key={section} className="panel-surface rounded-2xl p-5">
          <Skeleton className="mb-2 h-5 w-56" />
          <Skeleton className="mb-4 h-3 w-80 max-w-full" />
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {Array.from({ length: 4 }).map((_, j) => (
              <div key={j} className="rounded-xl border border-[var(--border-subtle)] p-4">
                <Skeleton className="mb-2 h-4 w-36" />
                <Skeleton className="mb-3 h-3 w-full" />
                <Skeleton className="mb-3 h-3 w-10/12" />
                <Skeleton className="h-7 w-24" />
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

export { default as Skeleton } from './Skeleton';
