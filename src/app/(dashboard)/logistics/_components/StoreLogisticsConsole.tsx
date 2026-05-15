'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { ArrowRightLeft, Boxes, ClipboardCheck, HandHelping, PackageCheck, Truck, Warehouse } from 'lucide-react';
import { PageHeader, Badge, StatCard } from '@/components/ui';
import { PageLoader } from '@/components/ui/Spinner';
import { getSpareParts, getLowStockParts } from '@/services/spare-parts.service';
import { getProcurementPipeline } from '@/services/procurement.service';
import { createClient } from '@/lib/supabase/client';
import { classifyStock, isOpenProcurement, stockStateBadgeClass, stockStateLabel } from '@/utils/store/stock-state';
import {
  storeCreateReorderLink,
  storeIssueLink,
  storePartDetail,
  storeProcurementDetail,
  storeReceiveLink,
  storeWorkOrderEvidence,
} from '@/utils/store/store-evidence-links';

type WorkflowPanel = 'receiving' | 'issue' | 'balance' | 'bin-card' | 'procurement' | 'usage-linkage';

interface PartRow { id: string; part_code: string; name: string; category: string | null; current_stock: number | null; reorder_level: number | null; is_active: boolean }
interface ProcRow { id: string; request_number: string; title: string; status: string; priority: string; expected_delivery_date: string | null; created_at: string }
interface ReceiptRow { id: string; part_id: string; quantity: number; received_date: string; supplier: string | null; spare_parts: { part_code: string; name: string } | null }
interface IssueRow { id: string; part_id: string; quantity: number; issue_date: string; issued_to_event_id: string | null; notes: string | null; department_id: string | null; spare_parts: { part_code: string; name: string } | null }

function normalizeWorkflow(value: string | null): WorkflowPanel {
  const map: Record<string, WorkflowPanel> = {
    receiving: 'receiving', issue: 'issue', balance: 'balance', 'bin-card': 'bin-card',
    procurement: 'procurement', tracking: 'procurement', 'usage-linkage': 'usage-linkage', usage: 'usage-linkage',
  };
  return map[value ?? ''] ?? 'receiving';
}

function priorityVariant(priority: string): 'error' | 'warning' | 'info' | 'default' {
  if (priority === 'critical') return 'error';
  if (priority === 'high') return 'warning';
  if (priority === 'medium') return 'info';
  return 'default';
}

export default function StoreLogisticsConsole() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const activeWorkflow = normalizeWorkflow(searchParams.get('workflow') ?? searchParams.get('panel'));

  const [parts, setParts] = useState<PartRow[]>([]);
  const [procurement, setProcurement] = useState<ProcRow[]>([]);
  const [receipts, setReceipts] = useState<ReceiptRow[]>([]);
  const [issues, setIssues] = useState<IssueRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      const supabase = createClient();
      const [partsRes, procRes, receiptsRes, issuesRes] = await Promise.all([
        getSpareParts({ is_active: true }),
        getProcurementPipeline(),
        supabase.from('stock_receipts').select('id, part_id, quantity, received_date, supplier, spare_parts(part_code, name)').order('received_date', { ascending: false }).limit(200),
        supabase.from('stock_issues').select('id, part_id, quantity, issue_date, issued_to_event_id, notes, department_id, spare_parts(part_code, name)').order('issue_date', { ascending: false }).limit(200),
      ]);
      if (cancelled) return;
      setParts((partsRes.data ?? []) as unknown as PartRow[]);
      setProcurement((procRes.data ?? []) as unknown as ProcRow[]);
      setReceipts((receiptsRes.data ?? []) as unknown as ReceiptRow[]);
      setIssues((issuesRes.data ?? []) as unknown as IssueRow[]);
      setLoading(false);
      void getLowStockParts; // keep import live
    }
    void load();
    return () => { cancelled = true; };
  }, []);

  const delivered = useMemo(() => procurement.filter((p) => p.status === 'delivered'), [procurement]);
  const openProcurement = useMemo(() => procurement.filter((p) => isOpenProcurement(p.status)), [procurement]);
  const linkedIssues = useMemo(() => issues.filter((i) => i.issued_to_event_id), [issues]);
  const unlinkedIssues = useMemo(() => issues.filter((i) => !i.issued_to_event_id), [issues]);

  const summary = {
    receiving: delivered.length,
    issue: parts.filter((p) => classifyStock(p) === 'low' || classifyStock(p) === 'stockout').length,
    balance: parts.length,
    procurement: openProcurement.length,
    usage: linkedIssues.length,
  };

  const panels: Array<{ id: WorkflowPanel; title: string; icon: React.ElementType; count: number; desc: string }> = [
    { id: 'receiving', title: 'Receiving', icon: Warehouse, count: summary.receiving, desc: 'Record delivered items into stock.' },
    { id: 'issue', title: 'Issue Queue', icon: HandHelping, count: summary.issue, desc: 'Issue approved items / track stockout-driven needs.' },
    { id: 'balance', title: 'Stock Balance', icon: Boxes, count: summary.balance, desc: 'Current stock and reorder pressure.' },
    { id: 'bin-card', title: 'Bin Card', icon: ArrowRightLeft, count: receipts.length + issues.length, desc: 'Movement ledger per part.' },
    { id: 'procurement', title: 'Procurement Tracking', icon: PackageCheck, count: summary.procurement, desc: 'Items expected to replenish store.' },
    { id: 'usage-linkage', title: 'Usage Linkage', icon: Truck, count: summary.usage, desc: 'Trace part issue → work order → equipment.' },
  ];

  function setPanel(id: WorkflowPanel) {
    const params = new URLSearchParams(window.location.search);
    params.set('workflow', id);
    router.replace(`/logistics?${params.toString()}`);
  }

  if (loading) return <PageLoader />;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Logistics Console"
        description="Receive → Issue → Stock Balance → Bin Card → Procurement Tracking → Usage Linkage."
        breadcrumbs={[{ label: 'Store Operations', href: '/command' }, { label: 'Logistics Console' }]}
        actions={<Badge variant="info">Store / logistics view</Badge>}
      />

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
        {panels.map((p) => {
          const Icon = p.icon;
          const active = activeWorkflow === p.id;
          return (
            <button
              key={p.id}
              type="button"
              onClick={() => setPanel(p.id)}
              className={`panel-surface flex flex-col gap-1 rounded-xl p-4 text-left transition-colors ${active ? 'ring-2 ring-[var(--brand)]' : 'hover:ring-1 hover:ring-[var(--brand)]/40'}`}
            >
              <div className="flex items-start justify-between gap-2">
                <span className="text-2xl font-bold leading-none text-[var(--foreground)]">{p.count}</span>
                <span className="rounded-lg bg-[var(--surface-2)] p-1.5"><Icon className="h-4 w-4 text-[var(--brand)]" /></span>
              </div>
              <span className="text-xs font-semibold text-[var(--foreground)]">{p.title}</span>
              <span className="text-[10px] leading-tight text-[var(--text-muted)]">{p.desc}</span>
            </button>
          );
        })}
      </div>

      {activeWorkflow === 'receiving' && (
        <div className="panel-surface rounded-xl p-5">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-base font-semibold text-[var(--foreground)]">Delivered procurement awaiting receipt</h2>
            <Link href="/procurement" className="text-xs text-violet-300 hover:text-violet-200">Open Procurement Tracking →</Link>
          </div>
          {delivered.length === 0 ? (
            <p className="py-4 text-center text-sm text-[var(--text-muted)]">No delivered items awaiting receipt.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-[820px] w-full text-sm">
                <thead>
                  <tr className="border-b border-[var(--border-subtle)]/60 text-left">
                    <th className="pb-2 pr-4 text-xs uppercase text-[var(--text-muted)]">Procurement</th>
                    <th className="pb-2 pr-4 text-xs uppercase text-[var(--text-muted)]">Title</th>
                    <th className="pb-2 pr-4 text-xs uppercase text-[var(--text-muted)]">Status</th>
                    <th className="pb-2 pr-4 text-xs uppercase text-[var(--text-muted)]">Expected</th>
                    <th className="pb-2 pr-4 text-xs uppercase text-[var(--text-muted)]">Priority</th>
                    <th className="pb-2 text-xs uppercase text-[var(--text-muted)]">Evidence</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--border-subtle)]/60">
                  {delivered.map((p) => (
                    <tr key={p.id}>
                      <td className="py-3 pr-4 font-medium text-[var(--foreground)]">{p.request_number}</td>
                      <td className="py-3 pr-4 text-[var(--text-muted)]">{p.title}</td>
                      <td className="py-3 pr-4"><Badge variant="info">{p.status}</Badge></td>
                      <td className="py-3 pr-4 text-[var(--text-muted)]">{p.expected_delivery_date ?? '—'}</td>
                      <td className="py-3 pr-4"><Badge variant={priorityVariant(p.priority)}>{p.priority}</Badge></td>
                      <td className="py-3">
                        <div className="flex flex-wrap gap-1.5">
                          <Link href={storeReceiveLink(p.id)} className="rounded-md bg-[var(--brand)] px-2 py-1 text-xs text-white">Receive Into Stock</Link>
                          <Link href={storeProcurementDetail(p.id)} className="rounded-md border border-[var(--border-subtle)] px-2 py-1 text-xs text-[var(--text-muted)] hover:text-[var(--foreground)]">View Procurement Evidence</Link>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {activeWorkflow === 'issue' && (
        <div className="panel-surface rounded-xl p-5">
          <div className="mb-3">
            <h2 className="text-base font-semibold text-[var(--foreground)]">Issue queue — parts requiring action</h2>
            <p className="text-xs text-[var(--text-muted)]">Items at or below reorder level. Approvals for item requests are handled by BME Head.</p>
          </div>
          <div className="overflow-x-auto">
            <table className="min-w-[760px] w-full text-sm">
              <thead>
                <tr className="border-b border-[var(--border-subtle)]/60 text-left">
                  <th className="pb-2 pr-4 text-xs uppercase text-[var(--text-muted)]">Part</th>
                  <th className="pb-2 pr-4 text-xs uppercase text-[var(--text-muted)]">Current</th>
                  <th className="pb-2 pr-4 text-xs uppercase text-[var(--text-muted)]">Reorder</th>
                  <th className="pb-2 pr-4 text-xs uppercase text-[var(--text-muted)]">State</th>
                  <th className="pb-2 text-xs uppercase text-[var(--text-muted)]">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--border-subtle)]/60">
                {parts.filter((p) => classifyStock(p) !== 'healthy').slice(0, 25).map((p) => {
                  const state = classifyStock(p);
                  return (
                    <tr key={p.id}>
                      <td className="py-3 pr-4">
                        <Link href={storePartDetail(p.id)} className="font-medium text-[var(--foreground)] hover:text-violet-300">{p.name}</Link>
                        <p className="text-xs text-[var(--text-muted)]">{p.part_code}</p>
                      </td>
                      <td className="py-3 pr-4 text-[var(--text-muted)]">{p.current_stock ?? 0}</td>
                      <td className="py-3 pr-4 text-[var(--text-muted)]">{p.reorder_level ?? 0}</td>
                      <td className="py-3 pr-4"><span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs ${stockStateBadgeClass(state)}`}>{stockStateLabel(state)}</span></td>
                      <td className="py-3">
                        <div className="flex flex-wrap gap-1.5">
                          {state === 'stockout' && <Link href={storeCreateReorderLink(p)} className="rounded-md bg-[var(--brand)] px-2 py-1 text-xs text-white">Create Reorder Request</Link>}
                          {state === 'low' && <Link href={storeCreateReorderLink(p)} className="rounded-md border border-[var(--border-subtle)] px-2 py-1 text-xs text-[var(--text-muted)] hover:text-[var(--foreground)]">Create Reorder Request</Link>}
                          <Link href={storeIssueLink(p.id)} className="rounded-md border border-[var(--border-subtle)] px-2 py-1 text-xs text-[var(--text-muted)] hover:text-[var(--foreground)]">Open Issue Record</Link>
                        </div>
                      </td>
                    </tr>
                  );
                })}
                {parts.filter((p) => classifyStock(p) !== 'healthy').length === 0 && (
                  <tr><td colSpan={5} className="px-4 py-6 text-center text-sm text-[var(--text-muted)]">No low-stock or stockout parts.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {activeWorkflow === 'balance' && (
        <div className="panel-surface rounded-xl p-5">
          <div className="mb-3">
            <h2 className="text-base font-semibold text-[var(--foreground)]">Stock balance</h2>
            <p className="text-xs text-[var(--text-muted)]">Current stock and reorder deficit.</p>
          </div>
          <div className="overflow-x-auto">
            <table className="min-w-[720px] w-full text-sm">
              <thead>
                <tr className="border-b border-[var(--border-subtle)]/60 text-left">
                  <th className="pb-2 pr-4 text-xs uppercase text-[var(--text-muted)]">Part</th>
                  <th className="pb-2 pr-4 text-xs uppercase text-[var(--text-muted)]">Current</th>
                  <th className="pb-2 pr-4 text-xs uppercase text-[var(--text-muted)]">Reorder</th>
                  <th className="pb-2 pr-4 text-xs uppercase text-[var(--text-muted)]">State</th>
                  <th className="pb-2 text-xs uppercase text-[var(--text-muted)]">Evidence</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--border-subtle)]/60">
                {parts.slice(0, 50).map((p) => {
                  const state = classifyStock(p);
                  return (
                    <tr key={p.id}>
                      <td className="py-3 pr-4">
                        <Link href={storePartDetail(p.id)} className="font-medium text-[var(--foreground)] hover:text-violet-300">{p.name}</Link>
                        <p className="text-xs text-[var(--text-muted)]">{p.part_code}</p>
                      </td>
                      <td className="py-3 pr-4 text-[var(--text-muted)]">{p.current_stock ?? 0}</td>
                      <td className="py-3 pr-4 text-[var(--text-muted)]">{p.reorder_level ?? 0}</td>
                      <td className="py-3 pr-4"><span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs ${stockStateBadgeClass(state)}`}>{stockStateLabel(state)}</span></td>
                      <td className="py-3">
                        <div className="flex flex-wrap gap-1.5">
                          <Link href={storePartDetail(p.id)} className="rounded-md border border-[var(--border-subtle)] px-2 py-1 text-xs text-[var(--text-muted)] hover:text-[var(--foreground)]">Part Detail</Link>
                          {state !== 'healthy' && <Link href={storeCreateReorderLink(p)} className="rounded-md border border-[var(--border-subtle)] px-2 py-1 text-xs text-[var(--text-muted)] hover:text-[var(--foreground)]">Create Reorder Request</Link>}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {activeWorkflow === 'bin-card' && (
        <div className="grid gap-4 md:grid-cols-2">
          <div className="panel-surface rounded-xl p-5">
            <h2 className="mb-3 text-base font-semibold text-[var(--foreground)]">Recent receipts</h2>
            {receipts.length === 0 ? <p className="py-4 text-center text-sm text-[var(--text-muted)]">No receipts.</p> : (
              <table className="w-full text-sm">
                <thead><tr className="border-b border-[var(--border-subtle)]/60 text-left"><th className="pb-2 pr-4 text-xs uppercase text-[var(--text-muted)]">Date</th><th className="pb-2 pr-4 text-xs uppercase text-[var(--text-muted)]">Part</th><th className="pb-2 text-xs uppercase text-[var(--text-muted)]">Qty</th></tr></thead>
                <tbody className="divide-y divide-[var(--border-subtle)]/60">
                  {receipts.slice(0, 20).map((r) => (
                    <tr key={r.id}>
                      <td className="py-2 pr-4 text-[var(--text-muted)]">{r.received_date}</td>
                      <td className="py-2 pr-4">{r.spare_parts?.name ?? '—'} <span className="text-[var(--text-muted)]">({r.spare_parts?.part_code ?? '—'})</span></td>
                      <td className="py-2 text-[var(--text-muted)]">{r.quantity}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
          <div className="panel-surface rounded-xl p-5">
            <h2 className="mb-3 text-base font-semibold text-[var(--foreground)]">Recent issues</h2>
            {issues.length === 0 ? <p className="py-4 text-center text-sm text-[var(--text-muted)]">No issues.</p> : (
              <table className="w-full text-sm">
                <thead><tr className="border-b border-[var(--border-subtle)]/60 text-left"><th className="pb-2 pr-4 text-xs uppercase text-[var(--text-muted)]">Date</th><th className="pb-2 pr-4 text-xs uppercase text-[var(--text-muted)]">Part</th><th className="pb-2 text-xs uppercase text-[var(--text-muted)]">Qty</th></tr></thead>
                <tbody className="divide-y divide-[var(--border-subtle)]/60">
                  {issues.slice(0, 20).map((i) => (
                    <tr key={i.id}>
                      <td className="py-2 pr-4 text-[var(--text-muted)]">{i.issue_date}</td>
                      <td className="py-2 pr-4">{i.spare_parts?.name ?? '—'} <span className="text-[var(--text-muted)]">({i.spare_parts?.part_code ?? '—'})</span></td>
                      <td className="py-2 text-[var(--text-muted)]">{i.quantity}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      )}

      {activeWorkflow === 'procurement' && (
        <div className="panel-surface rounded-xl p-5">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-base font-semibold text-[var(--foreground)]">Procurement tracking</h2>
            <Link href="/procurement" className="text-xs text-violet-300 hover:text-violet-200">Open full procurement →</Link>
          </div>
          {openProcurement.length === 0 ? <p className="py-4 text-center text-sm text-[var(--text-muted)]">No open procurement records.</p> : (
            <div className="overflow-x-auto">
              <table className="min-w-[760px] w-full text-sm">
                <thead>
                  <tr className="border-b border-[var(--border-subtle)]/60 text-left">
                    <th className="pb-2 pr-4 text-xs uppercase text-[var(--text-muted)]">Request</th>
                    <th className="pb-2 pr-4 text-xs uppercase text-[var(--text-muted)]">Title</th>
                    <th className="pb-2 pr-4 text-xs uppercase text-[var(--text-muted)]">Status</th>
                    <th className="pb-2 pr-4 text-xs uppercase text-[var(--text-muted)]">Priority</th>
                    <th className="pb-2 pr-4 text-xs uppercase text-[var(--text-muted)]">Expected</th>
                    <th className="pb-2 text-xs uppercase text-[var(--text-muted)]">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--border-subtle)]/60">
                  {openProcurement.slice(0, 25).map((p) => (
                    <tr key={p.id}>
                      <td className="py-3 pr-4 font-medium text-[var(--foreground)]">{p.request_number}</td>
                      <td className="py-3 pr-4 text-[var(--text-muted)]">{p.title}</td>
                      <td className="py-3 pr-4"><Badge variant="info">{p.status}</Badge></td>
                      <td className="py-3 pr-4"><Badge variant={priorityVariant(p.priority)}>{p.priority}</Badge></td>
                      <td className="py-3 pr-4 text-[var(--text-muted)]">{p.expected_delivery_date ?? '—'}</td>
                      <td className="py-3">
                        <Link href={storeProcurementDetail(p.id)} className="rounded-md border border-[var(--border-subtle)] px-2 py-1 text-xs text-[var(--text-muted)] hover:text-[var(--foreground)]">Track Procurement</Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {activeWorkflow === 'usage-linkage' && (
        <div className="space-y-4">
          <div className="panel-surface rounded-xl p-5">
            <h2 className="mb-3 text-base font-semibold text-[var(--foreground)]">Linked issues (issued to a work-order event)</h2>
            {linkedIssues.length === 0 ? <p className="py-4 text-center text-sm text-[var(--text-muted)]">No linked stock issues.</p> : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead><tr className="border-b border-[var(--border-subtle)]/60 text-left"><th className="pb-2 pr-4 text-xs uppercase text-[var(--text-muted)]">Date</th><th className="pb-2 pr-4 text-xs uppercase text-[var(--text-muted)]">Part</th><th className="pb-2 pr-4 text-xs uppercase text-[var(--text-muted)]">Qty</th><th className="pb-2 text-xs uppercase text-[var(--text-muted)]">Event</th></tr></thead>
                  <tbody className="divide-y divide-[var(--border-subtle)]/60">
                    {linkedIssues.slice(0, 25).map((i) => (
                      <tr key={i.id}>
                        <td className="py-2 pr-4 text-[var(--text-muted)]">{i.issue_date}</td>
                        <td className="py-2 pr-4">{i.spare_parts?.name ?? '—'}</td>
                        <td className="py-2 pr-4 text-[var(--text-muted)]">{i.quantity}</td>
                        <td className="py-2">
                          {i.issued_to_event_id && (
                            <Link href={storeWorkOrderEvidence(i.issued_to_event_id)} className="rounded-md border border-[var(--border-subtle)] px-2 py-1 text-xs text-[var(--text-muted)] hover:text-[var(--foreground)]">Open Work Order Evidence</Link>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
          {unlinkedIssues.length > 0 && (
            <div className="rounded-md border border-amber-500/40 bg-amber-500/5 p-3 text-xs text-amber-300">
              {unlinkedIssues.length} stock issue{unlinkedIssues.length === 1 ? '' : 's'} without a work-order event link. These appear when issues are recorded outside the maintenance flow.
            </div>
          )}
        </div>
      )}

      <p className="text-xs text-[var(--text-muted)]">
        Approve / Cancel procurement, change priority, assign technicians, and complete work orders are not store-user actions. They appear in the BME Head operational view.
      </p>
      <span className="hidden"><StatCard label="" value={0} icon={<Boxes className="h-4 w-4" />} /><ClipboardCheck className="hidden" /></span>
    </div>
  );
}
