'use client';

import { useEffect, useState, useMemo, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import {
  Plus, Activity, ShieldAlert, AlertTriangle, Wrench, CheckCircle2,
  Clock, AlertCircle, TrendingUp, QrCode, Printer, Stamp, RefreshCw,
} from 'lucide-react';
import { PageHeader, Button, Spinner, Badge } from '@/components/ui';
import AssistantPageContextBridge from '@/components/assistant/AssistantPageContextBridge';
import { BarChart, DoughnutChart, ChartCard } from '@/components/charts';
import { getEquipmentList } from '@/services/equipment.service';
import { getAll } from '@/services/settings.service';
import { getRiskScores } from '@/services/analytics.service';
import { getOpenMaintenanceRequests, getOpenWorkOrders } from '@/services/maintenance.service';
import { ROUTES } from '@/constants';
import { useRole } from '@/hooks/useRole';
import {
  formatEquipmentCondition,
  getConditionBadgeClass,
  EQUIPMENT_CONDITION_OPTIONS,
  isFaulted,
} from '@/utils/equipment/condition-labels';
import {
  getMaintenanceState,
  formatMaintenanceState,
  getMaintenanceStateBadgeClass,
  type OpenRequestInfo,
  type OpenWorkOrderInfo,
} from '@/utils/equipment/maintenance-state';
import {
  workOrderDetail,
  maintenanceRequestDetail,
  createMaintenanceRequestFromAsset,
  replacementEvidence,
} from '@/app/(dashboard)/command/_lib/command-center-routes';
import type { EquipmentCondition } from '@/types/domain';
import ViewerEquipmentOverview from './_components/ViewerEquipmentOverview';
import DepartmentEquipmentOverview from './_components/DepartmentEquipmentOverview';
import {
  bulkGenerateMissingQrTokensAction,
  ensureAssetQrTokenAction,
  markQrLabelAttachedAction,
  markQrLabelNeedsReplacementAction,
  markQrLabelPrintedAction,
  markQrLabelsAttachedBulkAction,
  markQrLabelsNeedsReplacementBulkAction,
  markQrLabelsPrintedBulkAction,
  regenerateAssetQrTokenAction,
  revokeQrTokenAction,
} from '@/actions/qr.actions';
import {
  formatQrLabelStatus,
  getQrLabelStatusBadgeVariant,
  getQrReadinessState,
  type QrLabelStatus,
} from '@/types/qr';

interface EquipmentRow {
  id: string;
  asset_code: string;
  name: string;
  condition: EquipmentCondition;
  status: string;
  installation_date: string | null;
  departments: { id: string; name: string } | null;
  equipment_categories: { id: string; name: string } | null;
  manufacturers: { id: string; name: string } | null;
  equipment_models: { id: string; name: string } | null;
  qr_token: string | null;
  qr_generated_at: string | null;
  qr_label_status: QrLabelStatus | null;
  qr_label_printed_at: string | null;
  qr_label_attached_at: string | null;
  qr_label_replaced_at: string | null;
  qr_token_regenerated_at: string | null;
  [key: string]: unknown;
}

interface RiskInfo {
  rpn: number;
  risk_level: string;
}

interface EnrichedRow extends EquipmentRow {
  riskInfo?: RiskInfo;
  openRequest?: OpenRequestInfo;
  openWorkOrder?: OpenWorkOrderInfo;
}

interface RefOption {
  value: string;
  label: string;
}

type QuickFilter =
  | ''
  | 'needs_attention'
  | 'faulted_no_request'
  | 'needs_repair'
  | 'non_functional'
  | 'under_maintenance'
  | 'high_risk'
  | 'replacement_candidate';

type QrStatusFilter =
  | ''
  | 'missing_token'
  | 'generated'
  | 'printed'
  | 'attached'
  | 'needs_replacement'
  | 'revoked';

function rpnBandLabel(rpn: number): string {
  if (rpn <= 100) return 'Low';
  if (rpn <= 200) return 'Medium';
  if (rpn <= 500) return 'High';
  return 'Critical';
}

function rpnBandClass(rpn: number): string {
  if (rpn <= 100) return 'bg-emerald-500/15 text-emerald-300';
  if (rpn <= 200) return 'bg-amber-500/15 text-amber-300';
  if (rpn <= 500) return 'bg-orange-500/15 text-orange-300';
  return 'bg-rose-500/15 text-rose-300';
}

function isHighRisk(risk?: RiskInfo): boolean {
  if (!risk) return false;
  return risk.risk_level === 'high' || risk.risk_level === 'critical' || risk.rpn > 500;
}

const QUICK_FILTERS: { key: QuickFilter; label: string }[] = [
  { key: 'needs_attention', label: 'Needs attention' },
  { key: 'faulted_no_request', label: 'Faulted, no request' },
  { key: 'needs_repair', label: 'Needs repair' },
  { key: 'non_functional', label: 'Non-functional' },
  { key: 'under_maintenance', label: 'Under maintenance' },
  { key: 'high_risk', label: 'High / Critical risk' },
  { key: 'replacement_candidate', label: 'Replacement candidate' },
];

const QR_STATUS_FILTERS: { key: QrStatusFilter; label: string }[] = [
  { key: 'missing_token', label: 'Missing Token' },
  { key: 'generated', label: 'Generated' },
  { key: 'printed', label: 'Printed' },
  { key: 'attached', label: 'Attached' },
  { key: 'needs_replacement', label: 'Needs Replacement' },
  { key: 'revoked', label: 'Revoked' },
];

const COLOR_MAP: Record<string, string> = {
  blue:   'bg-blue-500/15 text-blue-400',
  green:  'bg-emerald-500/15 text-emerald-400',
  yellow: 'bg-amber-500/15 text-amber-400',
  red:    'bg-rose-500/15 text-rose-400',
  purple: 'bg-violet-500/15 text-violet-400',
  orange: 'bg-orange-500/15 text-orange-400',
  gray:   'bg-slate-500/15 text-slate-400',
};

function SummaryCard({
  label, value, icon, color = 'blue', active, onClick,
}: {
  label: string;
  value: number;
  icon: React.ReactNode;
  color?: string;
  active?: boolean;
  onClick?: () => void;
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
        <span className={`rounded-lg p-1.5 ${COLOR_MAP[color] ?? COLOR_MAP.blue}`}>{icon}</span>
      </div>
      <span className="text-xs font-medium leading-tight text-[var(--text-muted)]">{label}</span>
    </button>
  );
}

function SortHeader({
  label, sortable, colKey, sortKey, sortAsc, onSort,
}: { label: string; sortable?: boolean; colKey?: string; sortKey?: string; sortAsc?: boolean; onSort?: (key: string) => void }) {
  return (
    <th
      className={`px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-[var(--text-muted)] ${sortable && colKey ? 'cursor-pointer select-none hover:text-[var(--foreground)]' : ''}`}
      onClick={sortable && colKey && onSort ? () => onSort(colKey) : undefined}
    >
      {label}
      {sortable && colKey && sortKey === colKey && (
        <span className="ml-1 text-[var(--brand)]">{sortAsc ? '↑' : '↓'}</span>
      )}
    </th>
  );
}

const CONDITION_CHART_COLORS: Record<string, string> = {
  functional: 'rgb(16, 185, 129)',
  needs_repair: 'rgb(245, 158, 11)',
  non_functional: 'rgb(239, 68, 68)',
  under_maintenance: 'rgb(99, 102, 241)',
  decommissioned: 'rgb(107, 114, 128)',
};

function getQrStatusLabel(row: Pick<EquipmentRow, 'qr_token' | 'qr_label_status'>): string {
  if (!row.qr_token || row.qr_label_status === 'not_generated') return 'No Token';
  return formatQrLabelStatus(row.qr_label_status);
}

function getQrStatusVariant(row: Pick<EquipmentRow, 'qr_token' | 'qr_label_status'>) {
  if (!row.qr_token || row.qr_label_status === 'not_generated') return 'default' as const;
  return getQrLabelStatusBadgeVariant(row.qr_label_status);
}

function matchesQrFilter(row: EquipmentRow, filter: QrStatusFilter): boolean {
  if (!filter) return true;
  if (filter === 'missing_token') return !row.qr_token || row.qr_label_status === 'not_generated';
  return row.qr_label_status === filter;
}

export default function EquipmentListPage() {
  const { roles } = useRole();
  const isViewerOnly =
    roles.includes('viewer') &&
    !roles.some((r) => r === 'developer' || r === 'admin' || r === 'bme_head' || r === 'technician');
  const isDepartmentOnly =
    (roles.includes('department_head') || roles.includes('department_user')) &&
    !roles.some((r) => r === 'developer' || r === 'admin' || r === 'bme_head' || r === 'technician');
  if (isDepartmentOnly) return <DepartmentEquipmentOverview />;
  if (isViewerOnly) return <ViewerEquipmentOverview />;
  return <OperationalEquipmentListPage />;
}

function OperationalEquipmentListPage() {
  const router = useRouter();
  const { roles, canManageEquipment, canCreateRequests } = useRole();
  const canManageQr = roles.some((role) => role === 'developer' || role === 'admin' || role === 'bme_head');

  const [allRows, setAllRows] = useState<EnrichedRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [departments, setDepartments] = useState<RefOption[]>([]);
  const [categories, setCategories] = useState<RefOption[]>([]);
  const [search, setSearch] = useState('');
  const [filterDept, setFilterDept] = useState('');
  const [filterCat, setFilterCat] = useState('');
  const [filterCondition, setFilterCondition] = useState('');
  const [filterQrStatus, setFilterQrStatus] = useState<QrStatusFilter>('');
  const [quickFilter, setQuickFilter] = useState<QuickFilter>('');
  const [sortKey, setSortKey] = useState<string>('name');
  const [sortAsc, setSortAsc] = useState(true);
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [pendingQr, startQrTransition] = useTransition();
  const [qrMessage, setQrMessage] = useState<string | null>(null);
  const [qrError, setQrError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const PAGE_SIZE = 20;

  useEffect(() => {
    let cancelled = false;
    async function fetchAll() {
      const [equipRes, riskRes, reqRes, woRes, deptRes, catRes] = await Promise.all([
        getEquipmentList(),
        getRiskScores(),
        getOpenMaintenanceRequests(),
        getOpenWorkOrders(),
        getAll('departments'),
        getAll('equipment_categories'),
      ]);
      if (cancelled) return;

      const equipment = (equipRes.data ?? []) as unknown as EquipmentRow[];

      const riskMap = new Map<string, RiskInfo>();
      for (const r of (riskRes.data as Array<{ asset_id: string; rpn: number; risk_level: string }> | null) ?? []) {
        if (!riskMap.has(r.asset_id)) riskMap.set(r.asset_id, { rpn: r.rpn, risk_level: r.risk_level });
      }

      const reqMap = new Map<string, OpenRequestInfo>();
      for (const r of (reqRes.data as Array<{ id: string; asset_id: string; status: string; urgency: string }> | null) ?? []) {
        if (!reqMap.has(r.asset_id)) reqMap.set(r.asset_id, { id: r.id, status: r.status, urgency: r.urgency });
      }

      const woMap = new Map<string, OpenWorkOrderInfo>();
      for (const r of (woRes.data as Array<{ id: string; asset_id: string; status: string; assigned_to: string | null }> | null) ?? []) {
        if (!woMap.has(r.asset_id)) woMap.set(r.asset_id, { id: r.id, status: r.status, assigned_to: r.assigned_to });
      }

      const enriched: EnrichedRow[] = equipment.map((eq) => ({
        ...eq,
        riskInfo: riskMap.get(eq.id),
        openRequest: reqMap.get(eq.id),
        openWorkOrder: woMap.get(eq.id),
      }));

      setAllRows(enriched);
      if (deptRes.data) setDepartments(deptRes.data.map((d: { id: string; name: string }) => ({ value: d.id, label: d.name })));
      if (catRes.data) setCategories(catRes.data.map((c: { id: string; name: string }) => ({ value: c.id, label: c.name })));
      setLoading(false);
    }
    void fetchAll();
    return () => { cancelled = true; };
  }, [reloadKey]);

  // Computed summary counts from all rows
  const counts = useMemo(() => {
    let functional = 0, needsRepair = 0, nonFunctional = 0, underMaintenance = 0, faultedNoReq = 0, highRisk = 0;
    let qrReady = 0, qrNeedsGeneration = 0, qrNeedsPrinting = 0, qrNeedsAttachment = 0, qrNeedsReplacement = 0, qrRevoked = 0;
    for (const row of allRows) {
      if (row.condition === 'functional') functional++;
      if (row.condition === 'needs_repair') needsRepair++;
      if (row.condition === 'non_functional') nonFunctional++;
      if (row.condition === 'under_maintenance') underMaintenance++;
      if (isFaulted(row.condition) && !row.openRequest && !row.openWorkOrder) faultedNoReq++;
      if (isHighRisk(row.riskInfo)) highRisk++;
      const readiness = getQrReadinessState(row);
      if (readiness === 'ready_to_scan') qrReady++;
      if (readiness === 'needs_label_generation') qrNeedsGeneration++;
      if (readiness === 'needs_printing') qrNeedsPrinting++;
      if (readiness === 'needs_attachment') qrNeedsAttachment++;
      if (readiness === 'needs_replacement') qrNeedsReplacement++;
      if (readiness === 'invalid_revoked') qrRevoked++;
    }
    return {
      total: allRows.length,
      functional,
      needsRepair,
      nonFunctional,
      underMaintenance,
      faultedNoReq,
      highRisk,
      qrReady,
      qrNeedsGeneration,
      qrNeedsPrinting,
      qrNeedsAttachment,
      qrNeedsReplacement,
      qrRevoked,
    };
  }, [allRows]);

  // Chart data derived from all rows
  const deptChartData = useMemo(() => {
    const map = new Map<string, number>();
    for (const row of allRows) {
      const dept = row.departments?.name ?? 'Unknown';
      map.set(dept, (map.get(dept) ?? 0) + 1);
    }
    const entries = Array.from(map.entries()).sort((a, b) => b[1] - a[1]);
    return { labels: entries.map(([k]) => k), values: entries.map(([, v]) => v) };
  }, [allRows]);

  const conditionChartData = useMemo(() => {
    const ORDER = ['functional', 'needs_repair', 'non_functional', 'under_maintenance', 'decommissioned'];
    const map = new Map<string, number>();
    for (const row of allRows) { map.set(row.condition, (map.get(row.condition) ?? 0) + 1); }
    const entries = ORDER.map((k) => [k, map.get(k) ?? 0] as [string, number]).filter(([, v]) => v > 0);
    return {
      labels: entries.map(([k]) => formatEquipmentCondition(k)),
      values: entries.map(([, v]) => v),
      colors: entries.map(([k]) => CONDITION_CHART_COLORS[k] ?? 'rgb(107,114,128)'),
    };
  }, [allRows]);

  // Filtered + sorted rows
  const filteredRows = useMemo(() => {
    let rows = allRows;

    // Standard filters
    if (filterDept) rows = rows.filter((r) => r.departments?.id === filterDept);
    if (filterCat) rows = rows.filter((r) => r.equipment_categories?.id === filterCat);
    if (filterCondition) rows = rows.filter((r) => r.condition === filterCondition);
    if (canManageQr && filterQrStatus) rows = rows.filter((r) => matchesQrFilter(r, filterQrStatus));
    if (search) {
      const q = search.toLowerCase();
      rows = rows.filter((r) =>
        r.name.toLowerCase().includes(q) ||
        r.asset_code.toLowerCase().includes(q) ||
        (typeof r.serial_number === 'string' && r.serial_number.toLowerCase().includes(q)),
      );
    }

    // Quick filters
    if (quickFilter === 'needs_attention') {
      rows = rows.filter((r) =>
        isFaulted(r.condition) || isHighRisk(r.riskInfo) ||
        r.openRequest !== undefined || r.openWorkOrder !== undefined,
      );
    } else if (quickFilter === 'faulted_no_request') {
      rows = rows.filter((r) => isFaulted(r.condition) && !r.openRequest && !r.openWorkOrder);
    } else if (quickFilter === 'needs_repair') {
      rows = rows.filter((r) => r.condition === 'needs_repair');
    } else if (quickFilter === 'non_functional') {
      rows = rows.filter((r) => r.condition === 'non_functional');
    } else if (quickFilter === 'under_maintenance') {
      rows = rows.filter((r) => r.condition === 'under_maintenance');
    } else if (quickFilter === 'high_risk') {
      rows = rows.filter((r) => isHighRisk(r.riskInfo));
    } else if (quickFilter === 'replacement_candidate') {
      rows = rows.filter((r) => r.riskInfo && r.riskInfo.rpn > 200);
    }

    // Sort
    rows = [...rows].sort((a, b) => {
      let av: string | number = '', bv: string | number = '';
      if (sortKey === 'name') { av = a.name; bv = b.name; }
      else if (sortKey === 'asset_code') { av = a.asset_code; bv = b.asset_code; }
      else if (sortKey === 'department') { av = a.departments?.name ?? ''; bv = b.departments?.name ?? ''; }
      else if (sortKey === 'category') { av = a.equipment_categories?.name ?? ''; bv = b.equipment_categories?.name ?? ''; }
      else if (sortKey === 'condition') { av = a.condition; bv = b.condition; }
      else if (sortKey === 'qr_status') { av = getQrStatusLabel(a); bv = getQrStatusLabel(b); }
      else if (sortKey === 'rpn') { av = a.riskInfo?.rpn ?? 0; bv = b.riskInfo?.rpn ?? 0; }
      if (av < bv) return sortAsc ? -1 : 1;
      if (av > bv) return sortAsc ? 1 : -1;
      return 0;
    });

    return rows;
  }, [allRows, filterDept, filterCat, filterCondition, filterQrStatus, canManageQr, search, quickFilter, sortKey, sortAsc]);

  const totalPages = Math.max(1, Math.ceil(filteredRows.length / PAGE_SIZE));
  const pageRows = filteredRows.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  const selectedRows = useMemo(
    () => allRows.filter((row) => selected.has(row.id)),
    [allRows, selected],
  );
  const selectedIds = useMemo(() => Array.from(selected), [selected]);
  const selectedTokenizedIds = useMemo(
    () => selectedRows.filter((row) => !!row.qr_token && row.qr_label_status !== 'revoked').map((row) => row.id),
    [selectedRows],
  );

  function handleCardFilter(qf: QuickFilter) {
    setQuickFilter((prev) => (prev === qf ? '' : qf));
    setFilterCondition('');
    setPage(1);
  }

  function handleSort(key: string) {
    if (sortKey === key) setSortAsc((p) => !p);
    else { setSortKey(key); setSortAsc(true); }
    setPage(1);
  }

  function handleFilterChange(key: string, value: string) {
    if (key === 'department_id') setFilterDept(value);
    if (key === 'category_id') setFilterCat(value);
    if (key === 'condition') setFilterCondition(value);
    if (key === 'qr_status') setFilterQrStatus(value as QrStatusFilter);
    setQuickFilter('');
    setPage(1);
  }

  function toggleSelected(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function setAllPageSelected(checked: boolean) {
    setSelected((prev) => {
      const next = new Set(prev);
      pageRows.forEach((row) => {
        if (checked) next.add(row.id);
        else next.delete(row.id);
      });
      return next;
    });
  }

  function runQrAction(
    label: string,
    action: () => Promise<{ success: boolean; error?: string; data?: unknown }>,
    options: { clearSelection?: boolean } = {},
  ) {
    setQrMessage(null);
    setQrError(null);
    startQrTransition(async () => {
      const result = await action();
      if (!result.success) {
        setQrError(result.error ?? `${label} failed`);
        return;
      }
      setQrMessage(`${label} succeeded.`);
      if (options.clearSelection) setSelected(new Set());
      setReloadKey((key) => key + 1);
    });
  }

  function handleSelectedAction(
    label: string,
    action: (ids: string[]) => Promise<{ success: boolean; error?: string }>,
  ) {
    if (selectedIds.length === 0) {
      setQrError('Select at least one asset first.');
      return;
    }
    runQrAction(label, () => action(selectedIds), { clearSelection: true });
  }

  function handlePrintSelected() {
    if (selectedTokenizedIds.length === 0) {
      setQrError('Select at least one tokenized, non-revoked asset before printing labels.');
      return;
    }
    router.push(`/equipment/qr-labels?assets=${encodeURIComponent(selectedTokenizedIds.join(','))}&print=1`);
  }

  function getRowAction(row: EnrichedRow): { label: string; href: string; variant: string } {
    const { openWorkOrder, openRequest, condition, riskInfo, id, departments, riskInfo: ri } = row;

    if (openWorkOrder) {
      const woStatus = openWorkOrder.status;
      if (woStatus === 'on_hold') return { label: 'Resolve Blocker', href: workOrderDetail(openWorkOrder.id, 'resolve-blocker'), variant: 'danger' };
      if (woStatus === 'in_progress') return { label: 'View Progress', href: workOrderDetail(openWorkOrder.id), variant: 'outline' };
      if (woStatus === 'assigned') return { label: 'Open Work Order', href: workOrderDetail(openWorkOrder.id, 'reassign'), variant: 'outline' };
      return { label: 'Open Work Order', href: workOrderDetail(openWorkOrder.id), variant: 'outline' };
    }

    if (openRequest) return { label: 'Open Request', href: maintenanceRequestDetail(openRequest.id), variant: 'outline' };

    if ((condition === 'needs_repair' || condition === 'non_functional') && canCreateRequests) {
      const urgency = condition === 'non_functional' ? 'high' : 'medium';
      const desc = `Equipment page detected ${row.name} is ${formatEquipmentCondition(condition)}${ri ? ` with RPN ${ri.rpn} (${ri.risk_level} risk)` : ''} and no open corrective request.`;
      return {
        label: 'Create Request',
        href: createMaintenanceRequestFromAsset(id, {
          departmentId: departments?.id,
          urgency,
          description: desc,
          type: 'corrective',
        }).replace('source=command-center', 'source=equipment').replace('reportedCondition=', '') + `&reportedCondition=${condition}`,
        variant: 'primary',
      };
    }

    if (isHighRisk(riskInfo)) return { label: 'Review Risk', href: `/equipment/${id}`, variant: 'outline' };
    if (ri && ri.rpn > 200) return { label: 'Open Replacement Evidence', href: replacementEvidence(id), variant: 'outline' };

    return { label: 'Open Asset Profile', href: `/equipment/${id}`, variant: 'ghost' };
  }

  if (loading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Spinner />
      </div>
    );
  }

  const summaryCards = [
    { label: 'Total Equipment', value: counts.total, icon: <Activity className="h-4 w-4" />, color: 'blue', qf: '' as QuickFilter },
    { label: 'Functional', value: counts.functional, icon: <CheckCircle2 className="h-4 w-4" />, color: 'green', qf: '' as QuickFilter, conditionFilter: 'functional' },
    { label: 'Needs Repair', value: counts.needsRepair, icon: <Wrench className="h-4 w-4" />, color: 'yellow', qf: 'needs_repair' as QuickFilter },
    { label: 'Non-functional', value: counts.nonFunctional, icon: <AlertCircle className="h-4 w-4" />, color: 'red', qf: 'non_functional' as QuickFilter },
    { label: 'Under Maintenance', value: counts.underMaintenance, icon: <Clock className="h-4 w-4" />, color: 'purple', qf: 'under_maintenance' as QuickFilter },
    { label: 'Faulted, No Request', value: counts.faultedNoReq, icon: <AlertTriangle className="h-4 w-4" />, color: 'orange', qf: 'faulted_no_request' as QuickFilter },
    { label: 'High / Critical Risk', value: counts.highRisk, icon: <ShieldAlert className="h-4 w-4" />, color: 'red', qf: 'high_risk' as QuickFilter },
    { label: 'Replacement Watch', value: allRows.filter((r) => r.riskInfo && r.riskInfo.rpn > 200).length, icon: <TrendingUp className="h-4 w-4" />, color: 'orange', qf: 'replacement_candidate' as QuickFilter },
  ];

  return (
    <div className="space-y-6">
      <AssistantPageContextBridge
        moduleLabel="Equipment"
        pageLabel="Equipment inventory"
        pageSummary="Asset list with condition, maintenance state, risk, QR readiness, and exact asset routes."
        searchQuery={search || undefined}
        activeTab={quickFilter || filterQrStatus || undefined}
        currentFilters={{
          departmentId: filterDept || null,
          categoryId: filterCat || null,
          condition: filterCondition || null,
          qrStatus: filterQrStatus || null,
          quickFilter: quickFilter || null,
          sortKey,
          sortAsc,
        }}
        visibleCounts={{
          total: counts.total,
          visible: filteredRows.length,
          functional: counts.functional,
          needsRepair: counts.needsRepair,
          nonFunctional: counts.nonFunctional,
          highRisk: counts.highRisk,
          qrReady: counts.qrReady,
          qrNeedsReplacement: counts.qrNeedsReplacement,
          selected: selected.size,
        }}
        availableEvidenceLinks={[
          { label: 'Equipment', href: '/equipment', type: 'module' },
          { label: 'QR Coverage', href: '/equipment/qr-coverage', type: 'qr' },
          { label: 'QR Scans', href: '/equipment/qr-scans', type: 'qr' },
        ]}
        quickPrompts={['Which equipment needs attention?', 'Check QR coverage issues.', 'Which assets have high risk?']}
      />
      <PageHeader
        title="Equipment"
        description="Asset-level operational control — condition, maintenance state, risk, and actions"
        actions={
          <div className="flex flex-wrap gap-2">
            {canManageQr && (
              <>
                <Link href="/equipment/qr-coverage">
                  <Button variant="outline">
                    <QrCode className="h-4 w-4" />
                    QR Coverage
                  </Button>
                </Link>
                <Link href="/equipment/qr-labels">
                  <Button variant="outline">
                    <Printer className="h-4 w-4" />
                    QR Labels
                  </Button>
                </Link>
                <Link href="/equipment/qr-scans">
                  <Button variant="outline">
                    <QrCode className="h-4 w-4" />
                    QR Scans
                  </Button>
                </Link>
              </>
            )}
            {canManageEquipment ? (
              <Link href={ROUTES.EQUIPMENT_NEW}>
                <Button>
                  <Plus className="h-4 w-4" />
                  Register Equipment
                </Button>
              </Link>
            ) : null}
          </div>
        }
      />

      {/* Summary Cards */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 xl:grid-cols-8">
        {summaryCards.map(({ label, value, icon, color, qf, conditionFilter }) => {
          const isActive = conditionFilter
            ? filterCondition === conditionFilter
            : qf ? quickFilter === qf : false;
          return (
            <SummaryCard
              key={label}
              label={label}
              value={value}
              icon={icon}
              color={color}
              active={isActive}
              onClick={() => {
                if (conditionFilter) {
                  setFilterCondition((prev) => (prev === conditionFilter ? '' : conditionFilter));
                  setQuickFilter('');
                } else if (qf) {
                  handleCardFilter(qf);
                }
                setPage(1);
              }}
            />
          );
        })}
      </div>

      {canManageQr && (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-6">
          {[
            { key: 'attached' as QrStatusFilter, label: 'Ready to Scan', value: counts.qrReady, tone: 'green' },
            { key: 'missing_token' as QrStatusFilter, label: 'Needs Token', value: counts.qrNeedsGeneration, tone: counts.qrNeedsGeneration > 0 ? 'yellow' : 'green' },
            { key: 'generated' as QrStatusFilter, label: 'Needs Printing', value: counts.qrNeedsPrinting, tone: 'blue' },
            { key: 'printed' as QrStatusFilter, label: 'Needs Attachment', value: counts.qrNeedsAttachment, tone: 'orange' },
            { key: 'needs_replacement' as QrStatusFilter, label: 'Needs Replacement', value: counts.qrNeedsReplacement, tone: counts.qrNeedsReplacement > 0 ? 'red' : 'green' },
            { key: 'revoked' as QrStatusFilter, label: 'Revoked', value: counts.qrRevoked, tone: counts.qrRevoked > 0 ? 'red' : 'gray' },
          ].map((card) => (
            <SummaryCard
              key={card.label}
              label={card.label}
              value={card.value}
              icon={<QrCode className="h-4 w-4" />}
              color={card.tone}
              active={filterQrStatus === card.key}
              onClick={() => {
                setFilterQrStatus((prev) => (prev === card.key ? '' : card.key));
                setPage(1);
              }}
            />
          ))}
        </div>
      )}

      {/* Charts */}
      <div className="grid gap-4 xl:grid-cols-2">
        <ChartCard title="Equipment by Department" description="Asset distribution across departments">
          <BarChart
            labels={deptChartData.labels}
            datasets={[{ label: 'Assets', data: deptChartData.values }]}
            height={200}
          />
        </ChartCard>
        <ChartCard title="Equipment by Condition" description="Current operational condition breakdown">
          <DoughnutChart
            labels={conditionChartData.labels}
            data={conditionChartData.values}
            colors={conditionChartData.colors}
            height={200}
          />
        </ChartCard>
      </div>

      {/* Quick Filter Chips */}
      <div className="flex flex-wrap gap-2">
        {QUICK_FILTERS.map(({ key, label }) => (
          <button
            key={key}
            onClick={() => { setQuickFilter((prev) => (prev === key ? '' : key)); setPage(1); }}
            className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
              quickFilter === key
                ? 'bg-[var(--brand)] text-white'
                : 'bg-[var(--surface-2)] text-[var(--text-muted)] hover:text-[var(--foreground)]'
            }`}
          >
            {label}
            {key === 'faulted_no_request' && counts.faultedNoReq > 0 && (
              <span className="ml-1 rounded-full bg-rose-500/20 px-1.5 text-rose-300">{counts.faultedNoReq}</span>
            )}
            {key === 'high_risk' && counts.highRisk > 0 && (
              <span className="ml-1 rounded-full bg-orange-500/20 px-1.5 text-orange-300">{counts.highRisk}</span>
            )}
          </button>
        ))}
      </div>

      {/* Filters */}
      <div className="flex min-w-0 flex-wrap items-center gap-3">
        <input
          type="text"
          placeholder="Search by name, asset code, serial number…"
          value={search}
          onChange={(e) => { setSearch(e.target.value); setPage(1); }}
          className="h-10 min-w-full rounded-md border border-[var(--surface-3)] bg-[var(--surface-1)] px-3 text-sm text-[var(--foreground)] placeholder-[var(--text-muted)] focus:outline-none focus:ring-1 focus:ring-[var(--brand)] sm:h-9 sm:min-w-0 sm:w-64"
        />
        <select
          value={filterDept}
          onChange={(e) => handleFilterChange('department_id', e.target.value)}
          className="h-10 min-w-[9rem] flex-1 rounded-md border border-[var(--surface-3)] bg-[var(--surface-1)] px-2 text-sm text-[var(--foreground)] focus:outline-none focus:ring-1 focus:ring-[var(--brand)] sm:h-9 sm:flex-none"
        >
          <option value="">All Departments</option>
          {departments.map((d) => <option key={d.value} value={d.value}>{d.label}</option>)}
        </select>
        <select
          value={filterCat}
          onChange={(e) => handleFilterChange('category_id', e.target.value)}
          className="h-10 min-w-[9rem] flex-1 rounded-md border border-[var(--surface-3)] bg-[var(--surface-1)] px-2 text-sm text-[var(--foreground)] focus:outline-none focus:ring-1 focus:ring-[var(--brand)] sm:h-9 sm:flex-none"
        >
          <option value="">All Categories</option>
          {categories.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
        </select>
        <select
          value={filterCondition}
          onChange={(e) => handleFilterChange('condition', e.target.value)}
          className="h-10 min-w-[9rem] flex-1 rounded-md border border-[var(--surface-3)] bg-[var(--surface-1)] px-2 text-sm text-[var(--foreground)] focus:outline-none focus:ring-1 focus:ring-[var(--brand)] sm:h-9 sm:flex-none"
        >
          <option value="">All Conditions</option>
          {EQUIPMENT_CONDITION_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
        {canManageQr && (
          <select
            value={filterQrStatus}
            onChange={(e) => handleFilterChange('qr_status', e.target.value)}
            className="h-10 min-w-[9rem] flex-1 rounded-md border border-[var(--surface-3)] bg-[var(--surface-1)] px-2 text-sm text-[var(--foreground)] focus:outline-none focus:ring-1 focus:ring-[var(--brand)] sm:h-9 sm:flex-none"
          >
            <option value="">All QR Statuses</option>
            {QR_STATUS_FILTERS.map((o) => <option key={o.key} value={o.key}>{o.label}</option>)}
          </select>
        )}
        {(search || filterDept || filterCat || filterCondition || filterQrStatus || quickFilter) && (
          <button
            onClick={() => { setSearch(''); setFilterDept(''); setFilterCat(''); setFilterCondition(''); setFilterQrStatus(''); setQuickFilter(''); setPage(1); }}
            className="text-xs text-[var(--text-muted)] hover:text-[var(--foreground)] underline"
          >
            Clear filters
          </button>
        )}
        <span className="text-xs text-[var(--text-muted)] sm:ml-auto">
          {filteredRows.length} of {allRows.length} assets
        </span>
      </div>

      {canManageQr && (
        <div className="panel-surface space-y-3 rounded-lg p-4">
          <div className="flex flex-wrap items-center gap-2">
            <div className="mr-auto">
              <p className="text-sm font-semibold text-[var(--foreground)]">QR Coverage Actions</p>
              <p className="text-xs text-[var(--text-muted)]">
                {selected.size} selected. Ready to scan means token present, label attached, and not revoked.
              </p>
            </div>
            <Button
              size="sm"
              variant="outline"
              onClick={() => runQrAction('Generate missing QR tokens', () => bulkGenerateMissingQrTokensAction())}
              disabled={pendingQr || counts.qrNeedsGeneration === 0}
            >
              <RefreshCw className={`h-4 w-4 ${pendingQr ? 'animate-spin' : ''}`} />
              Generate Missing ({counts.qrNeedsGeneration})
            </Button>
            <Button size="sm" variant="outline" onClick={handlePrintSelected} disabled={pendingQr || selectedTokenizedIds.length === 0}>
              <Printer className="h-4 w-4" />
              Print Selected ({selectedTokenizedIds.length})
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => handleSelectedAction('Mark selected printed', markQrLabelsPrintedBulkAction)}
              disabled={pendingQr || selected.size === 0}
            >
              <Stamp className="h-4 w-4" />
              Mark Printed
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => handleSelectedAction('Mark selected attached', markQrLabelsAttachedBulkAction)}
              disabled={pendingQr || selected.size === 0}
            >
              <Wrench className="h-4 w-4" />
              Mark Attached
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => handleSelectedAction('Flag selected for replacement', markQrLabelsNeedsReplacementBulkAction)}
              disabled={pendingQr || selected.size === 0}
            >
              <AlertTriangle className="h-4 w-4" />
              Needs Replacement
            </Button>
          </div>
          {(counts.qrNeedsGeneration > 0 || counts.qrNeedsPrinting > 0 || counts.qrNeedsAttachment > 0 || counts.qrNeedsReplacement > 0 || counts.qrRevoked > 0) && (
            <div className="rounded-md border border-amber-500/30 bg-amber-500/5 px-3 py-2 text-xs text-amber-200">
              QR readiness is label readiness only. Assets are operationally ready to scan only after a token exists and the physical label is attached.
            </div>
          )}
          {qrMessage && (
            <div className="rounded-md border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-200">
              {qrMessage}
            </div>
          )}
          {qrError && (
            <div className="rounded-md border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-sm text-rose-200">
              {qrError}
            </div>
          )}
        </div>
      )}

      {/* Table */}
      <div className="panel-surface overflow-hidden rounded-lg">
        <div className="overflow-x-auto">
          <table className="min-w-[980px] w-full text-sm">
            <thead className="border-b border-[var(--surface-3)] bg-[var(--surface-2)]">
              <tr>
                {canManageQr && (
                  <th className="w-10 px-4 py-3">
                    <input
                      type="checkbox"
                      aria-label="Select all visible equipment on this page"
                      checked={pageRows.length > 0 && pageRows.every((row) => selected.has(row.id))}
                      onChange={(e) => setAllPageSelected(e.target.checked)}
                    />
                  </th>
                )}
                <SortHeader label="Asset Code" sortable colKey="asset_code" sortKey={sortKey} sortAsc={sortAsc} onSort={handleSort} />
                <SortHeader label="Equipment" sortable colKey="name" sortKey={sortKey} sortAsc={sortAsc} onSort={handleSort} />
                <SortHeader label="Department" sortable colKey="department" sortKey={sortKey} sortAsc={sortAsc} onSort={handleSort} />
                <SortHeader label="Category" sortable colKey="category" sortKey={sortKey} sortAsc={sortAsc} onSort={handleSort} />
                <SortHeader label="Condition" sortable colKey="condition" sortKey={sortKey} sortAsc={sortAsc} onSort={handleSort} />
                <SortHeader label="Maintenance State" />
                <SortHeader label="Risk" sortable colKey="rpn" sortKey={sortKey} sortAsc={sortAsc} onSort={handleSort} />
                {canManageQr && <SortHeader label="QR Status" sortable colKey="qr_status" sortKey={sortKey} sortAsc={sortAsc} onSort={handleSort} />}
                <SortHeader label="Actions" />
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--surface-3)]">
              {pageRows.length === 0 ? (
                <tr>
                  <td colSpan={canManageQr ? 10 : 8} className="px-4 py-12 text-center text-sm text-[var(--text-muted)]">
                    No equipment found. Adjust your filters or register new equipment.
                  </td>
                </tr>
              ) : (
                pageRows.map((row) => {
                  const maintState = getMaintenanceState(row.condition, row.openRequest, row.openWorkOrder);
                  const action = getRowAction(row);
                  return (
                    <tr
                      key={row.id}
                      className="cursor-pointer transition-colors hover:bg-[var(--surface-2)]"
                      onClick={() => router.push(`/equipment/${row.id}`)}
                    >
                      {canManageQr && (
                        <td className="px-4 py-3" onClick={(e) => e.stopPropagation()}>
                          <input
                            type="checkbox"
                            aria-label={`Select ${row.asset_code}`}
                            checked={selected.has(row.id)}
                            onChange={() => toggleSelected(row.id)}
                          />
                        </td>
                      )}
                      <td className="px-4 py-3 font-mono text-xs text-[var(--text-muted)]">{row.asset_code}</td>
                      <td className="px-4 py-3">
                        <div className="font-medium text-[var(--foreground)]">{row.name}</div>
                        {row.equipment_models?.name && (
                          <div className="text-xs text-[var(--text-muted)]">{row.equipment_models.name}</div>
                        )}
                      </td>
                      <td className="px-4 py-3 text-[var(--text-muted)]">{row.departments?.name ?? '—'}</td>
                      <td className="px-4 py-3 text-[var(--text-muted)]">{row.equipment_categories?.name ?? '—'}</td>
                      <td className="px-4 py-3">
                        <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${getConditionBadgeClass(row.condition)}`}>
                          {formatEquipmentCondition(row.condition)}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${getMaintenanceStateBadgeClass(maintState)}`}>
                          {formatMaintenanceState(maintState)}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        {row.riskInfo != null ? (
                          <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${rpnBandClass(row.riskInfo.rpn)}`}>
                            {rpnBandLabel(row.riskInfo.rpn)} ({row.riskInfo.rpn})
                          </span>
                        ) : (
                          <span className="text-xs text-[var(--text-muted)]">Not assessed</span>
                        )}
                      </td>
                      {canManageQr && (
                        <td className="px-4 py-3">
                          <div className="flex flex-col gap-1">
                            <Badge variant={getQrStatusVariant(row)}>
                              {getQrStatusLabel(row)}
                            </Badge>
                            <span className="text-[10px] text-[var(--text-muted)]">
                              {getQrReadinessState(row) === 'ready_to_scan' ? 'Ready' : 'Action needed'}
                            </span>
                          </div>
                        </td>
                      )}
                      <td className="px-4 py-3">
                        <div className="flex min-w-[220px] flex-wrap gap-1.5" onClick={(e) => e.stopPropagation()}>
                          <a
                            href={action.href}
                            className={`inline-flex items-center rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
                              action.variant === 'primary'
                                ? 'bg-[var(--brand)] text-white hover:opacity-90'
                                : action.variant === 'danger'
                                ? 'bg-rose-500/15 text-rose-300 hover:bg-rose-500/25'
                                : action.variant === 'ghost'
                                ? 'text-[var(--text-muted)] hover:text-[var(--foreground)]'
                                : 'border border-[var(--surface-3)] bg-[var(--surface-2)] text-[var(--foreground)] hover:bg-[var(--surface-3)]'
                            }`}
                          >
                            {action.label}
                          </a>
                          {canManageQr && (
                            <>
                              <Link
                                href={`/equipment/${row.id}#qr-identity`}
                                className="rounded-lg border border-[var(--border-subtle)] px-2 py-1 text-xs font-medium hover:bg-[var(--surface-2)]"
                              >
                                QR Panel
                              </Link>
                              {!row.qr_token ? (
                                <button
                                  type="button"
                                  disabled={pendingQr}
                                  onClick={() => runQrAction('Generate QR token', () => ensureAssetQrTokenAction(row.id))}
                                  className="rounded-lg bg-[var(--brand)] px-2 py-1 text-xs font-medium text-white hover:bg-[var(--brand-strong)] disabled:opacity-50"
                                >
                                  Generate
                                </button>
                              ) : (
                                <>
                                  {row.qr_label_status !== 'revoked' && (
                                    <button
                                      type="button"
                                      disabled={pendingQr}
                                      onClick={() => router.push(`/equipment/qr-labels?assets=${encodeURIComponent(row.id)}&print=1`)}
                                      className="rounded-lg border border-[var(--border-subtle)] px-2 py-1 text-xs font-medium hover:bg-[var(--surface-2)] disabled:opacity-50"
                                    >
                                      Print
                                    </button>
                                  )}
                                  {row.qr_label_status !== 'revoked' && (
                                    <>
                                      <button
                                        type="button"
                                        disabled={pendingQr}
                                        onClick={() => runQrAction('Mark printed', () => markQrLabelPrintedAction(row.id))}
                                        className="rounded-lg border border-amber-500/60 bg-amber-500/10 px-2 py-1 text-xs font-medium text-amber-400 hover:bg-amber-500/20 disabled:opacity-50"
                                      >
                                        Printed
                                      </button>
                                      <button
                                        type="button"
                                        disabled={pendingQr}
                                        onClick={() => runQrAction('Mark attached', () => markQrLabelAttachedAction(row.id))}
                                        className="rounded-lg bg-emerald-600 px-2 py-1 text-xs font-medium text-white hover:bg-emerald-500 disabled:opacity-50"
                                      >
                                        Attached
                                      </button>
                                      <button
                                        type="button"
                                        disabled={pendingQr}
                                        onClick={() => runQrAction('Flag for replacement', () => markQrLabelNeedsReplacementAction(row.id))}
                                        className="rounded-lg bg-amber-600 px-2 py-1 text-xs font-medium text-white hover:bg-amber-500 disabled:opacity-50"
                                      >
                                        Replace
                                      </button>
                                      <button
                                        type="button"
                                        disabled={pendingQr}
                                        onClick={() => {
                                          if (window.confirm('Regenerate this asset QR token and reset its label lifecycle?')) {
                                            runQrAction('Regenerate QR token', () => regenerateAssetQrTokenAction(row.id));
                                          }
                                        }}
                                        className="rounded-lg border border-[var(--border-subtle)] px-2 py-1 text-xs font-medium hover:bg-[var(--surface-2)] disabled:opacity-50"
                                      >
                                        Regenerate
                                      </button>
                                      <button
                                        type="button"
                                        disabled={pendingQr}
                                        onClick={() => {
                                          if (window.confirm('Revoke this QR token? Scans of this label will be rejected.')) {
                                            runQrAction('Revoke QR token', () => revokeQrTokenAction(row.id));
                                          }
                                        }}
                                        className="rounded-lg bg-red-600 px-2 py-1 text-xs font-medium text-white hover:bg-red-500 disabled:opacity-50"
                                      >
                                        Revoke
                                      </button>
                                    </>
                                  )}
                                </>
                              )}
                            </>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="flex flex-col gap-3 border-t border-[var(--surface-3)] px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
            <span className="text-xs text-[var(--text-muted)]">
              Page {page} of {totalPages} — {filteredRows.length} assets
            </span>
            <div className="flex gap-2">
              <button
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={page === 1}
                className="rounded-md border border-[var(--surface-3)] px-3 py-1 text-xs disabled:opacity-40"
              >
                Previous
              </button>
              <button
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                disabled={page === totalPages}
                className="rounded-md border border-[var(--surface-3)] px-3 py-1 text-xs disabled:opacity-40"
              >
                Next
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
