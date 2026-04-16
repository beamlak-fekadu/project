import type { SupabaseClient } from '@supabase/supabase-js';
import type { CapabilityId, ChatContextRefs, ChatEvidence, TaskContextBundle, UserChatProfile } from '@/types/chatbot';
import { buildChatEvidence } from './context-service';

interface TaskContextParams {
  supabase: SupabaseClient;
  capability: CapabilityId;
  profile: UserChatProfile;
  contextRefs?: ChatContextRefs;
}

async function loadTaskBlocks(supabase: SupabaseClient, profile: UserChatProfile) {
  const [workOrdersRes, overduePmRes, approvalMaintenanceRes, disposalRes, procurementRes] = await Promise.all([
    supabase
      .from('work_orders')
      .select('id, work_order_number, status, priority, assigned_to, created_at')
      .eq('assigned_to', profile.profileId)
      .in('status', ['open', 'assigned', 'in_progress', 'on_hold'])
      .order('created_at', { ascending: false })
      .limit(12),
    supabase
      .from('v_overdue_pm')
      .select('id, plan_name, asset_code, asset_name, days_overdue, department_name')
      .order('days_overdue', { ascending: false })
      .limit(12),
    supabase
      .from('maintenance_requests')
      .select('id, request_number, status, urgency, created_at, department_id')
      .eq('status', 'pending')
      .order('created_at', { ascending: false })
      .limit(8),
    supabase
      .from('disposal_requests')
      .select('id, request_number, status, created_at')
      .eq('status', 'submitted')
      .order('created_at', { ascending: false })
      .limit(8),
    supabase
      .from('procurement_requests')
      .select('id, request_number, status, priority, created_at')
      .in('status', ['requested', 'under_review'])
      .order('created_at', { ascending: false })
      .limit(8),
  ]);

  return {
    assignedWorkOrders: (workOrdersRes.data ?? []) as Record<string, unknown>[],
    overduePm: (overduePmRes.data ?? []) as Record<string, unknown>[],
    maintenanceApprovals: (approvalMaintenanceRes.data ?? []) as Record<string, unknown>[],
    disposalApprovals: (disposalRes.data ?? []) as Record<string, unknown>[],
    procurementApprovals: (procurementRes.data ?? []) as Record<string, unknown>[],
  };
}

async function loadRiskAndAnalytics(supabase: SupabaseClient, contextRefs?: ChatContextRefs) {
  const equipmentId = contextRefs?.equipmentId;
  const [riskRes, reliabilityRes, replacementRes, flagsRes, decisionRes] = await Promise.all([
    equipmentId
      ? supabase
          .from('equipment_risk_scores')
          .select('asset_id, rpn, risk_level, assessed_at')
          .eq('asset_id', equipmentId)
          .order('assessed_at', { ascending: false })
          .limit(3)
      : supabase
          .from('equipment_risk_scores')
          .select('asset_id, rpn, risk_level, assessed_at')
          .order('assessed_at', { ascending: false })
          .limit(8),
    equipmentId
      ? supabase
          .from('equipment_reliability_metrics')
          .select('asset_id, mttr_hours, mtbf_hours, availability_ratio, computed_at')
          .eq('asset_id', equipmentId)
          .order('computed_at', { ascending: false })
          .limit(3)
      : supabase
          .from('equipment_reliability_metrics')
          .select('asset_id, mttr_hours, mtbf_hours, availability_ratio, computed_at')
          .order('computed_at', { ascending: false })
          .limit(8),
    equipmentId
      ? supabase
          .from('replacement_priority_scores')
          .select('asset_id, replacement_priority_index, rank, justification, computed_at')
          .eq('asset_id', equipmentId)
          .order('computed_at', { ascending: false })
          .limit(3)
      : supabase
          .from('replacement_priority_scores')
          .select('asset_id, replacement_priority_index, rank, justification, computed_at')
          .order('rank', { ascending: true })
          .limit(8),
    supabase
      .from('recommendation_flags')
      .select('id, asset_id, severity, flag_type, message, generated_at')
      .eq('is_acknowledged', false)
      .order('generated_at', { ascending: false })
      .limit(10),
    supabase
      .from('triage_action_queue')
      .select('id, asset_id, priority_score, recommendation, rationale')
      .eq('status', 'open')
      .order('priority_score', { ascending: false })
      .limit(10),
  ]);

  return {
    riskScores: (riskRes.data ?? []) as Record<string, unknown>[],
    reliabilityMetrics: (reliabilityRes.data ?? []) as Record<string, unknown>[],
    replacementPriority: (replacementRes.data ?? []) as Record<string, unknown>[],
    recommendationFlags: (flagsRes.data ?? []) as Record<string, unknown>[],
    decisionSupportQueue: (decisionRes.data ?? []) as Record<string, unknown>[],
  };
}

async function loadLogistics(supabase: SupabaseClient) {
  const [lowStockRes, procurementRes] = await Promise.all([
    supabase
      .from('v_low_stock_parts')
      .select('id, part_code, name, current_stock, reorder_level, deficit')
      .order('deficit', { ascending: false })
      .limit(10),
    supabase
      .from('procurement_requests')
      .select('id, request_number, title, status, priority, expected_delivery_date')
      .order('created_at', { ascending: false })
      .limit(10),
  ]);

  return {
    lowStockParts: (lowStockRes.data ?? []) as Record<string, unknown>[],
    procurementPipeline: (procurementRes.data ?? []) as Record<string, unknown>[],
  };
}

function selectCapabilityBlocks(
  capability: CapabilityId,
  shared: Record<string, unknown>,
  riskAnalytics: Record<string, unknown>,
  logistics: Record<string, unknown>
) {
  switch (capability) {
    case 'my_tasks':
    case 'prioritize_tasks':
      return { ...shared, ...riskAnalytics };
    case 'summarize_work_order':
    case 'maintenance_guidance':
      return { ...shared };
    case 'explain_equipment_risk':
    case 'decision_support_analysis':
    case 'alerts_and_escalations':
      return { ...riskAnalytics, ...shared };
    case 'explain_pm_status':
      return { overduePm: shared.overduePm, pmSignals: riskAnalytics.reliabilityMetrics };
    case 'logistics_status':
    case 'approval_tasks':
      return { ...shared, ...logistics };
    default:
      return { ...shared, ...riskAnalytics, ...logistics };
  }
}

export async function buildTaskContext(params: TaskContextParams): Promise<TaskContextBundle> {
  const { supabase, capability, profile, contextRefs } = params;

  const intentForEvidence =
    capability === 'logistics_status'
      ? 'calibration_or_logistics'
      : capability === 'safe_troubleshooting'
        ? 'troubleshooting'
        : capability === 'decision_support_analysis' || capability === 'explain_equipment_risk' || capability === 'alerts_and_escalations'
          ? 'analytics_explanation'
          : capability === 'summarize_work_order'
            ? 'work_order_help'
            : 'maintenance_tip';

  const evidence: ChatEvidence = await buildChatEvidence(supabase, contextRefs, profile, intentForEvidence);
  const [shared, riskAnalytics, logistics] = await Promise.all([
    loadTaskBlocks(supabase, profile),
    loadRiskAndAnalytics(supabase, contextRefs),
    loadLogistics(supabase),
  ]);

  return {
    capability,
    evidence,
    blocks: selectCapabilityBlocks(capability, shared, riskAnalytics, logistics),
  };
}
