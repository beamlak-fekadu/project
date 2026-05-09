import { createClient } from '@/lib/supabase/server';
import {
  buildCalibrationReason,
  buildCorrectiveReason,
  buildInstallationReason,
  buildLifecycleReason,
  buildPMReason,
  buildProcurementReason,
  buildStockBlockerReason,
  buildTrainingReason,
} from '@/utils/decision-support/command-center-reasons';
import {
  calibrationDetail,
  createMaintenanceRequestFromAsset,
  equipmentDetail,
  installationDetail,
  maintenanceRequestDetail,
  pmDetail,
  procurementDetail,
  replacementEvidence,
  replacementReportPrefill,
  stockIssuePrefill,
  stockProcurementPrefill,
  workOrderDetail,
} from './command-center-routes';

export interface EquipmentSummary {
  total: number;
  functional: number;
  nonFunctional: number;
  underMaintenance: number;
  needsRepair: number;
  stockBlockers: number;
}

export interface CriticalActionItem {
  id: string;
  title: string;
  assetName?: string;
  assetId?: string;
  departmentName?: string;
  category: 'corrective' | 'needs_request' | 'risk_watch' | 'calibration' | 'pm' | 'stock' | 'installation' | 'replacement' | 'procurement' | 'training';
  score: number;
  reason: string;
  scoreBreakdown?: string[];
  primaryAction: string;
  primaryActionHref: string;
  secondaryAction?: string;
  secondaryActionHref?: string;
  urgency: 'critical' | 'high' | 'medium' | 'low';
}

export interface ScoreExplanation {
  title: string;
  scoreLabel: string;
  formula: string;
  criteria: string[];
  weights?: Array<{ label: string; value: string }>;
  rawValues?: Array<{ label: string; value: string | number | null }>;
  normalizedValues?: Array<{ label: string; value: string | number | null }>;
  calculation: string;
  generatedReason: string;
  timestamp?: string | null;
  source?: string;
  assignmentMethod?: string;
  overrideInfo?: string | null;
  actionSuggestion?: string;
}

export interface CorrectiveMaintenanceItem {
  id: string;
  sourceType: 'work_order' | 'maintenance_request';
  recordId: string;
  detailHref: string;
  primaryActionHref: string;
  primaryActionLabel: string;
  secondaryActionHref?: string;
  secondaryActionLabel?: string;
  assetId: string;
  assetName: string;
  assetCode: string;
  departmentName: string;
  status: string;
  urgency: string;
  assignedToName: string | null;
  daysOpen: number;
  score: number;
  reason: string;
}

export interface NeedsRequestItem {
  id: string;
  assetId: string;
  assetName: string;
  assetCode: string;
  departmentName: string;
  departmentId: string | null;
  departmentCriticality: string | null;
  condition: string;
  status: string;
  rpn: number | null;
  riskLevel: string | null;
  healthScore: number | null;
  score: number;
  reason: string;
  createRequestHref: string;
}

export interface ProactiveRiskItem {
  id: string;
  assetId: string;
  assetName: string;
  assetCode: string;
  departmentName: string;
  condition: string;
  rpn: number | null;
  riskLevel: string | null;
  flags: string[];
  flagIds: string[];
  signalHash: string;
  score: number;
  reason: string;
}

export interface WorkOrderSummary {
  total: number;
  open: number;
  unassigned: number;
  assigned: number;
  inProgress: number;
  onHold: number;
  criticalOrHigh: number;
  overduePM: number;
  calibrationDue: number;
}

export interface WorkQueueItem {
  id: string;
  workOrderNumber: string;
  assetId: string;
  assetName: string;
  assetCode: string;
  status: string;
  priority: string | null;
  assignedToName: string | null;
  assignedToId: string | null;
  daysOpen: number;
  primaryAction: string;
  primaryActionHref: string;
  detailHref: string;
}

export interface CalibrationTriageItem {
  id: string;
  assetId: string;
  assetName: string;
  assetCode: string;
  departmentName: string;
  nextDueDate: string | null;
  daysOverdue: number;
  lastResult: string | null;
  score: number;
  reason: string;
  detailHref: string;
  scheduleHref: string;
  recordHref: string;
}

export interface PMTriageItem {
  id: string;
  assetId: string;
  assetName: string;
  assetCode: string;
  departmentName: string;
  scheduledDate: string;
  daysOverdue: number;
  score: number;
  reason: string;
  detailHref: string;
  assignHref: string;
  checklistHref: string;
}

export interface StockBlockerItem {
  id: string;
  partName: string;
  partCode: string;
  currentStock: number;
  reorderLevel: number;
  blockerType: 'stockout' | 'low_stock_risk' | 'maintenance_blocker';
  suggestedQuantity: number;
  linkedWorkOrderId: string | null;
  linkedAssetId: string | null;
  procurementHref: string;
  issueStockHref: string | null;
  detailHref: string;
  score: number;
  reason: string;
}

export interface InstallationTriageItem {
  id: string;
  assetId: string;
  assetName: string;
  assetCode: string;
  departmentName: string;
  status: string;
  daysPending: number;
  score: number;
  reason: string;
  detailHref: string;
  scheduleHref: string;
  commissionHref: string;
  assetHref: string;
}

export interface ProcurementTriageItem {
  id: string;
  requestNumber: string;
  description: string;
  status: string;
  priority: string | null;
  daysDelayed: number;
  score: number;
  reason: string;
  detailHref: string;
  updateHref: string;
  escalateHref: string;
}

export interface TrainingTriageItem {
  id: string;
  assetId: string | null;
  assetName: string;
  departmentName: string;
  status: string;
  daysPending: number;
  score: number;
  reason: string;
}

export interface TechnicianWorkloadItem {
  profileId: string;
  name: string;
  email: string | null;
  departmentName: string | null;
  openAssignments: number;
  inProgress: number;
  overdueTasks: number;
  criticalTasks: number;
  estimatedHours: number;
  status: 'available' | 'busy' | 'overloaded';
}

export interface CorrectiveTriageRow {
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

export interface ReplacementTriageRow {
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
  reason: string;
}

export interface TriageCategories {
  corrective: { rows: CorrectiveMaintenanceItem[]; total: number };
  needsRequest: { rows: NeedsRequestItem[]; total: number };
  proactiveRisk: { rows: ProactiveRiskItem[]; total: number };
  calibration: { rows: CalibrationTriageItem[]; total: number };
  pm: { rows: PMTriageItem[]; total: number };
  stockBlockers: { rows: StockBlockerItem[]; total: number };
  installation: { rows: InstallationTriageItem[]; total: number };
  replacement: { rows: ReplacementTriageRow[]; total: number };
  procurement: { rows: ProcurementTriageItem[]; total: number };
  training: { rows: TrainingTriageItem[]; total: number };
}

type SupabaseClient = Awaited<ReturnType<typeof createClient>>;

function daysSince(dateString: string | null | undefined): number {
  if (!dateString) return 0;
  const then = new Date(dateString).getTime();
  const now = Date.now();
  return Math.floor((now - then) / (1000 * 60 * 60 * 24));
}

function urgencyScore(urgency: string | null | undefined): number {
  switch (urgency) {
    case 'critical': return 40;
    case 'high': return 30;
    case 'medium': return 20;
    default: return 10;
  }
}

function woStatusScore(status: string | null | undefined): number {
  switch (status) {
    case 'in_progress': return 20;
    case 'assigned': return 15;
    case 'on_hold': return 10;
    case 'open': return 5;
    default: return 5;
  }
}

function mrStatusScore(status: string | null | undefined): number {
  switch (status) {
    case 'in_progress': return 20;
    case 'assigned': return 15;
    case 'approved': return 10;
    case 'pending': return 5;
    default: return 5;
  }
}

function workOrderAction(status: string | null | undefined, assignedTo: string | null | undefined, id: string): {
  label: string;
  href: string;
} {
  const detailHref = workOrderDetail(id);
  if (status === 'on_hold') return { label: 'Resolve Blocker', href: `${detailHref}?action=resolve-blocker` };
  if (status === 'in_progress') return { label: 'View Progress', href: detailHref };
  if (status === 'completed' || status === 'closed' || status === 'canceled') return { label: 'View Record', href: detailHref };
  if (!assignedTo) return { label: 'Assign', href: `${detailHref}?action=assign` };
  return { label: 'Reassign', href: `${detailHref}?action=reassign` };
}

function signalHash(parts: Array<string | number | null | undefined>): string {
  return parts.map((part) => part == null ? 'null' : String(part)).join('|');
}

function warnCommandData(message: string, error: unknown): void {
  if (process.env.NODE_ENV === 'development') {
    console.warn(`[command-center-data] ${message}`, error);
  }
}

async function fetchActiveCorrectiveAssetIds(supabase: SupabaseClient): Promise<Set<string>> {
  const [activeWoRes, activeMrRes] = await Promise.all([
    supabase
      .from('work_orders')
      .select('asset_id')
      .eq('work_type', 'corrective')
      .in('status', ['open', 'assigned', 'in_progress', 'on_hold'])
      .limit(500),
    supabase
      .from('maintenance_requests')
      .select('asset_id')
      .in('status', ['pending', 'approved', 'assigned', 'in_progress'])
      .limit(500),
  ]);

  return new Set<string>([
    ...((activeWoRes.data ?? []) as Array<{ asset_id: string | null }>)
      .map((r) => r.asset_id)
      .filter((id): id is string => Boolean(id)),
    ...((activeMrRes.data ?? []) as Array<{ asset_id: string | null }>)
      .map((r) => r.asset_id)
      .filter((id): id is string => Boolean(id)),
  ]);
}

export async function fetchEquipmentSummary(supabase: SupabaseClient): Promise<EquipmentSummary> {
  try {
    const [assetsRes, stockRes] = await Promise.all([
      supabase
        .from('equipment_assets')
        .select('id, condition, status')
        .is('deleted_at', null),
      supabase
        .from('spare_parts')
        .select('id, current_stock, reorder_level')
        .not('current_stock', 'is', null)
        .not('reorder_level', 'is', null)
        .gt('reorder_level', 0),
    ]);

    const assets = (assetsRes.data ?? []) as Array<{ id: string; condition: string | null; status: string | null }>;
    const spareParts = (stockRes.data ?? []) as Array<{ id: string; current_stock: number; reorder_level: number }>;

    const total = assets.length;
    const functional = assets.filter((a) => a.condition === 'functional' && a.status === 'active').length;
    const nonFunctional = assets.filter((a) => a.condition === 'non_functional').length;
    const underMaintenance = assets.filter((a) => a.condition === 'under_maintenance').length;
    const needsRepair = assets.filter((a) => a.condition === 'needs_repair').length;
    const stockBlockers = spareParts.filter((p) => p.current_stock <= p.reorder_level).length;

    return { total, functional, nonFunctional, underMaintenance, needsRepair, stockBlockers };
  } catch (error) {
    warnCommandData('fetchEquipmentSummary failed', error);
    return { total: 0, functional: 0, nonFunctional: 0, underMaintenance: 0, needsRepair: 0, stockBlockers: 0 };
  }
}

export async function fetchCorrectiveMaintenanceTriage(
  supabase: SupabaseClient,
): Promise<{ rows: CorrectiveMaintenanceItem[]; total: number }> {
  try {
    const [woRes, mrRes] = await Promise.all([
      supabase
        .from('work_orders')
        .select('id, asset_id, status, priority, assigned_to, created_at, profiles(full_name), equipment_assets(name, asset_code, departments(name))')
        .eq('work_type', 'corrective')
        .in('status', ['open', 'assigned', 'in_progress', 'on_hold'])
        .limit(200),
      supabase
        .from('maintenance_requests')
        .select('id, asset_id, status, urgency, created_at, fault_description, equipment_assets(name, asset_code, departments(name))')
        .in('status', ['pending', 'approved', 'assigned', 'in_progress'])
        .limit(200),
    ]);

    type WORow = {
      id: string;
      asset_id: string | null;
      status: string | null;
      priority: string | null;
      assigned_to: string | null;
      created_at: string | null;
      profiles: { full_name?: string } | null;
      equipment_assets: { name?: string; asset_code?: string; departments?: { name?: string } | Array<{ name?: string }> | null } | null;
    };

    type MRRow = {
      id: string;
      asset_id: string | null;
      status: string | null;
      urgency: string | null;
      created_at: string | null;
      fault_description: string | null;
      equipment_assets: { name?: string; asset_code?: string; departments?: { name?: string } | Array<{ name?: string }> | null } | null;
    };

    const woRows = (woRes.data ?? []) as WORow[];
    const mrRows = (mrRes.data ?? []) as MRRow[];

    // Build set of asset IDs already covered by work orders
    const assetIdsWithWorkOrders = new Set<string>(
      woRows.map((wo) => wo.asset_id).filter((id): id is string => id != null),
    );

    function extractDept(
      assetJoin: { departments?: { name?: string } | Array<{ name?: string }> | null } | null,
    ): string {
      if (!assetJoin) return 'Unknown';
      const d = assetJoin.departments;
      if (Array.isArray(d)) return d[0]?.name ?? 'Unknown';
      return d?.name ?? 'Unknown';
    }

    const woItems: CorrectiveMaintenanceItem[] = woRows.map((wo) => {
      const daysOpen = daysSince(wo.created_at);
      const action = workOrderAction(wo.status, wo.assigned_to, wo.id);
      const score =
        urgencyScore(wo.priority) +
        woStatusScore(wo.status) +
        Math.min(20, daysOpen * 0.5);

      return {
        id: wo.id,
        sourceType: 'work_order',
        recordId: wo.id,
        detailHref: workOrderDetail(wo.id),
        primaryActionHref: action.href,
        primaryActionLabel: action.label,
        secondaryActionHref: workOrderDetail(wo.id),
        secondaryActionLabel: 'View History',
        assetId: wo.asset_id ?? '',
        assetName: wo.equipment_assets?.name ?? 'Unknown',
        assetCode: wo.equipment_assets?.asset_code ?? 'N/A',
        departmentName: extractDept(wo.equipment_assets),
        status: wo.status ?? 'unknown',
        urgency: wo.priority ?? 'low',
        assignedToName: wo.profiles?.full_name ?? null,
        daysOpen,
        score,
        reason: buildCorrectiveReason({ urgency: wo.priority }),
      };
    });

    const mrItems: CorrectiveMaintenanceItem[] = mrRows
      .filter((mr) => mr.asset_id == null || !assetIdsWithWorkOrders.has(mr.asset_id))
      .map((mr) => {
        const daysOpen = daysSince(mr.created_at);
        const score =
          urgencyScore(mr.urgency) +
          mrStatusScore(mr.status) +
          Math.min(20, daysOpen * 0.5);

        return {
          id: mr.id,
          sourceType: 'maintenance_request',
          recordId: mr.id,
          detailHref: maintenanceRequestDetail(mr.id),
          primaryActionHref: maintenanceRequestDetail(mr.id),
          primaryActionLabel: 'Open Request',
          secondaryActionHref: mr.asset_id ? equipmentDetail(mr.asset_id) : undefined,
          secondaryActionLabel: 'View Equipment',
          assetId: mr.asset_id ?? '',
          assetName: mr.equipment_assets?.name ?? 'Unknown',
          assetCode: mr.equipment_assets?.asset_code ?? 'N/A',
          departmentName: extractDept(mr.equipment_assets),
          status: mr.status ?? 'unknown',
          urgency: mr.urgency ?? 'low',
          assignedToName: null,
          daysOpen,
          score,
          reason: buildCorrectiveReason({ urgency: mr.urgency }),
        };
      });

    const allItems = [...woItems, ...mrItems].sort((a, b) => b.score - a.score);
    return { rows: allItems.slice(0, 15), total: allItems.length };
  } catch (error) {
    warnCommandData('fetchCorrectiveMaintenanceTriage failed', error);
    return { rows: [], total: 0 };
  }
}

export async function fetchNeedsRequestTriage(
  supabase: SupabaseClient,
): Promise<{ rows: NeedsRequestItem[]; total: number }> {
  try {
    const activeCorrectiveAssetIds = await fetchActiveCorrectiveAssetIds(supabase);

    const { data, error } = await supabase
      .from('equipment_assets')
      .select('id, name, asset_code, condition, status, department_id, departments(name), equipment_categories(criticality_level)')
      .in('condition', ['non_functional', 'needs_repair', 'under_maintenance'])
      .is('deleted_at', null)
      .eq('status', 'active')
      .limit(300);

    if (error) return { rows: [], total: 0 };

    const candidateRows = ((data ?? []) as Array<Record<string, unknown>>)
      .filter((row) => !activeCorrectiveAssetIds.has(row.id as string));

    const assetIds = candidateRows.map((row) => row.id as string).filter(Boolean);
    const [riskRes, healthRes] = assetIds.length > 0
      ? await Promise.all([
          supabase
            .from('equipment_risk_scores')
            .select('asset_id, rpn, risk_level, assessed_at')
            .in('asset_id', assetIds)
            .order('assessed_at', { ascending: false })
            .limit(500),
          supabase
            .from('v_asset_health_summary')
            .select('asset_id, health_score')
            .in('asset_id', assetIds)
            .limit(500),
        ])
      : [{ data: [] }, { data: [] }];

    const riskByAsset = new Map<string, { rpn: number | null; riskLevel: string | null }>();
    for (const row of (riskRes.data ?? []) as Array<Record<string, unknown>>) {
      const assetId = row.asset_id as string | null;
      if (!assetId || riskByAsset.has(assetId)) continue;
      riskByAsset.set(assetId, {
        rpn: row.rpn == null ? null : Number(row.rpn),
        riskLevel: (row.risk_level as string | null) ?? null,
      });
    }

    const healthByAsset = new Map<string, number>();
    for (const row of (healthRes.data ?? []) as Array<Record<string, unknown>>) {
      if (row.asset_id) healthByAsset.set(row.asset_id as string, Number(row.health_score ?? 0));
    }

    function extractName(join: unknown): string {
      if (Array.isArray(join)) return (join[0] as { name?: string } | undefined)?.name ?? 'Unknown';
      return (join as { name?: string } | null)?.name ?? 'Unknown';
    }

    function extractCriticality(join: unknown): string | null {
      if (Array.isArray(join)) return (join[0] as { criticality_level?: string } | undefined)?.criticality_level ?? null;
      return (join as { criticality_level?: string } | null)?.criticality_level ?? null;
    }

    const rows: NeedsRequestItem[] = candidateRows.map((row) => {
      const assetId = row.id as string;
      const condition = (row.condition as string | null) ?? 'unknown';
      const criticality = extractCriticality(row.equipment_categories);
      const risk = riskByAsset.get(assetId) ?? { rpn: null, riskLevel: null };
      const healthScore = healthByAsset.get(assetId) ?? null;
      const conditionScore = condition === 'non_functional' ? 45 : condition === 'needs_repair' ? 35 : 25;
      const deptScore = criticality === 'critical' ? 25 : criticality === 'high' ? 18 : 8;
      const riskScore = risk.riskLevel === 'critical' ? 20 : risk.riskLevel === 'high' ? 12 : 0;
      const healthPenalty = healthScore != null ? Math.max(0, Math.min(10, (70 - healthScore) / 7)) : 0;
      const score = 90 + conditionScore + deptScore + riskScore + healthPenalty;
      const readableCondition = condition.replace(/_/g, ' ');
      const departmentId = (row.department_id as string | null) ?? null;
      const urgency = condition === 'non_functional'
        ? criticality === 'critical' || criticality === 'high' ? 'critical' : 'high'
        : condition === 'needs_repair'
          ? criticality === 'critical' || criticality === 'high' ? 'high' : 'medium'
          : 'medium';
      const reason = `Command Center detected ${(row.name as string | undefined) ?? 'this asset'} is ${readableCondition} with RPN ${risk.rpn ?? 'not yet scored'} and no open corrective request.`;

      return {
        id: assetId,
        assetId,
        assetName: (row.name as string | undefined) ?? 'Unknown',
        assetCode: (row.asset_code as string | undefined) ?? 'N/A',
        departmentName: extractName(row.departments),
        departmentId,
        departmentCriticality: criticality,
        condition,
        status: (row.status as string | undefined) ?? 'active',
        rpn: risk.rpn,
        riskLevel: risk.riskLevel,
        healthScore,
        score,
        reason,
        createRequestHref: createMaintenanceRequestFromAsset(assetId, {
          departmentId,
          urgency,
          description: reason,
        }),
      };
    });

    const sorted = rows.sort((a, b) => b.score - a.score);
    return { rows: sorted.slice(0, 15), total: sorted.length };
  } catch (error) {
    warnCommandData('fetchNeedsRequestTriage failed', error);
    return { rows: [], total: 0 };
  }
}

export async function fetchProactiveRiskWatch(
  supabase: SupabaseClient,
): Promise<{ rows: ProactiveRiskItem[]; total: number }> {
  try {
    const activeAssetIds = await fetchActiveCorrectiveAssetIds(supabase);
    const needsRequestConditions = new Set(['non_functional', 'needs_repair', 'under_maintenance']);

    // Step 2: recommendation flags for key flag types
    const [flagRes, riskRes] = await Promise.all([
      supabase
        .from('recommendation_flags')
        .select('id, asset_id, flag_type, severity, equipment_assets(name, asset_code, condition, status, departments(name))')
        .in('flag_type', ['urgent_maintenance', 'recurring_failure', 'high_risk', 'low_availability', 'monitor_closely'])
        .eq('is_acknowledged', false)
        .limit(300),
      supabase
        .from('equipment_risk_scores')
        .select('asset_id, rpn, risk_level, equipment_assets(name, asset_code, condition, status, deleted_at, departments(name))')
        .in('risk_level', ['high', 'critical'])
        .order('rpn', { ascending: false })
        .limit(100),
    ]);

    type FlagRow = {
      id: string;
      asset_id: string | null;
      flag_type: string | null;
      severity: string | null;
      equipment_assets: {
        name?: string;
        asset_code?: string;
        condition?: string | null;
        status?: string | null;
        departments?: { name?: string } | Array<{ name?: string }> | null;
      } | null;
    };

    type RiskRow = {
      asset_id: string | null;
      rpn: number | null;
      risk_level: string | null;
      equipment_assets: {
        name?: string;
        asset_code?: string;
        condition?: string | null;
        status?: string | null;
        deleted_at?: string | null;
        departments?: { name?: string } | Array<{ name?: string }> | null;
      } | null;
    };

    function extractDeptFromAsset(
      assetJoin: { departments?: { name?: string } | Array<{ name?: string }> | null } | null,
    ): string {
      if (!assetJoin) return 'Unknown';
      const d = assetJoin.departments;
      if (Array.isArray(d)) return d[0]?.name ?? 'Unknown';
      return d?.name ?? 'Unknown';
    }

    function flagSeverityScore(severity: string | null | undefined): number {
      switch (severity) {
        case 'critical': return 30;
        case 'high': return 20;
        default: return 10;
      }
    }

    function riskLevelScore(riskLevel: string | null | undefined): number {
      switch (riskLevel) {
        case 'critical': return 40;
        case 'high': return 25;
        default: return 0;
      }
    }

    // Step 4: build asset map
    const assetMap = new Map<string, ProactiveRiskItem>();

    const flagRows = (flagRes.data ?? []) as FlagRow[];
    for (const flag of flagRows) {
      const assetId = flag.asset_id;
      if (!assetId) continue;
      // Skip assets with active corrective maintenance
      if (activeAssetIds.has(assetId)) continue;
      if (flag.equipment_assets?.status !== 'active') continue;
      if (needsRequestConditions.has(flag.equipment_assets?.condition ?? '')) continue;

      if (!assetMap.has(assetId)) {
        assetMap.set(assetId, {
          id: assetId,
          assetId,
          assetName: flag.equipment_assets?.name ?? 'Unknown',
          assetCode: flag.equipment_assets?.asset_code ?? 'N/A',
          departmentName: extractDeptFromAsset(flag.equipment_assets),
          condition: flag.equipment_assets?.condition ?? 'unknown',
          rpn: null,
          riskLevel: null,
          flags: [],
          flagIds: [],
          signalHash: '',
          score: 0,
          reason: '',
        });
      }

      const entry = assetMap.get(assetId)!;
      if (flag.flag_type) entry.flags.push(flag.flag_type);
      entry.flagIds.push(flag.id);
      entry.score += flagSeverityScore(flag.severity);
    }

    const riskRows = (riskRes.data ?? []) as RiskRow[];
    for (const risk of riskRows) {
      const assetId = risk.asset_id;
      if (!assetId) continue;
      // Skip assets with active corrective maintenance
      if (activeAssetIds.has(assetId)) continue;
      // Skip deleted assets
      if (risk.equipment_assets?.deleted_at != null) continue;
      if (risk.equipment_assets?.status !== 'active') continue;
      if (needsRequestConditions.has(risk.equipment_assets?.condition ?? '')) continue;

      if (!assetMap.has(assetId)) {
        assetMap.set(assetId, {
          id: assetId,
          assetId,
          assetName: risk.equipment_assets?.name ?? 'Unknown',
          assetCode: risk.equipment_assets?.asset_code ?? 'N/A',
          departmentName: extractDeptFromAsset(risk.equipment_assets),
          condition: risk.equipment_assets?.condition ?? 'unknown',
          rpn: null,
          riskLevel: null,
          flags: [],
          flagIds: [],
          signalHash: '',
          score: 0,
          reason: '',
        });
      }

      const entry = assetMap.get(assetId)!;
      entry.rpn = risk.rpn;
      entry.riskLevel = risk.risk_level;
      entry.score += riskLevelScore(risk.risk_level);
    }

    // Step 5: generate reasons
    const items: ProactiveRiskItem[] = Array.from(assetMap.values()).map((item) => {
      const parts: string[] = [];
      parts.push('No open corrective request.');
      if (item.flags.length > 0) {
        parts.push(`Signals: ${item.flags.map((f) => f.replace(/_/g, ' ')).join(', ')}.`);
      }
      if (item.rpn != null && item.riskLevel) {
        parts.push(`RPN ${item.rpn} (${item.riskLevel}).`);
      }
      if (item.condition && item.condition !== 'functional' && item.condition !== 'unknown') {
        parts.push(`Condition: ${item.condition.replace(/_/g, ' ')}.`);
      }
      parts.push('Recommended: create maintenance request or schedule PM.');
      return {
        ...item,
        signalHash: signalHash([
          item.assetId,
          item.rpn,
          item.riskLevel,
          item.condition,
          item.flags.sort().join(','),
          item.flagIds.sort().join(','),
        ]),
        reason: parts.join(' '),
      };
    });

    const itemHashes = items.map((item) => item.signalHash);
    let acknowledged = new Set<string>();
    if (itemHashes.length > 0) {
      const { data: ackRows } = await supabase
        .from('command_center_acknowledgements')
        .select('item_key, signal_hash, snoozed_until')
        .eq('item_type', 'risk_watch')
        .in('signal_hash', itemHashes)
        .limit(500);
      acknowledged = new Set(
        ((ackRows ?? []) as Array<{ item_key: string | null; signal_hash: string | null; snoozed_until: string | null }>)
          .filter((row) => !row.snoozed_until || new Date(row.snoozed_until).getTime() > Date.now())
          .map((row) => `${row.item_key}:${row.signal_hash}`),
      );
    }

    const sorted = items
      .filter((item) => !acknowledged.has(`${item.assetId}:${item.signalHash}`))
      .sort((a, b) => b.score - a.score);
    return { rows: sorted.slice(0, 15), total: sorted.length };
  } catch (error) {
    warnCommandData('fetchProactiveRiskWatch failed', error);
    return { rows: [], total: 0 };
  }
}

export async function fetchWorkOrderSummary(supabase: SupabaseClient): Promise<WorkOrderSummary> {
  try {
    const { data, error } = await supabase
      .from('work_orders')
      .select('id, status, priority, assigned_to')
      .in('status', ['open', 'assigned', 'in_progress', 'on_hold'])
      .limit(500);

    if (error) {
      return { total: 0, open: 0, unassigned: 0, assigned: 0, inProgress: 0, onHold: 0, criticalOrHigh: 0, overduePM: 0, calibrationDue: 0 };
    }

    type WOSummaryRow = {
      id: string;
      status: string | null;
      priority: string | null;
      assigned_to: string | null;
    };

    const rows = (data ?? []) as WOSummaryRow[];

    let open = 0;
    let unassigned = 0;
    let assigned = 0;
    let inProgress = 0;
    let onHold = 0;
    let criticalOrHigh = 0;

    for (const row of rows) {
      if (row.status === 'open') open++;
      if (row.status === 'assigned') assigned++;
      if (row.status === 'in_progress') inProgress++;
      if (row.status === 'on_hold') onHold++;
      if (row.assigned_to == null) unassigned++;
      if (row.priority === 'critical' || row.priority === 'high') criticalOrHigh++;
    }

    return {
      total: rows.length,
      open,
      unassigned,
      assigned,
      inProgress,
      onHold,
      criticalOrHigh,
      overduePM: 0,
      calibrationDue: 0,
    };
  } catch (error) {
    warnCommandData('fetchWorkOrderSummary failed', error);
    return { total: 0, open: 0, unassigned: 0, assigned: 0, inProgress: 0, onHold: 0, criticalOrHigh: 0, overduePM: 0, calibrationDue: 0 };
  }
}

export async function fetchWorkQueue(supabase: SupabaseClient): Promise<WorkQueueItem[]> {
  try {
    const { data, error } = await supabase
      .from('work_orders')
      .select('id, work_order_number, asset_id, status, priority, assigned_to, created_at, profiles(full_name), equipment_assets(name, asset_code)')
      .in('status', ['open', 'assigned', 'in_progress', 'on_hold'])
      .order('created_at', { ascending: true })
      .limit(100);

    if (error) return [];

    type Row = {
      id: string;
      work_order_number: string | null;
      asset_id: string | null;
      status: string | null;
      priority: string | null;
      assigned_to: string | null;
      created_at: string | null;
      profiles: { full_name?: string } | null;
      equipment_assets: { name?: string; asset_code?: string } | null;
    };

    return ((data ?? []) as Row[]).map((row) => {
      const action = workOrderAction(row.status, row.assigned_to, row.id);
      return {
        id: row.id,
        workOrderNumber: row.work_order_number ?? 'N/A',
        assetId: row.asset_id ?? '',
        assetName: row.equipment_assets?.name ?? 'Unknown',
        assetCode: row.equipment_assets?.asset_code ?? 'N/A',
        status: row.status ?? 'open',
        priority: row.priority,
        assignedToName: row.profiles?.full_name ?? null,
        assignedToId: row.assigned_to,
        daysOpen: daysSince(row.created_at),
        primaryAction: action.label,
        primaryActionHref: action.href,
        detailHref: workOrderDetail(row.id),
      };
    });
  } catch (error) {
    warnCommandData('fetchWorkQueue failed', error);
    return [];
  }
}

export async function fetchCalibrationTriage(
  supabase: SupabaseClient,
  options: { limit?: number | null } = {},
): Promise<{ rows: CalibrationTriageItem[]; total: number }> {
  try {
    const in30d = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const { data, error } = await supabase
      .from('v_calibration_due')
      .select('id, asset_id, asset_name, asset_code, next_due_date, calibration_date, department_name')
      .lte('next_due_date', in30d)
      .limit(200);

    if (error) return { rows: [], total: 0 };

    const rows = ((data ?? []) as Array<Record<string, unknown>>).map((row) => {
      const nextDueDate = (row.next_due_date as string | null) ?? null;
      const overdueDays = nextDueDate ? daysSince(nextDueDate) : 0;
      const score = 50 + Math.min(50, overdueDays * 0.5);

      return {
        id: row.id as string,
        assetId: (row.asset_id as string | undefined) ?? '',
        assetName: (row.asset_name as string | undefined) ?? 'Unknown',
        assetCode: (row.asset_code as string | undefined) ?? 'N/A',
        departmentName: (row.department_name as string | undefined) ?? 'Unknown',
        nextDueDate,
        daysOverdue: overdueDays,
        lastResult: null,
        score,
        reason: buildCalibrationReason({ daysOverdue: overdueDays }),
        detailHref: row.asset_id ? equipmentDetail(row.asset_id as string) : calibrationDetail(row.id as string),
        scheduleHref: calibrationDetail(row.id as string, 'schedule'),
        recordHref: calibrationDetail(row.id as string, 'record-result'),
      };
    });

    const sorted = rows.sort((a, b) => b.score - a.score);
    return { rows: options.limit === null ? sorted : sorted.slice(0, options.limit ?? 10), total: sorted.length };
  } catch (error) {
    warnCommandData('fetchCalibrationTriage failed', error);
    return { rows: [], total: 0 };
  }
}

export async function fetchPMTriage(
  supabase: SupabaseClient,
  options: { limit?: number | null } = {},
): Promise<{ rows: PMTriageItem[]; total: number }> {
  try {
    const { data, error } = await supabase
      .from('v_overdue_pm')
      .select('id, asset_id, asset_name, asset_code, scheduled_date, department_name')
      .limit(200);

    if (error) return { rows: [], total: 0 };

    const rows = ((data ?? []) as Array<Record<string, unknown>>).map((row) => {
      const scheduledDate = (row.scheduled_date as string | undefined) ?? '';
      const daysOverdue = scheduledDate ? daysSince(scheduledDate) : 0;
      const score = 50 + Math.min(50, daysOverdue * 0.3);

      return {
        id: row.id as string,
        assetId: (row.asset_id as string | undefined) ?? '',
        assetName: (row.asset_name as string | undefined) ?? 'Unknown',
        assetCode: (row.asset_code as string | undefined) ?? 'N/A',
        departmentName: (row.department_name as string | undefined) ?? 'Unknown',
        scheduledDate,
        daysOverdue,
        score,
        reason: buildPMReason({ daysOverdue, pmcPercentage: null }),
        detailHref: pmDetail(row.id as string),
        assignHref: pmDetail(row.id as string, 'assign'),
        checklistHref: pmDetail(row.id as string, 'checklist'),
      };
    });

    const sorted = rows.sort((a, b) => b.score - a.score);
    return { rows: options.limit === null ? sorted : sorted.slice(0, options.limit ?? 10), total: sorted.length };
  } catch (error) {
    warnCommandData('fetchPMTriage failed', error);
    return { rows: [], total: 0 };
  }
}

export async function fetchStockBlockers(
  supabase: SupabaseClient,
  options: { limit?: number | null } = {},
): Promise<{ rows: StockBlockerItem[]; total: number }> {
  try {
    const [{ data, error }, woPartsRes] = await Promise.all([
      supabase
      .from('spare_parts')
      .select('id, part_code, name, current_stock, reorder_level')
      .not('current_stock', 'is', null)
      .not('reorder_level', 'is', null)
      .gt('reorder_level', 0)
        .limit(500),
      supabase
        .from('maintenance_parts_used')
        .select('spare_part_id, maintenance_events(work_order_id, asset_id, work_orders(id, status))')
        .limit(500),
    ]);

    if (error) return { rows: [], total: 0 };

    const allRows = ((data ?? []) as Array<Record<string, unknown>>).filter((row) => {
      const current = Number(row.current_stock ?? 0);
      const reorder = Number(row.reorder_level ?? 0);
      return current <= reorder;
    });

    const linkedOpenWorkByPart = new Map<string, { workOrderId: string | null; assetId: string | null }>();
    for (const row of (woPartsRes.data ?? []) as Array<Record<string, unknown>>) {
      const partId = row.spare_part_id as string | null;
      if (!partId || linkedOpenWorkByPart.has(partId)) continue;
      const event = row.maintenance_events as { work_order_id?: string | null; asset_id?: string | null; work_orders?: { id?: string; status?: string } | Array<{ id?: string; status?: string }> | null } | null;
      const workOrder = Array.isArray(event?.work_orders) ? event?.work_orders[0] : event?.work_orders;
      if (workOrder?.status && ['open', 'assigned', 'in_progress', 'on_hold'].includes(workOrder.status)) {
        linkedOpenWorkByPart.set(partId, { workOrderId: workOrder.id ?? event?.work_order_id ?? null, assetId: event?.asset_id ?? null });
      }
    }

    const rows: StockBlockerItem[] = allRows.map((row) => {
      const currentStock = Number(row.current_stock ?? 0);
      const reorderLevel = Number(row.reorder_level ?? 0);
      const linked = linkedOpenWorkByPart.get(row.id as string);
      const blockerType: StockBlockerItem['blockerType'] = linked
        ? 'maintenance_blocker'
        : currentStock <= 0
          ? 'stockout'
          : 'low_stock_risk';
      const suggestedQuantity = Math.max(1, reorderLevel - currentStock);
      const score =
        linked
          ? 100
          : currentStock === 0
            ? 90
            : 60 + ((reorderLevel - currentStock) / reorderLevel) * 30;
      const reason = linked
        ? buildStockBlockerReason({ currentStock, reorderLevel }) + ' Confirmed maintenance blocker for open work.'
        : currentStock <= 0
          ? 'Stockout. No linked open work order found, so this is a stockout risk rather than a confirmed repair blocker.'
          : 'Low stock risk. No linked open work order found.';

      return {
        id: row.id as string,
        partName: (row.name as string | undefined) ?? 'Unknown Part',
        partCode: (row.part_code as string | undefined) ?? 'N/A',
        currentStock,
        reorderLevel,
        blockerType,
        suggestedQuantity,
        linkedWorkOrderId: linked?.workOrderId ?? null,
        linkedAssetId: linked?.assetId ?? null,
        procurementHref: stockProcurementPrefill(row.id as string, {
          partName: (row.name as string | undefined) ?? 'Unknown Part',
          currentStock,
          reorderLevel,
          suggestedQuantity,
          reason,
          workOrderId: linked?.workOrderId ?? null,
          assetId: linked?.assetId ?? null,
        }),
        issueStockHref: linked?.workOrderId && currentStock > 0
          ? stockIssuePrefill(row.id as string, { workOrderId: linked.workOrderId, assetId: linked.assetId ?? null })
          : null,
        detailHref: `/spare-parts?partId=${row.id as string}`,
        score,
        reason,
      };
    });

    const sorted = rows.sort((a, b) => b.score - a.score);
    return { rows: options.limit === null ? sorted : sorted.slice(0, options.limit ?? 10), total: sorted.length };
  } catch (error) {
    warnCommandData('fetchStockBlockers failed', error);
    return { rows: [], total: 0 };
  }
}

export async function fetchInstallationTriage(supabase: SupabaseClient): Promise<{ rows: InstallationTriageItem[]; total: number }> {
  try {
    const { data, error } = await supabase
      .from('installation_records')
      .select('id, asset_id, installation_date, commissioning_date, equipment_assets(name, asset_code, departments(name))')
      .is('commissioning_date', null)
      .limit(200);

    if (error) {
      if (
        typeof error === 'object' &&
        error !== null &&
        'message' in error &&
        typeof (error as { message: string }).message === 'string' &&
        (error as { message: string }).message.includes('does not exist')
      ) {
        return { rows: [], total: 0 };
      }
      return { rows: [], total: 0 };
    }

    const rows: InstallationTriageItem[] = ((data ?? []) as Array<Record<string, unknown>>).map((row) => {
      const installDate = (row.installation_date as string | undefined) ?? null;
      const daysPending = installDate ? daysSince(installDate) : 0;
      const status = row.commissioning_date ? 'commissioned' : 'pending_commissioning';
      const score = 40 + Math.min(40, daysPending * 0.5);

      const asset = row.equipment_assets as { name?: string; asset_code?: string; departments?: { name?: string } | null } | null;
      const dept = Array.isArray(asset?.departments)
        ? (asset?.departments as Array<{ name?: string }>)[0]?.name
        : asset?.departments?.name;

      return {
        id: row.id as string,
        assetId: (row.asset_id as string | undefined) ?? '',
        assetName: asset?.name ?? 'Unknown',
        assetCode: asset?.asset_code ?? 'N/A',
        departmentName: dept ?? 'Unknown',
        status,
        daysPending,
        score,
        reason: buildInstallationReason({ daysPending, status, departmentName: dept ?? null }),
        detailHref: installationDetail(row.id as string),
        scheduleHref: installationDetail(row.id as string, 'schedule'),
        commissionHref: installationDetail(row.id as string, 'commission'),
        assetHref: row.asset_id ? equipmentDetail(row.asset_id as string) : installationDetail(row.id as string),
      };
    });

    const sorted = rows.sort((a, b) => b.score - a.score);
    return { rows: sorted.slice(0, 10), total: sorted.length };
  } catch (error) {
    warnCommandData('fetchInstallationTriage failed', error);
    return { rows: [], total: 0 };
  }
}

export async function fetchProcurementTriage(supabase: SupabaseClient): Promise<{ rows: ProcurementTriageItem[]; total: number }> {
  try {
    const { data, error } = await supabase
      .from('procurement_requests')
      .select('id, request_number, title, justification, status, priority, created_at')
      .not('status', 'in', '("delivered","canceled")')
      .limit(200);

    if (error) {
      if (
        typeof error === 'object' &&
        error !== null &&
        'message' in error &&
        typeof (error as { message: string }).message === 'string' &&
        (error as { message: string }).message.includes('does not exist')
      ) {
        return { rows: [], total: 0 };
      }
      return { rows: [], total: 0 };
    }

    const rows: ProcurementTriageItem[] = ((data ?? []) as Array<Record<string, unknown>>).map((row) => {
      const createdAt = (row.created_at as string | null) ?? null;
      const daysDelayed = daysSince(createdAt);
      const score = 45 + Math.min(45, daysDelayed * 0.5);

      return {
        id: row.id as string,
        requestNumber: (row.request_number as string | undefined) ?? 'N/A',
        description: (row.title as string | undefined) ?? (row.justification as string | undefined) ?? 'No description',
        status: (row.status as string | undefined) ?? 'unknown',
        priority: (row.priority as string | null) ?? null,
        daysDelayed,
        score,
        reason: buildProcurementReason({ status: row.status as string | null, daysDelayed }),
        detailHref: procurementDetail(row.id as string),
        updateHref: procurementDetail(row.id as string, 'status'),
        escalateHref: procurementDetail(row.id as string, 'escalate'),
      };
    });

    const sorted = rows.sort((a, b) => b.score - a.score);
    return { rows: sorted.slice(0, 10), total: sorted.length };
  } catch (error) {
    warnCommandData('fetchProcurementTriage failed', error);
    return { rows: [], total: 0 };
  }
}

export async function fetchTrainingTriage(supabase: SupabaseClient): Promise<{ rows: TrainingTriageItem[]; total: number }> {
  try {
    const { data, error } = await supabase
      .from('training_requests')
      .select('id, asset_id, status, created_at, notes, equipment_assets(name, departments(name))')
      .in('status', ['pending', 'approved'])
      .limit(200);

    if (error) return { rows: [], total: 0 };

    const rows: TrainingTriageItem[] = ((data ?? []) as Array<Record<string, unknown>>).map((row) => {
      const createdAt = (row.created_at as string | undefined) ?? null;
      const daysPending = createdAt ? daysSince(createdAt) : 0;

      const asset = row.equipment_assets as { name?: string; departments?: { name?: string } | null } | null;
      const dept = Array.isArray(asset?.departments)
        ? (asset?.departments as Array<{ name?: string }>)[0]?.name
        : asset?.departments?.name;

      const assetName = asset?.name ?? 'General Training';
      const departmentName = dept ?? 'Unknown';

      const score = 35 + Math.min(35, daysPending * 0.3);

      return {
        id: row.id as string,
        assetId: (row.asset_id as string | null) ?? null,
        assetName,
        departmentName,
        status: (row.status as string | undefined) ?? 'pending',
        daysPending,
        score,
        reason: buildTrainingReason({ daysPending, departmentName }),
      };
    });

    const sorted = rows.sort((a, b) => b.score - a.score);
    return { rows: sorted.slice(0, 10), total: sorted.length };
  } catch (error) {
    warnCommandData('fetchTrainingTriage failed', error);
    return { rows: [], total: 0 };
  }
}

export async function fetchTechnicianWorkload(supabase: SupabaseClient): Promise<TechnicianWorkloadItem[]> {
  try {
    const [techniciansRes, woRes] = await Promise.all([
      supabase
        .from('profiles')
        .select('id, full_name, email, departments(name), user_roles!inner(roles!inner(name))')
        .eq('is_active', true)
        .eq('user_roles.roles.name', 'technician')
        .order('full_name', { ascending: true })
        .limit(500),
      supabase
        .from('work_orders')
        .select('id, status, priority, estimated_hours, assigned_to, profiles(full_name)')
        .in('status', ['open', 'assigned', 'in_progress', 'on_hold'])
        .not('assigned_to', 'is', null)
        .limit(500),
    ]);

    type WORow = {
      id: string;
      status: string;
      priority: string | null;
      estimated_hours: number | null;
      assigned_to: string;
      profiles: { full_name?: string } | null;
    };

    type TechnicianRow = {
      id: string;
      full_name: string | null;
      email: string | null;
      departments: { name?: string } | Array<{ name?: string }> | null;
    };

    const woRows = (woRes.data ?? []) as WORow[];

    const workloadMap = new Map<string, {
      name: string;
      email: string | null;
      departmentName: string | null;
      openAssignments: number;
      inProgress: number;
      overdueTasks: number;
      criticalTasks: number;
      estimatedHours: number;
    }>();

    if (!techniciansRes.error) {
      for (const tech of (techniciansRes.data ?? []) as TechnicianRow[]) {
        const dept = Array.isArray(tech.departments)
          ? tech.departments[0]?.name ?? null
          : tech.departments?.name ?? null;
        workloadMap.set(tech.id, {
          name: tech.full_name ?? 'Unnamed Technician',
          email: tech.email,
          departmentName: dept,
          openAssignments: 0,
          inProgress: 0,
          overdueTasks: 0,
          criticalTasks: 0,
          estimatedHours: 0,
        });
      }
    }

    for (const wo of woRows) {
      const profileId = wo.assigned_to;
      const name = wo.profiles?.full_name ?? 'Unknown Technician';

      if (!workloadMap.has(profileId)) {
        workloadMap.set(profileId, {
          name,
          email: null,
          departmentName: null,
          openAssignments: 0,
          inProgress: 0,
          overdueTasks: 0,
          criticalTasks: 0,
          estimatedHours: 0,
        });
      }

      const entry = workloadMap.get(profileId)!;
      entry.openAssignments++;

      if (wo.status === 'in_progress') entry.inProgress++;
      if (wo.priority === 'high' || wo.priority === 'critical') entry.overdueTasks++;
      if (wo.priority === 'critical') entry.criticalTasks++;
      if (wo.estimated_hours) entry.estimatedHours += wo.estimated_hours;
    }

    const items: TechnicianWorkloadItem[] = Array.from(workloadMap.entries()).map(([profileId, data]) => {
      let status: 'available' | 'busy' | 'overloaded';
      if (data.openAssignments >= 6 || data.criticalTasks > 0) {
        status = 'overloaded';
      } else if (data.openAssignments >= 3) {
        status = 'busy';
      } else {
        status = 'available';
      }

      return {
        profileId,
        name: data.name,
        email: data.email,
        departmentName: data.departmentName,
        openAssignments: data.openAssignments,
        inProgress: data.inProgress,
        overdueTasks: data.overdueTasks,
        criticalTasks: data.criticalTasks,
        estimatedHours: data.estimatedHours,
        status,
      };
    });

    return items.sort((a, b) => b.openAssignments - a.openAssignments);
  } catch (error) {
    warnCommandData('fetchTechnicianWorkload failed', error);
    return [];
  }
}

export function buildCriticalActions(params: {
  corrective: CorrectiveMaintenanceItem[];
  needsRequest: NeedsRequestItem[];
  proactiveRisk: ProactiveRiskItem[];
  calibration: CalibrationTriageItem[];
  pm: PMTriageItem[];
  stockBlockers: StockBlockerItem[];
  installation: InstallationTriageItem[];
  replacement: ReplacementTriageRow[];
  procurement: ProcurementTriageItem[];
  training: TrainingTriageItem[];
}): CriticalActionItem[] {
  const {
    corrective,
    needsRequest,
    proactiveRisk,
    calibration,
    pm,
    stockBlockers,
    installation,
    replacement,
    procurement,
    training,
  } = params;

  const CATEGORY_WEIGHTS = {
    corrective: 100,
    needs_request: 90,
    calibration: 85,
    pm: 75,
    stock: 70,
    risk_watch: 65,
    installation: 60,
    replacement: 55,
    procurement: 45,
    training: 35,
  };

  const actions: CriticalActionItem[] = [];
  const urgencyFor = (score: number): CriticalActionItem['urgency'] =>
    score >= 180 ? 'critical' : score >= 150 ? 'high' : score >= 100 ? 'medium' : 'low';

  for (const item of corrective.slice(0, 3)) {
    const score = CATEGORY_WEIGHTS.corrective + item.score;
    actions.push({
      id: `corrective-${item.id}`,
      title: item.assetName,
      assetName: item.assetName,
      assetId: item.assetId,
      departmentName: item.departmentName,
      category: 'corrective',
      score,
      reason: buildCorrectiveReason({ urgency: item.urgency, departmentName: item.departmentName }),
      scoreBreakdown: [`Base ${CATEGORY_WEIGHTS.corrective}`, `Item priority ${Math.round(item.score)}`, `Urgency ${item.urgency}`, `${item.daysOpen} days open`],
      primaryAction: item.primaryActionLabel,
      primaryActionHref: item.primaryActionHref,
      secondaryAction: item.secondaryActionLabel,
      secondaryActionHref: item.secondaryActionHref,
      urgency: urgencyFor(score),
    });
  }

  for (const item of needsRequest.slice(0, 3)) {
    const score = CATEGORY_WEIGHTS.needs_request + item.score;
    actions.push({
      id: `needs-request-${item.assetId}`,
      title: item.assetName,
      assetName: item.assetName,
      assetId: item.assetId,
      departmentName: item.departmentName,
      category: 'needs_request',
      score,
      reason: item.reason,
      scoreBreakdown: [`Base ${CATEGORY_WEIGHTS.needs_request}`, `Condition ${item.condition.replace(/_/g, ' ')}`, `Department criticality ${item.departmentCriticality ?? 'not set'}`, item.rpn != null ? `RPN ${item.rpn}` : 'No RPN available'],
      primaryAction: 'Create Request',
      primaryActionHref: item.createRequestHref,
      secondaryAction: 'View Risk',
      secondaryActionHref: equipmentDetail(item.assetId),
      urgency: urgencyFor(score),
    });
  }

  for (const item of calibration.slice(0, 2)) {
    const score = CATEGORY_WEIGHTS.calibration + item.score;
    actions.push({
      id: `calibration-${item.id}`,
      title: item.assetName,
      assetName: item.assetName,
      assetId: item.assetId,
      departmentName: item.departmentName,
      category: 'calibration',
      score,
      reason: item.reason,
      scoreBreakdown: [`Base ${CATEGORY_WEIGHTS.calibration}`, `Calibration priority ${Math.round(item.score)}`, `${item.daysOverdue} days overdue`],
      primaryAction: 'Schedule Calibration',
      primaryActionHref: item.scheduleHref,
      secondaryAction: 'Record Result',
      secondaryActionHref: item.recordHref,
      urgency: urgencyFor(score),
    });
  }

  for (const item of pm.slice(0, 2)) {
    const score = CATEGORY_WEIGHTS.pm + item.score;
    actions.push({
      id: `pm-${item.id}`,
      title: item.assetName,
      assetName: item.assetName,
      assetId: item.assetId,
      departmentName: item.departmentName,
      category: 'pm',
      score,
      reason: item.reason,
      scoreBreakdown: [`Base ${CATEGORY_WEIGHTS.pm}`, `PM priority ${Math.round(item.score)}`, `${item.daysOverdue} days overdue`],
      primaryAction: 'Schedule PM',
      primaryActionHref: item.detailHref,
      secondaryAction: 'Assign PM',
      secondaryActionHref: item.assignHref,
      urgency: urgencyFor(score),
    });
  }

  for (const item of stockBlockers.slice(0, 2)) {
    const score = CATEGORY_WEIGHTS.stock + item.score;
    actions.push({
      id: `stock-${item.id}`,
      title: item.partName,
      category: 'stock',
      score,
      reason: item.reason,
      scoreBreakdown: [`Base ${CATEGORY_WEIGHTS.stock}`, `Stock score ${Math.round(item.score)}`, `Current ${item.currentStock}`, `Reorder ${item.reorderLevel}`],
      primaryAction: 'Request Procurement',
      primaryActionHref: item.procurementHref,
      secondaryAction: item.issueStockHref ? 'Issue Stock' : 'Details',
      secondaryActionHref: item.issueStockHref ?? item.detailHref,
      urgency: urgencyFor(score),
    });
  }

  for (const item of proactiveRisk.slice(0, 2)) {
    const score = CATEGORY_WEIGHTS.risk_watch + item.score;
    actions.push({
      id: `risk-watch-${item.assetId}`,
      title: item.assetName,
      assetName: item.assetName,
      assetId: item.assetId,
      departmentName: item.departmentName,
      category: 'risk_watch',
      score,
      reason: item.reason,
      scoreBreakdown: [`Base ${CATEGORY_WEIGHTS.risk_watch}`, `Risk signal score ${Math.round(item.score)}`, item.rpn != null ? `RPN ${item.rpn}` : 'No RPN available', item.flags.length ? `Flags ${item.flags.join(', ')}` : 'No active flag'],
      primaryAction: 'Review Risk',
      primaryActionHref: equipmentDetail(item.assetId),
      secondaryAction: undefined,
      secondaryActionHref: undefined,
      urgency: urgencyFor(score),
    });
  }

  for (const item of installation.slice(0, 1)) {
    const score = CATEGORY_WEIGHTS.installation + item.score;
    actions.push({
      id: `installation-${item.id}`,
      title: item.assetName,
      assetName: item.assetName,
      assetId: item.assetId,
      departmentName: item.departmentName,
      category: 'installation',
      score,
      reason: item.reason,
      scoreBreakdown: [`Base ${CATEGORY_WEIGHTS.installation}`, `Installation score ${Math.round(item.score)}`, `${item.daysPending} days pending`],
      primaryAction: 'Schedule Installation',
      primaryActionHref: item.scheduleHref,
      secondaryAction: 'View Asset',
      secondaryActionHref: item.assetHref,
      urgency: urgencyFor(score),
    });
  }

  for (const item of replacement.slice(0, 2)) {
    const rpiScore = item.priority_index <= 1 ? item.priority_index * 100 : item.priority_index;
    const score = CATEGORY_WEIGHTS.replacement + rpiScore;
    actions.push({
      id: `replacement-${item.asset_id}`,
      title: item.asset_name,
      assetName: item.asset_name,
      assetId: item.asset_id,
      departmentName: item.department_name,
      category: 'replacement',
      score,
      reason: buildLifecycleReason({
        rank: item.rank,
        priorityIndex: item.priority_index,
        ageScore: item.age_score,
        failureScore: item.failure_score,
        availabilityScore: item.availability_score,
        maintenanceBurdenScore: item.maintenance_burden_score,
        sparePartScore: item.spare_part_score,
        riskScore: item.risk_score,
      }),
      scoreBreakdown: [`Base ${CATEGORY_WEIGHTS.replacement}`, `RPI ${Math.round(rpiScore)}/100`, `Rank ${item.rank}`],
      primaryAction: 'View Evidence',
      primaryActionHref: replacementEvidence(item.asset_id),
      secondaryAction: 'Add to Report',
      secondaryActionHref: replacementReportPrefill(item.asset_id, { reason: item.reason, rank: item.rank, rpi: rpiScore }),
      urgency: urgencyFor(score),
    });
  }

  for (const item of procurement.slice(0, 1)) {
    const score = CATEGORY_WEIGHTS.procurement + item.score;
    actions.push({
      id: `procurement-${item.id}`,
      title: item.requestNumber,
      category: 'procurement',
      score,
      reason: item.reason,
      scoreBreakdown: [`Base ${CATEGORY_WEIGHTS.procurement}`, `Procurement score ${Math.round(item.score)}`, `${item.daysDelayed} days delayed`],
      primaryAction: 'Update Status',
      primaryActionHref: item.updateHref,
      secondaryAction: 'View Request',
      secondaryActionHref: item.detailHref,
      urgency: urgencyFor(score),
    });
  }

  for (const item of training.slice(0, 1)) {
    const score = CATEGORY_WEIGHTS.training + item.score;
    actions.push({
      id: `training-${item.id}`,
      title: item.assetName,
      assetId: item.assetId ?? undefined,
      assetName: item.assetName,
      departmentName: item.departmentName,
      category: 'training',
      score,
      reason: item.reason,
      scoreBreakdown: [`Base ${CATEGORY_WEIGHTS.training}`, `Training score ${Math.round(item.score)}`, `${item.daysPending} days pending`],
      primaryAction: 'Schedule Training',
      primaryActionHref: '/training',
      secondaryAction: 'View Request',
      secondaryActionHref: '/training',
      urgency: urgencyFor(score),
    });
  }

  return actions.sort((a, b) => b.score - a.score).slice(0, 6);
}
