'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { AlertTriangle, ClipboardCheck, PackageCheck, Timer, Truck, Warehouse } from 'lucide-react';
import { PageHeader, Badge, StatCard } from '@/components/ui';
import { PageLoader } from '@/components/ui/Spinner';
import { getProcurementPipeline } from '@/services/procurement.service';
import { isOpenProcurement, isDeliveredProcurement, isDelayedProcurement } from '@/utils/store/stock-state';
import { storeProcurementDetail, storeReceiveLink, storeReport } from '@/utils/store/store-evidence-links';

interface ProcRow {
  id: string;
  request_number: string;
  title: string;
  status: string;
  priority: string;
  justification?: string | null;
  expected_delivery_date: string | null;
  created_at: string;
}

const STATUS_LABEL: Record<string, string> = {
  requested: 'Requested',
  approved: 'Approved',
  ordered: 'Ordered',
  in_transit: 'In transit',
  delivered: 'Delivered',
  delayed: 'Delayed',
  canceled: 'Canceled',
};

function priorityVariant(priority: string): 'error' | 'warning' | 'info' | 'default' {
  if (priority === 'critical') return 'error';
  if (priority === 'high') return 'warning';
  if (priority === 'medium') return 'info';
  return 'default';
}

type StoreFilter = 'all' | 'requested' | 'approved' | 'ordered' | 'in_transit' | 'delivered' | 'delayed' | 'open' | 'stockout-linked';

export default function StoreProcurementTracking({ source }: { source?: string | null }) {
  const [rows, setRows] = useState<ProcRow[]>([]);
  const [loading, setLoading] = useState(true);
  const searchParams = useSearchParams();
  const initial = (searchParams.get('filter') as StoreFilter | null) ?? 'all';
  const [filter, setFilter] = useState<StoreFilter>(initial);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      const res = await getProcurementPipeline();
      if (cancelled) return;
      setRows((res.data ?? []) as unknown as ProcRow[]);
      setLoading(false);
    }
    void load();
    return () => { cancelled = true; };
  }, []);

  const counts = useMemo(() => {
    const c = { requested: 0, approved: 0, ordered: 0, in_transit: 0, delivered: 0, delayed: 0, open: 0 };
    for (const r of rows) {
      const s = (r.status ?? '').toLowerCase();
      if (s === 'requested') c.requested++;
      else if (s === 'approved') c.approved++;
      else if (s === 'ordered') c.ordered++;
      else if (s === 'in_transit') c.in_transit++;
      else if (s === 'delivered') c.delivered++;
      else if (s === 'delayed') c.delayed++;
      if (isOpenProcurement(s)) c.open++;
    }
    return c;
  }, [rows]);

  const filtered = useMemo(() => {
    if (filter === 'all') return rows;
    if (filter === 'open') return rows.filter((r) => isOpenProcurement(r.status));
    if (filter === 'delayed') return rows.filter((r) => isDelayedProcurement(r.status));
    if (filter === 'delivered') return rows.filter((r) => isDeliveredProcurement(r.status));
    return rows.filter((r) => (r.status ?? '').toLowerCase() === filter);
  }, [rows, filter]);

  if (loading) return <PageLoader />;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Procurement Tracking"
        description="Track reorder requests through the procurement pipeline. Procurement approvals and cancellations are not store-user actions."
        breadcrumbs={[{ label: 'Store Operations', href: '/command' }, { label: 'Procurement Tracking' }]}
        actions={<Badge variant="info">Store / logistics view</Badge>}
      />

      {source && (
        <div className="rounded-md border border-cyan-500/40 bg-cyan-500/5 px-3 py-2 text-xs text-cyan-300">
          Opened from {source.replace(/-/g, ' ')}.
        </div>
      )}

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-8">
        <StatCard label="Requested" value={counts.requested} icon={<ClipboardCheck className="h-5 w-5" />} color="blue" onClick={() => setFilter('requested')} active={filter === 'requested'} />
        <StatCard label="Approved" value={counts.approved} icon={<PackageCheck className="h-5 w-5" />} color="green" onClick={() => setFilter('approved')} active={filter === 'approved'} />
        <StatCard label="Ordered" value={counts.ordered} icon={<Truck className="h-5 w-5" />} color="purple" onClick={() => setFilter('ordered')} active={filter === 'ordered'} />
        <StatCard label="In Transit" value={counts.in_transit} icon={<Truck className="h-5 w-5" />} color="purple" onClick={() => setFilter('in_transit')} active={filter === 'in_transit'} />
        <StatCard label="Delivered" value={counts.delivered} icon={<Warehouse className="h-5 w-5" />} color="green" onClick={() => setFilter('delivered')} active={filter === 'delivered'} />
        <StatCard label="Delayed" value={counts.delayed} icon={<Timer className="h-5 w-5" />} color="red" onClick={() => setFilter('delayed')} active={filter === 'delayed'} />
        <StatCard label="Open Pipeline" value={counts.open} icon={<PackageCheck className="h-5 w-5" />} color="blue" onClick={() => setFilter('open')} active={filter === 'open'} />
        <StatCard label="All Requests" value={rows.length} icon={<AlertTriangle className="h-5 w-5" />} color="yellow" onClick={() => setFilter('all')} active={filter === 'all'} />
      </div>

      <div className="panel-surface overflow-x-auto rounded-xl">
        <table className="min-w-[1040px] w-full text-sm">
          <thead className="border-b border-[var(--border-subtle)]/60">
            <tr className="text-left">
              <th className="px-4 py-3 text-xs uppercase text-[var(--text-muted)]">Request</th>
              <th className="px-4 py-3 text-xs uppercase text-[var(--text-muted)]">Item / Title</th>
              <th className="px-4 py-3 text-xs uppercase text-[var(--text-muted)]">Status</th>
              <th className="px-4 py-3 text-xs uppercase text-[var(--text-muted)]">Priority</th>
              <th className="px-4 py-3 text-xs uppercase text-[var(--text-muted)]">Expected Delivery</th>
              <th className="px-4 py-3 text-xs uppercase text-[var(--text-muted)]">Created</th>
              <th className="px-4 py-3 text-xs uppercase text-[var(--text-muted)]">Next Store Action</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[var(--border-subtle)]/60">
            {filtered.length === 0 ? (
              <tr><td colSpan={7} className="px-4 py-6 text-center text-sm text-[var(--text-muted)]">No procurement records match this filter.</td></tr>
            ) : filtered.slice(0, 100).map((r) => (
              <tr key={r.id}>
                <td className="px-4 py-3 font-medium text-[var(--foreground)]">{r.request_number}</td>
                <td className="px-4 py-3 text-[var(--text-muted)]">{r.title}</td>
                <td className="px-4 py-3"><Badge variant="info">{STATUS_LABEL[r.status] ?? r.status}</Badge></td>
                <td className="px-4 py-3"><Badge variant={priorityVariant(r.priority)}>{r.priority}</Badge></td>
                <td className="px-4 py-3 text-[var(--text-muted)]">{r.expected_delivery_date ?? '—'}</td>
                <td className="px-4 py-3 text-[var(--text-muted)]">{r.created_at?.slice(0, 10) ?? '—'}</td>
                <td className="px-4 py-3">
                  <div className="flex flex-wrap gap-1.5">
                    {isDeliveredProcurement(r.status) ? (
                      <Link href={storeReceiveLink(r.id)} className="rounded-md bg-[var(--brand)] px-2 py-1 text-xs text-white">Receive Delivered Items</Link>
                    ) : (
                      <Link href={storeProcurementDetail(r.id)} className="rounded-md border border-[var(--border-subtle)] px-2 py-1 text-xs text-[var(--text-muted)] hover:text-[var(--foreground)]">Track Procurement</Link>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className="text-xs text-[var(--text-muted)]">
        Approve / Reject / Cancel / Change Priority are BME Head actions — not visible in this view. To create a new reorder request, open a stockout or low-stock row from <Link className="text-violet-300 hover:text-violet-200" href="/spare-parts">Spare Parts Stock Control</Link>.{' '}
        <Link className="text-violet-300 hover:text-violet-200" href={storeReport('procurement-pipeline')}>Export procurement report →</Link>
      </p>
    </div>
  );
}
