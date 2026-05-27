import type { SupabaseClient } from '@supabase/supabase-js';
import type { ChatContextRefs, ChatEvidence, UserChatProfile } from '@/types/chatbot';
import { canReadCopilotDepartment, requiresDepartmentScope } from './copilot-rbac';
import { searchEquipmentDocuments, type EquipmentDocumentMatch } from '@/services/embeddings';

export type EvidenceRequirementKey =
    | 'equipment'
    | 'workOrder'
    | 'department'
    | 'maintenanceHistory'
    | 'openWorkOrders'
    | 'maintenanceRequests'
    | 'pmSnapshot'
    | 'calibrationStatus'
    | 'logisticsSnapshot'
    | 'analyticsSnapshot'
    | 'manualOrSopTexts';

export interface ChatEvidenceLoadConfig {
  loadLogistics?: boolean;
  loadAnalytics?: boolean;
  expected?: EvidenceRequirementKey[];
  optional?: EvidenceRequirementKey[];
}

function canSeeDepartment(profile: UserChatProfile, departmentId: string | null | undefined) {
  if (!departmentId) return true;
  return canReadCopilotDepartment(profile, departmentId);
}

function unique(values: string[]) {
  return Array.from(new Set(values.filter(Boolean)));
}

function hasDeepEvidenceContent(value: unknown): boolean {
  if (Array.isArray(value)) return value.length > 0;
  if (!value || typeof value !== 'object') return value != null;
  return Object.values(value as Record<string, unknown>).some((entry) => hasDeepEvidenceContent(entry));
}

function isPresentEvidenceKey(key: EvidenceRequirementKey, evidence: {
  equipment: Record<string, unknown> | null;
  workOrder: Record<string, unknown> | null;
  department: Record<string, unknown> | null;
  maintenanceHistory: Record<string, unknown>[];
  openWorkOrders: Record<string, unknown>[];
  maintenanceRequests: Record<string, unknown>[];
  pmSnapshot: Record<string, unknown> | null;
  calibrationStatus: Record<string, unknown> | null;
  logisticsSnapshot: Record<string, unknown> | null;
  analyticsSnapshot: Record<string, unknown> | null;
  manualOrSopTexts: string[];
}) {
  if (key === 'equipment') return Boolean(evidence.equipment);
  if (key === 'workOrder') return Boolean(evidence.workOrder);
  if (key === 'department') return Boolean(evidence.department);
  if (key === 'maintenanceHistory') return evidence.maintenanceHistory.length > 0;
  if (key === 'openWorkOrders') return evidence.openWorkOrders.length > 0;
  if (key === 'maintenanceRequests') return evidence.maintenanceRequests.length > 0;
  if (key === 'pmSnapshot') return Boolean(evidence.pmSnapshot);
  if (key === 'calibrationStatus') return Boolean(evidence.calibrationStatus);
  if (key === 'logisticsSnapshot') return hasDeepEvidenceContent(evidence.logisticsSnapshot);
  if (key === 'analyticsSnapshot') return hasDeepEvidenceContent(evidence.analyticsSnapshot);
  if (key === 'manualOrSopTexts') return evidence.manualOrSopTexts.length > 0;
  return false;
}

export function buildEvidenceCompleteness(params: {
  expected: Set<EvidenceRequirementKey>;
  optional: Set<EvidenceRequirementKey>;
  missingDataFlags: string[];
  deniedContextRefs: Array<'equipment' | 'work_order' | 'department'>;
  contextRefs?: ChatContextRefs;
  documentRetrieval: ChatEvidence['documentRetrieval'];
  evidence: {
    equipment: Record<string, unknown> | null;
    workOrder: Record<string, unknown> | null;
    department: Record<string, unknown> | null;
    maintenanceHistory: Record<string, unknown>[];
    openWorkOrders: Record<string, unknown>[];
    maintenanceRequests: Record<string, unknown>[];
    pmSnapshot: Record<string, unknown> | null;
    calibrationStatus: Record<string, unknown> | null;
    logisticsSnapshot: Record<string, unknown> | null;
    analyticsSnapshot: Record<string, unknown> | null;
    manualOrSopTexts: string[];
  };
}): NonNullable<ChatEvidence['evidenceCompleteness']> {
  const expectedKeys = Array.from(params.expected);
  const optionalKeys = Array.from(params.optional).filter((key) => !params.expected.has(key));
  const requiredPresent = expectedKeys.filter((key) => isPresentEvidenceKey(key, params.evidence));
  const requiredMissing = expectedKeys.filter((key) => !requiredPresent.includes(key));
  const optionalMissing = optionalKeys.filter((key) => !isPresentEvidenceKey(key, params.evidence));
  const staleSignals: string[] = [];
  const conflictSignals: string[] = [];
  const sourceCoverage = {
    explicit_context: Boolean(params.contextRefs?.equipmentId || params.contextRefs?.workOrderId || params.contextRefs?.departmentId),
    page_context: false,
    memory_context: false,
    text_match: false,
    formal_tool: false,
    snapshot: Boolean(params.evidence.pmSnapshot || params.evidence.calibrationStatus || hasDeepEvidenceContent(params.evidence.analyticsSnapshot)),
    manual_or_sop: params.evidence.manualOrSopTexts.length > 0 || params.documentRetrieval.searchDocuments.length > 0,
  };
  const requiredScore = expectedKeys.length ? requiredPresent.length / expectedKeys.length : 1;
  const optionalPresent = optionalKeys.filter((key) => isPresentEvidenceKey(key, params.evidence)).length;
  const optionalScore = optionalKeys.length ? optionalPresent / optionalKeys.length : 1;
  const score = Math.max(0, Math.min(1, requiredScore * 0.7 + optionalScore * 0.3));
  const status =
    params.deniedContextRefs.length > 0 && requiredPresent.length === 0
      ? 'denied'
      : expectedKeys.length === 0
        ? 'unknown'
        : requiredMissing.length === 0
          ? optionalMissing.length > 0
            ? 'partial'
            : 'complete'
          : requiredPresent.length === 0
            ? 'insufficient'
            : 'partial';

  return {
    status,
    score: Math.round(score * 100) / 100,
    requiredPresent: unique(requiredPresent),
    requiredMissing: unique(requiredMissing),
    optionalMissing,
    staleSignals,
    conflictSignals,
    sourceCoverage,
  };
}

export async function buildChatEvidence(
  supabase: SupabaseClient,
  contextRefs: ChatContextRefs | undefined,
  profile: UserChatProfile,
  config: ChatEvidenceLoadConfig,
  message = ''
): Promise<ChatEvidence> {
  const evidenceSignals: string[] = [];
  const deniedContextRefs: Array<'equipment' | 'work_order' | 'department'> = [];
  const missingDataFlags: string[] = [];
  const expected = new Set(config.expected ?? []);
  const optional = new Set(config.optional ?? []);
  const expectedForFlags = new Set([...expected, ...optional]);

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
        equipment_categories(id, name, criticality_level),
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

  const openWorkOrders: Record<string, unknown>[] = [];
  if (equipmentId) {
    const { data } = await supabase
      .from('work_orders')
      .select('id, work_order_number, status, priority, work_type, created_at, assigned_to')
      .eq('asset_id', equipmentId)
      .in('status', ['open', 'assigned', 'in_progress', 'on_hold'])
      .order('created_at', { ascending: false })
      .limit(8);
    openWorkOrders.push(...((data ?? []) as Record<string, unknown>[]));
    if (openWorkOrders.length > 0) evidenceSignals.push('Loaded open work orders for equipment.');
  }

  const maintenanceRequests: Record<string, unknown>[] = [];
  if (equipmentId) {
    const { data } = await supabase
      .from('maintenance_requests')
      .select('id, request_number, status, urgency, created_at, department_id, asset_id')
      .eq('asset_id', equipmentId)
      .order('created_at', { ascending: false })
      .limit(8);
    maintenanceRequests.push(...((data ?? []) as Record<string, unknown>[]));
    if (maintenanceRequests.length > 0) evidenceSignals.push('Loaded maintenance requests for equipment.');
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
  if (config.loadLogistics) {
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
  if (config.loadAnalytics || equipmentId) {
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
      if (requiresDepartmentScope(profile) && selectedDepartmentId) {
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

  const documentRetrieval = await loadDocumentRetrieval({
    query: message,
    equipmentId,
    categoryId: ((equipment?.equipment_categories as { id?: string } | undefined)?.id),
    evidenceSignals,
  });

  if (expectedForFlags.has('equipment') && !equipment) {
    missingDataFlags.push(equipmentId ? 'equipment_record_missing' : 'equipment_context_missing');
  }
  if (expectedForFlags.has('workOrder') && !workOrder) {
    missingDataFlags.push(workOrderId ? 'work_order_record_missing' : 'work_order_context_missing');
  }
  if (expectedForFlags.has('department') && !department) {
    missingDataFlags.push(selectedDepartmentId ? 'department_record_missing' : 'department_context_missing');
  }
  if (expectedForFlags.has('maintenanceHistory') && equipmentId && maintenanceHistory.length === 0) {
    missingDataFlags.push('maintenance_history_missing');
  }
  if (expectedForFlags.has('openWorkOrders') && equipmentId && openWorkOrders.length === 0) {
    missingDataFlags.push('open_work_orders_missing');
  }
  if (expectedForFlags.has('maintenanceRequests') && equipmentId && maintenanceRequests.length === 0) {
    missingDataFlags.push('maintenance_requests_missing');
  }
  if (expectedForFlags.has('pmSnapshot') && equipmentId && !pmSnapshot) {
    missingDataFlags.push('pm_snapshot_missing');
  }
  if (expectedForFlags.has('calibrationStatus') && equipmentId && !calibrationStatus) {
    missingDataFlags.push('calibration_status_missing');
  }
  const lowStockParts: unknown[] = Array.isArray((logisticsSnapshot as { lowStockParts?: unknown[] } | null)?.lowStockParts)
    ? ((logisticsSnapshot as { lowStockParts?: unknown[] }).lowStockParts ?? [])
    : [];
  if (expectedForFlags.has('logisticsSnapshot') && (!logisticsSnapshot || lowStockParts.length === 0)) {
    missingDataFlags.push('logistics_snapshot_missing');
  }
  const hasAnalyticsContent = Boolean(
    analyticsSnapshot &&
      Object.values(analyticsSnapshot).some((value) => {
        if (Array.isArray(value)) return value.length > 0;
        if (value && typeof value === 'object') return Object.keys(value).length > 0;
        return value != null;
      })
  );
  if (expectedForFlags.has('analyticsSnapshot') && !hasAnalyticsContent) {
    missingDataFlags.push('analytics_snapshot_missing');
  }
  if (expectedForFlags.has('manualOrSopTexts') && manualOrSopTexts.length === 0 && documentRetrieval.searchDocuments.length === 0) {
    missingDataFlags.push('missing_manual_or_sop');
  }
  if (missingDataFlags.length > 0) {
    evidenceSignals.push(`Missing expected context: ${missingDataFlags.join(', ')}.`);
  }

  const completenessEvidence = {
    equipment,
    workOrder,
    department,
    maintenanceHistory,
    openWorkOrders,
    maintenanceRequests,
    pmSnapshot,
    calibrationStatus,
    logisticsSnapshot,
    analyticsSnapshot,
    manualOrSopTexts,
  };
  const evidenceCompleteness = buildEvidenceCompleteness({
    expected,
    optional,
    missingDataFlags,
    deniedContextRefs,
    contextRefs,
    documentRetrieval,
    evidence: completenessEvidence,
  });

  return {
    equipment,
    workOrder,
    department,
    maintenanceHistory,
    openWorkOrders,
    maintenanceRequests,
    pmSnapshot,
    calibrationStatus,
    logisticsSnapshot,
    analyticsSnapshot,
    manualOrSopTexts,
    documentRetrieval,
    missingDataFlags,
    evidenceCompleteness,
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

function documentMatchToSnippet(match: EquipmentDocumentMatch) {
  return {
    id: match.chunk_id,
    title: match.source_label ?? `Document chunk ${match.chunk_index + 1}`,
    snippet: match.chunk_text.slice(0, 360),
  };
}

async function loadDocumentRetrieval(params: {
  query: string;
  equipmentId?: string;
  categoryId?: string;
  evidenceSignals: string[];
}): Promise<ChatEvidence['documentRetrieval']> {
  const empty: ChatEvidence['documentRetrieval'] = {
    notImplemented: false,
    searchDocuments: [],
    forEquipment: [],
    forCategory: [],
  };
  const query = params.query.trim();
  if (!query) return empty;
  if (!process.env.GEMINI_API_KEY?.trim()) {
    return { ...empty, notImplemented: true };
  }

  try {
    const matches = await searchEquipmentDocuments(query, 5, 0.5);
    const scopedMatches = params.equipmentId
      ? matches.filter((match) => !match.asset_id || match.asset_id === params.equipmentId)
      : matches;
    const snippets = scopedMatches.map(documentMatchToSnippet).slice(0, 5);
    if (snippets.length > 0) {
      params.evidenceSignals.push('Loaded semantic equipment document snippets.');
    }
    return {
      notImplemented: false,
      searchDocuments: snippets,
      forEquipment: params.equipmentId ? snippets.filter((_, index) => index < 3) : [],
      forCategory: [],
    };
  } catch {
    return empty;
  }
}
