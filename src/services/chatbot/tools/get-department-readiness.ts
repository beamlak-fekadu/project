import type { ChatContextRefs } from '@/types/chatbot';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { UserChatProfile } from '@/types/chatbot';
import { isAdmin } from './task-data-loaders';
import { loadDecisionSupportSnapshot } from './task-data-loaders';

export async function getDepartmentReadiness(
  supabase: SupabaseClient,
  contextRefs: ChatContextRefs | undefined,
  profile: UserChatProfile
) {
  const targetDept = contextRefs?.departmentId ?? profile.departmentId;
  if (!targetDept) {
    const ds = await loadDecisionSupportSnapshot(supabase);
    if (isAdmin(profile)) {
      return { readinessRows: ds.readinessSnapshot.slice(0, 8), scope: 'organization' as const };
    }
    const scoped = (ds.readinessSnapshot as Record<string, unknown>[]).filter(
      (r) => String(r.department_id ?? '') === String(profile.departmentId ?? '')
    );
    return { readinessRows: scoped.slice(0, 8), scope: 'department' as const };
  }
  const { data, error } = await supabase
    .from('clinical_readiness_snapshots')
    .select('department_id, readiness_score, essential_total, essential_functional, snapshot_date')
    .eq('department_id', targetDept)
    .order('snapshot_date', { ascending: false })
    .limit(5);

  if (error) {
    return { readinessRows: [], error: 'readiness_query_failed' };
  }

  if (!isAdmin(profile) && targetDept !== profile.departmentId) {
    return { readinessRows: [], note: 'Department scope limited to your org unit.' };
  }

  return { readinessRows: (data ?? []) as Record<string, unknown>[], scope: 'department' as const };
}
