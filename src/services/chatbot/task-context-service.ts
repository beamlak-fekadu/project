import type { SupabaseClient } from '@supabase/supabase-js';
import type {
  CapabilityId,
  ChatContextRefs,
  ChatEvidence,
  ChatModuleContext,
  ClassifiedRequest,
  TaskContextBundle,
  UserChatProfile,
} from '@/types/chatbot';
import { buildChatEvidence } from './context-service';
import { planToolRetrieval, type CopilotToolName } from './tool-plan';
import { buildAlertSynthesis, buildCrossModuleSnapshot, buildProactiveSignals } from './proactive-signals';
import { buildTier1TroubleshootingBundle } from './troubleshooting-context';
import {
  getCurrentUserContext,
  getMyTasks,
  getEquipmentSummary,
  getWorkOrderSummary,
  getDepartmentReadiness,
  getAlertsSummary,
  getInventoryLogisticsStatus,
  getProcurementStatus,
  getSafeTroubleshootingContext,
  loadTaskBlocks,
  loadRiskAndAnalytics,
  loadLogistics,
  loadDecisionSupportSnapshot,
} from './tools';

export interface TaskContextParams {
  supabase: SupabaseClient;
  capability: CapabilityId;
  profile: UserChatProfile;
  contextRefs?: ChatContextRefs;
  message: string;
  moduleContext?: ChatModuleContext;
  classified: ClassifiedRequest;
}

function buildPriorityReasoning(blocks: {
  assignedWorkOrders: Record<string, unknown>[];
  overduePm: Record<string, unknown>[];
  recommendationFlags: Record<string, unknown>[];
  decisionSupportQueue: Record<string, unknown>[];
}) {
  const reasons: string[] = [];
  const highPriorityOrders = blocks.assignedWorkOrders.filter((item) =>
    ['high', 'critical'].includes(String(item.priority ?? ''))
  );
  if (highPriorityOrders.length > 0) reasons.push(`${highPriorityOrders.length} high-priority work orders need action.`);
  const overdueHeavy = blocks.overduePm.filter((item) => Number(item.days_overdue ?? 0) >= 7);
  if (overdueHeavy.length > 0) reasons.push(`${overdueHeavy.length} PM tasks are overdue by at least one week.`);
  const criticalFlags = blocks.recommendationFlags.filter((item) => ['high', 'critical'].includes(String(item.severity ?? '')));
  if (criticalFlags.length > 0) reasons.push(`${criticalFlags.length} high-severity recommendation flags are still open.`);
  if (blocks.decisionSupportQueue.length > 0) reasons.push('Decision-support queue indicates triage pressure on key assets.');
  return reasons;
}

function priorityWeight(priority: string) {
  if (priority === 'critical') return 4;
  if (priority === 'high') return 3;
  if (priority === 'medium') return 2;
  return 1;
}

function buildRankedOperationalQueue(shared: Record<string, unknown>, riskAnalytics: Record<string, unknown>) {
  type Ranked = {
    score: number;
    label: string;
    kind: 'work_order' | 'overdue_pm' | 'flag' | 'triage';
    record: Record<string, unknown>;
  };
  const ranked: Ranked[] = [];

  const workOrders = (shared.assignedWorkOrders as Record<string, unknown>[]) ?? [];
  for (const wo of workOrders) {
    const pr = priorityWeight(String(wo.priority ?? 'medium'));
    const status = String(wo.status ?? '');
    const holdPenalty = status === 'on_hold' ? 0.5 : 0;
    ranked.push({
      score: pr * 25 + (status === 'in_progress' ? 6 : 0) - holdPenalty,
      label: `WO ${String(wo.work_order_number ?? wo.id)} (${String(wo.priority ?? 'medium')} / ${status})`,
      kind: 'work_order',
      record: wo,
    });
  }

  const overduePm = (shared.overduePm as Record<string, unknown>[]) ?? [];
  for (const pm of overduePm) {
    const days = Number(pm.days_overdue ?? 0);
    ranked.push({
      score: 60 + Math.min(days, 60),
      label: `Overdue PM: ${String(pm.plan_name ?? 'plan')} on ${String(pm.asset_code ?? pm.asset_name ?? 'asset')} (+${days}d)`,
      kind: 'overdue_pm',
      record: pm,
    });
  }

  const flags = (riskAnalytics.recommendationFlags as Record<string, unknown>[]) ?? [];
  for (const flag of flags.slice(0, 8)) {
    const sev = String(flag.severity ?? '');
    const sevScore = sev === 'critical' ? 5 : sev === 'high' ? 4 : 2;
    ranked.push({
      score: 40 + sevScore * 4,
      label: `Flag ${String(flag.flag_type ?? 'signal')} (${sev})`,
      kind: 'flag',
      record: flag,
    });
  }

  const triage = (riskAnalytics.decisionSupportQueue as Record<string, unknown>[]) ?? [];
  for (const row of triage.slice(0, 6)) {
    ranked.push({
      score: 35 + Number(row.priority_score ?? 0),
      label: `Triage queue: ${String(row.recommendation ?? 'action')}`,
      kind: 'triage',
      record: row,
    });
  }

  ranked.sort((a, b) => b.score - a.score);
  return ranked.slice(0, 15).map((item, index) => ({
    rank: index + 1,
    score: Math.round(item.score * 10) / 10,
    label: item.label,
    id: item.record.id,
    type: item.kind,
  }));
}

function resolveContextAssetId(contextRefs: ChatContextRefs | undefined, evidence: ChatEvidence): string | undefined {
  if (contextRefs?.equipmentId) return contextRefs.equipmentId;
  const wo = evidence.workOrder as { asset_id?: string; equipment_assets?: { id?: string } | null } | null;
  if (wo?.asset_id) return wo.asset_id as string;
  const nested = wo?.equipment_assets;
  if (nested && typeof nested === 'object' && 'id' in nested) {
    return nested.id as string;
  }
  return undefined;
}

function sliceRiskForAsset(assetId: string, riskAnalytics: Record<string, unknown>) {
  const match = (rows: Record<string, unknown>[]) => rows.filter((row) => String(row.asset_id ?? '') === assetId);
  return {
    riskScores: match((riskAnalytics.riskScores as Record<string, unknown>[]) ?? []).slice(0, 3),
    reliabilityMetrics: match((riskAnalytics.reliabilityMetrics as Record<string, unknown>[]) ?? []).slice(0, 3),
    replacementPriority: match((riskAnalytics.replacementPriority as Record<string, unknown>[]) ?? []).slice(0, 3),
  };
}

function selectCapabilityBlocks(
  capability: CapabilityId,
  shared: Record<string, unknown>,
  riskAnalytics: Record<string, unknown>,
  logistics: Record<string, unknown>,
  decisionSupport: Record<string, unknown>
) {
  switch (capability) {
    case 'assistant_intro':
      return { ...shared, ...riskAnalytics, introPreview: { openWos: (shared.assignedWorkOrders as unknown[]).length } };
    case 'my_tasks':
    case 'prioritize_tasks':
      return {
        ...shared,
        ...riskAnalytics,
        ...decisionSupport,
        priorityReasoning: buildPriorityReasoning({
          assignedWorkOrders: (shared.assignedWorkOrders as Record<string, unknown>[]) ?? [],
          overduePm: (shared.overduePm as Record<string, unknown>[]) ?? [],
          recommendationFlags: (riskAnalytics.recommendationFlags as Record<string, unknown>[]) ?? [],
          decisionSupportQueue: (riskAnalytics.decisionSupportQueue as Record<string, unknown>[]) ?? [],
        }),
        rankedOperationalQueue: buildRankedOperationalQueue(shared, riskAnalytics),
      };
    case 'summarize_work_order':
    case 'maintenance_guidance':
      return { ...shared, ...riskAnalytics };
    case 'summarize_equipment':
    case 'maintenance_tips':
      return { ...shared, ...riskAnalytics };
    case 'explain_replacement_priority':
      return {
        replacementPriority: riskAnalytics.replacementPriority,
        recommendationFlags: riskAnalytics.recommendationFlags,
        reliabilityMetrics: riskAnalytics.reliabilityMetrics,
      };
    case 'explain_equipment_risk':
    case 'decision_support_analysis':
    case 'summarize_department_readiness':
      return { ...riskAnalytics, ...shared, ...decisionSupport };
    case 'alerts_and_escalations':
      return {
        ...riskAnalytics,
        ...shared,
        ...decisionSupport,
        alertSynthesis: buildAlertSynthesis((riskAnalytics.recommendationFlags as Record<string, unknown>[]) ?? []),
      };
    case 'explain_pm_status':
      return { overduePm: shared.overduePm, pmSignals: riskAnalytics.reliabilityMetrics };
    case 'logistics_status':
    case 'procurement_status':
      return { ...shared, ...logistics };
    case 'pending_approvals':
    case 'approval_tasks':
      return { ...shared, ...logistics };
    case 'training_status':
      return { trainingRequests: shared.trainingRequests, workloadSnapshot: decisionSupport.workloadSnapshot };
    case 'disposal_status':
      return { disposalPipeline: shared.disposalPipeline, disposalApprovals: shared.disposalApprovals };
    default:
      return { ...shared, ...riskAnalytics, ...logistics, ...decisionSupport };
  }
}

async function collectToolResults(params: {
  supabase: SupabaseClient;
  plan: CopilotToolName[];
  profile: UserChatProfile;
  contextRefs?: ChatContextRefs;
  moduleContext?: ChatModuleContext;
  message: string;
  shared: Record<string, unknown>;
  riskAnalytics: Record<string, unknown>;
  evidence: ChatEvidence;
  openWorkOrderOnAsset: boolean;
}): Promise<Record<string, unknown>> {
  const { supabase, plan, profile, contextRefs, moduleContext, message, shared, riskAnalytics, evidence, openWorkOrderOnAsset } =
    params;
  const toolResults: Record<string, unknown> = {};

  for (const name of plan) {
    if (name === 'getCurrentUserContext') {
      toolResults[name] = getCurrentUserContext(profile, moduleContext);
    } else if (name === 'getMyTasks') {
      toolResults[name] = getMyTasks({
        assignedWorkOrders: (shared.assignedWorkOrders as Record<string, unknown>[]) ?? [],
        overduePm: (shared.overduePm as Record<string, unknown>[]) ?? [],
      });
    } else if (name === 'getEquipmentSummary') {
      toolResults[name] = await getEquipmentSummary(supabase, contextRefs, profile);
    } else if (name === 'getWorkOrderSummary') {
      toolResults[name] = await getWorkOrderSummary(supabase, contextRefs, profile);
    } else if (name === 'getDepartmentReadiness') {
      toolResults[name] = await getDepartmentReadiness(supabase, contextRefs, profile);
    } else if (name === 'getAlertsSummary') {
      toolResults[name] = getAlertsSummary({
        recommendationFlags: (riskAnalytics.recommendationFlags as Record<string, unknown>[]) ?? [],
      });
    } else if (name === 'getInventoryLogisticsStatus') {
      toolResults[name] = await getInventoryLogisticsStatus(supabase);
    } else if (name === 'getProcurementStatus') {
      toolResults[name] = await getProcurementStatus(supabase);
    } else if (name === 'getSafeTroubleshootingContext') {
      toolResults[name] = getSafeTroubleshootingContext(evidence, { openWorkOrderOnAsset, userMessage: message });
    }
  }
  return toolResults;
}

export async function buildTaskContext(params: TaskContextParams): Promise<TaskContextBundle> {
  const { supabase, capability, profile, contextRefs, message, moduleContext, classified } = params;

  const intentForEvidence =
    capability === 'assistant_intro'
      ? 'assistant_intro'
      : capability === 'logistics_status'
        ? 'calibration_or_logistics'
        : capability === 'procurement_status'
          ? 'calibration_or_logistics'
          : capability === 'safe_troubleshooting'
            ? 'troubleshooting'
            : capability === 'decision_support_analysis' ||
                capability === 'explain_equipment_risk' ||
                capability === 'alerts_and_escalations' ||
                capability === 'explain_replacement_priority' ||
                capability === 'summarize_department_readiness'
              ? 'analytics_explanation'
              : capability === 'summarize_work_order'
                ? 'work_order_help'
                : capability === 'summarize_equipment'
                  ? 'equipment_lookup'
                  : capability === 'training_status'
                    ? 'maintenance_tip'
                    : capability === 'disposal_status'
                      ? 'maintenance_tip'
                      : 'maintenance_tip';

  const evidence: ChatEvidence = await buildChatEvidence(supabase, contextRefs, profile, intentForEvidence);
  const [shared, riskAnalytics, logistics, decisionSupport] = await Promise.all([
    loadTaskBlocks(supabase, profile, capability),
    loadRiskAndAnalytics(supabase, contextRefs),
    loadLogistics(supabase),
    loadDecisionSupportSnapshot(supabase),
  ]);

  const selectedTools = planToolRetrieval(classified, message);
  const assetFocus = resolveContextAssetId(contextRefs, evidence);
  const wo = evidence.workOrder as { asset_id?: string; status?: string } | null;
  const woStatus = String(wo?.status ?? '');
  const openWoStatuses = ['open', 'assigned', 'in_progress', 'on_hold'];
  const openWorkOrderOnAsset = Boolean(
    assetFocus && wo?.asset_id && String(wo.asset_id) === assetFocus && openWoStatuses.includes(woStatus)
  );

  const toolResults = (await collectToolResults({
    supabase,
    plan: selectedTools,
    profile,
    contextRefs,
    moduleContext,
    message,
    shared,
    riskAnalytics,
    evidence,
    openWorkOrderOnAsset,
  })) as Record<string, unknown>;

  const toolTrace = { selectedTools, toolResults };
  let blocks: Record<string, unknown> = selectCapabilityBlocks(capability, shared, riskAnalytics, logistics, decisionSupport);
  if (assetFocus) {
    blocks = {
      ...blocks,
      focusedAssetAnalytics: sliceRiskForAsset(assetFocus, riskAnalytics),
    };
  }
  const proactiveSignals = buildProactiveSignals({ capability, shared, riskAnalytics });
  if (proactiveSignals.length) {
    blocks = { ...blocks, proactiveSignals };
  }
  blocks = {
    ...blocks,
    toolTrace,
    crossModuleSnapshot: buildCrossModuleSnapshot({
      workOrders: (shared.assignedWorkOrders as Record<string, unknown>[]) ?? [],
      flags: (riskAnalytics.recommendationFlags as Record<string, unknown>[]) ?? [],
      lowStockParts: logistics.lowStockParts as Record<string, unknown>[],
      procurementPipeline: logistics.procurementPipeline as Record<string, unknown>[],
    }),
  };

  if (capability === 'safe_troubleshooting') {
    const tier1 =
      (toolResults.getSafeTroubleshootingContext as ReturnType<typeof getSafeTroubleshootingContext> | undefined) ??
      buildTier1TroubleshootingBundle(evidence, { openWorkOrderOnAsset });
    blocks = { ...blocks, tier1Troubleshooting: tier1 };
  }

  return { capability, evidence, blocks };
}
