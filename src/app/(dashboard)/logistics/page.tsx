'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { ArrowRightLeft, Boxes, ClipboardCheck, HandHelping, PackageCheck, Warehouse } from 'lucide-react';
import { PageHeader, Card, Badge, StatCard } from '@/components/ui';
import { AskAiButton } from '@/components/assistant/AskAiButton';
import { getLowStockParts, getSpareParts } from '@/services/spare-parts.service';
import { getProcurementPipeline } from '@/services/procurement.service';
import { createClient } from '@/lib/supabase/client';

export default function LogisticsPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const activePanel = searchParams.get('panel') ?? 'receiving';
  const [summary, setSummary] = useState({
    lowStock: 0,
    totalParts: 0,
    receipts: 0,
    issues: 0,
    procurementOpen: 0,
    pendingReceiving: 0,
    pendingIssue: 0,
    workOrderIssues: 0,
    latestReceipt: 'No receipts recorded',
    latestIssue: 'No issues recorded',
    latestProcurement: 'No open procurement',
    issueExamples: [] as string[],
    procurementExamples: [] as string[],
    receiptExamples: [] as string[],
  });

  useEffect(() => {
    async function loadSummary() {
      const supabase = createClient();
      const [lowRes, partsRes, receiptsRes, issuesRes, procurementRes] = await Promise.all([
        getLowStockParts(),
        getSpareParts({ is_active: true }),
        supabase.from('stock_receipts').select('id, quantity, received_date, spare_parts(part_code, name)').order('received_date', { ascending: false }).limit(20),
        supabase.from('stock_issues').select('id, quantity, issue_date, issued_to_event_id, spare_parts(part_code, name)').order('issue_date', { ascending: false }).limit(20),
        getProcurementPipeline(),
      ]);
      const procurementRows = (procurementRes.data ?? []) as Array<{ status?: string; title?: string; request_number?: string; expected_delivery_date?: string | null }>;
      const receiptRows = (receiptsRes.data ?? []) as Array<{ quantity?: number; received_date?: string; spare_parts?: { part_code?: string; name?: string } | null }>;
      const issueRows = (issuesRes.data ?? []) as Array<{ quantity?: number; issue_date?: string; issued_to_event_id?: string | null; spare_parts?: { part_code?: string; name?: string } | null }>;
      const openProcurement = procurementRows.filter((row) => row.status && !['delivered', 'canceled'].includes(row.status));
      const deliveredNotReceived = procurementRows.filter((row) => row.status === 'delivered').length;
      setSummary({
        lowStock: lowRes.data?.length ?? 0,
        totalParts: partsRes.data?.length ?? 0,
        receipts: receiptRows.length,
        issues: issueRows.length,
        procurementOpen: openProcurement.length,
        pendingReceiving: deliveredNotReceived,
        pendingIssue: lowRes.data?.length ?? 0,
        workOrderIssues: issueRows.filter((row) => row.issued_to_event_id).length,
        latestReceipt: receiptRows[0] ? `${receiptRows[0].spare_parts?.part_code ?? 'Part'} x${receiptRows[0].quantity ?? 0}` : 'No receipts recorded',
        latestIssue: issueRows[0] ? `${issueRows[0].spare_parts?.part_code ?? 'Part'} x${issueRows[0].quantity ?? 0}` : 'No issues recorded',
        latestProcurement: openProcurement[0]?.status ? `Latest status: ${openProcurement[0].status.replace(/_/g, ' ')}` : 'No open procurement',
        issueExamples: issueRows.slice(0, 3).map((row) => `${row.spare_parts?.part_code ?? 'Part'} x${row.quantity ?? 0}`),
        procurementExamples: openProcurement.slice(0, 3).map((row) => `${row.request_number ?? 'PR'} · ${row.title ?? row.status}`),
        receiptExamples: receiptRows.slice(0, 3).map((row) => `${row.spare_parts?.part_code ?? 'Part'} x${row.quantity ?? 0}`),
      });
    }
    void loadSummary();
  }, []);

  const routeTo = (href: string) => router.push(href);

  const logisticsAreas = [
    {
      title: 'Item Receiving',
      href: '/logistics?panel=receiving',
      desc: 'Record inbound stock from delivered procurement or direct receipts.',
      count: summary.pendingReceiving,
      latest: summary.latestReceipt,
      icon: Warehouse,
      action: 'Receive Item',
    },
    {
      title: 'Item Request',
      href: '/logistics?panel=request',
      desc: 'Track stock support requests through the central Requests Hub.',
      count: summary.procurementOpen,
      latest: summary.latestProcurement,
      icon: HandHelping,
      action: 'Open Requests',
    },
    {
      title: 'Item Approval / Issue',
      href: '/logistics?panel=issue',
      desc: 'Issue parts to departments or work orders with traceability.',
      count: summary.pendingIssue,
      latest: summary.latestIssue,
      icon: ClipboardCheck,
      action: 'Issue Stock',
    },
    {
      title: 'Stock Balance / Bin Card',
      href: '/logistics?panel=balance',
      desc: 'Review current balances, reorder thresholds, receipts, and issues.',
      count: summary.totalParts,
      latest: `${summary.lowStock} below reorder threshold`,
      icon: Boxes,
      action: 'Review Balance',
    },
    {
      title: 'Usage Linkage',
      href: '/logistics?panel=usage-linkage',
      desc: 'Review stock issues connected to maintenance execution evidence.',
      count: summary.workOrderIssues,
      latest: 'Stock issue records retain work-order linkage where available.',
      icon: ArrowRightLeft,
      action: 'Trace Usage',
    },
  ];

  const todayWork = [
    {
      label: 'Pending issue',
      count: summary.pendingIssue,
      why: 'Approved/requested stock support waiting to be issued or procured before maintenance can continue.',
      action: 'Open Issue Queue',
      href: '/logistics?panel=issue',
      tone: 'text-orange-300',
      secondary: ['Issue Stock', 'View Affected Work Orders'],
    },
    {
      label: 'Open procurement',
      count: summary.procurementOpen,
      why: 'Purchases that need follow-up before stock can recover.',
      action: 'Track Procurement Pipeline',
      href: '/procurement?filter=open&source=logistics',
      tone: 'text-violet-300',
      secondary: ['Receive Delivered Items', 'Escalate Delayed Orders'],
    },
    {
      label: 'Work-order usage links',
      count: summary.workOrderIssues,
      why: `${summary.workOrderIssues} stock issues are linked to work orders; ${Math.max(summary.issues - summary.workOrderIssues, 0)} issue rows are not linked.`,
      action: 'Trace Usage',
      href: '/logistics?panel=usage-linkage',
      tone: 'text-cyan-300',
      secondary: ['Open Blocked Work Orders', 'Review Unlinked Issues'],
    },
  ];

  const panelContent: Record<string, { title: string; description: string; examples: string[]; actions: Array<{ label: string; href: string }> }> = {
    receiving: {
      title: 'Item Receiving',
      description: 'Delivered procurement items ready to receive and recent direct stock receipts.',
      examples: summary.receiptExamples,
      actions: [
        { label: 'Receive Stock', href: '/spare-parts?action=receive&source=logistics' },
        { label: 'Track Delivered Procurement', href: '/procurement?filter=delivered&source=logistics' },
      ],
    },
    request: {
      title: 'Item Request',
      description: 'Open stock support requests by department, part, or work-order need.',
      examples: summary.procurementExamples,
      actions: [
        { label: 'Request Procurement', href: '/procurement?source=logistics' },
        { label: 'Open Stock Blockers', href: '/spare-parts?filter=blockers&source=logistics' },
      ],
    },
    issue: {
      title: 'Item Approval / Issue',
      description: 'Approved or requested stock support waiting for issue, procurement, or evidence linkage.',
      examples: summary.issueExamples,
      actions: [
        { label: 'Issue Stock', href: '/spare-parts?action=issue&source=logistics' },
        { label: 'Open Issue Queue', href: '/spare-parts?filter=blockers&source=logistics' },
      ],
    },
    balance: {
      title: 'Stock Balance / Bin Card',
      description: 'Stock movement ledger: current balance, reorder threshold, recent receipts, and recent issues.',
      examples: [`${summary.totalParts} active parts`, `${summary.lowStock} below reorder threshold`, `${summary.receipts} recent receipt rows`],
      actions: [
        { label: 'Review Balance', href: '/spare-parts?tab=catalog&source=logistics' },
        { label: 'Open Receipts', href: '/spare-parts?tab=receipts&source=logistics' },
        { label: 'Open Issues', href: '/spare-parts?tab=issues&source=logistics' },
      ],
    },
    'usage-linkage': {
      title: 'Usage Linkage',
      description: 'Trace part issue to work order, equipment, and maintenance execution evidence.',
      examples: [`${summary.workOrderIssues} linked issue rows`, `${Math.max(summary.issues - summary.workOrderIssues, 0)} unlinked issue rows`, `${summary.lowStock} possible blockers`],
      actions: [
        { label: 'Trace Usage', href: '/spare-parts?tab=issues&source=logistics&linked=work-orders' },
        { label: 'Open Blocked Work Orders', href: '/work-orders?filter=on_hold&source=logistics' },
      ],
    },
  };
  const selectedPanel = panelContent[activePanel] ?? panelContent.receiving;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Logistics"
        description="Store operations for stock receiving, request, issue, and balance control."
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
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-5">
        <StatCard label="Low Stock" value={summary.lowStock} icon={<Boxes className="h-6 w-6" />} color="red" onClick={() => routeTo('/spare-parts?filter=low-stock&source=logistics')} />
        <StatCard label="Active Parts" value={summary.totalParts} icon={<Warehouse className="h-6 w-6" />} color="blue" onClick={() => routeTo('/spare-parts?tab=catalog&source=logistics')} />
        <StatCard label="Recent Receipts" value={summary.receipts} icon={<ClipboardCheck className="h-6 w-6" />} color="green" onClick={() => routeTo('/spare-parts?tab=receipts&source=logistics')} />
        <StatCard label="Recent Issues" value={summary.issues} icon={<ArrowRightLeft className="h-6 w-6" />} color="orange" onClick={() => routeTo('/spare-parts?tab=issues&source=logistics')} />
        <StatCard label="Open Procurement" value={summary.procurementOpen} icon={<HandHelping className="h-6 w-6" />} color="purple" onClick={() => routeTo('/procurement?filter=open&source=logistics')} />
        <StatCard label="Pending Receiving" value={summary.pendingReceiving} icon={<PackageCheck className="h-6 w-6" />} color="yellow" active={activePanel === 'receiving'} onClick={() => routeTo('/logistics?panel=receiving')} />
        <StatCard label="Pending Issue" value={summary.pendingIssue} icon={<ClipboardCheck className="h-6 w-6" />} color="orange" active={activePanel === 'issue'} onClick={() => routeTo('/logistics?panel=issue')} />
        <StatCard label="Work Order Linked Issues" value={summary.workOrderIssues} icon={<ArrowRightLeft className="h-6 w-6" />} color="blue" active={activePanel === 'usage-linkage'} onClick={() => routeTo('/logistics?panel=usage-linkage')} />
      </div>
      <section className="panel-surface rounded-lg p-4">
        <h2 className="text-base font-semibold text-[var(--foreground)]">Store Workflow</h2>
        <div className="mt-3 flex flex-wrap items-center gap-2 text-sm text-[var(--text-muted)]">
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
          <p className="text-sm text-[var(--text-muted)]">Receive arrived stock, issue what can safely be issued, and escalate stock blockers that are delaying work orders.</p>
        </div>
        <div className="grid gap-3 md:grid-cols-3">
          {todayWork.map((item) => (
            <Link key={item.label} href={item.href} className="rounded-lg border border-[var(--border-subtle)] bg-[var(--surface-1)] p-3 transition hover:border-[var(--brand)]/50">
              <div className="flex items-center justify-between gap-3">
                <p className="text-sm font-semibold text-[var(--foreground)]">{item.label}</p>
                <span className={`text-2xl font-bold ${item.tone}`}>{item.count}</span>
              </div>
              <p className="mt-2 text-sm text-[var(--text-muted)]">{item.why}</p>
              <p className="mt-3 text-sm font-medium text-[var(--brand)]">{item.action}</p>
              <div className="mt-2 flex flex-wrap gap-1">
                {item.secondary.map((label) => <span key={label} className="rounded-full bg-[var(--surface-3)] px-2 py-0.5 text-[10px] text-[var(--text-muted)]">{label}</span>)}
              </div>
            </Link>
          ))}
        </div>
      </section>
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {logisticsAreas.map((area) => (
          <Link key={area.title} href={area.href}>
            <Card className="h-full transition-transform hover:-translate-y-0.5">
              <div className="flex items-start gap-3">
                <div className="rounded-lg bg-cyan-500/20 p-2 text-cyan-300">
                  <area.icon className="h-5 w-5" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-3">
                    <p className="font-semibold text-[var(--foreground)]">{area.title}</p>
                    <Badge variant="info">{area.count}</Badge>
                  </div>
                  <p className="text-sm text-[var(--text-muted)]">{area.desc}</p>
                  <p className="mt-3 text-xs text-[var(--text-muted)]">{area.latest}</p>
                  <p className="mt-2 text-sm font-medium text-[var(--brand)]">{area.action}</p>
                </div>
              </div>
            </Card>
          </Link>
        ))}
      </div>
      <section className="panel-surface rounded-lg p-4">
        <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-base font-semibold text-[var(--foreground)]">{selectedPanel.title}</h2>
            <p className="text-sm text-[var(--text-muted)]">{selectedPanel.description}</p>
          </div>
          <Badge variant="info">{activePanel.replace(/-/g, ' ')}</Badge>
        </div>
        <div className="grid gap-3 md:grid-cols-3">
          {(selectedPanel.examples.length > 0 ? selectedPanel.examples : ['No rows available yet']).map((example) => (
            <div key={example} className="rounded-lg border border-[var(--border-subtle)] bg-[var(--surface-1)] p-3 text-sm text-[var(--foreground)]">
              {example}
            </div>
          ))}
        </div>
        <div className="mt-4 flex flex-wrap gap-2">
          {selectedPanel.actions.map((action) => (
            <Link key={action.label} href={action.href} className="rounded-lg border border-[var(--border-subtle)] px-3 py-1.5 text-sm font-medium text-[var(--brand)] hover:bg-[var(--surface-2)]">
              {action.label}
            </Link>
          ))}
        </div>
      </section>
    </div>
  );
}
