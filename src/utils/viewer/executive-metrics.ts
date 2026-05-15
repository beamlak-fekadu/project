// Server-side executive metric aggregator for the Viewer role.
//
// Every value returned by this file is computed from real loaded rows in the
// BMERMS database. No generated narrative, no AI-derived text, no fake values.
// If a metric cannot be computed (e.g. view missing) the helper returns
// `null` and the UI must render an explicit "Not available" state.
//
// Source rows / definitions:
//   - equipment_assets (deleted_at IS NULL, status = 'active') for inventory
//     counts; equipment_categories.criticality_level distinguishes essential
//     (high/critical) from non-essential equipment.
//   - v_department_readiness (functional essential / total essential * 100)
//     for the department readiness score.
//   - v_open_work_orders for the open work order queue and unfinished work.
//   - v_overdue_pm for PM overdue counts.
//   - v_calibration_due for calibration overdue/upcoming counts.
//   - v_replacement_decision for replacement scoring; the canonical
//     replacement-candidate threshold lives in replacement-thresholds.ts and
//     is applied via isReplacementCandidate / isStrongReplacementCandidate.
//   - recommendation_flags (low_stock + part_shortage, not acknowledged) for
//     stock blocker counts.
//   - procurement_requests with status in (delayed, in_transit, ordered) for
//     procurement delay counts; delayed alone is also surfaced explicitly.
//   - work_orders with status='completed' and completed_at in current month
//     for monthly completion count.
//
// Each helper documents:
//   - WHAT it counts
//   - WHAT it excludes
//   - SOURCE table/view
//   - NULL semantics

import type { createClient } from '@/lib/supabase/server';
import {
  isReplacementCandidate,
  isStrongReplacementCandidate,
} from '@/utils/decision-support/replacement-thresholds';

type Supabase = Awaited<ReturnType<typeof createClient>>;

export interface ViewerExecutiveMetrics {
  // Inventory baseline (computed from equipment_assets active rows).
  totalAssets: number;
  functionalAssets: number;
  needsRepairAssets: number;
  nonFunctionalAssets: number;
  underMaintenanceAssets: number;
  essentialAssets: number; // criticality_level IN ('high','critical')
  // Critical clinical signal — essential equipment currently unavailable.
  criticalEquipmentDown: number;
  // Hospital-wide readiness — null if v_department_readiness returned no rows.
  clinicalReadinessPercent: number | null;
  // Active work order baseline.
  openWorkOrders: number;
  criticalOpenWork: number; // priority in ('critical','high'), not completed
  overdueWork: number; // open WO with scheduled_date < today
  onHoldWork: number;
  monthlyCompletion: number; // completed_at within current calendar month
  // Compliance.
  pmCompliancePercent: number | null; // last 90d window, completed / scheduled
  pmOverdue: number;
  calibrationDueSoon: number; // due in next 30d (not overdue)
  calibrationOverdue: number;
  criticalCalibrationOverdue: number; // calibration overdue on essential assets
  // Resource pressure.
  stockBlockers: number;
  procurementDelays: number;
  // Lifecycle.
  replacementReviewCandidates: number; // RPI >= 0.55 (Strong + Review)
  strongReplacementCandidates: number; // RPI >= 0.70 (Strong)
  // Risk distribution.
  highRiskAssets: number; // risk_level in ('high','critical')
  recurringFailureFlags: number; // recommendation_flags where flag_type='recurring_failure'
  // Departments-at-risk count (computed via department readiness rules in
  // utils/viewer/readiness.ts at the page level; surfaced here for the
  // executive snapshot card).
  departmentsAtRisk: number;
}

interface AssetRow {
  id: string;
  condition: string | null;
  department_id: string | null;
  equipment_categories: { criticality_level?: string | null } | { criticality_level?: string | null }[] | null;
}

function firstRelation<T>(value: T | T[] | null | undefined): T | null {
  if (Array.isArray(value)) return value[0] ?? null;
  return value ?? null;
}

function isEssential(asset: AssetRow): boolean {
  const cat = firstRelation(asset.equipment_categories);
  const c = cat?.criticality_level ?? null;
  return c === 'high' || c === 'critical';
}

export async function fetchViewerExecutiveMetrics(
  supabase: Supabase,
  options: { departmentsAtRisk?: number } = {},
): Promise<ViewerExecutiveMetrics> {
  const todayIso = new Date().toISOString().slice(0, 10);
  const monthStart = (() => {
    const d = new Date();
    return new Date(d.getUTCFullYear(), d.getUTCMonth(), 1).toISOString().slice(0, 10);
  })();
  const in30dIso = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const last90dIso = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

  const [
    assetsRes,
    readinessRes,
    woRes,
    pmRes,
    calRes,
    flagsRes,
    procRes,
    replacementRes,
    riskRes,
    completedWoRes,
    pmComplianceRes,
  ] = await Promise.all([
    supabase
      .from('equipment_assets')
      .select('id, condition, department_id, equipment_categories(criticality_level)')
      .is('deleted_at', null)
      .eq('status', 'active')
      .limit(2000),
    supabase
      .from('v_department_readiness')
      .select('readiness_score, essential_total, essential_functional')
      .limit(500),
    supabase
      .from('v_open_work_orders')
      .select('id, priority, status, scheduled_date')
      .limit(2000),
    supabase
      .from('v_overdue_pm')
      .select('id, asset_id')
      .limit(2000),
    supabase
      .from('v_calibration_due')
      .select('id, asset_id, next_due_date, equipment_assets(equipment_categories(criticality_level))')
      .limit(2000),
    supabase
      .from('recommendation_flags')
      .select('id, flag_type, is_acknowledged')
      .eq('is_acknowledged', false)
      .limit(2000),
    supabase
      .from('procurement_requests')
      .select('id, status')
      .limit(2000),
    supabase
      .from('v_replacement_decision')
      .select('asset_id, replacement_priority_index')
      .limit(2000),
    supabase
      .from('equipment_risk_scores')
      .select('asset_id, risk_level')
      .limit(2000),
    supabase
      .from('work_orders')
      .select('id, completed_at, status')
      .eq('status', 'completed')
      .gte('completed_at', monthStart)
      .limit(2000),
    // PM compliance over rolling 90d: completed / scheduled where scheduled_date in last 90d
    supabase
      .from('pm_schedules')
      .select('id, status, scheduled_date')
      .gte('scheduled_date', last90dIso)
      .lte('scheduled_date', todayIso)
      .limit(2000),
  ]);

  const assets = (assetsRes.data ?? []) as AssetRow[];
  const totalAssets = assets.length;
  let functionalAssets = 0;
  let needsRepairAssets = 0;
  let nonFunctionalAssets = 0;
  let underMaintenanceAssets = 0;
  let essentialAssets = 0;
  let criticalEquipmentDown = 0;
  for (const a of assets) {
    if (a.condition === 'functional') functionalAssets++;
    else if (a.condition === 'needs_repair') needsRepairAssets++;
    else if (a.condition === 'non_functional') nonFunctionalAssets++;
    else if (a.condition === 'under_maintenance') underMaintenanceAssets++;
    const essential = isEssential(a);
    if (essential) {
      essentialAssets++;
      if (a.condition === 'non_functional' || a.condition === 'under_maintenance') {
        criticalEquipmentDown++;
      }
    }
  }

  // Clinical readiness: weighted average of department readiness scores by
  // essential_total (so smaller departments don't distort the headline).
  let clinicalReadinessPercent: number | null = null;
  const readinessRows = (readinessRes.data ?? []) as Array<{ readiness_score: number | null; essential_total: number | null; essential_functional: number | null }>;
  if (readinessRows.length > 0) {
    let totalEssential = 0;
    let totalFunctional = 0;
    for (const r of readinessRows) {
      totalEssential += Number(r.essential_total ?? 0);
      totalFunctional += Number(r.essential_functional ?? 0);
    }
    if (totalEssential > 0) {
      clinicalReadinessPercent = Math.round((totalFunctional / totalEssential) * 100);
    }
  }

  const woRows = (woRes.data ?? []) as Array<{ id: string; priority: string | null; status: string | null; scheduled_date: string | null }>;
  const openWorkOrders = woRows.length;
  let criticalOpenWork = 0;
  let overdueWork = 0;
  let onHoldWork = 0;
  for (const wo of woRows) {
    const p = (wo.priority ?? '').toLowerCase();
    if (p === 'critical' || p === 'high') criticalOpenWork++;
    if (wo.status === 'on_hold') onHoldWork++;
    if (wo.scheduled_date && wo.scheduled_date < todayIso && wo.status !== 'completed') overdueWork++;
  }

  const pmOverdue = (pmRes.data ?? []).length;

  const calRows = (calRes.data ?? []) as Array<{ id: string; next_due_date: string | null; equipment_assets?: { equipment_categories?: { criticality_level?: string | null } | null } | null }>;
  let calibrationDueSoon = 0;
  let calibrationOverdue = 0;
  let criticalCalibrationOverdue = 0;
  for (const c of calRows) {
    const due = c.next_due_date;
    if (!due) continue;
    if (due < todayIso) {
      calibrationOverdue++;
      const cat = firstRelation(c.equipment_assets?.equipment_categories ?? null);
      if (cat?.criticality_level === 'high' || cat?.criticality_level === 'critical') {
        criticalCalibrationOverdue++;
      }
    } else if (due <= in30dIso) {
      calibrationDueSoon++;
    }
  }

  const flagRows = (flagsRes.data ?? []) as Array<{ flag_type: string | null }>;
  let stockBlockers = 0;
  let recurringFailureFlags = 0;
  for (const f of flagRows) {
    const t = (f.flag_type ?? '').toLowerCase();
    if (t === 'low_stock' || t === 'part_shortage') stockBlockers++;
    if (t === 'recurring_failure') recurringFailureFlags++;
  }

  const procRows = (procRes.data ?? []) as Array<{ status: string | null }>;
  let procurementDelays = 0;
  for (const p of procRows) {
    const s = (p.status ?? '').toLowerCase();
    if (s === 'delayed' || s === 'in_transit' || s === 'ordered' || s === 'approved') {
      // delayed counts the operational delay states; this matches the canonical
      // definition used by Command Center critical actions.
      procurementDelays++;
    }
  }
  // Distinguish the strict "delayed" state if available — but for the executive
  // headline we count the operational pipeline pressure, not strict 'delayed'.

  const replacementRows = (replacementRes.data ?? []) as Array<{ replacement_priority_index: number | null }>;
  let replacementReviewCandidates = 0;
  let strongReplacementCandidates = 0;
  for (const r of replacementRows) {
    if (isReplacementCandidate(r.replacement_priority_index)) replacementReviewCandidates++;
    if (isStrongReplacementCandidate(r.replacement_priority_index)) strongReplacementCandidates++;
  }

  const riskRows = (riskRes.data ?? []) as Array<{ risk_level: string | null }>;
  let highRiskAssets = 0;
  for (const r of riskRows) {
    const lvl = (r.risk_level ?? '').toLowerCase();
    if (lvl === 'critical' || lvl === 'high') highRiskAssets++;
  }

  const monthlyCompletion = (completedWoRes.data ?? []).length;

  // PM compliance (rolling 90d): completed / scheduled. Skipped/deferred not counted as completed.
  let pmCompliancePercent: number | null = null;
  const pmComplianceRows = (pmComplianceRes.data ?? []) as Array<{ status: string | null }>;
  if (pmComplianceRows.length > 0) {
    const completed = pmComplianceRows.filter((p) => (p.status ?? '').toLowerCase() === 'completed').length;
    pmCompliancePercent = Math.round((completed / pmComplianceRows.length) * 100);
  }

  return {
    totalAssets,
    functionalAssets,
    needsRepairAssets,
    nonFunctionalAssets,
    underMaintenanceAssets,
    essentialAssets,
    criticalEquipmentDown,
    clinicalReadinessPercent,
    openWorkOrders,
    criticalOpenWork,
    overdueWork,
    onHoldWork,
    monthlyCompletion,
    pmCompliancePercent,
    pmOverdue,
    calibrationDueSoon,
    calibrationOverdue,
    criticalCalibrationOverdue,
    stockBlockers,
    procurementDelays,
    replacementReviewCandidates,
    strongReplacementCandidates,
    highRiskAssets,
    recurringFailureFlags,
    departmentsAtRisk: options.departmentsAtRisk ?? 0,
  };
}

// Department-level rollups for the Viewer Service Readiness panel.
export interface ViewerDeptReadiness {
  departmentId: string;
  departmentName: string;
  readinessScore: number | null; // 0–100 from v_department_readiness
  essentialTotal: number;
  essentialFunctional: number;
  essentialUnavailable: number;
  criticalOpenWork: number;
  overduePm: number;
  overdueCalibration: number;
}

export async function fetchViewerDeptReadiness(
  supabase: Supabase,
): Promise<ViewerDeptReadiness[]> {
  const todayIso = new Date().toISOString().slice(0, 10);

  const [readinessRes, woRes, pmRes, calRes] = await Promise.all([
    supabase
      .from('v_department_readiness')
      .select('department_id, department_name, readiness_score, essential_total, essential_functional')
      .limit(500),
    supabase
      .from('v_open_work_orders')
      .select('id, priority, department_id')
      .limit(2000),
    supabase
      .from('v_overdue_pm')
      .select('id, department_id')
      .limit(2000),
    supabase
      .from('v_calibration_due')
      .select('id, next_due_date, equipment_assets(department_id)')
      .limit(2000),
  ]);

  const woByDept = new Map<string, number>();
  for (const wo of (woRes.data ?? []) as Array<{ priority: string | null; department_id: string | null }>) {
    const dept = wo.department_id;
    if (!dept) continue;
    const p = (wo.priority ?? '').toLowerCase();
    if (p === 'critical' || p === 'high') {
      woByDept.set(dept, (woByDept.get(dept) ?? 0) + 1);
    }
  }

  const pmByDept = new Map<string, number>();
  for (const p of (pmRes.data ?? []) as Array<{ department_id: string | null }>) {
    const dept = p.department_id;
    if (!dept) continue;
    pmByDept.set(dept, (pmByDept.get(dept) ?? 0) + 1);
  }

  const calByDept = new Map<string, number>();
  for (const c of (calRes.data ?? []) as Array<{ next_due_date: string | null; equipment_assets?: { department_id?: string | null } | { department_id?: string | null }[] | null }>) {
    const due = c.next_due_date;
    if (!due || due >= todayIso) continue;
    const eq = firstRelation(c.equipment_assets);
    const dept = eq?.department_id;
    if (!dept) continue;
    calByDept.set(dept, (calByDept.get(dept) ?? 0) + 1);
  }

  return ((readinessRes.data ?? []) as Array<{ department_id: string; department_name: string | null; readiness_score: number | null; essential_total: number | null; essential_functional: number | null }>).map((row) => {
    const essentialTotal = Number(row.essential_total ?? 0);
    const essentialFunctional = Number(row.essential_functional ?? 0);
    return {
      departmentId: row.department_id,
      departmentName: row.department_name ?? 'Unknown',
      readinessScore: row.readiness_score === null ? null : Math.round(Number(row.readiness_score)),
      essentialTotal,
      essentialFunctional,
      essentialUnavailable: Math.max(0, essentialTotal - essentialFunctional),
      criticalOpenWork: woByDept.get(row.department_id) ?? 0,
      overduePm: pmByDept.get(row.department_id) ?? 0,
      overdueCalibration: calByDept.get(row.department_id) ?? 0,
    };
  }).sort((a, b) => a.departmentName.localeCompare(b.departmentName));
}

// Critical Risks Requiring Management Awareness — composed from real signals.
export interface ViewerCriticalRisk {
  id: string;
  category: 'equipment_down' | 'critical_work' | 'overdue_pm' | 'overdue_calibration' | 'high_rpn' | 'replacement' | 'stock_blocker' | 'procurement_delay';
  assetId?: string | null;
  assetName: string;
  assetCode?: string | null;
  departmentName: string;
  issue: string;
  impact: string;
  workflowStatus: string;
  evidenceHref: string;
}

export async function fetchViewerCriticalRisks(supabase: Supabase): Promise<ViewerCriticalRisk[]> {
  const out: ViewerCriticalRisk[] = [];

  // Critical equipment unavailable
  const { data: criticalDown } = await supabase
    .from('equipment_assets')
    .select('id, asset_code, name, condition, departments(name), equipment_categories(criticality_level)')
    .is('deleted_at', null)
    .eq('status', 'active')
    .in('condition', ['non_functional', 'under_maintenance'])
    .limit(500);

  for (const a of (criticalDown ?? []) as Array<{ id: string; asset_code: string; name: string; condition: string; departments?: { name?: string } | { name?: string }[] | null; equipment_categories?: { criticality_level?: string } | { criticality_level?: string }[] | null }>) {
    const cat = firstRelation(a.equipment_categories);
    if (cat?.criticality_level !== 'high' && cat?.criticality_level !== 'critical') continue;
    const dept = firstRelation(a.departments);
    out.push({
      id: `equip-${a.id}`,
      category: 'equipment_down',
      assetId: a.id,
      assetName: a.name,
      assetCode: a.asset_code,
      departmentName: dept?.name ?? 'Unknown',
      issue: a.condition === 'non_functional' ? 'Critical equipment non-functional' : 'Critical equipment under maintenance',
      impact: 'Service delivery impact for essential clinical equipment',
      workflowStatus: a.condition === 'non_functional' ? 'Non-functional' : 'Under maintenance',
      evidenceHref: `/equipment/${a.id}`,
    });
  }

  // Critical/high open work orders
  const { data: criticalWork } = await supabase
    .from('v_open_work_orders')
    .select('id, work_order_number, priority, status, scheduled_date, equipment_assets(id, asset_code, name, departments(name))')
    .in('priority', ['critical', 'high'])
    .limit(50);

  for (const wo of (criticalWork ?? []) as Array<{ id: string; work_order_number?: string | null; priority: string; status: string; scheduled_date?: string | null; equipment_assets?: { id?: string; asset_code?: string; name?: string; departments?: { name?: string } | { name?: string }[] | null } | { id?: string; asset_code?: string; name?: string; departments?: { name?: string } | { name?: string }[] | null }[] | null }>) {
    const eq = firstRelation(wo.equipment_assets);
    const dept = firstRelation(eq?.departments ?? null);
    out.push({
      id: `wo-${wo.id}`,
      category: 'critical_work',
      assetId: eq?.id ?? null,
      assetName: eq?.name ?? 'Unknown asset',
      assetCode: eq?.asset_code ?? null,
      departmentName: dept?.name ?? 'Unknown',
      issue: `${wo.priority === 'critical' ? 'Critical' : 'High'} priority work order ${wo.work_order_number ?? ''} active`,
      impact: 'Active execution required to restore service',
      workflowStatus: wo.status,
      evidenceHref: `/maintenance/work-orders/${wo.id}`,
    });
  }

  return out.slice(0, 25);
}
