import type { SupabaseClient } from '@supabase/supabase-js';
import type { ChatContextRefs, ChatEvidence, ChatIntent, UserChatProfile } from '@/types/chatbot';

function isDepartmentScoped(profile: UserChatProfile) {
  return profile.roleNames.includes('department_user') && !profile.roleNames.includes('admin');
}

function canSeeDepartment(profile: UserChatProfile, departmentId: string | null | undefined) {
  if (!departmentId) return true;
  if (!isDepartmentScoped(profile)) return true;
  return profile.departmentId === departmentId;
}

export async function buildChatEvidence(
  supabase: SupabaseClient,
  contextRefs: ChatContextRefs | undefined,
  profile: UserChatProfile,
  intent: ChatIntent
): Promise<ChatEvidence> {
  const evidenceSignals: string[] = [];
  const deniedContextRefs: Array<'equipment' | 'work_order' | 'department'> = [];

  const equipmentId = contextRefs?.equipmentId;
  const workOrderId = contextRefs?.workOrderId;
  const selectedDepartmentId = contextRefs?.departmentId ?? profile.departmentId ?? undefined;

  let equipment: Record<string, unknown> | null = null;
  if (equipmentId) {
    const { data } = await supabase
      .from('equipment_assets')
      .select(`
        id, asset_code, name, condition, status, department_id,
        equipment_models(name),
        manufacturers(name),
        equipment_categories(name, criticality_level),
        departments(name)
      `)
      .eq('id', equipmentId)
      .is('deleted_at', null)
      .maybeSingle();

    if (data && canSeeDepartment(profile, data.department_id as string | null)) {
      equipment = data as Record<string, unknown>;
      evidenceSignals.push('Loaded equipment context.');
    } else if (equipmentId) {
      deniedContextRefs.push('equipment');
      evidenceSignals.push('Requested equipment context is not visible for current role scope.');
    }
  }

  let workOrder: Record<string, unknown> | null = null;
  if (workOrderId) {
    const { data } = await supabase
      .from('work_orders')
      .select(`
        id, work_order_number, status, priority, work_type, root_cause, action_taken, closure_notes, created_at,
        equipment_assets(id, name, asset_code, department_id)
      `)
      .eq('id', workOrderId)
      .maybeSingle();

    const workOrderDepartment = (data?.equipment_assets as { department_id?: string } | null)?.department_id;
    if (data && canSeeDepartment(profile, workOrderDepartment)) {
      workOrder = data as Record<string, unknown>;
      evidenceSignals.push('Loaded work-order context.');
    } else if (workOrderId) {
      deniedContextRefs.push('work_order');
      evidenceSignals.push('Requested work-order context is not visible for current role scope.');
    }
  }

  let department: Record<string, unknown> | null = null;
  if (selectedDepartmentId) {
    const { data } = await supabase
      .from('departments')
      .select('id, name, code')
      .eq('id', selectedDepartmentId)
      .maybeSingle();

    if (data && canSeeDepartment(profile, data.id)) {
      department = data as Record<string, unknown>;
      evidenceSignals.push('Loaded department context.');
    } else if (selectedDepartmentId) {
      deniedContextRefs.push('department');
      evidenceSignals.push('Requested department context is not visible for current role scope.');
    }
  }

  const maintenanceHistory: Record<string, unknown>[] = [];
  if (equipmentId) {
    const { data } = await supabase
      .from('maintenance_events')
      .select('event_type, action_taken, failure_date, completion_date, notes, repair_duration_hours')
      .eq('asset_id', equipmentId)
      .order('created_at', { ascending: false })
      .limit(8);
    maintenanceHistory.push(...((data ?? []) as Record<string, unknown>[]));
    if (maintenanceHistory.length > 0) evidenceSignals.push('Loaded maintenance history.');
  }

  let pmSnapshot: Record<string, unknown> | null = null;
  if (equipmentId) {
    const { data } = await supabase
      .from('pm_compliance_metrics')
      .select('pmc_percentage, scheduled_count, completed_count, computed_at')
      .eq('asset_id', equipmentId)
      .order('computed_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (data) {
      pmSnapshot = data as Record<string, unknown>;
      evidenceSignals.push('Loaded PM compliance snapshot.');
    }
  }

  let calibrationStatus: Record<string, unknown> | null = null;
  if (equipmentId) {
    const { data } = await supabase
      .from('calibration_records')
      .select('calibration_date, next_due_date, result, notes')
      .eq('asset_id', equipmentId)
      .order('calibration_date', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (data) {
      calibrationStatus = data as Record<string, unknown>;
      evidenceSignals.push('Loaded calibration status.');
    }
  }

  let logisticsSnapshot: Record<string, unknown> | null = null;
  if (intent === 'calibration_or_logistics' || intent === 'maintenance_tip') {
    const { data } = await supabase
      .from('spare_parts')
      .select('id, name, current_stock, reorder_level')
      .order('current_stock', { ascending: true })
      .limit(6);
    if (data && data.length > 0) {
      logisticsSnapshot = {
        lowStockParts: (data as Record<string, unknown>[]).filter((part) => {
          const stock = Number(part.current_stock ?? 0);
          const reorder = Number(part.reorder_level ?? 0);
          return stock <= reorder;
        }),
      };
      evidenceSignals.push('Loaded logistics stock snapshot.');
    }
  }

  let analyticsSnapshot: Record<string, unknown> | null = null;
  if (intent === 'analytics_explanation' || equipmentId) {
    if (equipmentId) {
      const [riskRes, reliabilityRes, replacementRes] = await Promise.all([
        supabase
          .from('equipment_risk_scores')
          .select('rpn, risk_level, assessed_at')
          .eq('asset_id', equipmentId)
          .order('assessed_at', { ascending: false })
          .limit(1)
          .maybeSingle(),
        supabase
          .from('equipment_reliability_metrics')
          .select('mttr_hours, mtbf_hours, availability_ratio, failure_count, computed_at')
          .eq('asset_id', equipmentId)
          .order('computed_at', { ascending: false })
          .limit(1)
          .maybeSingle(),
        supabase
          .from('replacement_priority_scores')
          .select('replacement_priority_index, rank, justification, computed_at')
          .eq('asset_id', equipmentId)
          .order('computed_at', { ascending: false })
          .limit(1)
          .maybeSingle(),
      ]);

      analyticsSnapshot = {
        risk: (riskRes.data ?? null) as Record<string, unknown> | null,
        reliability: (reliabilityRes.data ?? null) as Record<string, unknown> | null,
        replacement: (replacementRes.data ?? null) as Record<string, unknown> | null,
      };
      if (riskRes.data || reliabilityRes.data || replacementRes.data) {
        evidenceSignals.push('Loaded equipment analytics snapshots.');
      }
    } else {
      let scopedAssetIds: string[] = [];
      if (isDepartmentScoped(profile) && selectedDepartmentId) {
        const { data: scopedAssets } = await supabase
          .from('equipment_assets')
          .select('id')
          .eq('department_id', selectedDepartmentId)
          .is('deleted_at', null)
          .limit(200);
        scopedAssetIds = (scopedAssets ?? []).map((asset) => asset.id as string);
      }

      const flagsQuery = supabase
        .from('recommendation_flags')
        .select('flag_type, severity, message, generated_at')
        .order('generated_at', { ascending: false })
        .limit(10);

      const scopedFlagsQuery = scopedAssetIds.length > 0 ? flagsQuery.in('asset_id', scopedAssetIds) : flagsQuery;

      const [pmDeptRes, flagsRes] = await Promise.all([
        supabase
          .from('pm_compliance_metrics')
          .select('department_id, pmc_percentage, scheduled_count, completed_count, computed_at')
          .eq('department_id', selectedDepartmentId ?? '')
          .order('computed_at', { ascending: false })
          .limit(5),
        scopedFlagsQuery,
      ]);
      analyticsSnapshot = {
        pmCompliance: (pmDeptRes.data ?? []) as Record<string, unknown>[],
        recommendationFlags: (flagsRes.data ?? []) as Record<string, unknown>[],
      };
      if ((pmDeptRes.data?.length ?? 0) > 0 || (flagsRes.data?.length ?? 0) > 0) {
        evidenceSignals.push('Loaded department-level analytics snapshots.');
      }
    }
  }

  const manualOrSopTexts: string[] = [];
  if (equipmentId) {
    const { data } = await supabase
      .from('equipment_documents')
      .select('title, description, document_type')
      .eq('asset_id', equipmentId)
      .in('document_type', ['manual', 'sop'])
      .order('created_at', { ascending: false })
      .limit(5);

    if (data) {
      for (const doc of data) {
        const title = typeof doc.title === 'string' ? doc.title : '';
        const description = typeof doc.description === 'string' ? doc.description : '';
        const combined = `${title}. ${description}`.trim();
        if (combined) manualOrSopTexts.push(combined);
      }
    }
    if (manualOrSopTexts.length > 0) evidenceSignals.push('Loaded manual/SOP snippets.');
  }

  const port = documentRetrievalNotImplemented;
  const [searchRes, forEquipRes, forCatRes] = await Promise.all([
    port.searchDocuments(''),
    equipmentId ? port.getDocumentsForEquipment(equipmentId) : Promise.resolve([]),
    port.getDocumentsForCategory(''),
  ]);

  return {
    equipment,
    workOrder,
    department,
    maintenanceHistory,
    pmSnapshot,
    calibrationStatus,
    logisticsSnapshot,
    analyticsSnapshot,
    manualOrSopTexts,
    documentRetrieval: {
      notImplemented: true,
      searchDocuments: searchRes,
      forEquipment: forEquipRes,
      forCategory: forCatRes,
    },
    evidenceSignals,
    deniedContextRefs,
    accessDenied: deniedContextRefs.length > 0,
  };
}

/** RAG / pgvector hook — structured DB reads stay in tools; this path is for manuals/docs later. */
export interface DocumentRetrievalPort {
  searchDocuments(
    _query: string,
    _filters?: { categoryId?: string; limit?: number }
  ): Promise<Array<{ id?: string; title: string; snippet?: string }>>;
  getDocumentsForEquipment(_equipmentId: string): Promise<Array<{ id?: string; title: string; snippet?: string }>>;
  getDocumentsForCategory(_categoryId: string): Promise<Array<{ id?: string; title: string; snippet?: string }>>;
}

export const documentRetrievalNotImplemented: DocumentRetrievalPort = {
  async searchDocuments() {
    return [];
  },
  async getDocumentsForEquipment() {
    return [];
  },
  async getDocumentsForCategory() {
    return [];
  },
};
