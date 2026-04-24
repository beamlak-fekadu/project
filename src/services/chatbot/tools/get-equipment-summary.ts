import type { ChatContextRefs } from '@/types/chatbot';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { UserChatProfile } from '@/types/chatbot';
import { isAdmin, loadRiskAndAnalytics } from './task-data-loaders';

function sliceForAsset(
  equipmentId: string,
  riskAnalytics: {
    riskScores: Record<string, unknown>[];
    reliabilityMetrics: Record<string, unknown>[];
    replacementPriority: Record<string, unknown>[];
  }
) {
  const match = (rows: Record<string, unknown>[]) => rows.filter((row) => String(row.asset_id ?? '') === equipmentId);
  return {
    riskScores: match(riskAnalytics.riskScores).slice(0, 2),
    reliabilityMetrics: match(riskAnalytics.reliabilityMetrics).slice(0, 2),
    replacementPriority: match(riskAnalytics.replacementPriority).slice(0, 2),
  };
}

export async function getEquipmentSummary(
  supabase: SupabaseClient,
  contextRefs: ChatContextRefs | undefined,
  profile: UserChatProfile
) {
  const equipmentId = contextRefs?.equipmentId;
  if (!equipmentId) {
    return { equipment: null, analytics: null, note: 'No equipmentId in context.' };
  }
  const { data: equipment } = await supabase
    .from('equipment_assets')
    .select('id, asset_code, name, condition, status, department_id, manufacturers(name), equipment_models(name), equipment_categories(name, criticality_level)')
    .eq('id', equipmentId)
    .is('deleted_at', null)
    .maybeSingle();

  if (equipment) {
    const dep = equipment.department_id as string | null | undefined;
    if (!isAdmin(profile) && dep && dep !== profile.departmentId) {
      return { equipment: null, note: 'Equipment not in your department scope.' };
    }
  }

  const riskAnalytics = await loadRiskAndAnalytics(supabase, contextRefs);
  return {
    equipment: (equipment as Record<string, unknown> | null) ?? null,
    focusedAssetAnalytics: equipment ? sliceForAsset(equipmentId, riskAnalytics) : null,
  };
}
