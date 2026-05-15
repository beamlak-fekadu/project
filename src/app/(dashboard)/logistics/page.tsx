'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { ArrowRightLeft, Boxes, ClipboardCheck, HandHelping, PackageCheck, Warehouse } from 'lucide-react';
import { PageHeader, Badge, StatCard } from '@/components/ui';
import ClearFiltersButton from '@/components/ui/ClearFiltersButton';
import Table from '@/components/ui/Table';
import { AskAiButton } from '@/components/assistant/AskAiButton';
import { getLowStockParts, getSpareParts } from '@/services/spare-parts.service';
import { getProcurementPipeline } from '@/services/procurement.service';
import { createClient } from '@/lib/supabase/client';
import { procurementDetail } from '@/app/(dashboard)/command/_lib/command-center-routes';
import { useRole } from '@/hooks/useRole';
import StoreLogisticsConsole from './_components/StoreLogisticsConsole';

type WorkflowPanel = 'receiving' | 'requests' | 'issue' | 'bin-card' | 'usage-linkage';

type ProcurementRow = { id: string; request_number: string; title: string; status: string; priority: string; expected_delivery_date: string | null; created_at: string };
type PartRow = { id: string; part_code: string; name: string; current_stock: number; reorder_level: number; unit_cost: number | null; is_active: boolean };
type ReceiptRow = { id: string; quantity: number; received_date: string; supplier: string | null; spare_parts: { part_code: string; name: string } | null };
type IssueRow = { id: string; quantity: number; issue_date: string; issued_to_event_id: string | null; notes: string | null; spare_parts: { part_code: string; name: string } | null };

function priorityVariant(priority: string): 'error' | 'warning' | 'info' | 'default' {
  if (priority === 'critical') return 'error';
  if (priority === 'high') return 'warning';
  if (priority === 'medium') return 'info';
  return 'default';
}

function normalizeWorkflow(value: string | null): WorkflowPanel {
  const map: Record<string, WorkflowPanel> = {
    receiving: 'receiving',
    requests: 'requests',
    request: 'requests',
    issue: 'issue',
    'bin-card': 'bin-card',
    balance: 'bin-card',
    'usage-linkage': 'usage-linkage',
    usage: 'usage-linkage',
  };
  return map[value ?? ''] ?? 'receiving';
}

export default function LogisticsPage() {
  const { roles } = useRole();
  const isStoreOnly =
    roles.includes('store_user') &&
    !roles.some((r) => r === 'developer' || r === 'admin' || r === 'bme_head' || r === 'technician');
  if (isStoreOnly) return <StoreLogisticsConsole />;
  return <OperationalLogisticsPage />;
}

function OperationalLogisticsPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { canManageParts } = useRole();
  const activeWorkflow = normalizeWorkflow(searchParams.get('workflow') ?? searchParams.get('panel'));

  const [procurement, setProcurement] = useState<ProcurementRow[]>([]);
  const [parts, setParts] = useState<PartRow[]>([]);
  const [lowStock, setLowStock] = useState<PartRow[]>([]);
  const [receipts, setReceipts] = useState<ReceiptRow[]>([]);
  const [issues, setIssues] = useState<IssueRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      const supabase = createClient();
      const [lowRes, partsRes, receiptsRes, issuesRes, procurementRes] = await Promise.all([
        getLowStockParts(),
        getSpareParts({ is_active: true }),
        supabase.from('stock_receipts').select('id, quantity, received_date, supplier, spare_parts(part_code, name)').order('received_date', { ascending: false }).limit(100),
        supabase.from('stock_issues').select('id, quantity, issue_date, issued_to_event_id, notes, spare_parts(part_code, name)').order('issue_date', { ascending: false }).limit(100),
        getProcurementPipeline(),
      ]);
      setProcurement((procurementRes.data ?? []) as unknown as ProcurementRow[]);
      setParts((partsRes.data ?? []) as unknown as PartRow[]);
      setLowStock((lowRes.data ?? []) as unknown as PartRow[]);
      setReceipts((receiptsRes.data ?? []) as unknown as ReceiptRow[]);
      setIssues((issuesRes.data ?? []) as unknown as IssueRow[]);
      setLoading(false);
    }
    void load();
  }, []);

  const deliveredProcurement = procurement.filter((row) => row.status === 'delivered');
  const openProcurement = procurement.filter((row) => !['delivered', 'canceled'].includes(row.status));
  const stockoutParts = parts.filter((row) => Number(row.current_stock ?? 0) <= 0);
  const linkedIssues = issues.filter((row) => row.issued_to_event_id);
  const unlinkedIssues = issues.filter((row) => !row.issued_to_event_id);

  const summary = {
    lowStock: lowStock.length,
    totalParts: parts.length,
    receipts: receipts.length,
    issues: issues.length,
    procurementOpen: openProcurement.length,
    pendingReceiving: deliveredProcurement.length,
    pendingIssue: lowStock.length,
    workOrderIssues: linkedIssues.length,
  };

  const go = (href: string) => router.push(href);

  const workflowAreas = [
    { id: 'receiving' as WorkflowPanel, title: 'Item Receiving', icon: Warehouse, count: summary.pendingReceiving, desc: 'Delivered procurement ready to receive into stock.' },
    { id: 'requests' as WorkflowPanel, title: 'Item Request', icon: HandHelping, count: summary.procurementOpen, desc: 'Open procurement and stock support requests.' },
    { id: 'issue' as WorkflowPanel, title: 'Item Approval / Issue', icon: ClipboardCheck, count: summary.pendingIssue, desc: 'Low stock and stockout items needing issue or procurement.' },
    { id: 'bin-card' as WorkflowPanel, title: 'Stock Balance / Bin Card', icon: Boxes, count: summary.totalParts, desc: 'Stock movement ledger: balances, receipts, and issues.' },
    { id: 'usage-linkage' as WorkflowPanel, title: 'Usage Linkage', icon: ArrowRightLeft, count: summary.workOrderIssues, desc: 'Trace parts issued to maintenance execution.' },
  ];

  function renderPanel() {
    if (loading) return <p className="text-sm text-[var(--text-muted)]">Loading data...</p>;

    if (activeWorkflow === 'receiving') {
      if (deliveredProcurement.length === 0) {
        return <p className="py-8 text-center text-sm text-[var(--text-muted)]">No delivered procurement items are waiting for receipt. Items appear here when procurement status is &quot;delivered.&quot;</p>;
      }
      return (
        <Table
          columns={[
            { key: 'request_number', header: 'Request #', sortable: true },
            { key: 'title', header: 'Item', sortable: true },
            { key: 'priority', header: 'Priority', render: (row: Record<string, unknown>) => <Badge variant={priorityVariant(String(row.priority ?? ''))}>{String(row.priority ?? '—')}</Badge> },
            { key: 'expected_delivery_date', header: 'Expected Delivery', render: (row: Record<string, unknown>) => row.expected_delivery_date ? new Date(row.expected_delivery_date as string).toLocaleDateString() : '—' },
            {
              key: 'action', header: 'Next Action',
              render: (row: Record<string, unknown>) => (
                <div className="flex flex-wrap gap-1.5">
                  <Link href={`/spare-parts?action=receive&source=logistics&procurementId=${String(row.id)}`} className="rounded-lg bg-emerald-600 px-2 py-1 text-xs font-medium text-white hover:bg-emerald-500">
                    Receive Into Stock
                  </Link>
                  <Link href={procurementDetail(String(row.id))} className="rounded-lg border border-[var(--border-subtle)] px-2 py-1 text-xs font-medium hover:bg-[var(--surface-2)]">
                    Open Procurement
                  </Link>
                </div>
              ),
            },
          ]}
          data={deliveredProcurement as unknown as Record<string, unknown>[]}
          emptyMessage="No delivered items found"
        />
      );
    }

    if (activeWorkflow === 'requests') {
      if (openProcurement.length === 0) {
        return (
          <div className="py-8 text-center">
            <p className="text-sm text-[var(--text-muted)]">No open procurement or stock requests.</p>
            {canManageParts && (
              <Link href="/procurement/requests/new?source=logistics" className="mt-3 inline-flex rounded-lg bg-[var(--brand)] px-4 py-2 text-sm font-medium text-white hover:bg-[var(--brand-strong)]">
                Create Procurement Request
              </Link>
            )}
          </div>
        );
      }
      return (
        <Table
          columns={[
            { key: 'request_number', header: 'Request #', sortable: true },
            { key: 'title', header: 'Item', sortable: true },
            { key: 'priority', header: 'Priority', render: (row: Record<string, unknown>) => <Badge variant={priorityVariant(String(row.priority ?? ''))}>{String(row.priority ?? '—')}</Badge> },
            {
              key: 'status', header: 'Status',
              render: (row: Record<string, unknown>) => <Badge variant="info">{String(row.status ?? '—').replace(/_/g, ' ')}</Badge>,
            },
            {
              key: 'expected_delivery_date', header: 'Expected Delivery',
              render: (row: Record<string, unknown>) => row.expected_delivery_date ? new Date(row.expected_delivery_date as string).toLocaleDateString() : 'TBD',
            },
            {
              key: 'action', header: 'Next Action',
              render: (row: Record<string, unknown>) => (
                <div className="flex flex-wrap gap-1.5">
                  <Link href={procurementDetail(String(row.id))} className="rounded-lg bg-[var(--brand)] px-2 py-1 text-xs font-medium text-white hover:bg-[var(--brand-strong)]">
                    Track Procurement
                  </Link>
                  {row.status === 'requested' && canManageParts && (
                    <Link href={procurementDetail(String(row.id), 'review')} className="rounded-lg border border-[var(--border-subtle)] px-2 py-1 text-xs font-medium hover:bg-[var(--surface-2)]">
                      Review / Approve
                    </Link>
                  )}
                </div>
              ),
            },
          ]}
          data={openProcurement as unknown as Record<string, unknown>[]}
          emptyMessage="No open requests found"
        />
      );
    }

    if (activeWorkflow === 'issue') {
      const issueRows = lowStock.map((part) => ({
        ...part,
        deficit: Math.max(0, Number(part.reorder_level ?? 0) - Number(part.current_stock ?? 0)),
        isStockout: Number(part.current_stock ?? 0) <= 0,
      }));
      if (issueRows.length === 0) {
        return <p className="py-8 text-center text-sm text-[var(--text-muted)]">All parts are above reorder level. No issue or procurement action needed right now.</p>;
      }
      return (
        <Table
          columns={[
            { key: 'part_code', header: 'Part Code', sortable: true },
            { key: 'name', header: 'Part Name', sortable: true },
            {
              key: 'current_stock', header: 'Current Stock',
              render: (row: Record<string, unknown>) => (
                <span className={(row.isStockout as boolean) ? 'font-semibold text-red-400' : 'font-semibold text-amber-400'}>
                  {String(row.current_stock ?? 0)}
                </span>
              ),
            },
            { key: 'reorder_level', header: 'Reorder Level' },
            {
              key: 'deficit', header: 'Deficit',
              render: (row: Record<string, unknown>) => Number(row.deficit) > 0 ? <Badge variant="warning">-{String(row.deficit)}</Badge> : '—',
            },
            {
              key: 'action', header: 'Next Action',
              render: (row: Record<string, unknown>) => {
                const isStockout = row.isStockout as boolean;
                const partId = String(row.id);
                const params = new URLSearchParams({ source: 'logistics', partId, currentStock: String(row.current_stock ?? 0), reorderLevel: String(row.reorder_level ?? 0) });
                return (
                  <div className="flex flex-wrap gap-1.5">
                    {Number(row.current_stock) > 0 && canManageParts && (
                      <Link href={`/spare-parts?action=issue&source=logistics&partId=${partId}`} className="rounded-lg bg-emerald-600 px-2 py-1 text-xs font-medium text-white hover:bg-emerald-500">
                        Issue Stock
                      </Link>
                    )}
                    <Link
                      href={`/procurement/requests/new?${params.toString()}&itemName=${encodeURIComponent(String(row.name ?? ''))}&reason=Stock+below+reorder+level`}
                      className={isStockout ? 'rounded-lg bg-red-600 px-2 py-1 text-xs font-medium text-white hover:bg-red-500' : 'rounded-lg bg-amber-600 px-2 py-1 text-xs font-medium text-white hover:bg-amber-500'}
                    >
                      {isStockout ? 'Create Urgent Procurement' : 'Request Procurement'}
                    </Link>
                  </div>
                );
              },
            },
          ]}
          data={issueRows as unknown as Record<string, unknown>[]}
          emptyMessage="No low-stock items"
        />
      );
    }

    if (activeWorkflow === 'bin-card') {
      const binRows = parts.map((part) => {
        const partReceipts = receipts.filter((r) => r.spare_parts?.part_code === part.part_code);
        const partIssues = issues.filter((r) => r.spare_parts?.part_code === part.part_code);
        const lastReceipt = partReceipts[0]?.received_date ? new Date(partReceipts[0].received_date).toLocaleDateString() : '—';
        const lastIssue = partIssues[0]?.issue_date ? new Date(partIssues[0].issue_date).toLocaleDateString() : '—';
        const stock = Number(part.current_stock ?? 0);
        const reorder = Number(part.reorder_level ?? 0);
        return {
          ...part,
          receiptsCount: partReceipts.length,
          issuesCount: partIssues.length,
          lastReceipt,
          lastIssue,
          stockState: stock <= 0 ? 'Stockout' : stock <= reorder ? 'Low Stock' : 'Adequate',
        };
      });
      return (
        <Table
          columns={[
            { key: 'part_code', header: 'Code', sortable: true },
            { key: 'name', header: 'Part', sortable: true },
            {
              key: 'current_stock', header: 'Current',
              render: (row: Record<string, unknown>) => {
                const state = String(row.stockState ?? '');
                const cls = state === 'Stockout' ? 'font-bold text-red-600 dark:text-red-400' : state === 'Low Stock' ? 'font-bold text-amber-600 dark:text-amber-400' : 'text-emerald-600 dark:text-emerald-400';
                return <span className={cls}>{String(row.current_stock ?? 0)}</span>;
              },
            },
            { key: 'reorder_level', header: 'Reorder' },
            {
              key: 'stockState', header: 'State',
              render: (row: Record<string, unknown>) => {
                const v = String(row.stockState ?? '');
                return <Badge variant={v === 'Stockout' ? 'error' : v === 'Low Stock' ? 'warning' : 'success'}>{v}</Badge>;
              },
            },
            { key: 'receiptsCount', header: 'Receipts', sortable: true },
            { key: 'lastReceipt', header: 'Last Receipt' },
            { key: 'issuesCount', header: 'Issues', sortable: true },
            { key: 'lastIssue', header: 'Last Issue' },
            {
              key: 'unit_cost', header: 'Unit Cost',
              render: (row: Record<string, unknown>) => row.unit_cost != null ? `ETB ${(Number(row.unit_cost)).toFixed(2)}` : '—',
            },
            {
              key: 'action', header: 'Actions',
              render: (row: Record<string, unknown>) => (
                <div className="flex flex-wrap gap-1.5">
                  <Link href={`/spare-parts?partId=${String(row.id)}&source=logistics`} className="rounded-lg border border-[var(--border-subtle)] px-2 py-1 text-xs font-medium hover:bg-[var(--surface-2)]">
                    Open Part
                  </Link>
                  {Number(row.current_stock) <= Number(row.reorder_level) && (
                    <Link
                      href={`/procurement/requests/new?source=logistics&partId=${String(row.id)}&itemName=${encodeURIComponent(String(row.name ?? ''))}&currentStock=${String(row.current_stock ?? 0)}&reorderLevel=${String(row.reorder_level ?? 0)}&reason=Stock+below+reorder+level`}
                      className="rounded-lg bg-amber-600 px-2 py-1 text-xs font-medium text-white hover:bg-amber-500"
                    >
                      Request Procurement
                    </Link>
                  )}
                </div>
              ),
            },
          ]}
          data={binRows as unknown as Record<string, unknown>[]}
          emptyMessage="No parts found"
        />
      );
    }

    if (activeWorkflow === 'usage-linkage') {
      return (
        <div className="space-y-6">
          {stockoutParts.length > 0 && (
            <div className="rounded-lg border border-red-500/30 bg-red-500/10 p-3">
              <p className="text-sm font-semibold text-red-700 dark:text-red-300">{stockoutParts.length} parts are stocked out — they may be blocking active work orders.</p>
              <Link href="/work-orders?filter=on_hold&source=logistics" className="mt-2 inline-block text-xs text-red-700 dark:text-red-300 hover:underline">
                Open Blocked Work Orders &rarr;
              </Link>
            </div>
          )}
          <div>
            <div className="mb-2 flex items-center justify-between">
              <p className="text-sm font-semibold text-[var(--foreground)]">Linked Issues ({linkedIssues.length})</p>
              <Badge variant="success">Work-order linked</Badge>
            </div>
            {linkedIssues.length === 0 ? (
              <p className="text-sm text-[var(--text-muted)]">No issues are currently linked to work orders.</p>
            ) : (
              <Table
                columns={[
                  { key: 'partCode', header: 'Part Code' },
                  { key: 'partName', header: 'Part' },
                  { key: 'quantity', header: 'Qty' },
                  { key: 'issue_date', header: 'Issue Date', render: (row: Record<string, unknown>) => row.issue_date ? new Date(String(row.issue_date)).toLocaleDateString() : '—' },
                  { key: 'issued_to_event_id', header: 'Work Order Ref', render: (row: Record<string, unknown>) => row.issued_to_event_id ? (
                    <Link href={`/maintenance/work-orders/${String(row.issued_to_event_id)}`} className="text-xs text-[var(--brand)] hover:underline">Open Work Order</Link>
                  ) : '—' },
                  { key: 'notes', header: 'Notes' },
                ]}
                data={linkedIssues.map((i) => ({ ...i, partCode: i.spare_parts?.part_code ?? '—', partName: i.spare_parts?.name ?? '—' })) as unknown as Record<string, unknown>[]}
                emptyMessage=""
              />
            )}
          </div>
          <div>
            <div className="mb-2 flex items-center justify-between">
              <p className="text-sm font-semibold text-[var(--foreground)]">Unlinked Issues ({unlinkedIssues.length})</p>
              <Badge variant="warning">No work-order linkage</Badge>
            </div>
            {unlinkedIssues.length === 0 ? (
              <p className="text-sm text-[var(--text-muted)]">All issues are linked to work orders.</p>
            ) : (
              <Table
                columns={[
                  { key: 'partCode', header: 'Part Code' },
                  { key: 'partName', header: 'Part' },
                  { key: 'quantity', header: 'Qty' },
                  { key: 'issue_date', header: 'Issue Date', render: (row: Record<string, unknown>) => row.issue_date ? new Date(String(row.issue_date)).toLocaleDateString() : '—' },
                  { key: 'notes', header: 'Notes' },
                ]}
                data={unlinkedIssues.map((i) => ({ ...i, partCode: i.spare_parts?.part_code ?? '—', partName: i.spare_parts?.name ?? '—' })) as unknown as Record<string, unknown>[]}
                emptyMessage=""
              />
            )}
          </div>
        </div>
      );
    }

    return null;
  }

  const panelTitles: Record<WorkflowPanel, { title: string; description: string }> = {
    'receiving': { title: 'Item Receiving', description: 'Delivered procurement items ready to receive into stock.' },
    'requests': { title: 'Item Requests', description: 'Open procurement and stock support requests requiring follow-up.' },
    'issue': { title: 'Item Approval / Issue', description: 'Parts at or below reorder level requiring issue or procurement action.' },
    'bin-card': { title: 'Stock Balance / Bin Card', description: 'Movement ledger: current balances, reorder thresholds, receipts, and issue records.' },
    'usage-linkage': { title: 'Usage Linkage', description: 'Trace stock issues to work orders, identify stockout blockers, and review unlinked issues.' },
  };

  const current = panelTitles[activeWorkflow];

  return (
    <div className="space-y-6">
      <PageHeader
        title="Logistics"
        description="Store operations for stock receiving, request, issue, balance, and usage traceability."
        actions={
          <div className="flex items-center gap-2">
            <AskAiButton
              moduleLabel="Logistics"
              label="Explain stock issues"
              seedPrompt="Explain likely stock risks and what actions to prioritize for logistics continuity."
            />
            <Badge variant="warning">Stockout visibility active</Badge>
          </div>
        }
      />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4 2xl:grid-cols-8">
        <StatCard label="Low Stock" value={summary.lowStock} icon={<Boxes className="h-5 w-5" />} color="red" onClick={() => go('/spare-parts?filter=low-stock&source=logistics')} />
        <StatCard label="Active Parts" value={summary.totalParts} icon={<Warehouse className="h-5 w-5" />} color="blue" onClick={() => go('/spare-parts?tab=catalog&source=logistics')} />
        <StatCard label="Recent Receipts" value={summary.receipts} icon={<ClipboardCheck className="h-5 w-5" />} color="green" onClick={() => go('/logistics?workflow=bin-card')} />
        <StatCard label="Recent Issues" value={summary.issues} icon={<ArrowRightLeft className="h-5 w-5" />} color="orange" onClick={() => go('/logistics?workflow=usage-linkage')} />
        <StatCard label="Open Procurement" value={summary.procurementOpen} icon={<HandHelping className="h-5 w-5" />} color="purple" onClick={() => go('/procurement?filter=open&source=logistics')} />
        <StatCard label="Pending Receiving" value={summary.pendingReceiving} icon={<PackageCheck className="h-5 w-5" />} color="yellow" active={activeWorkflow === 'receiving'} onClick={() => go('/logistics?workflow=receiving')} />
        <StatCard label="Low/Stockout Parts" value={summary.pendingIssue} icon={<ClipboardCheck className="h-5 w-5" />} color="orange" active={activeWorkflow === 'issue'} onClick={() => go('/logistics?workflow=issue')} />
        <StatCard label="WO-Linked Issues" value={summary.workOrderIssues} icon={<ArrowRightLeft className="h-5 w-5" />} color="blue" active={activeWorkflow === 'usage-linkage'} onClick={() => go('/logistics?workflow=usage-linkage')} />
      </div>

      {(searchParams.get('workflow') || searchParams.get('panel')) && (
        <div className="flex justify-end">
          <ClearFiltersButton onClick={() => go('/logistics')} />
        </div>
      )}

      <section className="panel-surface rounded-lg p-4">
        <h2 className="mb-3 text-base font-semibold text-[var(--foreground)]">Store Workflow</h2>
        <div className="flex flex-wrap items-center gap-2 text-sm text-[var(--text-muted)]">
          {['Receive', 'Request', 'Approve', 'Issue', 'Balance / Bin Card', 'Usage Evidence'].map((step, index, steps) => (
            <span key={step} className="inline-flex items-center gap-2">
              <span className="rounded-full border border-[var(--border-subtle)] px-3 py-1">{step}</span>
              {index < steps.length - 1 && <span>&rarr;</span>}
            </span>
          ))}
        </div>
      </section>

      <section className="panel-surface rounded-lg p-4">
        <div className="mb-3">
          <h2 className="text-base font-semibold text-[var(--foreground)]">Today Logistics Work</h2>
          <p className="text-sm text-[var(--text-muted)]">Receive arrived stock, issue what can safely be issued, and escalate stock blockers delaying work orders.</p>
        </div>
        <div className="grid gap-3 md:grid-cols-3">
          {[
            {
              label: 'Pending issue',
              count: summary.pendingIssue,
              why: 'Low-stock or stockout parts need procurement or issue decisions before repairs can continue.',
              href: '/logistics?workflow=issue',
              tone: 'text-orange-700 dark:text-orange-300',
            },
            {
              label: 'Open procurement',
              count: summary.procurementOpen,
              why: 'Purchases that need follow-up before stock can recover.',
              href: '/procurement?filter=open&source=logistics',
              tone: 'text-violet-700 dark:text-violet-300',
            },
            {
              label: 'Work-order linked issues',
              count: summary.workOrderIssues,
              why: `${summary.workOrderIssues} stock issues are linked to work orders; ${Math.max(summary.issues - summary.workOrderIssues, 0)} are not linked.`,
              href: '/logistics?workflow=usage-linkage',
              tone: 'text-cyan-700 dark:text-cyan-300',
            },
          ].map((item) => (
            <Link key={item.label} href={item.href} className="rounded-lg border border-[var(--border-subtle)] bg-[var(--surface-1)] p-3 transition hover:border-[var(--brand)]/50">
              <div className="flex items-center justify-between gap-3">
                <p className="text-sm font-semibold text-[var(--foreground)]">{item.label}</p>
                <span className={`text-2xl font-bold ${item.tone}`}>{item.count}</span>
              </div>
              <p className="mt-2 text-sm text-[var(--text-muted)]">{item.why}</p>
              <p className="mt-3 text-sm font-medium text-[var(--brand)]">Open workflow &rarr;</p>
            </Link>
          ))}
        </div>
      </section>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-5">
        {workflowAreas.map((area) => (
          <button
            key={area.id}
            type="button"
            onClick={() => go(`/logistics?workflow=${area.id}`)}
            className={`rounded-lg border p-3 text-left transition ${activeWorkflow === area.id ? 'border-[var(--brand)] bg-[var(--surface-2)]' : 'border-[var(--border-subtle)] hover:border-[var(--brand)]/50'}`}
          >
            <div className="rounded-lg bg-cyan-500/20 p-2 text-cyan-300 inline-flex mb-2">
              <area.icon className="h-4 w-4" />
            </div>
            <p className="text-sm font-semibold text-[var(--foreground)]">{area.title}</p>
            <p className="mt-1 text-xs text-[var(--text-muted)]">{area.desc}</p>
            <Badge variant="info" className="mt-2">{area.count}</Badge>
          </button>
        ))}
      </div>

      <section className="panel-surface rounded-lg p-4">
        <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-base font-semibold text-[var(--foreground)]">{current.title}</h2>
            <p className="mt-1 text-sm text-[var(--text-muted)]">{current.description}</p>
          </div>
          <div className="flex gap-2">
            <Badge variant="info">{activeWorkflow.replace(/-/g, ' ')}</Badge>
            {activeWorkflow === 'receiving' && canManageParts && (
              <Link href="/spare-parts?action=receive&source=logistics" className="rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-emerald-500">
                Receive Stock
              </Link>
            )}
            {activeWorkflow === 'requests' && canManageParts && (
              <Link href="/procurement/requests/new?source=logistics" className="rounded-lg bg-[var(--brand)] px-3 py-1.5 text-xs font-medium text-white hover:bg-[var(--brand-strong)]">
                New Procurement Request
              </Link>
            )}
          </div>
        </div>
        {renderPanel()}
      </section>
    </div>
  );
}
