import Link from 'next/link';
import {
  AlertTriangle,
  ArrowRightLeft,
  Boxes,
  ClipboardCheck,
  HandHelping,
  Package,
  PackageCheck,
  Timer,
  TrendingUp,
  Truck,
  Warehouse,
  Wrench,
} from 'lucide-react';
import { Badge, Card, CardContent, CardHeader, CardTitle, PageHeader } from '@/components/ui';
import {
  type StoreExecutiveMetrics,
  type StoreStockRiskRow,
  type StoreReceivingRow,
  type StoreIssueRow,
  type StoreBlockerRow,
} from '@/utils/store/store-metrics';
import {
  stockStateBadgeClass,
  stockStateLabel,
} from '@/utils/store/stock-state';
import {
  storeBinCardLink,
  storeCreateReorderLink,
  storeEquipmentDetail,
  storeIssueLink,
  storePartDetail,
  storeProcurementDetail,
  storeReceiveLink,
  storeReport,
  storeWorkOrderEvidence,
} from '@/utils/store/store-evidence-links';

interface Props {
  metrics: StoreExecutiveMetrics;
  stockRisk: StoreStockRiskRow[];
  receiving: StoreReceivingRow[];
  issueQueue: StoreIssueRow[];
  blockers: StoreBlockerRow[];
  generatedAt: string;
}

interface MetricCard {
  label: string;
  value: number | string;
  subtitle: string;
  icon: React.ReactNode;
  tone: 'critical' | 'warning' | 'info' | 'success' | 'neutral';
  href?: string;
  hrefLabel?: string;
}

function toneClass(tone: MetricCard['tone']): string {
  switch (tone) {
    case 'critical': return 'border-rose-500/40 bg-rose-500/5';
    case 'warning': return 'border-amber-500/40 bg-amber-500/5';
    case 'info': return 'border-cyan-500/40 bg-cyan-500/5';
    case 'success': return 'border-emerald-500/40 bg-emerald-500/5';
    default: return 'border-[var(--border-subtle)] bg-[var(--surface-1)]';
  }
}

function iconBg(tone: MetricCard['tone']): string {
  switch (tone) {
    case 'critical': return 'bg-rose-500/15 text-rose-300';
    case 'warning': return 'bg-amber-500/15 text-amber-300';
    case 'info': return 'bg-cyan-500/15 text-cyan-300';
    case 'success': return 'bg-emerald-500/15 text-emerald-300';
    default: return 'bg-zinc-500/15 text-zinc-300';
  }
}

export default function StoreOperationsCommandCenter({ metrics, stockRisk, receiving, issueQueue, blockers, generatedAt }: Props) {
  const cards: MetricCard[] = [
    { label: 'Stockouts', value: metrics.stockoutParts, subtitle: 'Spare parts with current_stock ≤ 0.', icon: <AlertTriangle className="h-5 w-5" />, tone: metrics.stockoutParts > 0 ? 'critical' : 'success', href: '/spare-parts?filter=stockout', hrefLabel: 'Open Stockout Evidence' },
    { label: 'Low Stock Parts', value: metrics.lowStockParts, subtitle: '0 < current_stock ≤ reorder_level.', icon: <Boxes className="h-5 w-5" />, tone: metrics.lowStockParts > 0 ? 'warning' : 'success', href: '/spare-parts?filter=low-stock', hrefLabel: 'Open Low Stock' },
    { label: 'Blocked Work Orders', value: metrics.blockedWorkOrders, subtitle: 'Open work orders currently on_hold.', icon: <Wrench className="h-5 w-5" />, tone: metrics.blockedWorkOrders > 0 ? 'warning' : 'success', href: '/maintenance', hrefLabel: 'View Blocked Work Orders' },
    { label: 'Pending Issue Requests', value: metrics.pendingIssueRequests, subtitle: 'Maintenance requests still in pending review.', icon: <ClipboardCheck className="h-5 w-5" />, tone: 'info', href: '/logistics?workflow=issue', hrefLabel: 'Open Issue Queue' },
    { label: 'Approved Items to Issue', value: metrics.approvedItemsToIssue, subtitle: 'Approved maintenance requests (handoff to store).', icon: <HandHelping className="h-5 w-5" />, tone: metrics.approvedItemsToIssue > 0 ? 'info' : 'success', href: '/logistics?workflow=issue', hrefLabel: 'Open Issue Queue' },
    { label: 'Delivered Items to Receive', value: metrics.deliveredItemsToReceive, subtitle: 'Procurement requests at status = delivered.', icon: <Warehouse className="h-5 w-5" />, tone: metrics.deliveredItemsToReceive > 0 ? 'warning' : 'success', href: storeReceiveLink(), hrefLabel: 'Open Receiving Queue' },
    { label: 'Open Procurement', value: metrics.openProcurement, subtitle: 'Requested / approved / ordered / in transit.', icon: <PackageCheck className="h-5 w-5" />, tone: 'info', href: '/procurement', hrefLabel: 'Track Procurement' },
    { label: 'Delayed Procurement', value: metrics.delayedProcurement, subtitle: 'Procurement requests in delayed status.', icon: <Timer className="h-5 w-5" />, tone: metrics.delayedProcurement > 0 ? 'warning' : 'success', href: '/procurement?filter=delayed', hrefLabel: 'Open Delayed' },
    { label: 'Recent Receipts', value: metrics.recentReceipts, subtitle: 'stock_receipts logged this month.', icon: <Truck className="h-5 w-5" />, tone: 'info', href: '/logistics?workflow=bin-card', hrefLabel: 'Open Stock Movement' },
    { label: 'Recent Issues', value: metrics.recentIssues, subtitle: 'stock_issues logged this month.', icon: <TrendingUp className="h-5 w-5" />, tone: 'info', href: '/logistics?workflow=usage-linkage', hrefLabel: 'Open Usage Linkage' },
  ];

  return (
    <div className="space-y-8">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <PageHeader
            title="Store Operations Command Center"
            description="Stock, receiving, issuing, procurement tracking, and maintenance blocker context for the Medical Equipment Store Officer."
          />
          <p className="text-xs text-[var(--text-muted)]">Updated {generatedAt} · Store / logistics view</p>
        </div>
        <Badge variant="info">Store / logistics view</Badge>
      </div>

      {/* ── Top metric cards ─────────────────────────────────────────── */}
      <section aria-label="Store metric cards">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
          {cards.map((c) => (
            <div key={c.label} className={`flex flex-col gap-2 rounded-xl border p-4 ${toneClass(c.tone)}`}>
              <div className="flex items-start justify-between gap-2">
                <div className={`rounded-md p-2 ${iconBg(c.tone)}`}>{c.icon}</div>
              </div>
              <div>
                <p className="text-xs uppercase tracking-wide text-[var(--text-muted)]">{c.label}</p>
                <p className="mt-1 text-2xl font-semibold text-[var(--foreground)]">{c.value}</p>
                <p className="mt-1 text-xs leading-snug text-[var(--text-muted)]">{c.subtitle}</p>
              </div>
              {c.href && (
                <Link href={c.href} className="mt-auto inline-flex w-fit items-center gap-1 rounded-md border border-[var(--border-subtle)] px-2 py-1 text-xs text-[var(--text-muted)] hover:text-[var(--foreground)]">
                  {c.hrefLabel} →
                </Link>
              )}
            </div>
          ))}
        </div>
      </section>

      {/* ── Today's Store Work ───────────────────────────────────────── */}
      <section aria-label="Today's store work">
        <Card>
          <CardHeader><CardTitle>Today’s Store Work</CardTitle></CardHeader>
          <CardContent>
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
              <Link href={storeReceiveLink()} className="flex flex-col gap-1 rounded-lg border border-[var(--border-subtle)] p-3 hover:border-[var(--brand)]/50">
                <span className="inline-flex items-center gap-2 text-sm font-medium text-[var(--foreground)]"><Warehouse className="h-4 w-4 text-cyan-300" /> Receive Delivered Items</span>
                <span className="text-xs text-[var(--text-muted)]">{metrics.deliveredItemsToReceive} delivered procurement{metrics.deliveredItemsToReceive === 1 ? '' : 's'} awaiting receipt.</span>
              </Link>
              <Link href={storeIssueLink()} className="flex flex-col gap-1 rounded-lg border border-[var(--border-subtle)] p-3 hover:border-[var(--brand)]/50">
                <span className="inline-flex items-center gap-2 text-sm font-medium text-[var(--foreground)]"><HandHelping className="h-4 w-4 text-violet-300" /> Issue Approved Requests</span>
                <span className="text-xs text-[var(--text-muted)]">{metrics.approvedItemsToIssue} approved request{metrics.approvedItemsToIssue === 1 ? '' : 's'} pending parts handoff.</span>
              </Link>
              <Link href="/spare-parts?filter=stockout" className="flex flex-col gap-1 rounded-lg border border-[var(--border-subtle)] p-3 hover:border-[var(--brand)]/50">
                <span className="inline-flex items-center gap-2 text-sm font-medium text-[var(--foreground)]"><AlertTriangle className="h-4 w-4 text-rose-300" /> Review Stockouts</span>
                <span className="text-xs text-[var(--text-muted)]">{metrics.stockoutParts} part{metrics.stockoutParts === 1 ? '' : 's'} at zero stock.</span>
              </Link>
              <Link href="/procurement?filter=delayed" className="flex flex-col gap-1 rounded-lg border border-[var(--border-subtle)] p-3 hover:border-[var(--brand)]/50">
                <span className="inline-flex items-center gap-2 text-sm font-medium text-[var(--foreground)]"><Timer className="h-4 w-4 text-amber-300" /> Track Delayed Procurement</span>
                <span className="text-xs text-[var(--text-muted)]">{metrics.delayedProcurement} delayed procurement record{metrics.delayedProcurement === 1 ? '' : 's'}.</span>
              </Link>
              <Link href="/maintenance" className="flex flex-col gap-1 rounded-lg border border-[var(--border-subtle)] p-3 hover:border-[var(--brand)]/50">
                <span className="inline-flex items-center gap-2 text-sm font-medium text-[var(--foreground)]"><Wrench className="h-4 w-4 text-orange-300" /> Trace Work-Order Blockers</span>
                <span className="text-xs text-[var(--text-muted)]">{metrics.blockedWorkOrders} on-hold work order{metrics.blockedWorkOrders === 1 ? '' : 's'}.</span>
              </Link>
            </div>
          </CardContent>
        </Card>
      </section>

      {/* ── Stock Risk ────────────────────────────────────────────────── */}
      <section aria-label="Stock risk">
        <Card>
          <CardHeader><CardTitle><span className="inline-flex items-center gap-2"><Boxes className="h-5 w-5 text-amber-300" />Stock risk</span></CardTitle></CardHeader>
          <CardContent>
            {stockRisk.filter((r) => r.state !== 'healthy').length === 0 ? (
              <p className="py-4 text-center text-sm text-[var(--text-muted)]">No parts below reorder level.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="min-w-[920px] w-full text-sm">
                  <thead>
                    <tr className="border-b border-[var(--border-subtle)]/60 text-left">
                      <th className="pb-2 pr-4 text-xs uppercase text-[var(--text-muted)]">Part</th>
                      <th className="pb-2 pr-4 text-xs uppercase text-[var(--text-muted)]">Current</th>
                      <th className="pb-2 pr-4 text-xs uppercase text-[var(--text-muted)]">Reorder</th>
                      <th className="pb-2 pr-4 text-xs uppercase text-[var(--text-muted)]">Deficit</th>
                      <th className="pb-2 pr-4 text-xs uppercase text-[var(--text-muted)]">State</th>
                      <th className="pb-2 pr-4 text-xs uppercase text-[var(--text-muted)]">Procurement</th>
                      <th className="pb-2 text-xs uppercase text-[var(--text-muted)]">Next action</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[var(--border-subtle)]/60">
                    {stockRisk.filter((r) => r.state !== 'healthy').slice(0, 15).map((r) => {
                      const hasOpenProcurement = !!r.openProcurementId;
                      return (
                        <tr key={r.id}>
                          <td className="py-3 pr-4">
                            <Link href={storePartDetail(r.id)} className="font-medium text-[var(--foreground)] hover:text-violet-300">{r.name}</Link>
                            <p className="text-xs text-[var(--text-muted)]">{r.partCode}</p>
                          </td>
                          <td className="py-3 pr-4 text-[var(--text-muted)]">{r.currentStock}</td>
                          <td className="py-3 pr-4 text-[var(--text-muted)]">{r.reorderLevel}</td>
                          <td className="py-3 pr-4 text-[var(--text-muted)]">{r.deficit}</td>
                          <td className="py-3 pr-4">
                            <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs ${stockStateBadgeClass(r.state)}`}>{stockStateLabel(r.state)}</span>
                          </td>
                          <td className="py-3 pr-4 text-[var(--text-muted)]">
                            {hasOpenProcurement ? (
                              <Link href={storeProcurementDetail(r.openProcurementId!)} className="text-xs text-violet-300 hover:text-violet-200">{r.openProcurementStatus} →</Link>
                            ) : (
                              <span className="text-xs text-[var(--text-subtle)]">No open procurement</span>
                            )}
                          </td>
                          <td className="py-3">
                            <div className="flex flex-wrap gap-1.5">
                              {hasOpenProcurement ? (
                                <Link href={storeProcurementDetail(r.openProcurementId!)} className="rounded-md border border-[var(--border-subtle)] bg-[var(--brand)] px-2 py-1 text-xs text-white">Track Procurement</Link>
                              ) : (
                                <Link href={storeCreateReorderLink({ id: r.id, name: r.name, part_code: r.partCode, current_stock: r.currentStock, reorder_level: r.reorderLevel })} className="rounded-md bg-[var(--brand)] px-2 py-1 text-xs text-white">Create Reorder Request</Link>
                              )}
                              <Link href={storePartDetail(r.id)} className="rounded-md border border-[var(--border-subtle)] px-2 py-1 text-xs text-[var(--text-muted)] hover:text-[var(--foreground)]">Part Detail</Link>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
                <p className="mt-3 text-xs text-[var(--text-muted)]">Linked procurement detected via best-effort title match on part code/name. The system does not yet enforce a strict procurement→part foreign key.</p>
              </div>
            )}
          </CardContent>
        </Card>
      </section>

      {/* ── Receiving queue ─────────────────────────────────────────── */}
      <section aria-label="Receiving queue">
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle><span className="inline-flex items-center gap-2"><Warehouse className="h-5 w-5 text-cyan-300" />Receiving queue</span></CardTitle>
              <Link href={storeReceiveLink()} className="text-xs text-violet-300 hover:text-violet-200">Open full receiving →</Link>
            </div>
          </CardHeader>
          <CardContent>
            {receiving.length === 0 ? (
              <p className="py-4 text-center text-sm text-[var(--text-muted)]">No delivered items awaiting receipt.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="min-w-[760px] w-full text-sm">
                  <thead>
                    <tr className="border-b border-[var(--border-subtle)]/60 text-left">
                      <th className="pb-2 pr-4 text-xs uppercase text-[var(--text-muted)]">Procurement</th>
                      <th className="pb-2 pr-4 text-xs uppercase text-[var(--text-muted)]">Title</th>
                      <th className="pb-2 pr-4 text-xs uppercase text-[var(--text-muted)]">Status</th>
                      <th className="pb-2 pr-4 text-xs uppercase text-[var(--text-muted)]">Expected</th>
                      <th className="pb-2 pr-4 text-xs uppercase text-[var(--text-muted)]">Priority</th>
                      <th className="pb-2 text-xs uppercase text-[var(--text-muted)]">Action</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[var(--border-subtle)]/60">
                    {receiving.slice(0, 15).map((r) => (
                      <tr key={r.id}>
                        <td className="py-3 pr-4 font-medium text-[var(--foreground)]">{r.requestNumber}</td>
                        <td className="py-3 pr-4 text-[var(--text-muted)]">{r.title}</td>
                        <td className="py-3 pr-4"><Badge variant="info">{r.status}</Badge></td>
                        <td className="py-3 pr-4 text-[var(--text-muted)]">{r.expectedDeliveryDate ?? '—'}</td>
                        <td className="py-3 pr-4 text-[var(--text-muted)]">{r.priority}</td>
                        <td className="py-3">
                          <div className="flex flex-wrap gap-1.5">
                            <Link href={storeReceiveLink(r.id)} className="rounded-md bg-[var(--brand)] px-2 py-1 text-xs text-white">Receive Into Stock</Link>
                            <Link href={storeProcurementDetail(r.id)} className="rounded-md border border-[var(--border-subtle)] px-2 py-1 text-xs text-[var(--text-muted)] hover:text-[var(--foreground)]">Open Procurement</Link>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>
      </section>

      {/* ── Issue queue ─────────────────────────────────────────────── */}
      <section aria-label="Issue queue">
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle><span className="inline-flex items-center gap-2"><HandHelping className="h-5 w-5 text-violet-300" />Issue queue</span></CardTitle>
              <Link href={storeIssueLink()} className="text-xs text-violet-300 hover:text-violet-200">Open full issue queue →</Link>
            </div>
          </CardHeader>
          <CardContent>
            {issueQueue.length === 0 ? (
              <p className="py-4 text-center text-sm text-[var(--text-muted)]">No approved issue requests found.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="min-w-[820px] w-full text-sm">
                  <thead>
                    <tr className="border-b border-[var(--border-subtle)]/60 text-left">
                      <th className="pb-2 pr-4 text-xs uppercase text-[var(--text-muted)]">Request</th>
                      <th className="pb-2 pr-4 text-xs uppercase text-[var(--text-muted)]">Asset</th>
                      <th className="pb-2 pr-4 text-xs uppercase text-[var(--text-muted)]">Department</th>
                      <th className="pb-2 pr-4 text-xs uppercase text-[var(--text-muted)]">Reported condition</th>
                      <th className="pb-2 pr-4 text-xs uppercase text-[var(--text-muted)]">Status</th>
                      <th className="pb-2 text-xs uppercase text-[var(--text-muted)]">Action</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[var(--border-subtle)]/60">
                    {issueQueue.slice(0, 15).map((r) => (
                      <tr key={r.id}>
                        <td className="py-3 pr-4 font-medium text-[var(--foreground)]">{r.requestNumber}</td>
                        <td className="py-3 pr-4">
                          <p className="text-[var(--foreground)]">{r.assetName}</p>
                          <p className="text-xs text-[var(--text-muted)]">{r.assetCode}</p>
                        </td>
                        <td className="py-3 pr-4 text-[var(--text-muted)]">{r.departmentName}</td>
                        <td className="py-3 pr-4 text-[var(--text-muted)]">{r.reportedCondition ?? '—'}</td>
                        <td className="py-3 pr-4"><Badge variant="success">{r.status}</Badge></td>
                        <td className="py-3">
                          <div className="flex flex-wrap gap-1.5">
                            <Link href={storeIssueLink()} className="rounded-md bg-[var(--brand)] px-2 py-1 text-xs text-white">Issue Approved Item</Link>
                            <Link href={`/maintenance/requests/${r.id}`} className="rounded-md border border-[var(--border-subtle)] px-2 py-1 text-xs text-[var(--text-muted)] hover:text-[var(--foreground)]">View Request Evidence</Link>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <p className="mt-3 text-xs text-[var(--text-muted)]">Approved maintenance requests are surfaced as the handoff queue for the store. Issue mutation must occur on the Logistics &gt; Issue panel — Store cannot approve item requests directly.</p>
              </div>
            )}
          </CardContent>
        </Card>
      </section>

      {/* ── Stock movement summary ────────────────────────────────── */}
      <section aria-label="Stock movement">
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle><span className="inline-flex items-center gap-2"><ArrowRightLeft className="h-5 w-5 text-emerald-300" />Stock movement / bin card</span></CardTitle>
              <Link href={storeBinCardLink()} className="text-xs text-violet-300 hover:text-violet-200">Open bin card →</Link>
            </div>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <div className="rounded-lg border border-[var(--border-subtle)] p-3">
                <p className="text-xs uppercase text-[var(--text-muted)]">Receipts this month</p>
                <p className="mt-1 text-2xl font-semibold text-[var(--foreground)]">{metrics.recentReceipts}</p>
                <Link href={storeReport('spare-parts-stock')} className="mt-2 inline-block text-xs text-violet-300 hover:text-violet-200">Export Stock Report →</Link>
              </div>
              <div className="rounded-lg border border-[var(--border-subtle)] p-3">
                <p className="text-xs uppercase text-[var(--text-muted)]">Issues this month</p>
                <p className="mt-1 text-2xl font-semibold text-[var(--foreground)]">{metrics.recentIssues}</p>
                <Link href="/logistics?workflow=usage-linkage" className="mt-2 inline-block text-xs text-violet-300 hover:text-violet-200">Open Usage Linkage →</Link>
              </div>
              <div className="rounded-lg border border-[var(--border-subtle)] p-3">
                <p className="text-xs uppercase text-[var(--text-muted)]">Total active parts</p>
                <p className="mt-1 text-2xl font-semibold text-[var(--foreground)]">{metrics.totalParts}</p>
                <Link href="/spare-parts" className="mt-2 inline-block text-xs text-violet-300 hover:text-violet-200">Open Stock Control →</Link>
              </div>
            </div>
          </CardContent>
        </Card>
      </section>

      {/* ── Maintenance blockers compact panel ──────────────────────── */}
      <section aria-label="Maintenance blockers compact">
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle><span className="inline-flex items-center gap-2"><Wrench className="h-5 w-5 text-orange-300" />Work orders affected</span></CardTitle>
              <Link href="/maintenance" className="text-xs text-violet-300 hover:text-violet-200">Open blocker view →</Link>
            </div>
          </CardHeader>
          <CardContent>
            {blockers.length === 0 ? (
              <p className="py-4 text-center text-sm text-[var(--text-muted)]">No on-hold work orders currently flagged.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="min-w-[720px] w-full text-sm">
                  <thead>
                    <tr className="border-b border-[var(--border-subtle)]/60 text-left">
                      <th className="pb-2 pr-4 text-xs uppercase text-[var(--text-muted)]">Work Order</th>
                      <th className="pb-2 pr-4 text-xs uppercase text-[var(--text-muted)]">Asset</th>
                      <th className="pb-2 pr-4 text-xs uppercase text-[var(--text-muted)]">Department</th>
                      <th className="pb-2 pr-4 text-xs uppercase text-[var(--text-muted)]">Priority</th>
                      <th className="pb-2 pr-4 text-xs uppercase text-[var(--text-muted)]">Blocked since</th>
                      <th className="pb-2 text-xs uppercase text-[var(--text-muted)]">Evidence</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[var(--border-subtle)]/60">
                    {blockers.slice(0, 10).map((b) => (
                      <tr key={b.id}>
                        <td className="py-3 pr-4 font-medium text-[var(--foreground)]">{b.workOrderNumber ?? `WO ${b.id.slice(0, 8)}`}</td>
                        <td className="py-3 pr-4">
                          <p className="text-[var(--foreground)]">{b.assetName}</p>
                          <p className="text-xs text-[var(--text-muted)]">{b.assetCode}</p>
                        </td>
                        <td className="py-3 pr-4 text-[var(--text-muted)]">{b.departmentName}</td>
                        <td className="py-3 pr-4 text-[var(--text-muted)]">{b.priority ?? '—'}</td>
                        <td className="py-3 pr-4 text-[var(--text-muted)]">{b.blockedSince?.slice(0, 10) ?? '—'}</td>
                        <td className="py-3">
                          <div className="flex flex-wrap gap-1.5">
                            <Link href={storeWorkOrderEvidence(b.id)} className="rounded-md border border-[var(--border-subtle)] px-2 py-1 text-xs text-[var(--text-muted)] hover:text-[var(--foreground)]">View Work Evidence</Link>
                            {b.assetId && (<Link href={storeEquipmentDetail(b.assetId)} className="rounded-md border border-[var(--border-subtle)] px-2 py-1 text-xs text-[var(--text-muted)] hover:text-[var(--foreground)]">Asset Profile</Link>)}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>
      </section>

      {/* ── Quick links ───────────────────────────────────────────── */}
      <section aria-label="Store quick links">
        <div className="flex flex-wrap gap-2">
          <Link href="/spare-parts" className="inline-flex items-center gap-2 rounded-md border border-[var(--border-subtle)] px-3 py-1.5 text-sm text-[var(--text-muted)] hover:text-[var(--foreground)]"><Package className="h-4 w-4" /> Spare Parts Stock Control</Link>
          <Link href="/logistics" className="inline-flex items-center gap-2 rounded-md border border-[var(--border-subtle)] px-3 py-1.5 text-sm text-[var(--text-muted)] hover:text-[var(--foreground)]"><Boxes className="h-4 w-4" /> Logistics Console</Link>
          <Link href="/procurement" className="inline-flex items-center gap-2 rounded-md border border-[var(--border-subtle)] px-3 py-1.5 text-sm text-[var(--text-muted)] hover:text-[var(--foreground)]"><PackageCheck className="h-4 w-4" /> Procurement Tracking</Link>
          <Link href="/maintenance" className="inline-flex items-center gap-2 rounded-md border border-[var(--border-subtle)] px-3 py-1.5 text-sm text-[var(--text-muted)] hover:text-[var(--foreground)]"><Wrench className="h-4 w-4" /> Maintenance Blockers</Link>
          <Link href="/alerts" className="inline-flex items-center gap-2 rounded-md border border-[var(--border-subtle)] px-3 py-1.5 text-sm text-[var(--text-muted)] hover:text-[var(--foreground)]">Logistics Alerts</Link>
          <Link href="/calendar" className="inline-flex items-center gap-2 rounded-md border border-[var(--border-subtle)] px-3 py-1.5 text-sm text-[var(--text-muted)] hover:text-[var(--foreground)]">Hospital Calendar</Link>
          <Link href="/reports" className="inline-flex items-center gap-2 rounded-md border border-[var(--border-subtle)] px-3 py-1.5 text-sm text-[var(--text-muted)] hover:text-[var(--foreground)]">Reports</Link>
        </div>
      </section>
    </div>
  );
}
