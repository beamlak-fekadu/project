import Link from 'next/link';
import {
  ArrowUpDown,
  CalendarDays,
  Info,
  ShieldAlert,
  Users,
  Zap,
} from 'lucide-react';
import { requireRole } from '@/lib/auth/helpers';
import { createClient } from '@/lib/supabase/server';
import { Badge, Card, CardContent, CardHeader, CardTitle, PageHeader } from '@/components/ui';
import ExpandableText from '@/components/ui/ExpandableText';
import { RefreshButton } from './_components/RefreshButton';
import { AutoRefreshStatus } from './_components/AutoRefreshStatus';
import { SummaryActionCards } from './_components/SummaryActionCards';
import { CriticalActionStrip } from './_components/CriticalActionStrip';
import { TriageCenterTabs } from './_components/TriageCenterTabs';
import { WorkloadAssignment } from './_components/WorkloadAssignment';
import CommandCenterInteractive from './_components/CommandCenterInteractive';
import { RiskBandDrilldown, type RiskBand } from './_components/RiskBandDrilldown';
import { ScoreExplanation } from './_components/ScoreExplanation';
import { generateReplacementDriver, generateTriageReason } from '@/utils/decision-support/explanations';
import { buildReplacementReason, summarizeRiskDrivers } from '@/utils/decision-support/command-center-reasons';
import type { RiskExplanation } from '@/services/risk-assessment.service';
import {
  fetchEquipmentSummary,
  fetchCorrectiveMaintenanceTriage,
  fetchNeedsRequestTriage,
  fetchProactiveRiskWatch,
  fetchCalibrationTriage,
  fetchPMTriage,
  fetchStockBlockers,
  fetchInstallationTriage,
  fetchProcurementTriage,
  fetchTrainingTriage,
  fetchTechnicianWorkload,
  fetchWorkOrderSummary,
  fetchWorkQueue,
  buildCriticalActions,
  type CorrectiveMaintenanceItem,
  type NeedsRequestItem,
  type ProactiveRiskItem,
  type ReplacementTriageRow,
  type WorkOrderSummary,
  type WorkQueueItem,
  type TechnicianWorkloadItem,
} from './_lib/command-center-data';
import { equipmentDetail, replacementEvidence, replacementReportPrefill } from './_lib/command-center-routes';
import { isReplacementCandidate } from '@/utils/decision-support/replacement-thresholds';
import ViewerExecutiveCommandCenter from './_components/ViewerExecutiveCommandCenter';
import {
  fetchViewerExecutiveMetrics,
  fetchViewerDeptReadiness,
  fetchViewerCriticalRisks,
} from '@/utils/viewer/executive-metrics';
import { classifyDeptRisk } from '@/utils/viewer/readiness';
import StoreOperationsCommandCenter from './_components/StoreOperationsCommandCenter';
import {
  fetchStoreExecutiveMetrics,
  fetchStoreStockRisk,
  fetchStoreReceivingQueue,
  fetchStoreIssueQueue,
  fetchStoreBlockers,
} from '@/utils/store/store-metrics';
import DepartmentDashboard from './_components/DepartmentDashboard';
import {
  fetchDepartmentMetrics,
  fetchDepartmentAttention,
  fetchDepartmentRequests,
  fetchDepartmentWorkOrders,
  fetchDepartmentOverduePm,
  fetchDepartmentOverdueCalibration,
  fetchDepartmentName,
} from '@/utils/department/department-metrics';
import { detectDepartmentRoleType } from '@/utils/department/department-scope';

// ─── types ────────────────────────────────────────────────────────────────────

interface TriageRow {
  id: string;
  flag_id: string | null;
  flag_type: string | null;
  flag_severity: string | null;
  asset_id: string;
  asset_name: string;
  asset_code: string;
  department_id: string | null;
  department_name: string;
  recommendation: string;
  rationale: string[];
  score: number;
}

interface DeptReadiness {
  department_id: string;
  department_name: string;
  essential_total: number;
  essential_functional: number;
  readiness_score: number;
  total_tracked_assets: number;
  non_essential_total: number;
  essential_unavailable: number;
}

interface ReadinessReconciliation {
  totalActiveAssets: number;
  essentialAssets: number;
  nonEssentialAssets: number;
  unassignedAssets: number;
  missingCriticalityAssets: number;
}

interface WorkInProgress {
  open_work_orders: number;
  in_progress: number;
  assigned: number;
  on_hold: number;
  overdue_pm: number;
  overdue_pm_gt30: number;
  calibration_due_30d: number;
}

interface RiskScoreRow {
  asset_id: string;
  asset_name: string;
  asset_code: string;
  department_name: string;
  severity: number;
  occurrence: number;
  detectability: number;
  rpn: number;
  risk_level: string;
  reason: string;
  suggested_action: string;
}

interface ReplacementRow {
  asset_id: string;
  asset_name: string;
  asset_code: string;
  department_name: string;
  age_score: number | null;
  failure_score: number | null;
  availability_score: number | null;
  maintenance_burden_score: number | null;
  spare_part_score: number | null;
  risk_score: number | null;
  cost_score: number | null;
  priority_index: number;
  rank: number;
  justification: string | null;
}

function normalizeRationale(value: unknown): string[] {
  if (Array.isArray(value)) return value.map((item) => String(item)).filter(Boolean);
  if (value && typeof value === 'object') {
    return Object.entries(value as Record<string, unknown>)
      .map(([k, v]) => `${k}=${Array.isArray(v) ? v.join(', ') : String(v)}`)
      .filter(Boolean);
  }
  if (typeof value === 'string') return [value];
  return [];
}

function suggestedRiskAction(row: { severity: number; risk_level: string }): string {
  if (row.risk_level === 'critical') return 'Immediate risk review and escalation';
  if (row.severity >= 8) return 'Review clinical safety controls and mitigation plan';
  if (row.risk_level === 'high') return 'Schedule risk mitigation';
  if (row.risk_level === 'medium') return 'Plan preventive action';
  return 'Continue routine controls';
}

function rpnBand(rpn: number): RiskBand['key'] {
  if (rpn <= 100) return 'low';
  if (rpn <= 200) return 'medium';
  if (rpn <= 500) return 'high';
  return 'critical';
}

const BAND_META: Record<RiskBand['key'], { label: string; range: string; colorClass: string; textClass: string }> = {
  low:      { label: 'Low',      range: '1–100',   colorClass: 'bg-emerald-500/20', textClass: 'text-emerald-300' },
  medium:   { label: 'Medium',   range: '101–200', colorClass: 'bg-amber-500/20',   textClass: 'text-amber-300' },
  high:     { label: 'High',     range: '201–500', colorClass: 'bg-orange-500/20',  textClass: 'text-orange-300' },
  critical: { label: 'Critical', range: '501+',    colorClass: 'bg-rose-500/20',    textClass: 'text-rose-300' },
};

// ─── data fetchers (existing, preserved) ─────────────────────────────────────

async function fetchTriageData(
  supabase: Awaited<ReturnType<typeof createClient>>,
  profileId: string | null,
  primaryRole: string,
): Promise<{ rows: TriageRow[]; totalItems: number }> {
  let assetIdQuery = supabase
    .from('v_command_center_triage')
    .select('asset_id')
    .eq('status', 'open')
    .limit(500);

  let rowsQuery = supabase
    .from('v_command_center_triage')
    .select('triage_id, asset_id, asset_code, asset_name, department_id, department_name, priority_score, recommendation, rationale, top_flag_id, top_flag_type, top_flag_severity')
    .eq('status', 'open')
    .order('priority_score', { ascending: false });

  if (primaryRole === 'technician' && profileId) {
    assetIdQuery = assetIdQuery.eq('assigned_to', profileId);
    rowsQuery = rowsQuery.eq('assigned_to', profileId);
  }

  const [assetIdRes, rowsRes] = await Promise.all([assetIdQuery, rowsQuery.limit(100)]);
  if (assetIdRes.error || rowsRes.error) return { rows: [], totalItems: 0 };

  const totalUniqueAssets = new Set(
    (assetIdRes.data ?? []).map((r: Record<string, unknown>) => r.asset_id as string).filter(Boolean),
  ).size;

  const allRows = (rowsRes.data ?? []) as Array<Record<string, unknown>>;
  const deduped = new Map<string, Record<string, unknown>>();
  for (const row of allRows) {
    const aid = row.asset_id as string;
    const existing = deduped.get(aid);
    if (!existing || Number(row.priority_score) > Number(existing.priority_score)) deduped.set(aid, row);
  }

  const queueRows = Array.from(deduped.values())
    .sort((a, b) => Number(b.priority_score) - Number(a.priority_score))
    .slice(0, 10);

  const rows = queueRows.map((row) => ({
    id: row.triage_id as string,
    flag_id: (row.top_flag_id as string | undefined) ?? null,
    flag_type: (row.top_flag_type as string | undefined) ?? null,
    flag_severity: (row.top_flag_severity as string | undefined) ?? null,
    asset_id: row.asset_id as string,
    asset_name: (row.asset_name as string | undefined) ?? 'Unknown asset',
    asset_code: (row.asset_code as string | undefined) ?? 'N/A',
    department_id: (row.department_id as string | null) ?? null,
    department_name: (row.department_name as string | undefined) ?? 'Unknown',
    recommendation: generateTriageReason({
      flagType: (row.top_flag_type as string | undefined) ?? null,
      rationale: normalizeRationale(row.rationale),
      fallbackRecommendation: (row.recommendation as string | undefined) ?? null,
    }),
    rationale: normalizeRationale(row.rationale),
    score: Number(row.priority_score ?? 0),
  }));

  return { rows, totalItems: totalUniqueAssets };
}

async function fetchReadinessData(supabase: Awaited<ReturnType<typeof createClient>>): Promise<DeptReadiness[]> {
  const [readinessRes, assetRes] = await Promise.all([
    supabase
    .from('v_department_readiness')
    .select('department_id, department_name, readiness_score, essential_total, essential_functional')
    .order('department_name', { ascending: true })
      .limit(500),
    supabase
      .from('equipment_assets')
      .select('id, department_id, condition, status, equipment_categories(criticality_level)')
      .is('deleted_at', null)
      .eq('status', 'active')
      .limit(1000),
  ]);

  if (readinessRes.error) return [];

  const countsByDept = new Map<string, { total: number; nonEssential: number }>();
  for (const asset of (assetRes.data ?? []) as Array<Record<string, unknown>>) {
    const deptId = asset.department_id as string | null;
    if (!deptId) continue;
    const category = Array.isArray(asset.equipment_categories)
      ? (asset.equipment_categories as Array<{ criticality_level?: string }>)[0]
      : asset.equipment_categories as { criticality_level?: string } | null;
    const criticality = category?.criticality_level ?? null;
    const isEssential = criticality === 'high' || criticality === 'critical';
    const current = countsByDept.get(deptId) ?? { total: 0, nonEssential: 0 };
    current.total++;
    if (!isEssential) current.nonEssential++;
    countsByDept.set(deptId, current);
  }

  return ((readinessRes.data ?? []) as Array<Record<string, unknown>>)
    .map((row) => {
      const departmentId = row.department_id as string;
      const essentialTotal = Number(row.essential_total ?? 0);
      const essentialFunctional = Number(row.essential_functional ?? 0);
      const counts = countsByDept.get(departmentId) ?? { total: essentialTotal, nonEssential: 0 };
      return {
      department_id: departmentId,
      department_name: (row.department_name as string | undefined) ?? 'Unknown',
      essential_total: essentialTotal,
      essential_functional: essentialFunctional,
      readiness_score: Math.round(Number(row.readiness_score ?? 0)),
      total_tracked_assets: counts.total,
      non_essential_total: counts.nonEssential,
      essential_unavailable: Math.max(0, essentialTotal - essentialFunctional),
    };
    })
    .sort((a, b) => a.department_name.localeCompare(b.department_name));
}

async function fetchReadinessReconciliation(supabase: Awaited<ReturnType<typeof createClient>>): Promise<ReadinessReconciliation> {
  const fallback = { totalActiveAssets: 0, essentialAssets: 0, nonEssentialAssets: 0, unassignedAssets: 0, missingCriticalityAssets: 0 };
  try {
    const { data, error } = await supabase
      .from('equipment_assets')
      .select('id, department_id, equipment_categories(criticality_level)')
      .is('deleted_at', null)
      .eq('status', 'active')
      .limit(1000);
    if (error) return fallback;
    let essentialAssets = 0;
    let nonEssentialAssets = 0;
    let unassignedAssets = 0;
    let missingCriticalityAssets = 0;
    for (const row of (data ?? []) as Array<Record<string, unknown>>) {
      const category = Array.isArray(row.equipment_categories)
        ? (row.equipment_categories as Array<{ criticality_level?: string }>)[0]
        : row.equipment_categories as { criticality_level?: string } | null;
      const criticality = category?.criticality_level ?? null;
      if (!row.department_id) unassignedAssets++;
      if (!criticality) missingCriticalityAssets++;
      if (criticality === 'high' || criticality === 'critical') essentialAssets++;
      else nonEssentialAssets++;
    }
    return { totalActiveAssets: (data ?? []).length, essentialAssets, nonEssentialAssets, unassignedAssets, missingCriticalityAssets };
  } catch {
    return fallback;
  }
}

async function fetchWorkInProgress(supabase: Awaited<ReturnType<typeof createClient>>): Promise<WorkInProgress> {
  const in30d = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

  const [woRes, pmRes, calRes] = await Promise.all([
    supabase.from('v_open_work_orders').select('id, status').limit(500),
    supabase.from('v_overdue_pm').select('id, scheduled_date').limit(500),
    supabase.from('v_calibration_due').select('id').lte('next_due_date', in30d).limit(500),
  ]);

  const woRows = (woRes.data ?? []) as Array<{ id: string; status: string }>;
  const pmRows = (pmRes.data ?? []) as Array<{ id: string; scheduled_date: string }>;
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

  return {
    open_work_orders: woRows.length,
    in_progress: woRows.filter((r) => r.status === 'in_progress').length,
    assigned: woRows.filter((r) => r.status === 'assigned').length,
    on_hold: woRows.filter((r) => r.status === 'on_hold').length,
    overdue_pm: pmRows.length,
    overdue_pm_gt30: pmRows.filter((r) => r.scheduled_date <= thirtyDaysAgo).length,
    calibration_due_30d: (calRes.data ?? []).length,
  };
}

async function fetchRiskData(supabase: Awaited<ReturnType<typeof createClient>>): Promise<{ rows: RiskScoreRow[]; totalAssets: number }> {
  const [riskRes, assetCountRes] = await Promise.all([
    supabase
      .from('equipment_risk_scores')
      .select('asset_id, severity, occurrence, detectability, rpn, risk_level, explanation, equipment_assets(asset_code, name, status, deleted_at, departments(name))')
      .order('rpn', { ascending: false })
      .limit(500),
    supabase.from('equipment_assets').select('id', { count: 'exact', head: true }).is('deleted_at', null).eq('status', 'active'),
  ]);

  const rows = ((riskRes.data ?? []) as Array<Record<string, unknown>>).flatMap((row) => {
    const asset = row.equipment_assets as { asset_code: string; name: string; status?: string; deleted_at?: string | null; departments?: { name: string } | null } | null;
    if (!asset || asset.deleted_at || asset.status !== 'active') return [];
    const severity = Number(row.severity ?? 0);
    const riskLevel = (row.risk_level as string) ?? 'low';
    const explanation = (row.explanation as RiskExplanation | null) ?? null;
    const rpn = Number(row.rpn ?? 0);
    return [{
      asset_id: row.asset_id as string,
      asset_name: asset.name ?? 'Unknown',
      asset_code: asset.asset_code ?? 'N/A',
      department_name: asset.departments?.name ?? 'Unknown',
      severity,
      occurrence: Number(row.occurrence ?? 0),
      detectability: Number(row.detectability ?? 0),
      rpn,
      risk_level: riskLevel,
      reason: summarizeRiskDrivers(explanation, rpn, riskLevel),
      suggested_action: suggestedRiskAction({ severity, risk_level: riskLevel }),
    }];
  });

  return { rows, totalAssets: assetCountRes.count ?? 0 };
}

async function fetchReplacementData(supabase: Awaited<ReturnType<typeof createClient>>): Promise<{ rows: ReplacementRow[]; total: number }> {
  const { data, error } = await supabase
    .from('v_replacement_decision')
    .select('asset_id, asset_code, asset_name, department_name, age_score, failure_score, availability_score, maintenance_burden_score, spare_part_score, risk_score, cost_score, replacement_priority_index, replacement_rank, justification')
    .order('replacement_priority_index', { ascending: false })
    .limit(500);

  if (error) return { rows: [], total: 0 };

  const all = ((data ?? []) as Array<Record<string, unknown>>).map((row) => ({
    asset_id: row.asset_id as string,
    asset_name: (row.asset_name as string | undefined) ?? 'Unknown',
    asset_code: (row.asset_code as string | undefined) ?? 'N/A',
    department_name: (row.department_name as string | undefined) ?? 'Unknown',
    age_score: row.age_score as number | null,
    failure_score: row.failure_score as number | null,
    availability_score: row.availability_score as number | null,
    maintenance_burden_score: row.maintenance_burden_score as number | null,
    spare_part_score: row.spare_part_score as number | null,
    risk_score: row.risk_score as number | null,
    cost_score: row.cost_score as number | null,
    priority_index: Number(row.replacement_priority_index ?? 0),
    rank: Number(row.replacement_rank ?? 0),
    justification: (row.justification as string | null) ?? null,
  }));

  // Canonical replacement candidate count = Strong + Review (RPI >= 0.55).
  // Monitor-band rows are not "candidates" and must not be counted here.
  const candidates = all.filter((row) => isReplacementCandidate(row.priority_index));
  return { rows: candidates.slice(0, 5), total: candidates.length };
}

// ─── page ─────────────────────────────────────────────────────────────────────

export default async function CommandCenterPage() {
  const profile = await requireRole(['developer', 'admin', 'bme_head', 'technician', 'department_head', 'department_user', 'store_user', 'viewer']);
  const primaryRole = profile.roleNames?.[0] ?? 'viewer';
  const profileId = ((profile as unknown as Record<string, unknown>).id as string | undefined) ?? null;
  const departmentId = ((profile as unknown as Record<string, unknown>).department_id as string | undefined) ?? null;
  const canMutate = primaryRole !== 'viewer';
  const isFullDesign = ['developer', 'admin', 'bme_head'].includes(primaryRole);

  const supabase = await createClient();
  const now = new Date().toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });

  // ── Department Head / Department User Department Dashboard ────────────
  const deptRoleType = detectDepartmentRoleType(profile.roleNames ?? []);
  if (deptRoleType) {
    const departmentId = (profile as unknown as Record<string, unknown>).department_id as string | null | undefined ?? null;
    const profileIdLocal = (profile as unknown as Record<string, unknown>).id as string | null ?? null;
    const [departmentName, deptMetrics, attention, requests, workOrders, overduePm, overdueCal] = await Promise.all([
      fetchDepartmentName(supabase, departmentId).catch(() => null),
      fetchDepartmentMetrics(supabase, departmentId).catch(() => null),
      fetchDepartmentAttention(supabase, departmentId).catch(() => []),
      fetchDepartmentRequests(supabase, departmentId).catch(() => []),
      fetchDepartmentWorkOrders(supabase, departmentId).catch(() => []),
      fetchDepartmentOverduePm(supabase, departmentId).catch(() => []),
      fetchDepartmentOverdueCalibration(supabase, departmentId).catch(() => []),
    ]);
    return (
      <DepartmentDashboard
        departmentId={departmentId}
        departmentName={departmentName}
        profileId={profileIdLocal}
        roleType={deptRoleType}
        metrics={deptMetrics ?? {
          totalAssets: 0, functionalAssets: 0, needsRepairAssets: 0, nonFunctionalAssets: 0,
          underMaintenanceAssets: 0, criticalAssets: 0, criticalEquipmentDown: 0,
          readinessPercent: null, openRequests: 0, pendingRequests: 0, openWorkOrders: 0,
          criticalOpenWork: 0, overdueWork: 0, awaitingPartsWork: 0, overduePm: 0,
          overdueCalibration: 0, failedCalibration: 0, monthlyCompletedWork: 0,
          monthlyCompletedPm: 0, monthlyCompletedCalibration: 0, trainingNeeds: 0,
          unacknowledgedAlerts: 0,
        }}
        attention={attention}
        requests={requests}
        workOrders={workOrders}
        overduePm={overduePm}
        overdueCalibration={overdueCal}
        generatedAt={now}
      />
    );
  }

  // ── Store-User Store Operations Command Center ─────────────────────────
  // Renders a dedicated stock/logistics console. Other roles fall through.
  if (primaryRole === 'store_user') {
    const [storeMetricsBase, stockRisk, receiving, issueQueue, blockers] = await Promise.all([
      fetchStoreExecutiveMetrics(supabase).catch(() => null),
      fetchStoreStockRisk(supabase).catch(() => []),
      fetchStoreReceivingQueue(supabase).catch(() => []),
      fetchStoreIssueQueue(supabase).catch(() => []),
      fetchStoreBlockers(supabase).catch(() => []),
    ]);
    const storeMetrics = storeMetricsBase ?? {
      totalParts: 0, inStockParts: 0, lowStockParts: 0, stockoutParts: 0,
      blockedWorkOrders: 0, approvedItemsToIssue: 0, deliveredItemsToReceive: 0,
      openProcurement: 0, delayedProcurement: 0, recentReceipts: 0,
      recentIssues: 0, pendingIssueRequests: 0,
    };
    return (
      <StoreOperationsCommandCenter
        metrics={storeMetrics}
        stockRisk={stockRisk}
        receiving={receiving}
        issueQueue={issueQueue}
        blockers={blockers}
        generatedAt={now}
      />
    );
  }

  // ── Viewer-only Executive Oversight Portal ─────────────────────────────────
  // Developer/Admin/BME Head/other operational roles fall through to the
  // existing Command Center below. Viewer renders a dedicated read-only view
  // computed from the same canonical helpers and views — no generated text.
  if (primaryRole === 'viewer') {
    const [vMetricsBase, vDepartments, vCriticalRisks] = await Promise.all([
      fetchViewerExecutiveMetrics(supabase).catch(() => null),
      fetchViewerDeptReadiness(supabase).catch(() => []),
      fetchViewerCriticalRisks(supabase).catch(() => []),
    ]);
    const departmentsAtRisk = vDepartments.filter((d) => {
      const level = classifyDeptRisk({
        readinessScore: d.readinessScore,
        essentialUnavailable: d.essentialUnavailable,
        criticalOpenWork: d.criticalOpenWork,
        overduePm: d.overduePm,
        overdueCalibration: d.overdueCalibration,
      });
      return level === 'high' || level === 'medium';
    }).length;
    const vMetrics = vMetricsBase ?? {
      totalAssets: 0, functionalAssets: 0, needsRepairAssets: 0, nonFunctionalAssets: 0,
      underMaintenanceAssets: 0, essentialAssets: 0, criticalEquipmentDown: 0,
      clinicalReadinessPercent: null, openWorkOrders: 0, criticalOpenWork: 0,
      overdueWork: 0, onHoldWork: 0, monthlyCompletion: 0, pmCompliancePercent: null,
      pmOverdue: 0, calibrationDueSoon: 0, calibrationOverdue: 0,
      criticalCalibrationOverdue: 0, stockBlockers: 0, procurementDelays: 0,
      replacementReviewCandidates: 0, strongReplacementCandidates: 0,
      highRiskAssets: 0, recurringFailureFlags: 0, departmentsAtRisk: 0,
    };
    return (
      <ViewerExecutiveCommandCenter
        metrics={{ ...vMetrics, departmentsAtRisk }}
        departments={vDepartments}
        criticalRisks={vCriticalRisks}
        generatedAt={now}
      />
    );
  }

  // ── Fetch all data in parallel ─────────────────────────────────────────────
  let triage: { rows: TriageRow[]; totalItems: number } = { rows: [], totalItems: 0 };
  let readiness: DeptReadiness[] = [];
  let readinessReconciliation: ReadinessReconciliation = { totalActiveAssets: 0, essentialAssets: 0, nonEssentialAssets: 0, unassignedAssets: 0, missingCriticalityAssets: 0 };
  let wip: WorkInProgress = { open_work_orders: 0, in_progress: 0, assigned: 0, on_hold: 0, overdue_pm: 0, overdue_pm_gt30: 0, calibration_due_30d: 0 };
  let risk: { rows: RiskScoreRow[]; totalAssets: number } = { rows: [], totalAssets: 0 };
  let replacement: { rows: ReplacementRow[]; total: number } = { rows: [], total: 0 };

  try {
    [triage, readiness, readinessReconciliation, wip, risk, replacement] = await Promise.all([
      fetchTriageData(supabase, profileId, primaryRole),
      fetchReadinessData(supabase),
      fetchReadinessReconciliation(supabase),
      fetchWorkInProgress(supabase),
      fetchRiskData(supabase),
      fetchReplacementData(supabase),
    ]);
  } catch {
    // all sections fall back to empty state individually
  }

  // ── Full redesign additional data ──────────────────────────────────────────
  const equipmentSummary = isFullDesign ? await fetchEquipmentSummary(supabase).catch(() => ({ total: 0, functional: 0, nonFunctional: 0, underMaintenance: 0, needsRepair: 0, stockBlockers: 0 })) : { total: 0, functional: 0, nonFunctional: 0, underMaintenance: 0, needsRepair: 0, stockBlockers: 0 };

  const [corrective, needsRequest, proactiveRisk, calibrationTriage, pmTriage, stockBlockers, installationTriage, procurementTriage, trainingTriage, technicianWorkload, workOrderSummary, workQueue] = isFullDesign
    ? await Promise.all([
        fetchCorrectiveMaintenanceTriage(supabase).catch(() => ({ rows: [], total: 0 })),
        fetchNeedsRequestTriage(supabase).catch(() => ({ rows: [] as NeedsRequestItem[], total: 0 })),
        fetchProactiveRiskWatch(supabase).catch(() => ({ rows: [] as ProactiveRiskItem[], total: 0 })),
        fetchCalibrationTriage(supabase).catch(() => ({ rows: [], total: 0 })),
        fetchPMTriage(supabase).catch(() => ({ rows: [], total: 0 })),
        fetchStockBlockers(supabase).catch(() => ({ rows: [], total: 0 })),
        fetchInstallationTriage(supabase).catch(() => ({ rows: [], total: 0 })),
        fetchProcurementTriage(supabase).catch(() => ({ rows: [], total: 0 })),
        fetchTrainingTriage(supabase).catch(() => ({ rows: [], total: 0 })),
        fetchTechnicianWorkload(supabase).catch(() => []),
        fetchWorkOrderSummary(supabase).catch(() => ({ total: 0, open: 0, unassigned: 0, assigned: 0, inProgress: 0, onHold: 0, criticalOrHigh: 0, overduePM: 0, calibrationDue: 0 })),
        fetchWorkQueue(supabase).catch(() => []),
      ])
    : [
        { rows: [] as CorrectiveMaintenanceItem[], total: 0 },
        { rows: [] as NeedsRequestItem[], total: 0 },
        { rows: [] as ProactiveRiskItem[], total: 0 },
        { rows: [], total: 0 },
        { rows: [], total: 0 },
        { rows: [], total: 0 },
        { rows: [], total: 0 },
        { rows: [], total: 0 },
        { rows: [], total: 0 },
        [],
        { total: 0, open: 0, unassigned: 0, assigned: 0, inProgress: 0, onHold: 0, criticalOrHigh: 0, overduePM: 0, calibrationDue: 0 },
        [] as WorkQueueItem[],
      ];

  // ── Legacy triage rows (CorrectiveTriageRow) for CommandCenterInteractive (non-BME-Head) ──

  // ── Build replacement triage rows ──────────────────────────────────────────
  const replacementTriageRows: ReplacementTriageRow[] = replacement.rows.map((r) => ({
    asset_id: r.asset_id,
    asset_name: r.asset_name,
    asset_code: r.asset_code,
    department_name: r.department_name,
    age_score: r.age_score,
    failure_score: r.failure_score,
    availability_score: r.availability_score,
    maintenance_burden_score: r.maintenance_burden_score,
    spare_part_score: r.spare_part_score,
    risk_score: r.risk_score,
    cost_score: r.cost_score,
    priority_index: r.priority_index,
    rank: r.rank,
    reason: buildReplacementReason({
      rank: r.rank,
      priorityIndex: r.priority_index,
      ageScore: r.age_score,
      failureScore: r.failure_score,
      availabilityScore: r.availability_score,
      maintenanceBurdenScore: r.maintenance_burden_score,
      sparePartScore: r.spare_part_score,
      riskScore: r.risk_score,
      costScore: r.cost_score,
      justification: r.justification,
    }),
  }));

  // ── Build critical actions ─────────────────────────────────────────────────
  const criticalActions = isFullDesign
    ? buildCriticalActions({
        corrective: (corrective as { rows: CorrectiveMaintenanceItem[]; total: number }).rows,
        needsRequest: (needsRequest as { rows: NeedsRequestItem[]; total: number }).rows,
        proactiveRisk: (proactiveRisk as { rows: ProactiveRiskItem[]; total: number }).rows,
        calibration: calibrationTriage.rows,
        pm: pmTriage.rows,
        stockBlockers: stockBlockers.rows,
        installation: installationTriage.rows,
        replacement: replacementTriageRows,
        procurement: procurementTriage.rows,
        training: [],
      })
    : [];

  const mergedWorkOrderSummary: WorkOrderSummary = {
    ...(workOrderSummary as WorkOrderSummary),
    overduePM: pmTriage.total,
    calibrationDue: calibrationTriage.total,
  };
  if (isFullDesign) {
    wip = {
      open_work_orders: mergedWorkOrderSummary.total,
      in_progress: mergedWorkOrderSummary.inProgress,
      assigned: mergedWorkOrderSummary.assigned,
      on_hold: mergedWorkOrderSummary.onHold,
      overdue_pm: pmTriage.total,
      overdue_pm_gt30: pmTriage.rows.filter((row) => row.daysOverdue > 30).length,
      calibration_due_30d: calibrationTriage.total,
    };
  }

  // ── RPN band computation ───────────────────────────────────────────────────
  const bandCounts = { low: 0, medium: 0, high: 0, critical: 0 };
  const bandAssets: Record<RiskBand['key'], RiskScoreRow[]> = { low: [], medium: [], high: [], critical: [] };
  for (const row of risk.rows) {
    const band = rpnBand(row.rpn);
    bandCounts[band]++;
    bandAssets[band].push(row);
  }
  const totalAssessed = risk.rows.length;

  const bands: RiskBand[] = (['low', 'medium', 'high', 'critical'] as RiskBand['key'][]).map((key) => ({
    key,
    ...BAND_META[key],
    count: bandCounts[key],
    percentage: totalAssessed > 0 ? Math.round((bandCounts[key] / totalAssessed) * 100) : 0,
    topAssets: bandAssets[key],
  }));

  // ── Role-specific triage heading (for simplified view) ────────────────────
  const triageHeading =
    primaryRole === 'technician'
      ? 'Your urgent items'
      : primaryRole === 'department_user'
        ? 'Department readiness focus'
        : primaryRole === 'store_user'
          ? 'Parts and procurement focus'
          : 'Hospital triage';

  // ── FULL REDESIGN (developer / admin / bme_head) ──────────────────────────
  if (isFullDesign) {
    return (
      <div className="space-y-8">
        {/* ── SECTION 0: Live Operational Header ───────────────────────── */}
        <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <PageHeader
              title="Command Center"
              description="Live biomedical operations status"
            />
            <div className="mt-1 flex flex-wrap items-center gap-3">
              <AutoRefreshStatus />
              <span className="text-xs text-[var(--text-muted)]/50">·</span>
              <span className="text-xs text-[var(--text-muted)]">Updated from current operational records · {now}</span>
              <Link href="/calendar" className="text-xs text-cyan-300/80 hover:text-cyan-200" title="Open hospital operations calendar">
                <CalendarDays className="inline h-3 w-3" /> Calendar
              </Link>
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <RefreshButton />
          </div>
        </div>

        {/* ── SECTION 1: Summary Action Cards ──────────────────────────── */}
        <section aria-label="Summary action cards">
          <SummaryActionCards
            summary={{ ...equipmentSummary, stockBlockers: stockBlockers.total }}
            wip={{ open_work_orders: mergedWorkOrderSummary.total, overdue_pm: pmTriage.total, calibration_due_30d: calibrationTriage.total }}
            criticalActionCount={criticalActions.length}
            replacementCandidates={replacement.total}
            canMutate={canMutate}
          />
        </section>

        {/* ── SECTION 2: Critical Action Strip ─────────────────────────── */}
        <section aria-label="Critical actions">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="inline-flex items-center gap-2 text-base font-semibold text-[var(--foreground)]">
              <Zap className="h-4 w-4 text-rose-400" />
              Critical actions
            </h2>
            <span className="text-xs text-[var(--text-muted)]">Top urgent items across all workflows</span>
          </div>
          <CriticalActionStrip items={criticalActions} canMutate={canMutate} />
        </section>

        {/* ── SECTION 3: Categorized Triage Center ─────────────────────── */}
        <section aria-label="Categorized triage center">
          <div className="mb-3">
            <h2 className="text-base font-semibold text-[var(--foreground)]">Triage center</h2>
            <p className="text-xs text-[var(--text-muted)]">Workflow-specific priority queues — click a tab to review</p>
          </div>
          <TriageCenterTabs
            corrective={(corrective as { rows: CorrectiveMaintenanceItem[]; total: number })}
            needsRequest={(needsRequest as { rows: NeedsRequestItem[]; total: number })}
            proactiveRisk={(proactiveRisk as { rows: ProactiveRiskItem[]; total: number })}
            calibration={calibrationTriage}
            pm={pmTriage}
            stockBlockers={stockBlockers}
            installation={installationTriage}
            replacement={{ rows: replacementTriageRows, total: replacement.total }}
            procurement={procurementTriage}
            training={trainingTriage}
            canMutate={canMutate}
            primaryRole={primaryRole}
          />
        </section>

        {/* ── SECTION 5: Department Readiness + WIP ────────────────────── */}
        <section aria-label="Department readiness and work in progress">
          <h2 className="mb-3 text-base font-semibold text-[var(--foreground)]">Department readiness</h2>
          <p className="mb-4 text-xs text-[var(--text-muted)]">
            Readiness is calculated from essential high/critical equipment. Total equipment inventory includes essential and non-essential assets.
            Formula: functional essential ÷ total essential × 100.
          </p>
          <div className="mb-4 grid grid-cols-2 gap-2 text-xs md:grid-cols-5">
            <div className="rounded-md border border-[var(--border-subtle)]/60 p-2"><span className="text-[var(--text-muted)]">Total active assets</span><p className="font-semibold">{readinessReconciliation.totalActiveAssets}</p></div>
            <div className="rounded-md border border-[var(--border-subtle)]/60 p-2"><span className="text-[var(--text-muted)]">Essential denominator</span><p className="font-semibold">{readinessReconciliation.essentialAssets}</p></div>
            <div className="rounded-md border border-[var(--border-subtle)]/60 p-2"><span className="text-[var(--text-muted)]">Non-essential excluded</span><p className="font-semibold">{readinessReconciliation.nonEssentialAssets}</p></div>
            <div className="rounded-md border border-[var(--border-subtle)]/60 p-2"><span className="text-[var(--text-muted)]">No department</span><p className="font-semibold">{readinessReconciliation.unassignedAssets}</p></div>
            <div className="rounded-md border border-[var(--border-subtle)]/60 p-2"><span className="text-[var(--text-muted)]">Missing criticality</span><p className="font-semibold">{readinessReconciliation.missingCriticalityAssets}</p></div>
          </div>
          <CommandCenterInteractive
            triageRows={triage.rows}
            triageTotalItems={triage.totalItems}
            triageHeading={triageHeading}
            canMutate={canMutate}
            readiness={readiness}
            wip={wip}
            primaryRole={primaryRole}
            departmentId={departmentId}
            showTriage={false}
            showWip={false}
          />
        </section>

        {/* ── SECTION 7: Workload & Assignment ─────────────────────────── */}
        <section aria-label="Workload and assignment">
          <div className="mb-3">
            <h2 className="inline-flex items-center gap-2 text-base font-semibold text-[var(--foreground)]">
              <Users className="h-4 w-4 text-blue-400" />
              Work Queue &amp; assignment
            </h2>
            <p className="mt-0.5 text-xs text-[var(--text-muted)]">
              Open work queue · technician availability · suggested assignment
            </p>
          </div>
          <div className="panel-surface rounded-lg p-5">
            <WorkloadAssignment
              summary={mergedWorkOrderSummary}
              queue={workQueue as WorkQueueItem[]}
              technicians={technicianWorkload as TechnicianWorkloadItem[]}
              canMutate={canMutate}
            />
          </div>
        </section>

        {/* ── SECTION 8: Risk Distribution ─────────────────────────────── */}
        <section aria-label="Equipment risk distribution">
          <Card>
            <CardHeader>
              <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
                <CardTitle>
                  <span className="inline-flex items-center gap-2">
                    <ShieldAlert className="h-5 w-5 text-orange-400" />
                    Equipment risk by RPN band
                  </span>
                </CardTitle>
                <span className="text-xs text-[var(--text-muted)]">
                  {totalAssessed} of {risk.totalAssets} equipment risk-assessed
                  {risk.totalAssets > totalAssessed && (
                    <span title="Some equipment has not yet been risk-scored." className="ml-1 inline-flex cursor-help items-center text-amber-400">
                      <Info className="h-3.5 w-3.5" />
                    </span>
                  )}
                </span>
              </div>
            </CardHeader>
            <CardContent>
              {totalAssessed === 0 ? (
                <p className="py-4 text-center text-sm text-[var(--text-muted)]">No risk scores computed yet</p>
              ) : (
                <>
                  <RiskBandDrilldown bands={bands} totalAssessed={totalAssessed} />
                  <p className="mt-4 text-xs text-[var(--text-muted)]">
                    RPN = Severity × Occurrence × Detectability. Severity reflects clinical/service impact.
                    Occurrence reflects failure likelihood based on history and condition.
                    Detectability reflects ability to detect failure before service impact — higher score means poorer detection.
                  </p>
                </>
              )}
            </CardContent>
          </Card>
        </section>

        {/* ── SECTION 9: Replacement Watchlist ─────────────────────────── */}
        <section aria-label="Replacement watchlist">
          <Card>
            <CardHeader>
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                <CardTitle>
                  <span className="inline-flex items-center gap-2">
                    <ArrowUpDown className="h-5 w-5 text-amber-400" />
                    Replacement watchlist — top 5 candidates
                  </span>
                </CardTitle>
                {replacement.total > 0 && (
                  <Link href="/command/drilldown/replacement" className="text-xs text-violet-300 hover:text-violet-200">
                    Full ranking ({replacement.total}) →
                  </Link>
                )}
              </div>
            </CardHeader>
            <CardContent>
              {replacement.rows.length === 0 ? (
                <p className="py-4 text-center text-sm text-[var(--text-muted)]">No assets currently exceed the replacement review threshold (RPI ≥ 0.55).</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="min-w-[720px] w-full text-sm">
                    <thead>
                      <tr className="border-b border-[var(--border-subtle)]/60 text-left">
                        <th className="pb-2 pr-4 font-medium text-[var(--text-muted)]">Rank</th>
                        <th className="pb-2 pr-4 font-medium text-[var(--text-muted)]">Asset</th>
                        <th className="pb-2 pr-4 font-medium text-[var(--text-muted)]">Department</th>
                        <th className="pb-2 pr-4 font-medium text-[var(--text-muted)]">RPI</th>
                        <th className="pb-2 pr-4 font-medium text-[var(--text-muted)]">Key Driver</th>
                        <th className="pb-2 font-medium text-[var(--text-muted)]">Actions</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[var(--border-subtle)]/60">
                      {replacement.rows.map((row) => (
                        <tr key={row.asset_id}>
                          <td className="py-3 pr-4">
                            <span className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-amber-500/20 text-xs font-bold text-amber-300">
                              {row.rank}
                            </span>
                          </td>
                          <td className="py-3 pr-4">
                            <Link href={equipmentDetail(row.asset_id)} className="font-medium text-[var(--foreground)] hover:text-violet-300">
                              {row.asset_name}
                            </Link>
                            <p className="text-xs text-[var(--text-muted)]">{row.asset_code}</p>
                          </td>
                          <td className="py-3 pr-4 text-[var(--text-muted)]">{row.department_name}</td>
                          <td className="py-3 pr-4">
                            <ScoreExplanation details={{
                              title: `Replacement Priority Index — ${row.asset_name}`,
                              scoreLabel: `RPI ${Math.round(row.priority_index * 100)}/100`,
                              formula: 'weighted sum of normalized criteria × 100',
                              criteria: ['Availability', 'Age', 'Failure rate', 'Maintenance burden', 'Risk/RPN', 'Spare parts', 'Cost'],
                              weights: [
                                { label: 'Availability', value: '20%' },
                                { label: 'Age', value: '15%' },
                                { label: 'Failure rate', value: '15%' },
                                { label: 'Maintenance burden', value: '15%' },
                                { label: 'Risk/RPN', value: '15%' },
                                { label: 'Spare parts', value: '10%' },
                                { label: 'Cost', value: '10%' },
                              ],
                              rawValues: [{ label: 'Rank', value: row.rank }],
                              normalizedValues: [
                                { label: 'Availability score', value: row.availability_score },
                                { label: 'Age score', value: row.age_score },
                                { label: 'Failure score', value: row.failure_score },
                                { label: 'Maintenance burden', value: row.maintenance_burden_score },
                                { label: 'Risk score', value: row.risk_score },
                                { label: 'Spare part score', value: row.spare_part_score },
                                { label: 'Cost score', value: row.cost_score },
                              ],
                              calculation: `RPI = ${Math.round(row.priority_index * 100)}/100`,
                              generatedReason: buildReplacementReason({
                                rank: row.rank,
                                priorityIndex: row.priority_index,
                                ageScore: row.age_score,
                                failureScore: row.failure_score,
                                availabilityScore: row.availability_score,
                                maintenanceBurdenScore: row.maintenance_burden_score,
                                sparePartScore: row.spare_part_score,
                                riskScore: row.risk_score,
                                costScore: row.cost_score,
                                justification: row.justification,
                              }),
                              source: 'v_replacement_decision / replacement_priority_scores',
                              assignmentMethod: 'Computed; no manual override shown',
                              actionSuggestion: 'Review replacement evidence; final lifecycle decision remains with the BME Head.',
                            }}>
                              <Badge variant="warning">RPI {Math.round(row.priority_index * 100)}/100</Badge>
                            </ScoreExplanation>
                          </td>
                          <td className="max-w-xs py-3 pr-4">
                            <ExpandableText
                              text={buildReplacementReason({
                                rank: row.rank,
                                priorityIndex: row.priority_index,
                                ageScore: row.age_score,
                                failureScore: row.failure_score,
                                availabilityScore: row.availability_score,
                                maintenanceBurdenScore: row.maintenance_burden_score,
                                sparePartScore: row.spare_part_score,
                                riskScore: row.risk_score,
                                costScore: row.cost_score,
                                justification: row.justification,
                              })}
                              lines={2}
                              className="text-xs text-[var(--text-muted)]"
                            />
                          </td>
                          <td className="py-3">
                            <div className="flex flex-wrap gap-1.5">
                              <Link href={replacementEvidence(row.asset_id)} className="rounded-md border border-[var(--border-subtle)] px-2 py-1 text-xs text-[var(--text-muted)] hover:text-[var(--foreground)]">
                                Evidence
                              </Link>
                              {canMutate && (
                                <Link href={replacementReportPrefill(row.asset_id, { rank: row.rank, rpi: row.priority_index <= 1 ? row.priority_index * 100 : row.priority_index })} className="rounded-md border border-[var(--border-subtle)] px-2 py-1 text-xs text-[var(--text-muted)] hover:text-[var(--foreground)]">
                                  Add to Report
                                </Link>
                              )}
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
      </div>
    );
  }

  // ── SIMPLIFIED VIEW (technician / dept_head / dept_user / store_user / viewer) ──
  return (
    <div className="space-y-8">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <PageHeader
          title="Command Center"
          description={`Live operational status — ${now}`}
        />
        <RefreshButton />
      </div>

      <CommandCenterInteractive
        triageRows={triage.rows}
        triageTotalItems={triage.totalItems}
        triageHeading={triageHeading}
        canMutate={canMutate}
        readiness={readiness}
        wip={wip}
        primaryRole={primaryRole}
        departmentId={departmentId}
        showTriage
      />

      <section aria-label="Equipment risk distribution">
        <Card>
          <CardHeader>
            <CardTitle>
              <span className="inline-flex items-center gap-2">
                <ShieldAlert className="h-5 w-5 text-orange-400" />
                Equipment risk (RPN)
              </span>
            </CardTitle>
          </CardHeader>
          <CardContent>
            {totalAssessed === 0 ? (
              <p className="py-4 text-center text-sm text-[var(--text-muted)]">No risk scores computed yet</p>
            ) : (
              <RiskBandDrilldown bands={bands} totalAssessed={totalAssessed} />
            )}
          </CardContent>
        </Card>
      </section>

      {replacement.rows.length > 0 && (
        <section aria-label="Replacement watchlist">
          <Card>
            <CardHeader>
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                <CardTitle>
                  <span className="inline-flex items-center gap-2">
                    <ArrowUpDown className="h-5 w-5 text-amber-400" />
                    Top replacement candidates
                  </span>
                </CardTitle>
                {replacement.total > 0 && (
                  <Link href="/replacement" className="text-xs text-violet-300 hover:text-violet-200">
                    View full ranking ({replacement.total}) →
                  </Link>
                )}
              </div>
            </CardHeader>
            <CardContent>
              <div className="overflow-x-auto">
                <table className="min-w-[640px] w-full text-sm">
                  <thead>
                    <tr className="border-b border-[var(--border-subtle)]/60 text-left">
                      <th className="pb-2 pr-4 font-medium text-[var(--text-muted)]">Rank</th>
                      <th className="pb-2 pr-4 font-medium text-[var(--text-muted)]">Asset</th>
                      <th className="pb-2 pr-4 font-medium text-[var(--text-muted)]">Department</th>
                      <th className="pb-2 pr-4 font-medium text-[var(--text-muted)]">Priority Index</th>
                      <th className="pb-2 font-medium text-[var(--text-muted)]">Key Driver</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[var(--border-subtle)]/60">
                    {replacement.rows.map((row) => (
                      <tr key={row.asset_id}>
                        <td className="py-3 pr-4">
                          <span className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-amber-500/20 text-xs font-bold text-amber-300">
                            {row.rank}
                          </span>
                        </td>
                        <td className="py-3 pr-4">
                          <Link href={`/equipment/${row.asset_id}`} className="font-medium text-[var(--foreground)] hover:text-violet-300">
                            {row.asset_name}
                          </Link>
                          <p className="text-xs text-[var(--text-muted)]">{row.asset_code}</p>
                        </td>
                        <td className="py-3 pr-4 text-[var(--text-muted)]">{row.department_name}</td>
                        <td className="py-3 pr-4">
                          <ScoreExplanation details={{
                            title: `Replacement Priority Index — ${row.asset_name}`,
                            scoreLabel: `RPI ${Math.round(row.priority_index * 100)}/100`,
                            formula: 'weighted sum of normalized criteria × 100',
                            criteria: ['Availability', 'Age', 'Failure rate', 'Maintenance burden', 'Risk/RPN', 'Spare parts', 'Cost'],
                            weights: [
                              { label: 'Availability', value: '20%' },
                              { label: 'Age', value: '15%' },
                              { label: 'Failure rate', value: '15%' },
                              { label: 'Maintenance burden', value: '15%' },
                              { label: 'Risk/RPN', value: '15%' },
                              { label: 'Spare parts', value: '10%' },
                              { label: 'Cost', value: '10%' },
                            ],
                            normalizedValues: [
                              { label: 'Availability score', value: row.availability_score },
                              { label: 'Age score', value: row.age_score },
                              { label: 'Failure score', value: row.failure_score },
                              { label: 'Maintenance burden', value: row.maintenance_burden_score },
                              { label: 'Risk score', value: row.risk_score },
                              { label: 'Spare part score', value: row.spare_part_score },
                              { label: 'Cost score', value: row.cost_score },
                            ],
                            rawValues: [{ label: 'Rank', value: row.rank }],
                            calculation: `RPI = ${Math.round(row.priority_index * 100)}/100`,
                            generatedReason: generateReplacementDriver(row),
                            source: 'v_replacement_decision / replacement_priority_scores',
                            assignmentMethod: 'Computed',
                            actionSuggestion: 'Review lifecycle evidence.',
                          }}>
                            <Badge variant="warning">RPI {Math.round(row.priority_index * 100)}/100</Badge>
                          </ScoreExplanation>
                        </td>
                        <td className="max-w-md py-3">
                          <ExpandableText text={generateReplacementDriver(row)} lines={2} className="text-xs text-[var(--text-muted)]" />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        </section>
      )}
    </div>
  );
}
