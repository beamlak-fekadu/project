import type { ChatContextRefs } from '@/types/chatbot';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { UserChatProfile } from '@/types/chatbot';

function canScope(profile: UserChatProfile, departmentId: string | null | undefined) {
  if (profile.roleNames.includes('admin')) return true;
  if (!departmentId) return true;
  return profile.departmentId === departmentId;
}

export async function getWorkOrderSummary(
  supabase: SupabaseClient,
  contextRefs: ChatContextRefs | undefined,
  profile: UserChatProfile
) {
  const workOrderId = contextRefs?.workOrderId;
  if (!workOrderId) {
    return { workOrder: null, note: 'No workOrderId in context.' };
  }
  const { data } = await supabase
    .from('work_orders')
    .select(
      'id, work_order_number, status, priority, work_type, root_cause, action_taken, closure_notes, created_at, equipment_assets(id, name, asset_code, department_id)'
    )
    .eq('id', workOrderId)
    .maybeSingle();

  const d = (data as Record<string, unknown> | null) ?? null;
  if (!d) return { workOrder: null, note: 'Work order not found or inaccessible.' };
  const dept = (d.equipment_assets as { department_id?: string } | null)?.department_id;
  if (!canScope(profile, dept)) {
    return { workOrder: null, note: 'Work order not visible for this role.' };
  }
  return { workOrder: d };
}
