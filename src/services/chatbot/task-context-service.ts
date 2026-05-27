import type { SupabaseClient } from '@supabase/supabase-js';
import type {
  CapabilityId,
  ChatContextRefs,
  ChatEvidence,
  ChatModuleContext,
  ClassifiedRequest,
  TaskContextBundle,
  UserChatProfile,
  ChatIntent,
} from '@/types/chatbot';
import { buildChatEvidence, type ChatEvidenceLoadConfig } from './context-service';
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
import { executeCopilotTool } from './tools/tool-executor';
import type { CopilotToolName as FormalCopilotToolName, CopilotToolResult } from './tools/tool-types';

function planFormalTools(capability: CapabilityId, moduleContext?: ChatModuleContext, contextRefs?: ChatContextRefs): FormalCopilotToolName[] {
  const tools: FormalCopilotToolName[] = ['read_current_user_context', 'read_current_page_context'];
  if (capability === 'summarize_equipment' || capability === 'explain_equipment_risk' || moduleContext?.selectedRecordType === 'equipment') {
    tools.push('read_equipment_status');
    if (contextRefs?.equipmentId) tools.push('read_equipment_history');
  }
  if (capability === 'summarize_work_order' || moduleContext?.selectedRecordType === 'work_order') {
    tools.push('read_work_order_status');
  }
  if (capability === 'prioritize_tasks') tools.push('read_command_center_snapshot', 'read_alerts_summary', 'read_pm_compliance', 'read_calibration_status');
  if (capability === 'summarize_department_readiness') tools.push('read_department_readiness');
  if (capability === 'explain_equipment_risk') tools.push('read_replacement_risk', 'read_alerts_summary');
  if (capability === 'explain_pm_status') tools.push('read_pm_compliance', 'read_calibration_status');
  if (capability === 'summarize_alerts') tools.push('read_alerts_summary');
  if (moduleContext?.moduleLabel === 'Calibration' || capability === 'explain_pm_status') tools.push('read_calibration_status');
  if (capability === 'logistics_status') tools.push('read_stock_blockers');
  if (capability === 'procurement_status') tools.push('read_procurement_pipeline');
  if (capability === 'training_status') tools.push('read_training_status');
  if (capability === 'disposal_status') tools.push('read_disposal_status');
  if (capability === 'qr_asset_context' || moduleContext?.qrToken || moduleContext?.moduleLabel === 'QR Field Scan') {
    tools.push('read_qr_asset_context', 'read_qr_scan_evidence');
  }
  if (capability === 'offline_sync_status' || moduleContext?.queueStatus || moduleContext?.moduleLabel === 'Offline Sync') {
    tools.push('read_offline_sync_summary');
  }
  if (capability === 'report_summary' || moduleContext?.reportType) tools.push('read_report_snapshot');
  if (capability === 'copilot_diagnostics') {
    tools.push('read_tool_trace', 'read_routing_trace', 'read_provider_trace', 'read_parser_failures');
  }
  if (capability === 'usage_status' || capability === 'copilot_diagnostics') tools.push('read_gemini_usage_summary');
  return Array.from(new Set(tools));
}

function summarizeToolResults(results: CopilotToolResult[]) {
  return {
    evidenceUsed: Array.from(new Set(results.flatMap((result) => result.evidenceSignals))).slice(0, 12),
    sourceTables: Array.from(new Set(results.flatMap((result) => result.sourceTables))).slice(0, 12),
    routeLinks: results.flatMap((result) => result.routeLinks).slice(0, 10),
    warnings: Array.from(new Set(results.flatMap((result) => [...result.warnings, result.deniedReason ?? '', result.staleDataWarning ?? ''].filter(Boolean)))).slice(0, 8),
  };
}

export interface TaskContextParams {
  supabase: SupabaseClient;
  capability: CapabilityId;
  profile: UserChatProfile;
  contextRefs?: ChatContextRefs;
  message: string;
  moduleContext?: ChatModuleContext;
  classified: ClassifiedRequest;
}

const CAPABILITY_EVIDENCE_CONFIG: Record<CapabilityId, ChatEvidenceLoadConfig> = {
  assistant_intro: {},
  general_conversation: {},
  off_topic_safe: {},
  my_tasks: { loadLogistics: true, loadAnalytics: true, expected: [] },
  prioritize_tasks: { loadLogistics: true, loadAnalytics: true, expected: [] },
  summarize_work_order: { loadLogistics: true, loadAnalytics: false, expected: ['workOrder'] },
  summarize_equipment: {
    loadLogistics: false,
    loadAnalytics: true,
    expected: ['equipment'],
    optional: ['maintenanceHistory', 'openWorkOrders', 'maintenanceRequests', 'pmSnapshot', 'calibrationStatus', 'analyticsSnapshot'],
  },
  explain_equipment_risk: { loadLogistics: false, loadAnalytics: true, expected: ['analyticsSnapshot'] },
  explain_pm_status: { loadLogistics: false, loadAnalytics: true, expected: ['pmSnapshot', 'calibrationStatus', 'analyticsSnapshot'] },
  summarize_alerts: { loadLogistics: false, loadAnalytics: true, expected: ['analyticsSnapshot'] },
  safe_troubleshooting: {
    loadLogistics: false,
    loadAnalytics: true,
    expected: [],
    optional: ['equipment', 'maintenanceHistory', 'openWorkOrders', 'maintenanceRequests', 'pmSnapshot', 'calibrationStatus', 'manualOrSopTexts'],
  },
  maintenance_tips: { loadLogistics: false, loadAnalytics: true, expected: ['pmSnapshot'] },
  logistics_status: { loadLogistics: true, loadAnalytics: false, expected: ['logisticsSnapshot'] },
  procurement_status: { loadLogistics: true, loadAnalytics: false, expected: ['logisticsSnapshot'] },
  summarize_department_readiness: { loadLogistics: false, loadAnalytics: true, expected: ['department', 'analyticsSnapshot'] },
  training_status: { loadLogistics: false, loadAnalytics: false, expected: [] },
  disposal_status: { loadLogistics: false, loadAnalytics: false, expected: [] },
  qr_asset_context: { loadLogistics: false, loadAnalytics: true, expected: ['equipment', 'analyticsSnapshot'] },
  offline_sync_status: { loadLogistics: false, loadAnalytics: true, expected: ['analyticsSnapshot'] },
  report_summary: { loadLogistics: false, loadAnalytics: true, expected: ['analyticsSnapshot'] },
  metric_debug: { loadLogistics: false, loadAnalytics: true, expected: ['analyticsSnapshot'] },
  copilot_diagnostics: { loadLogistics: false, loadAnalytics: true, expected: ['analyticsSnapshot'] },
  usage_status: { loadLogistics: false, loadAnalytics: true, expected: ['analyticsSnapshot'] },
  unsafe_or_restricted: {},
  general_system_fallback: {},
};

function evidenceConfigForCapability(capability: CapabilityId, intent: ChatIntent): ChatEvidenceLoadConfig {
  const base = CAPABILITY_EVIDENCE_CONFIG[capability] ?? {};
  if (capability === 'summarize_equipment' && intent === 'inventory_search') {
    return { ...base, expected: ['department'], optional: ['analyticsSnapshot'] };
  }
  if (capability === 'summarize_equipment' && intent !== 'asset_summary' && intent !== 'equipment_history') {
    return { ...base, expected: ['analyticsSnapshot'] };
  }
  if (capability === 'explain_pm_status' && intent !== 'calibration_status' && intent !== 'preventive_maintenance') {
    return { ...base, expected: ['analyticsSnapshot'] };
  }
  return base;
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
    case 'general_conversation':
    case 'off_topic_safe':
    case 'unsafe_or_restricted':
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
      return { ...shared, ...riskAnalytics };
    case 'summarize_equipment':
    case 'maintenance_tips':
      return { ...shared, ...riskAnalytics };
    case 'explain_equipment_risk':
    case 'summarize_department_readiness':
      return { ...riskAnalytics, ...shared, ...decisionSupport };
    case 'summarize_alerts':
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
    case 'training_status':
      return { trainingRequests: shared.trainingRequests, workloadSnapshot: decisionSupport.workloadSnapshot };
    case 'disposal_status':
      return { disposalPipeline: shared.disposalPipeline, disposalApprovals: shared.disposalApprovals };
    case 'qr_asset_context':
      return { ...shared, ...riskAnalytics, note: 'QR page-aware scan tools are planned; current response is limited to visible asset and evidence context.' };
    case 'offline_sync_status':
      return { note: 'Offline sync page-aware retrieval is planned for a later phase; use Developer Lab offline diagnostics for live queue evidence.' };
    case 'report_summary':
      return { ...riskAnalytics, ...decisionSupport, note: 'Report-specific retrieval is planned; current response is limited to visible operational evidence.' };
    case 'metric_debug':
      return { ...riskAnalytics, ...decisionSupport, toolTrace: shared.toolTrace, note: 'Metric debug uses available context and telemetry only; raw developer traces stay gated.' };
    case 'copilot_diagnostics':
    case 'usage_status':
      return { note: 'Copilot diagnostics are available in Developer Lab. Chat responses do not expose raw telemetry unless developer-gated UI is used.' };
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
      toolResults[name] = await getInventoryLogisticsStatus(supabase, profile);
    } else if (name === 'getProcurementStatus') {
      toolResults[name] = await getProcurementStatus(supabase, profile);
    } else if (name === 'getSafeTroubleshootingContext') {
      toolResults[name] = getSafeTroubleshootingContext(evidence, { openWorkOrderOnAsset, userMessage: message });
    }
  }
  return toolResults;
}

export async function buildTaskContext(params: TaskContextParams): Promise<TaskContextBundle> {
  const { supabase, capability, profile, contextRefs, message, moduleContext, classified } = params;

  if (
    capability === 'assistant_intro' ||
    capability === 'general_conversation' ||
    capability === 'off_topic_safe' ||
    capability === 'unsafe_or_restricted'
  ) {
    return {
      capability,
      blocks: {
        toolTrace: [],
        retrievalSkipped: true,
      },
      evidence: {
        equipment: null,
        workOrder: null,
        department: null,
        maintenanceHistory: [],
        pmSnapshot: null,
        calibrationStatus: null,
        logisticsSnapshot: null,
        analyticsSnapshot: null,
        manualOrSopTexts: [],
        documentRetrieval: {
          notImplemented: true,
          searchDocuments: [],
          forEquipment: [],
          forCategory: [],
        },
        evidenceSignals: [],
        deniedContextRefs: [],
        missingDataFlags: [],
        evidenceCompleteness: {
          status: 'unknown',
          score: 1,
          requiredPresent: [],
          requiredMissing: [],
          optionalMissing: [],
          staleSignals: [],
          conflictSignals: [],
          sourceCoverage: {
            explicit_context: false,
            page_context: Boolean(moduleContext),
            memory_context: false,
            text_match: false,
            formal_tool: false,
            snapshot: false,
            manual_or_sop: false,
          },
        },
        accessDenied: false,
      },
    };
  }

  const evidenceConfig = evidenceConfigForCapability(capability, classified.intent);
  const evidence: ChatEvidence = await buildChatEvidence(supabase, contextRefs, profile, evidenceConfig, message);
  const [shared, riskAnalytics, logistics, decisionSupport] = await Promise.all([
    loadTaskBlocks(supabase, profile),
    loadRiskAndAnalytics(supabase, contextRefs, profile),
    loadLogistics(supabase, profile),
    loadDecisionSupportSnapshot(supabase, profile),
  ]);

  const selectedTools = planToolRetrieval(classified);
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
  const formalToolNames = planFormalTools(capability, moduleContext, contextRefs);
  const formalToolResults = await Promise.all(
    formalToolNames.map((toolName) =>
      executeCopilotTool(supabase, toolName, {
        profile,
        contextRefs,
        moduleContext,
        route: moduleContext?.route ?? moduleContext?.pathname ?? null,
      })
    )
  );
  const formalToolSummary = summarizeToolResults(formalToolResults);
  if (evidence.evidenceCompleteness) {
    evidence.evidenceCompleteness.sourceCoverage.formal_tool = formalToolSummary.evidenceUsed.length > 0;
    evidence.evidenceCompleteness.sourceCoverage.page_context = Boolean(
      moduleContext?.route ||
        moduleContext?.pathname ||
        moduleContext?.selectedRecordType ||
        moduleContext?.selectedRecordId ||
        moduleContext?.visibleCounts
    );
    if (formalToolSummary.warnings.length > 0) {
      evidence.evidenceCompleteness.staleSignals = Array.from(
        new Set([
          ...evidence.evidenceCompleteness.staleSignals,
          ...formalToolSummary.warnings.filter((warning) => /stale|old|outdated/i.test(warning)).slice(0, 4),
        ])
      );
    }
  }
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
    formalToolTrace: {
      selectedTools: formalToolNames,
      results: formalToolResults,
      summary: formalToolSummary,
    },
    evidenceUsed: formalToolSummary.evidenceUsed,
    sourceTables: formalToolSummary.sourceTables,
    routeLinks: formalToolSummary.routeLinks,
    toolWarnings: formalToolSummary.warnings,
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
