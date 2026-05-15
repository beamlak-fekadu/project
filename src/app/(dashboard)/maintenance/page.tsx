'use client';

import { useEffect, useState, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import {
  Wrench, ClipboardList, Clock, AlertTriangle, CheckCircle2,
  AlertCircle, TrendingUp, Play, ShieldAlert,
} from 'lucide-react';
import { PageHeader, DataTable, Button, Spinner } from '@/components/ui';
import ClearFiltersButton from '@/components/ui/ClearFiltersButton';
import { UrgencyBadge, WorkOrderStatusBadge, RequestStatusBadge } from '@/components/ui/StatusBadge';
import { getMaintenanceRequests, getWorkOrders } from '@/services/maintenance.service';
import { getRecommendationFlags } from '@/services/analytics.service';
import { useToast } from '@/components/ui/Toast';
import { useRole } from '@/hooks/useRole';
import type { MaintenanceRequest, WorkOrder } from '@/types/domain';
import { generateAlertSummary } from '@/utils/decision-support/explanations';
import { createMaintenanceRequestFromAsset } from '@/app/(dashboard)/command/_lib/command-center-routes';
import { isOpenMaintenanceRequestStatus } from '@/utils/maintenance/request-status';
import ViewerMaintenanceOverview from './_components/ViewerMaintenanceOverview';
import StoreMaintenanceBlockers from './_components/StoreMaintenanceBlockers';
import DepartmentWorkStatus from './_components/DepartmentWorkStatus';

// ─── Types ─────────────────────────────────────────────────────────────────
type RequestRow = MaintenanceRequest & {
  equipment_assets?: { id: string; asset_code?: string | null; name?: string | null; serial_number?: string | null } | Array<{ id: string; asset_code?: string | null; name?: string | null; serial_number?: string | null }> | null;
  departments?: { id: string; name?: string | null; code?: string | null } | Array<{ id: string; name?: string | null; code?: string | null }> | null;
  reported_condition?: string | null;
  [key: string]: unknown;
};

type WorkOrderRow = WorkOrder & {
  equipment_assets?: { id: string; asset_code?: string | null; name?: string | null } | Array<{ id: string; asset_code?: string | null; name?: string | null }> | null;
  profiles?: { id: string; full_name?: string | null; email?: string | null } | Array<{ id: string; full_name?: string | null; email?: string | null }> | null;
  request_id?: string | null;
  completion_outcome?: string | null;
  final_equipment_condition?: string | null;
  [key: string]: unknown;
};

interface RecurringFailureFlag {
  id: string;
  asset_id: string;
  message: string;
  severity: string;
  generated_at: string;
  details?: Record<string, unknown>;
  equipment_assets?: { id?: string; asset_code?: string; name?: string; departments?: { name?: string } | null } | null;
  flag_type?: string;
  is_acknowledged?: boolean;
}

type ReqFilter = 'all' | 'pending' | 'approved' | 'needs_wo' | 'critical' | 'in_progress' | 'completed' | 'rejected';
type WOFilter = 'all' | 'open' | 'unassigned' | 'assigned' | 'in_progress' | 'on_hold' | 'completed' | 'critical';

// ─── Helpers ────────────────────────────────────────────────────────────────
function firstRelation<T>(value: T | T[] | null | undefined): T | null {
  if (!value) return null;
  return Array.isArray(value) ? (value[0] ?? null) : value;
}

function safeDisplay(value: string | null | undefined): string | null {
  if (!value) return null;
  return /^[0-9a-f-]{32,36}$/i.test(value) ? null : value;
}

// ─── Components (must be outside MaintenancePage to avoid static-component error) ──
const CARD_COLORS: Record<string, string> = {
  blue:   'bg-blue-500/15 text-blue-400',
  green:  'bg-emerald-500/15 text-emerald-400',
  yellow: 'bg-amber-500/15 text-amber-400',
  red:    'bg-rose-500/15 text-rose-400',
  purple: 'bg-violet-500/15 text-violet-400',
  orange: 'bg-orange-500/15 text-orange-400',
};

function SummaryCard({ label, value, icon, color = 'blue', active, onClick }: {
  label: string; value: number; icon: React.ReactNode; color?: string; active?: boolean; onClick?: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`panel-surface flex flex-col gap-1 rounded-xl p-4 text-left transition-colors
        ${onClick ? 'cursor-pointer hover:ring-1 hover:ring-[var(--brand)]/40' : ''}
        ${active ? 'ring-2 ring-[var(--brand)]' : ''}`}
    >
      <div className="flex items-start justify-between gap-2">
        <span className="text-2xl font-bold leading-none text-[var(--foreground)]">{value}</span>
        <span className={`rounded-lg p-1.5 ${CARD_COLORS[color] ?? CARD_COLORS.blue}`}>{icon}</span>
      </div>
      <span className="text-xs font-medium leading-tight text-[var(--text-muted)]">{label}</span>
    </button>
  );
}

function ActionLink({ href, label, variant = 'outline' }: {
  href: string; label: string; variant?: 'primary' | 'outline' | 'danger';
}) {
  return (
    <a
      href={href}
      onClick={(e) => e.stopPropagation()}
      className={`inline-flex items-center rounded-md px-2.5 py-1 text-xs font-medium whitespace-nowrap transition-colors ${
        variant === 'primary'
          ? 'bg-[var(--brand)] text-white hover:opacity-90'
          : variant === 'danger'
          ? 'bg-rose-500/15 text-rose-300 hover:bg-rose-500/25'
          : 'border border-[var(--surface-3)] bg-[var(--surface-2)] text-[var(--foreground)] hover:bg-[var(--surface-3)]'
      }`}
    >
      {label}
    </a>
  );
}

function QuickChip({ label, active, count, onClick }: {
  label: string; active: boolean; count?: number; onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium transition-colors ${
        active
          ? 'bg-[var(--brand)] text-white'
          : 'bg-[var(--surface-2)] text-[var(--text-muted)] hover:text-[var(--foreground)]'
      }`}
    >
      {label}
      {count !== undefined && (
        <span className={`rounded-full px-1.5 py-px text-[10px] ${active ? 'bg-white/20 text-white' : 'bg-[var(--surface-3)] text-[var(--text-muted)]'}`}>
          {count}
        </span>
      )}
    </button>
  );
}

function ReportedConditionBadge({ condition }: { condition?: string | null }) {
  if (!condition) return <span className="text-xs text-[var(--text-muted)]">—</span>;
  const map: Record<string, { label: string; cls: string }> = {
    functional_issue: { label: 'Functional (issue)', cls: 'text-emerald-300' },
    needs_repair:     { label: 'Needs repair',       cls: 'text-amber-300' },
    non_functional:   { label: 'Non-functional',     cls: 'text-rose-300' },
  };
  const entry = map[condition];
  if (!entry) return <span className="text-xs text-[var(--text-muted)]">{condition}</span>;
  return <span className={`text-xs font-medium ${entry.cls}`}>{entry.label}</span>;
}

// ─── Quick filter config ────────────────────────────────────────────────────
const REQ_FILTERS: { key: ReqFilter; label: string }[] = [
  { key: 'all',       label: 'All' },
  { key: 'pending',   label: 'Pending' },
  { key: 'approved',  label: 'Approved' },
  { key: 'needs_wo',  label: 'Needs WO' },
  { key: 'critical',  label: 'Critical' },
  { key: 'in_progress', label: 'In Progress' },
  { key: 'completed', label: 'Completed' },
  { key: 'rejected',  label: 'Rejected' },
];

const WO_FILTERS: { key: WOFilter; label: string }[] = [
  { key: 'all',        label: 'All' },
  { key: 'open',       label: 'Open' },
  { key: 'unassigned', label: 'Unassigned' },
  { key: 'assigned',   label: 'Assigned' },
  { key: 'in_progress', label: 'In Progress' },
  { key: 'on_hold',    label: 'On Hold' },
  { key: 'completed',  label: 'Completed' },
  { key: 'critical',   label: 'Critical' },
];

// ─── Main Page ──────────────────────────────────────────────────────────────
export default function MaintenancePage() {
  const { roles } = useRole();
  const isViewerOnly =
    roles.includes('viewer') &&
    !roles.some((r) => r === 'developer' || r === 'admin' || r === 'bme_head' || r === 'technician');
  const isStoreOnly =
    roles.includes('store_user') &&
    !roles.some((r) => r === 'developer' || r === 'admin' || r === 'bme_head' || r === 'technician');
  const isDepartmentOnly =
    (roles.includes('department_head') || roles.includes('department_user')) &&
    !roles.some((r) => r === 'developer' || r === 'admin' || r === 'bme_head' || r === 'technician');
  if (isDepartmentOnly) return <DepartmentWorkStatus />;
  if (isStoreOnly) return <StoreMaintenanceBlockers />;
  if (isViewerOnly) return <ViewerMaintenanceOverview />;
  return <OperationalMaintenancePage />;
}

function OperationalMaintenancePage() {
  const router = useRouter();
  const { toast } = useToast();
  const { canCreateRequests, canManageMaintenance } = useRole();

  const [requests, setRequests] = useState<RequestRow[]>([]);
  const [workOrders, setWorkOrders] = useState<WorkOrderRow[]>([]);
  const [recurringFailures, setRecurringFailures] = useState<RecurringFailureFlag[]>([]);
  const [acknowledgedCount, setAcknowledgedCount] = useState(0);
  const [loading, setLoading] = useState(true);

  const [activeTab, setActiveTab] = useState<'requests' | 'work-orders'>('requests');
  const [reqFilter, setReqFilter] = useState<ReqFilter>('all');
  const [woFilter, setWoFilter] = useState<WOFilter>('all');

  useEffect(() => {
    let cancelled = false;
    async function load() {
      const [reqRes, woRes, flagRes] = await Promise.all([
        getMaintenanceRequests(),
        getWorkOrders(),
        getRecommendationFlags(),
      ]);
      if (cancelled) return;
      if (reqRes.error) toast('error', 'Failed to load maintenance requests');
      if (woRes.error) toast('error', 'Failed to load work orders');
      setRequests((reqRes.data ?? []) as unknown as RequestRow[]);
      setWorkOrders((woRes.data ?? []) as unknown as WorkOrderRow[]);
      const allFlags = (flagRes.data ?? []) as unknown as Array<RecurringFailureFlag>;
      const allRecurring = allFlags.filter((f) => f.flag_type === 'recurring_failure');
      setRecurringFailures(allRecurring.filter((f) => !f.is_acknowledged));
      setAcknowledgedCount(allRecurring.filter((f) => f.is_acknowledged).length);
      setLoading(false);
    }
    void load();
    return () => { cancelled = true; };
  }, [toast]);

  // ── Derived maps ──────────────────────────────────────────────────────────
  const linkedWOByRequest = useMemo(() => {
    const map = new Map<string, WorkOrderRow[]>();
    for (const wo of workOrders) {
      const key = wo.request_id as string | null;
      if (key) map.set(key, [...(map.get(key) ?? []), wo]);
    }
    return map;
  }, [workOrders]);

  const requestById = useMemo(() => {
    const map = new Map<string, RequestRow>();
    for (const r of requests) map.set(r.id, r);
    return map;
  }, [requests]);

  // Map assetId → first open request (used in recurring failure card to prevent duplicate creation)
  const openRequestByAsset = useMemo(() => {
    const map = new Map<string, RequestRow>();
    for (const r of requests) {
      if (isOpenMaintenanceRequestStatus(r.status) && !map.has(r.asset_id)) {
        map.set(r.asset_id, r);
      }
    }
    return map;
  }, [requests]);

  // ── Summary counts (same source as tables) ────────────────────────────────
  const counts = useMemo(() => {
    const now = new Date();
    return {
      pending:   requests.filter((r) => r.status === 'pending').length,
      approved:  requests.filter((r) => r.status === 'approved').length,
      needsWO:   requests.filter((r) => r.status === 'approved' && !(linkedWOByRequest.get(r.id)?.length)).length,
      openWO:    workOrders.filter((wo) => !['completed', 'canceled'].includes(wo.status)).length,
      unassigned: workOrders.filter((wo) => wo.status === 'open' && !wo.assigned_to).length,
      inProgress: workOrders.filter((wo) => wo.status === 'in_progress').length,
      onHold:    workOrders.filter((wo) => wo.status === 'on_hold').length,
      completedMonth: workOrders.filter((wo) => {
        if (wo.status !== 'completed' || !wo.completed_at) return false;
        const d = new Date(wo.completed_at as string);
        return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth();
      }).length,
      recurringFlags: recurringFailures.length,
    };
  }, [requests, workOrders, linkedWOByRequest, recurringFailures]);

  // ── Filtered datasets ─────────────────────────────────────────────────────
  const filteredRequests = useMemo(() => {
    switch (reqFilter) {
      case 'pending':    return requests.filter((r) => r.status === 'pending');
      case 'approved':   return requests.filter((r) => r.status === 'approved');
      case 'needs_wo':   return requests.filter((r) => r.status === 'approved' && !(linkedWOByRequest.get(r.id)?.length));
      case 'critical':   return requests.filter((r) => r.urgency === 'critical');
      case 'in_progress': return requests.filter((r) => r.status === 'in_progress');
      case 'completed':  return requests.filter((r) => r.status === 'completed');
      case 'rejected':   return requests.filter((r) => r.status === 'rejected' || r.status === 'canceled');
      default:           return requests;
    }
  }, [requests, reqFilter, linkedWOByRequest]);

  const filteredWorkOrders = useMemo(() => {
    switch (woFilter) {
      case 'open':       return workOrders.filter((wo) => !['completed', 'canceled'].includes(wo.status));
      case 'unassigned': return workOrders.filter((wo) => wo.status === 'open' && !wo.assigned_to);
      case 'assigned':   return workOrders.filter((wo) => wo.status === 'assigned');
      case 'in_progress': return workOrders.filter((wo) => wo.status === 'in_progress');
      case 'on_hold':    return workOrders.filter((wo) => wo.status === 'on_hold');
      case 'completed':  return workOrders.filter((wo) => wo.status === 'completed');
      case 'critical':   return workOrders.filter((wo) => wo.priority === 'critical');
      default:           return workOrders;
    }
  }, [workOrders, woFilter]);

  // Card click → switch tab and apply filter
  function activateFilter(tab: 'requests' | 'work-orders', filter: string) {
    setActiveTab(tab);
    if (tab === 'requests') setReqFilter(filter as ReqFilter);
    else setWoFilter(filter as WOFilter);
  }

  // ── Column definitions ────────────────────────────────────────────────────
  const requestColumns = useMemo(() => [
    { key: 'request_number', header: 'Request #', sortable: true },
    {
      key: 'asset',
      header: 'Asset',
      sortable: true,
      render: (row: RequestRow) => {
        const a = firstRelation(row.equipment_assets);
        return safeDisplay(a?.name) ?? safeDisplay(a?.asset_code) ?? '—';
      },
    },
    {
      key: 'dept',
      header: 'Dept',
      render: (row: RequestRow) => {
        const d = firstRelation(row.departments);
        return safeDisplay(d?.name) ?? '—';
      },
    },
    {
      key: 'reported_condition',
      header: 'Reported',
      render: (row: RequestRow) => <ReportedConditionBadge condition={row.reported_condition} />,
    },
    {
      key: 'urgency',
      header: 'Urgency',
      sortable: true,
      render: (row: RequestRow) => <UrgencyBadge urgency={row.urgency} />,
    },
    {
      key: 'status',
      header: 'Status',
      sortable: true,
      render: (row: RequestRow) => <RequestStatusBadge status={row.status} />,
    },
    {
      key: 'linked_wo',
      header: 'Work Order',
      render: (row: RequestRow) => {
        const wos = linkedWOByRequest.get(row.id) ?? [];
        if (!wos.length) {
          if (row.status === 'approved') {
            return <span className="text-xs font-semibold text-amber-300">Needs WO</span>;
          }
          return <span className="text-xs text-[var(--text-muted)]">—</span>;
        }
        const latest = wos[0];
        return (
          <a
            href={`/maintenance/work-orders/${latest.id}`}
            onClick={(e) => e.stopPropagation()}
            className="text-xs text-[var(--brand)] hover:underline"
          >
            {latest.work_order_number as string}
          </a>
        );
      },
    },
    {
      key: 'created_at',
      header: 'Created',
      sortable: true,
      render: (row: RequestRow) => new Date(row.created_at).toLocaleDateString(),
    },
    {
      key: 'action',
      header: 'Next Action',
      render: (row: RequestRow) => {
        const wos = linkedWOByRequest.get(row.id) ?? [];
        const openWO = wos.find((wo) => !['completed', 'canceled'].includes(wo.status));

        if (openWO) {
          const s = openWO.status;
          if (s === 'on_hold')    return <ActionLink href={`/maintenance/work-orders/${openWO.id}?action=resolve-blocker`} label="Resolve Blocker" variant="danger" />;
          if (s === 'in_progress') return <ActionLink href={`/maintenance/work-orders/${openWO.id}`} label="View Progress" />;
          return <ActionLink href={`/maintenance/work-orders/${openWO.id}`} label="Open WO" />;
        }
        if (row.status === 'pending') {
          return <ActionLink href={`/maintenance/requests/${row.id}`} label="Review" variant="primary" />;
        }
        if (row.status === 'approved' && canManageMaintenance) {
          const assetId = (firstRelation(row.equipment_assets) as { id: string } | null)?.id ?? row.asset_id;
          return (
            <ActionLink
              href={`/maintenance/work-orders/new?request_id=${row.id}&asset_id=${assetId}&urgency=${row.urgency}&priority=${row.urgency}&work_type=corrective&source=maintenance-request`}
              label="Create WO"
              variant="primary"
            />
          );
        }
        return <ActionLink href={`/maintenance/requests/${row.id}`} label="View" />;
      },
    },
  ], [linkedWOByRequest, canManageMaintenance]);

  const woColumns = useMemo(() => [
    { key: 'work_order_number', header: 'WO #', sortable: true },
    {
      key: 'asset',
      header: 'Asset',
      sortable: true,
      render: (row: WorkOrderRow) => {
        const a = firstRelation(row.equipment_assets);
        return safeDisplay(a?.name) ?? safeDisplay(a?.asset_code) ?? '—';
      },
    },
    {
      key: 'request',
      header: 'Request',
      render: (row: WorkOrderRow) => {
        const reqId = row.request_id as string | null;
        if (!reqId) return <span className="text-xs text-[var(--text-muted)]">—</span>;
        const req = requestById.get(reqId);
        if (!req) return <span className="text-xs text-[var(--text-muted)]">—</span>;
        return (
          <a
            href={`/maintenance/requests/${req.id}`}
            onClick={(e) => e.stopPropagation()}
            className="text-xs text-[var(--brand)] hover:underline"
          >
            {req.request_number}
          </a>
        );
      },
    },
    {
      key: 'assigned_to',
      header: 'Assigned To',
      render: (row: WorkOrderRow) => {
        const name = firstRelation(row.profiles)?.full_name;
        return name
          ? <span className="text-sm">{name}</span>
          : <span className="text-xs font-semibold text-amber-300">Unassigned</span>;
      },
    },
    {
      key: 'priority',
      header: 'Priority',
      sortable: true,
      render: (row: WorkOrderRow) => <UrgencyBadge urgency={row.priority} />,
    },
    {
      key: 'status',
      header: 'Status',
      sortable: true,
      render: (row: WorkOrderRow) => <WorkOrderStatusBadge status={row.status} />,
    },
    {
      key: 'work_type',
      header: 'Type',
      render: (row: WorkOrderRow) =>
        row.work_type.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()),
    },
    {
      key: 'action',
      header: 'Next Action',
      render: (row: WorkOrderRow) => {
        const s = row.status;
        if (s === 'on_hold')    return <ActionLink href={`/maintenance/work-orders/${row.id}?action=resolve-blocker`} label="Resolve Blocker" variant="danger" />;
        if (s === 'in_progress') return <ActionLink href={`/maintenance/work-orders/${row.id}`} label="View Progress" />;
        if (s === 'open' && !row.assigned_to) return <ActionLink href={`/maintenance/work-orders/${row.id}?action=assign`} label="Assign" variant="primary" />;
        if (s === 'assigned')  return <ActionLink href={`/maintenance/work-orders/${row.id}`} label="Start / View" />;
        if (s === 'completed') return <ActionLink href={`/maintenance/work-orders/${row.id}`} label="View Result" />;
        return <ActionLink href={`/maintenance/work-orders/${row.id}`} label="View" />;
      },
    },
  ], [requestById]);

  if (loading) {
    return (
      <div className="flex min-h-[400px] items-center justify-center">
        <Spinner size="lg" />
      </div>
    );
  }

  // ── Summary card config ───────────────────────────────────────────────────
  const summaryCards = [
    { label: 'Pending Requests',    value: counts.pending,        icon: <ClipboardList className="h-4 w-4" />, color: 'yellow', tab: 'requests' as const,    filter: 'pending' },
    { label: 'Approved Requests',   value: counts.approved,       icon: <CheckCircle2 className="h-4 w-4" />, color: 'blue',   tab: 'requests' as const,    filter: 'approved' },
    { label: 'Needs Work Order',    value: counts.needsWO,        icon: <Wrench className="h-4 w-4" />,       color: 'orange', tab: 'requests' as const,    filter: 'needs_wo' },
    { label: 'Open Work Orders',    value: counts.openWO,         icon: <Play className="h-4 w-4" />,         color: 'blue',   tab: 'work-orders' as const, filter: 'open' },
    { label: 'Unassigned',         value: counts.unassigned,     icon: <AlertCircle className="h-4 w-4" />,  color: 'red',    tab: 'work-orders' as const, filter: 'unassigned' },
    { label: 'In Progress',        value: counts.inProgress,     icon: <Clock className="h-4 w-4" />,        color: 'purple', tab: 'work-orders' as const, filter: 'in_progress' },
    { label: 'On Hold',            value: counts.onHold,         icon: <AlertTriangle className="h-4 w-4" />, color: 'orange', tab: 'work-orders' as const, filter: 'on_hold' },
    { label: 'Done This Month',    value: counts.completedMonth, icon: <TrendingUp className="h-4 w-4" />,   color: 'green',  tab: 'work-orders' as const, filter: 'completed' },
  ];

  const activeCardFilter = activeTab === 'requests' ? reqFilter : woFilter;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Maintenance"
        description="Requests, work orders, and workflow management"
        breadcrumbs={[{ label: 'Command Center', href: '/command' }, { label: 'Maintenance' }]}
      />

      {/* ── Summary Cards ── */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 xl:grid-cols-8">
        {summaryCards.map(({ label, value, icon, color, tab, filter }) => (
          <SummaryCard
            key={label}
            label={label}
            value={value}
            icon={icon}
            color={color}
            active={activeTab === tab && activeCardFilter === filter}
            onClick={() => activateFilter(tab, filter)}
          />
        ))}
      </div>

      {/* ── Recurring Failure Banner ── */}
      {recurringFailures.length > 0 && (
        <div className="panel-surface rounded-lg p-5">
          <div className="mb-3 flex items-center justify-between gap-3">
            <h2 className="flex items-center gap-2 text-sm font-semibold text-rose-300">
              <ShieldAlert className="h-4 w-4" />
              Recurring failure equipment ({recurringFailures.length} unacknowledged
              {acknowledgedCount > 0 ? `, ${acknowledgedCount} acknowledged` : ''})
            </h2>
            <span className="text-xs text-[var(--text-muted)]">Threshold: ≥4 failures in assessed period</span>
          </div>
          <div className="max-h-72 space-y-2 overflow-y-auto">
            {recurringFailures.map((flag) => {
              const asset = flag.equipment_assets;
              const assetId = asset?.id ?? flag.asset_id;
              const failureCount = (flag.details?.failure_count as number | undefined) ?? '?';
              const deptName = (flag.details?.department_name as string | undefined) ?? '';
              const existingRequest = openRequestByAsset.get(assetId);
              const diagUrl = createMaintenanceRequestFromAsset(assetId, {
                urgency: 'high',
                description: `Recurring failure detected: ${asset?.name ?? assetId} has ${failureCount} recorded failures, exceeding the threshold of 4. Diagnostic investigation required.`,
                type: 'corrective',
              }).replace('source=command-center', 'source=recurring-failure');
              return (
                <div key={flag.id} className="flex flex-col gap-2 rounded-lg bg-[var(--surface-2)] p-3 sm:flex-row sm:items-center sm:justify-between">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="text-sm font-medium text-[var(--foreground)]">
                        {asset?.name ?? 'Unknown asset'}
                      </p>
                      <span className="rounded bg-rose-500/15 px-1.5 py-px text-[10px] font-semibold text-rose-300">
                        {typeof failureCount === 'number' ? `${failureCount} failures` : 'Failures recorded'}
                      </span>
                      {deptName && (
                        <span className="text-xs text-[var(--text-muted)]">{deptName}</span>
                      )}
                      {existingRequest && (
                        <span className="rounded bg-amber-500/15 px-1.5 py-px text-[10px] font-medium text-amber-300">
                          Request open: {existingRequest.request_number}
                        </span>
                      )}
                    </div>
                    <p className="mt-0.5 text-xs text-[var(--text-muted)]">
                      {asset?.asset_code ?? flag.asset_id} ·{' '}
                      {generateAlertSummary({ assetName: asset?.name, flagType: 'recurring_failure', details: flag.details ?? null })}
                    </p>
                  </div>
                  <div className="flex shrink-0 flex-wrap gap-2">
                    <a href={`/equipment/${assetId}`} className="text-xs font-medium text-violet-300 hover:text-violet-200">
                      View history →
                    </a>
                    <a href={`/equipment/${assetId}`} className="text-xs font-medium text-[var(--brand)] hover:opacity-80">
                      Review risk →
                    </a>
                    {existingRequest ? (
                      <a
                        href={`/maintenance/requests/${existingRequest.id}`}
                        className="rounded-md bg-amber-500/15 px-2.5 py-1 text-xs font-medium text-amber-300 hover:bg-amber-500/25"
                      >
                        Open Request ({existingRequest.request_number})
                      </a>
                    ) : (
                      <a href={diagUrl} className="rounded-md bg-rose-500/15 px-2.5 py-1 text-xs font-medium text-rose-300 hover:bg-rose-500/25">
                        Schedule diagnostic
                      </a>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ── Tabs ── */}
      <div className="panel-surface overflow-hidden rounded-xl">
        {/* Tab headers */}
        <div className="flex border-b border-[var(--surface-3)]">
          {([
            { id: 'requests' as const, label: 'Requests', count: requests.length },
            { id: 'work-orders' as const, label: 'Work Orders', count: workOrders.length },
          ] as const).map(({ id, label, count }) => (
            <button
              key={id}
              type="button"
              onClick={() => setActiveTab(id)}
              className={`flex items-center gap-2 border-b-2 px-5 py-3 text-sm font-medium transition-colors -mb-px ${
                activeTab === id
                  ? 'border-[var(--brand)] text-[var(--foreground)]'
                  : 'border-transparent text-[var(--text-muted)] hover:text-[var(--foreground)]'
              }`}
            >
              {label}
              <span className={`rounded-full px-2 py-px text-[11px] ${activeTab === id ? 'bg-[var(--brand)]/20 text-[var(--brand)]' : 'bg-[var(--surface-3)] text-[var(--text-muted)]'}`}>
                {count}
              </span>
            </button>
          ))}
        </div>

        <div className="p-4">
          {/* ── Requests tab ── */}
          {activeTab === 'requests' && (
            <div className="space-y-3">
              <div className="flex flex-wrap items-center gap-2">
                {REQ_FILTERS.map(({ key, label }) => {
                  const countMap: Partial<Record<ReqFilter, number>> = {
                    pending:    counts.pending,
                    approved:   counts.approved,
                    needs_wo:   counts.needsWO,
                    critical:   requests.filter((r) => r.urgency === 'critical').length,
                    in_progress: requests.filter((r) => r.status === 'in_progress').length,
                    completed:  requests.filter((r) => r.status === 'completed').length,
                    rejected:   requests.filter((r) => r.status === 'rejected' || r.status === 'canceled').length,
                  };
                  return (
                    <QuickChip
                      key={key}
                      label={label}
                      active={reqFilter === key}
                      count={key !== 'all' ? countMap[key] : undefined}
                      onClick={() => setReqFilter(key)}
                    />
                  );
                })}
                {reqFilter !== 'all' && (
                  <ClearFiltersButton onClick={() => setReqFilter('all')} />
                )}
                <div className="ml-auto">
                  {canCreateRequests && (
                    <Link href="/maintenance/requests/new">
                      <Button size="sm">
                        <ClipboardList className="h-4 w-4" />
                        New Request
                      </Button>
                    </Link>
                  )}
                </div>
              </div>
              <DataTable<RequestRow>
                key={reqFilter}
                columns={requestColumns}
                data={filteredRequests}
                searchPlaceholder="Search by request #, asset, department…"
                onRowClick={(row) => router.push(`/maintenance/requests/${row.id}`)}
                emptyMessage="No requests match the current filter."
              />
            </div>
          )}

          {/* ── Work Orders tab ── */}
          {activeTab === 'work-orders' && (
            <div className="space-y-3">
              <div className="flex flex-wrap items-center gap-2">
                {WO_FILTERS.map(({ key, label }) => {
                  const countMap: Partial<Record<WOFilter, number>> = {
                    open:       counts.openWO,
                    unassigned: counts.unassigned,
                    assigned:   workOrders.filter((wo) => wo.status === 'assigned').length,
                    in_progress: counts.inProgress,
                    on_hold:    counts.onHold,
                    completed:  workOrders.filter((wo) => wo.status === 'completed').length,
                    critical:   workOrders.filter((wo) => wo.priority === 'critical').length,
                  };
                  return (
                    <QuickChip
                      key={key}
                      label={label}
                      active={woFilter === key}
                      count={key !== 'all' ? countMap[key] : undefined}
                      onClick={() => setWoFilter(key)}
                    />
                  );
                })}
                {woFilter !== 'all' && (
                  <ClearFiltersButton onClick={() => setWoFilter('all')} />
                )}
                <div className="ml-auto">
                  {canManageMaintenance && (
                    <Link href="/maintenance/work-orders/new">
                      <Button size="sm">
                        <Wrench className="h-4 w-4" />
                        New Work Order
                      </Button>
                    </Link>
                  )}
                </div>
              </div>
              <DataTable<WorkOrderRow>
                key={woFilter}
                columns={woColumns}
                data={filteredWorkOrders}
                searchPlaceholder="Search by WO #, asset, technician…"
                onRowClick={(row) => router.push(`/maintenance/work-orders/${row.id}`)}
                emptyMessage="No work orders match the current filter."
              />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
