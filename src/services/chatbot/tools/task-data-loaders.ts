import type { SupabaseClient } from '@supabase/supabase-js';
import type { CapabilityId, ChatContextRefs, UserChatProfile } from '@/types/chatbot';

export function isAdmin(profile: UserChatProfile) {
  return profile.roleNames.includes('admin');
}

export function usesBroadWorkOrderPool(profile: UserChatProfile, capability: CapabilityId) {
  if (isAdmin(profile)) return true;
  if (capability === 'prioritize_tasks' && profile.roleNames.includes('engineer')) return true;
  return false;
}

export async function loadTaskBlocks(
  supabase: SupabaseClient,
  profile: UserChatProfile,
  capability: CapabilityId
) {
  const assignedWorkOrdersQuery = supabase
    .from('work_orders')
    .select('id, work_order_number, status, priority, assigned_to, created_at, asset_id')
    .in('status', ['open', 'assigned', 'in_progress', 'on_hold'])
    .order('created_at', { ascending: false })
    .limit(24);

  const scopedWorkOrdersQuery = usesBroadWorkOrderPool(profile, capability)
    ? assignedWorkOrdersQuery
    : assignedWorkOrdersQuery.eq('assigned_to', profile.profileId);

  let maintenanceApprovalsQuery = supabase
    .from('maintenance_requests')
    .select('id, request_number, status, urgency, created_at, department_id')
    .eq('status', 'pending')
    .order('created_at', { ascending: false })
    .limit(12);

  if (!isAdmin(profile) && profile.departmentId) {
    maintenanceApprovalsQuery = maintenanceApprovalsQuery.eq('department_id', profile.departmentId);
  }

  let trainingRequestsQuery = supabase
    .from('training_requests')
    .select('id, request_number, status, training_type, created_at, department_id')
    .in('status', ['pending', 'approved', 'scheduled'])
    .order('created_at', { ascending: false })
    .limit(10);

  if (!isAdmin(profile) && profile.departmentId) {
    trainingRequestsQuery = trainingRequestsQuery.eq('department_id', profile.departmentId);
  }

  const [
    workOrdersRes,
    overduePmRes,
    approvalMaintenanceRes,
    disposalRes,
    procurementRes,
    trainingRes,
    disposalQueueRes,
  ] = await Promise.all([
    scopedWorkOrdersQuery,
    supabase
      .from('v_overdue_pm')
      .select('id, plan_name, asset_code, asset_name, days_overdue, department_name')
      .order('days_overdue', { ascending: false })
      .limit(12),
    maintenanceApprovalsQuery,
    supabase
      .from('disposal_requests')
      .select('id, request_number, status, created_at')
      .eq('status', 'pending')
      .order('created_at', { ascending: false })
      .limit(8),
    supabase
      .from('procurement_requests')
      .select('id, request_number, status, priority, created_at')
      .in('status', ['requested', 'under_review'])
      .order('created_at', { ascending: false })
      .limit(8),
    trainingRequestsQuery,
    supabase
      .from('disposal_requests')
      .select('id, request_number, status, reason, disposal_method_proposed, created_at, asset_id')
      .in('status', ['pending', 'approved'])
      .order('created_at', { ascending: false })
      .limit(10),
  ]);

  return {
    assignedWorkOrders: (workOrdersRes.data ?? []) as Record<string, unknown>[],
    overduePm: (overduePmRes.data ?? []) as Record<string, unknown>[],
    maintenanceApprovals: (approvalMaintenanceRes.data ?? []) as Record<string, unknown>[],
    disposalApprovals: (disposalRes.data ?? []) as Record<string, unknown>[],
    procurementApprovals: (procurementRes.data ?? []) as Record<string, unknown>[],
    trainingRequests: (trainingRes.data ?? []) as Record<string, unknown>[],
    disposalPipeline: (disposalQueueRes.data ?? []) as Record<string, unknown>[],
  };
}

export async function loadRiskAndAnalytics(supabase: SupabaseClient, contextRefs?: ChatContextRefs) {
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
      .limit(12),
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

export async function loadLogistics(supabase: SupabaseClient) {
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

export async function loadDecisionSupportSnapshot(supabase: SupabaseClient) {
  const [readinessRes, workloadRes] = await Promise.all([
    supabase
      .from('clinical_readiness_snapshots')
      .select('department_id, readiness_score, essential_total, essential_functional, snapshot_date')
      .order('snapshot_date', { ascending: false })
      .limit(15),
    supabase
      .from('workload_capacity_snapshots')
      .select('assignee_id, open_assignments, overdue_assignments, estimated_hours, snapshot_date')
      .order('snapshot_date', { ascending: false })
      .limit(20),
  ]);

  return {
    readinessSnapshot: (readinessRes.data ?? []) as Record<string, unknown>[],
    workloadSnapshot: (workloadRes.data ?? []) as Record<string, unknown>[],
  };
}
