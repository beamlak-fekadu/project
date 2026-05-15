// Server-side aggregator for department-scoped data.
//
// Every value returned here is computed from real loaded rows in BMERMS,
// filtered by a single `departmentId` argument. There is NO all-hospital
// fallback if `departmentId` is null/undefined — the caller must render the
// missing-department state instead.
//
// Source rows and definitions:
//   - equipment_assets        : department_id = :dept, deleted_at IS NULL,
//                               status = 'active'. equipment_categories
//                               provides criticality_level.
//   - maintenance_requests    : department_id = :dept (or asset's dept).
//                               Statuses: pending, approved, assigned,
//                               in_progress, completed, rejected, canceled.
//   - v_open_work_orders      : open WOs joined to equipment_assets;
//                               filtered to dept assets.
//   - v_overdue_pm            : overdue PM schedules; we filter by joined
//                               equipment_asset.department_id.
//   - v_calibration_due       : calibration upcoming/overdue; filtered by
//                               joined asset.department_id (asset_id column
//                               present per migration 00043).
//   - work_orders             : status='completed', completed_at within
//                               current month, filtered to dept assets.
//   - recommendation_flags    : not acknowledged; filtered by asset's dept.
//   - training_requests / training_sessions : filtered to dept if linkage
//                               present; otherwise reported as not available.
//
// Missing-department semantics: the caller decides UI. These functions
// short-circuit and return zero/empty when `departmentId` is empty so the
// page renders no data and renders an explicit empty/error banner.

import type { createClient } from '@/lib/supabase/server';

type Supabase = Awaited<ReturnType<typeof createClient>>;

export interface DepartmentMetrics {
  totalAssets: number;
  functionalAssets: number;
  needsRepairAssets: number;
  nonFunctionalAssets: number;
  underMaintenanceAssets: number;
  criticalAssets: number;
  criticalEquipmentDown: number;
  readinessPercent: number | null; // functional essential / total essential * 100
  openRequests: number;
  pendingRequests: number;
  openWorkOrders: number;
  criticalOpenWork: number;
  overdueWork: number;
  awaitingPartsWork: number;
  overduePm: number;
  overdueCalibration: number;
  failedCalibration: number;
  monthlyCompletedWork: number;
  monthlyCompletedPm: number;
  monthlyCompletedCalibration: number;
  trainingNeeds: number; // training requests pending for dept assets/staff
  unacknowledgedAlerts: number;
}

function firstRelation<T>(value: T | T[] | null | undefined): T | null {
  if (Array.isArray(value)) return value[0] ?? null;
  return value ?? null;
}

function monthStartIso(): string {
  const d = new Date();
  return new Date(d.getUTCFullYear(), d.getUTCMonth(), 1).toISOString().slice(0, 10);
}

const EMPTY_METRICS: DepartmentMetrics = {
  totalAssets: 0,
  functionalAssets: 0,
  needsRepairAssets: 0,
  nonFunctionalAssets: 0,
  underMaintenanceAssets: 0,
  criticalAssets: 0,
  criticalEquipmentDown: 0,
  readinessPercent: null,
  openRequests: 0,
  pendingRequests: 0,
  openWorkOrders: 0,
  criticalOpenWork: 0,
  overdueWork: 0,
  awaitingPartsWork: 0,
  overduePm: 0,
  overdueCalibration: 0,
  failedCalibration: 0,
  monthlyCompletedWork: 0,
  monthlyCompletedPm: 0,
  monthlyCompletedCalibration: 0,
  trainingNeeds: 0,
  unacknowledgedAlerts: 0,
};

export async function fetchDepartmentMetrics(
  supabase: Supabase,
  departmentId: string | null | undefined,
): Promise<DepartmentMetrics> {
  if (!departmentId) return EMPTY_METRICS;
  const todayIso = new Date().toISOString().slice(0, 10);
  const monthStart = monthStartIso();

  const [
    assetsRes,
    requestsRes,
    woRes,
    pmRes,
    calRes,
    completedWoRes,
    completedPmRes,
    completedCalRes,
    trainingRes,
    flagsRes,
  ] = await Promise.all([
    supabase
      .from('equipment_assets')
      .select('id, condition, equipment_categories(criticality_level)')
      .eq('department_id', departmentId)
      .is('deleted_at', null)
      .eq('status', 'active')
      .limit(2000),
    supabase
      .from('maintenance_requests')
      .select('id, status, urgency')
      .eq('department_id', departmentId)
      .limit(2000),
    supabase
      .from('v_open_work_orders')
      .select('id, priority, status, created_at, department_id')
      .eq('department_id', departmentId)
      .limit(2000),
    supabase
      .from('v_overdue_pm')
      .select('id, scheduled_date, department_id')
      .eq('department_id', departmentId)
      .limit(2000),
    // v_calibration_due exposes 'result' (not 'last_result'). Filter dept assets
    // via equipment_assets!inner join; migration 00043 added asset_id to the view.
    supabase
      .from('v_calibration_due')
      .select('id, next_due_date, result, equipment_assets!inner(department_id)')
      .eq('equipment_assets.department_id', departmentId)
      .limit(2000),
    supabase
      .from('work_orders')
      .select('id, completed_at, equipment_assets!inner(department_id)')
      .eq('status', 'completed')
      .gte('completed_at', monthStart)
      .eq('equipment_assets.department_id', departmentId)
      .limit(2000),
    supabase
      .from('pm_schedules')
      .select('id, completed_at, status, equipment_assets!inner(department_id)')
      .eq('status', 'completed')
      .gte('completed_at', monthStart)
      .eq('equipment_assets.department_id', departmentId)
      .limit(2000),
    supabase
      .from('calibration_records')
      .select('id, calibration_date, equipment_assets!inner(department_id)')
      .gte('calibration_date', monthStart)
      .eq('equipment_assets.department_id', departmentId)
      .limit(2000),
    supabase
      .from('training_requests')
      .select('id, status, department_id')
      .eq('department_id', departmentId)
      .limit(2000),
    supabase
      .from('recommendation_flags')
      .select('id, is_acknowledged, equipment_assets!inner(department_id)')
      .eq('is_acknowledged', false)
      .eq('equipment_assets.department_id', departmentId)
      .limit(2000),
  ]);

  const assets = (assetsRes.data ?? []) as Array<{ condition: string | null; equipment_categories?: { criticality_level?: string | null } | { criticality_level?: string | null }[] | null }>;
  let functional = 0, needsRepair = 0, nonFunctional = 0, underMaintenance = 0;
  let criticalAssets = 0, criticalDown = 0;
  let essentialTotal = 0, essentialFunctional = 0;
  for (const a of assets) {
    const cat = firstRelation(a.equipment_categories);
    const isEssential = cat?.criticality_level === 'high' || cat?.criticality_level === 'critical';
    if (a.condition === 'functional') functional++;
    else if (a.condition === 'needs_repair') needsRepair++;
    else if (a.condition === 'non_functional') nonFunctional++;
    else if (a.condition === 'under_maintenance') underMaintenance++;
    if (isEssential) {
      criticalAssets++;
      essentialTotal++;
      if (a.condition === 'functional') essentialFunctional++;
      if (a.condition === 'non_functional' || a.condition === 'under_maintenance') criticalDown++;
    }
  }
  const readinessPercent = essentialTotal > 0 ? Math.round((essentialFunctional / essentialTotal) * 100) : null;

  const reqs = (requestsRes.data ?? []) as Array<{ status: string | null; urgency: string | null }>;
  let openReq = 0, pendingReq = 0;
  for (const r of reqs) {
    const s = (r.status ?? '').toLowerCase();
    if (['pending', 'approved', 'assigned', 'in_progress'].includes(s)) openReq++;
    if (s === 'pending') pendingReq++;
  }

  // work_orders has no scheduled_date; use age > 14d from created_at as proxy.
  const WO_AGING_DAYS = 14;
  const nowMs = Date.now();
  const woRows = (woRes.data ?? []) as Array<{ priority: string | null; status: string | null; created_at: string | null }>;
  let criticalWo = 0, overdueWo = 0, awaitingParts = 0;
  for (const wo of woRows) {
    const p = (wo.priority ?? '').toLowerCase();
    if (p === 'critical' || p === 'high') criticalWo++;
    const ageDays = wo.created_at ? Math.floor((nowMs - new Date(wo.created_at).getTime()) / (1000 * 60 * 60 * 24)) : 0;
    if (ageDays >= WO_AGING_DAYS) overdueWo++;
    if (wo.status === 'on_hold') awaitingParts++;
  }

  // v_calibration_due uses column 'result', not 'last_result'. Department filter
  // is applied via equipment_assets!inner join in the query above.
  const calRows = (calRes.data ?? []) as Array<{ next_due_date: string | null; result: string | null }>;
  let overdueCal = 0, failedCal = 0;
  for (const c of calRows) {
    if (c.next_due_date && c.next_due_date < todayIso) overdueCal++;
    if ((c.result ?? '').toLowerCase() === 'failed' || (c.result ?? '').toLowerCase() === 'adjusted') failedCal++;
  }

  const trainingRows = (trainingRes.data ?? []) as Array<{ status: string | null }>;
  let trainingNeeds = 0;
  for (const t of trainingRows) {
    const s = (t.status ?? '').toLowerCase();
    if (['pending', 'approved', 'scheduled'].includes(s)) trainingNeeds++;
  }

  return {
    totalAssets: assets.length,
    functionalAssets: functional,
    needsRepairAssets: needsRepair,
    nonFunctionalAssets: nonFunctional,
    underMaintenanceAssets: underMaintenance,
    criticalAssets,
    criticalEquipmentDown: criticalDown,
    readinessPercent,
    openRequests: openReq,
    pendingRequests: pendingReq,
    openWorkOrders: woRows.length,
    criticalOpenWork: criticalWo,
    overdueWork: overdueWo,
    awaitingPartsWork: awaitingParts,
    overduePm: (pmRes.data ?? []).length,
    overdueCalibration: overdueCal,
    failedCalibration: failedCal,
    monthlyCompletedWork: (completedWoRes.data ?? []).length,
    monthlyCompletedPm: (completedPmRes.data ?? []).length,
    monthlyCompletedCalibration: (completedCalRes.data ?? []).length,
    trainingNeeds,
    unacknowledgedAlerts: (flagsRes.data ?? []).length,
  };
}

// Equipment-requiring-attention rows (non-functional / under_maintenance /
// needs_repair, plus essential equipment with active open work).
export interface DepartmentAttentionRow {
  id: string;
  assetCode: string;
  assetName: string;
  condition: string;
  criticality: string | null;
  issue: string;
  status: string;
  lastUpdate: string | null;
}

export async function fetchDepartmentAttention(
  supabase: Supabase,
  departmentId: string | null | undefined,
): Promise<DepartmentAttentionRow[]> {
  if (!departmentId) return [];
  const { data } = await supabase
    .from('equipment_assets')
    .select('id, asset_code, name, condition, updated_at, equipment_categories(criticality_level)')
    .eq('department_id', departmentId)
    .is('deleted_at', null)
    .eq('status', 'active')
    .in('condition', ['needs_repair', 'non_functional', 'under_maintenance'])
    .order('updated_at', { ascending: false })
    .limit(50);
  return ((data ?? []) as Array<Record<string, unknown>>).map((r) => {
    const cat = firstRelation(r.equipment_categories as Record<string, unknown> | Record<string, unknown>[] | null);
    return {
      id: r.id as string,
      assetCode: (r.asset_code as string) ?? '—',
      assetName: (r.name as string) ?? 'Unknown',
      condition: (r.condition as string) ?? 'unknown',
      criticality: ((cat as Record<string, unknown> | null)?.criticality_level as string | undefined) ?? null,
      issue:
        r.condition === 'non_functional' ? 'Non-functional'
        : r.condition === 'under_maintenance' ? 'Under maintenance'
        : 'Needs repair',
      status: (r.condition as string) ?? 'unknown',
      lastUpdate: (r.updated_at as string) ?? null,
    };
  });
}

// Active maintenance request and work-order rows for department roles.
export interface DepartmentRequestRow {
  id: string;
  requestNumber: string;
  assetId: string | null;
  assetName: string;
  assetCode: string;
  type: string;
  submittedBy: string;
  submittedById: string | null;
  status: string;
  urgency: string | null;
  createdAt: string | null;
  updatedAt: string | null;
}

export async function fetchDepartmentRequests(
  supabase: Supabase,
  departmentId: string | null | undefined,
): Promise<DepartmentRequestRow[]> {
  if (!departmentId) return [];
  const { data } = await supabase
    .from('maintenance_requests')
    .select('id, request_number, status, urgency, requested_by, created_at, updated_at, equipment_assets(id, asset_code, name), profiles!maintenance_requests_requested_by_fkey(full_name)')
    .eq('department_id', departmentId)
    .order('created_at', { ascending: false })
    .limit(200);
  return ((data ?? []) as Array<Record<string, unknown>>).map((r) => {
    const eq = firstRelation(r.equipment_assets as Record<string, unknown> | Record<string, unknown>[] | null);
    const submitter = firstRelation(r.profiles as Record<string, unknown> | Record<string, unknown>[] | null);
    return {
      id: r.id as string,
      requestNumber: (r.request_number as string) ?? '',
      assetId: ((eq as Record<string, unknown> | null)?.id as string) ?? null,
      assetName: ((eq as Record<string, unknown> | null)?.name as string) ?? 'Unknown asset',
      assetCode: ((eq as Record<string, unknown> | null)?.asset_code as string) ?? '—',
      type: 'maintenance',
      submittedBy: ((submitter as Record<string, unknown> | null)?.full_name as string) ?? 'Unknown',
      submittedById: (r.requested_by as string) ?? null,
      status: (r.status as string) ?? '',
      urgency: (r.urgency as string | null) ?? null,
      createdAt: (r.created_at as string | null) ?? null,
      updatedAt: (r.updated_at as string | null) ?? null,
    };
  });
}

// Department-scoped open work orders.
export interface DepartmentWorkOrderRow {
  id: string;
  workOrderNumber: string | null;
  assetId: string | null;
  assetName: string;
  assetCode: string;
  priority: string | null;
  status: string;
  scheduledDate: string | null;
  startedAt: string | null;
  assignedTechnician: string | null;
}

export async function fetchDepartmentWorkOrders(
  supabase: Supabase,
  departmentId: string | null | undefined,
): Promise<DepartmentWorkOrderRow[]> {
  if (!departmentId) return [];
  // Use direct view columns: asset_name, asset_code, assigned_to_name are denormalized
  // into the view. v_open_work_orders exposes department_id after migration 00044.
  // work_orders has no scheduled_date column.
  const { data } = await supabase
    .from('v_open_work_orders')
    .select('id, work_order_number, priority, status, created_at, asset_id, department_id, asset_name, asset_code, assigned_to_name')
    .eq('department_id', departmentId)
    .order('created_at', { ascending: false })
    .limit(200);
  return ((data ?? []) as Array<Record<string, unknown>>).map((r) => ({
    id: r.id as string,
    workOrderNumber: (r.work_order_number as string | null) ?? null,
    assetId: (r.asset_id as string | null) ?? null,
    assetName: (r.asset_name as string | undefined) ?? 'Unknown',
    assetCode: (r.asset_code as string | undefined) ?? '—',
    priority: (r.priority as string | null) ?? null,
    status: (r.status as string) ?? '',
    scheduledDate: null, // work_orders has no scheduled_date column
    startedAt: (r.created_at as string | null) ?? null,
    assignedTechnician: (r.assigned_to_name as string | null) ?? null,
  }));
}

// Department-scoped overdue PM evidence.
export interface DepartmentPmRow {
  id: string;
  assetId: string | null;
  assetName: string;
  assetCode: string;
  scheduledDate: string | null;
  daysOverdue: number;
}

export async function fetchDepartmentOverduePm(
  supabase: Supabase,
  departmentId: string | null | undefined,
): Promise<DepartmentPmRow[]> {
  if (!departmentId) return [];
  const { data } = await supabase
    .from('v_overdue_pm')
    .select('id, scheduled_date, asset_id, department_id, equipment_assets(asset_code, name)')
    .eq('department_id', departmentId)
    .limit(200);
  const now = Date.now();
  return ((data ?? []) as Array<Record<string, unknown>>).map((r) => {
    const eq = firstRelation(r.equipment_assets as Record<string, unknown> | Record<string, unknown>[] | null);
    const sched = r.scheduled_date as string | null;
    const overdueDays = sched ? Math.floor((now - new Date(sched).getTime()) / (1000 * 60 * 60 * 24)) : 0;
    return {
      id: r.id as string,
      assetId: (r.asset_id as string | null) ?? null,
      assetName: ((eq as Record<string, unknown> | null)?.name as string) ?? 'Unknown',
      assetCode: ((eq as Record<string, unknown> | null)?.asset_code as string) ?? '—',
      scheduledDate: sched,
      daysOverdue: overdueDays,
    };
  });
}

// Department-scoped overdue calibration evidence.
export interface DepartmentCalRow {
  id: string;
  assetId: string;
  assetName: string;
  assetCode: string;
  nextDueDate: string | null;
  daysOverdue: number;
  lastResult: string | null;
}

export async function fetchDepartmentOverdueCalibration(
  supabase: Supabase,
  departmentId: string | null | undefined,
): Promise<DepartmentCalRow[]> {
  if (!departmentId) return [];
  // v_calibration_due column is 'result', not 'last_result' (migration 00043).
  const { data } = await supabase
    .from('v_calibration_due')
    .select('id, asset_id, next_due_date, result, equipment_assets!inner(asset_code, name, department_id)')
    .eq('equipment_assets.department_id', departmentId)
    .limit(200);
  const todayIso = new Date().toISOString().slice(0, 10);
  const now = Date.now();
  return ((data ?? []) as Array<Record<string, unknown>>)
    .filter((r) => {
      const due = r.next_due_date as string | null;
      return due && due < todayIso;
    })
    .map((r) => {
      const eq = firstRelation(r.equipment_assets as Record<string, unknown> | Record<string, unknown>[] | null);
      const due = r.next_due_date as string | null;
      const overdueDays = due ? Math.floor((now - new Date(due).getTime()) / (1000 * 60 * 60 * 24)) : 0;
      return {
        id: r.id as string,
        assetId: r.asset_id as string,
        assetName: ((eq as Record<string, unknown> | null)?.name as string) ?? 'Unknown',
        assetCode: ((eq as Record<string, unknown> | null)?.asset_code as string) ?? '—',
        nextDueDate: due,
        daysOverdue: overdueDays,
        lastResult: (r.result as string | null) ?? null,
      };
    });
}

// Department-scoped unacknowledged recommendation flags.
export interface DepartmentAlertRow {
  id: string;
  assetId: string;
  assetCode: string;
  assetName: string;
  flagType: string;
  severity: string;
  message: string;
  generatedAt: string | null;
  details: Record<string, unknown> | null;
}

export async function fetchDepartmentAlerts(
  supabase: Supabase,
  departmentId: string | null | undefined,
): Promise<DepartmentAlertRow[]> {
  if (!departmentId) return [];
  const { data } = await supabase
    .from('recommendation_flags')
    .select('id, asset_id, flag_type, severity, message, details, generated_at, equipment_assets!inner(asset_code, name, department_id)')
    .eq('is_acknowledged', false)
    .eq('equipment_assets.department_id', departmentId)
    .order('generated_at', { ascending: false })
    .limit(200);
  return ((data ?? []) as Array<Record<string, unknown>>).map((r) => {
    const eq = firstRelation(r.equipment_assets as Record<string, unknown> | Record<string, unknown>[] | null);
    return {
      id: r.id as string,
      assetId: (r.asset_id as string) ?? '',
      assetCode: ((eq as Record<string, unknown> | null)?.asset_code as string) ?? '—',
      assetName: ((eq as Record<string, unknown> | null)?.name as string) ?? 'Unknown',
      flagType: (r.flag_type as string) ?? '',
      severity: (r.severity as string) ?? 'low',
      message: (r.message as string) ?? '',
      generatedAt: (r.generated_at as string | null) ?? null,
      details: (r.details as Record<string, unknown> | null) ?? null,
    };
  });
}

// Resolve a department's display name from a department_id.
export async function fetchDepartmentName(
  supabase: Supabase,
  departmentId: string | null | undefined,
): Promise<string | null> {
  if (!departmentId) return null;
  const { data } = await supabase
    .from('departments')
    .select('name')
    .eq('id', departmentId)
    .maybeSingle();
  return (data?.name as string | undefined) ?? null;
}
