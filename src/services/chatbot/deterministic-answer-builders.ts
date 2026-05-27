import type {
  AssistantContent,
  CapabilityId,
  ChatContextRefs,
  ChatDecision,
  ChatEvidence,
  ChatModuleContext,
  ClassifiedRequest,
  UserChatProfile,
} from '@/types/chatbot';
import { getCapabilityResponseDefaults } from './capability-response-defaults';
import { getCopilotRoleCategory } from './copilot-rbac';
import { buildWorkflowExplainerAnswer, workflowExplainerToAssistant } from './workflow-explainers';
import { handleFollowUp, type FollowUpMemoryContext } from './follow-up-handlers';

type ToolResultLike = {
  ok?: boolean;
  toolName?: string;
  data?: unknown;
  evidenceSignals?: unknown[];
  sourceTables?: unknown[];
  routeLinks?: Array<{ label?: unknown; href?: unknown; type?: unknown }>;
  warnings?: unknown[];
  deniedReason?: unknown;
  staleDataWarning?: unknown;
};

export type DeterministicAnswerParams = {
  capability: CapabilityId;
  decision: ChatDecision;
  profile: UserChatProfile;
  message: string;
  classified?: ClassifiedRequest;
  contextRefs?: ChatContextRefs;
  moduleContext?: ChatModuleContext;
  blocks: Record<string, unknown>;
  evidence: ChatEvidence;
  /** Optional follow-up memory context threaded from the orchestrator. */
  followUpMemory?: FollowUpMemoryContext;
};

function asRows(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value) ? (value.filter((item) => item && typeof item === 'object') as Record<string, unknown>[]) : [];
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function text(value: unknown, fallback = '') {
  if (typeof value === 'string') return value.trim() || fallback;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return fallback;
}

function count(value: unknown) {
  const n = typeof value === 'number' ? value : Number(value ?? 0);
  return Number.isFinite(n) ? n : 0;
}

function lower(value: unknown) {
  return text(value).toLowerCase();
}

function sentenceList(items: string[], max = 4) {
  return items.map((item) => item.trim()).filter(Boolean).slice(0, max);
}

function uniqueStrings(items: unknown[], max: number, maxLen = 220) {
  return Array.from(
    new Set(
      items
        .map((item) => text(item).slice(0, maxLen))
        .filter(Boolean)
    )
  ).slice(0, max);
}

function toolResults(blocks: Record<string, unknown>): ToolResultLike[] {
  const trace = asRecord(blocks.formalToolTrace);
  return asRows(trace?.results) as ToolResultLike[];
}

function toolData(blocks: Record<string, unknown>, name: string): unknown {
  return toolResults(blocks).find((result) => result.toolName === name)?.data;
}

function pageContext(blocks: Record<string, unknown>, moduleContext?: ChatModuleContext): ChatModuleContext {
  const fromTool = asRecord(toolData(blocks, 'read_current_page_context'));
  return {
    ...(fromTool ?? {}),
    ...(moduleContext ?? {}),
  } as ChatModuleContext;
}

function routeLinks(blocks: Record<string, unknown>, moduleContext?: ChatModuleContext) {
  const fromBlocks = Array.isArray(blocks.routeLinks) ? blocks.routeLinks : [];
  const fromTools = toolResults(blocks).flatMap((result) => result.routeLinks ?? []);
  const fromPage = moduleContext?.availableEvidenceLinks ?? [];
  const links = [...fromBlocks, ...fromTools, ...fromPage]
    .map((item) => {
      const row = asRecord(item);
      const label = text(row?.label).slice(0, 120);
      const href = text(row?.href).slice(0, 250);
      const type = text(row?.type).slice(0, 60);
      return label && href.startsWith('/') ? { label, href, type: type || undefined } : null;
    })
    .filter(Boolean) as Array<{ label: string; href: string; type?: string }>;

  const seen = new Set<string>();
  return links.filter((link) => {
    const key = `${link.label}:${link.href}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).slice(0, 6);
}

function sourceTables(blocks: Record<string, unknown>) {
  const fromBlocks = Array.isArray(blocks.sourceTables) ? blocks.sourceTables : [];
  const fromTools = toolResults(blocks).flatMap((result) => result.sourceTables ?? []);
  return uniqueStrings([...fromBlocks, ...fromTools], 12, 120);
}

function evidenceLabels(params: DeterministicAnswerParams) {
  const { blocks, evidence, moduleContext } = params;
  const equipment = getEquipment(blocks, evidence);
  const workOrder = getWorkOrder(blocks, evidence);
  const page = pageContext(blocks, moduleContext);
  const labels: string[] = [];

  const assetLabel = [text(equipment?.asset_code), text(equipment?.name)].filter(Boolean).join(' - ');
  if (assetLabel) labels.push(`Asset ${assetLabel}`);
  if (workOrder) labels.push(`Work order ${text(workOrder.work_order_number, text(workOrder.id, 'selected work order'))}`);
  if (page.selectedRecordLabel) labels.push(text(page.selectedRecordLabel));
  if (page.pageLabel) labels.push(text(page.pageLabel));

  return uniqueStrings(
    [
      ...labels,
      ...(Array.isArray(blocks.evidenceUsed) ? blocks.evidenceUsed : []),
      ...(evidence.evidenceSignals ?? []),
      ...toolResults(blocks).flatMap((result) => result.evidenceSignals ?? []),
    ],
    8
  );
}

function limitations(blocks: Record<string, unknown>, extra: string[] = []) {
  return uniqueStrings(
    [
      ...extra,
      ...(Array.isArray(blocks.toolWarnings) ? blocks.toolWarnings : []),
      ...toolResults(blocks).flatMap((result) => [
        ...(result.warnings ?? []),
        result.deniedReason,
        result.staleDataWarning,
      ]),
    ].map((item) => {
      const value = text(item);
      if (/Tool access denied by copilot RBAC|Role is not allowed to use/i.test(value)) {
        return 'Some cross-module context is outside this role scope.';
      }
      return value;
    }),
    6
  );
}

function sanitizeDecision(decision: ChatDecision): ChatDecision {
  return decision === 'refuse' || decision === 'escalate' || decision === 'check_manual' ? 'limited_answer' : decision;
}

function hasRecordData(params: DeterministicAnswerParams) {
  const { blocks, evidence, moduleContext } = params;
  return Boolean(
      getEquipment(blocks, evidence) ||
      getWorkOrder(blocks, evidence) ||
      (evidence.openWorkOrders?.length ?? 0) ||
      (evidence.maintenanceRequests?.length ?? 0) ||
      asRows(blocks.rankedOperationalQueue).length ||
      asRows(blocks.assignedWorkOrders).length ||
      asRows(blocks.overduePm).length ||
      asRows(blocks.recommendationFlags).length ||
      asRows(blocks.lowStockParts).length ||
      asRows(blocks.procurementPipeline).length ||
      asRows(toolData(blocks, 'read_stock_blockers')).length ||
      asRows(toolData(blocks, 'read_procurement_pipeline')).length ||
      asRecord(toolData(blocks, 'read_pm_compliance')) ||
      asRecord(toolData(blocks, 'read_calibration_status')) ||
      asRows(toolData(blocks, 'read_replacement_risk')).length ||
      asRows(toolData(blocks, 'read_training_status')).length ||
      asRows(toolData(blocks, 'read_disposal_status')).length ||
      asRows(toolData(blocks, 'read_equipment_history')).length ||
      asRows(toolData(blocks, 'read_qr_scan_evidence')).length ||
      asRecord(toolData(blocks, 'read_offline_sync_summary')) ||
      moduleContext?.pageSummary ||
      moduleContext?.visibleCounts ||
      (evidence.evidenceSignals ?? []).length
  );
}

function baseAssistant(
  params: DeterministicAnswerParams,
  patch: Partial<AssistantContent> & { summary: string }
): AssistantContent {
  const defaults = getCapabilityResponseDefaults(params.capability);
  const recordBacked = hasRecordData(params);
  return {
    decision: sanitizeDecision(params.decision),
    title: patch.title ?? defaults.title,
    intelligence_mode: patch.intelligence_mode ?? defaults.intelligence_mode,
    summary: patch.summary.slice(0, 2000),
    key_findings: sentenceList(patch.key_findings ?? [], 8),
    recommended_actions: sentenceList(patch.recommended_actions ?? [], 8),
    priority_reasoning: sentenceList(patch.priority_reasoning ?? [], 8),
    likely_causes: sentenceList(patch.likely_causes ?? [], 6),
    troubleshooting_steps: sentenceList(patch.troubleshooting_steps ?? [], 8),
    maintenance_tips: sentenceList(patch.maintenance_tips ?? [], 8),
    required_tools_or_parts: sentenceList(patch.required_tools_or_parts ?? [], 6),
    actions: sentenceList(patch.actions ?? patch.recommended_actions ?? [], 8),
    insights: sentenceList(patch.insights ?? patch.key_findings ?? [], 8),
    recommendations: sentenceList(patch.recommendations ?? patch.recommended_actions ?? [], 8),
    escalation_guidance: patch.escalation_guidance,
    escalation_recommendation: patch.escalation_recommendation,
    reason_for_limit: patch.reason_for_limit,
    answer_basis: patch.answer_basis ?? (recordBacked ? 'system_data' : 'general_safe_guidance'),
    confidence: patch.confidence ?? (recordBacked ? 'medium' : 'low'),
    escalation_required: Boolean(patch.escalation_required),
    entities_referenced: uniqueStrings(patch.entities_referenced ?? evidenceLabels(params), 10),
    follow_up_suggestions: sentenceList(patch.follow_up_suggestions ?? defaults.follow_up_suggestions, 4),
    proactive_signals: sentenceList(patch.proactive_signals ?? [], 3),
    routing_explanation: sentenceList(patch.routing_explanation ?? [], 8),
    evidence_used: uniqueStrings(patch.evidence_used ?? evidenceLabels(params), 10),
    links: patch.links ?? routeLinks(params.blocks, params.moduleContext),
    limitations: uniqueStrings([...(patch.limitations ?? []), ...limitations(params.blocks)], 6),
    missingDataFlags: uniqueStrings(patch.missingDataFlags ?? params.evidence.missingDataFlags ?? [], 12),
    data_freshness: patch.data_freshness ?? (recordBacked ? 'Current scoped BMEDIS records and page context.' : undefined),
    source_tables: uniqueStrings(patch.source_tables ?? sourceTables(params.blocks), 12),
    action_drafts: [],
  };
}

function getEquipment(blocks: Record<string, unknown>, evidence: ChatEvidence) {
  return (
    asRecord(toolData(blocks, 'read_equipment_status')) ??
    asRecord(toolData(blocks, 'read_qr_asset_context')) ??
    asRecord(blocks.equipment) ??
    asRecord(evidence.equipment)
  );
}

function getWorkOrder(blocks: Record<string, unknown>, evidence: ChatEvidence) {
  return asRecord(toolData(blocks, 'read_work_order_status')) ?? asRecord(blocks.workOrder) ?? asRecord(evidence.workOrder);
}

function assetName(asset: Record<string, unknown> | null) {
  if (!asset) return 'this asset';
  return [text(asset.asset_code), text(asset.name)].filter(Boolean).join(' - ') || text(asset.id, 'this asset');
}

function linkedAssetLabel(row: Record<string, unknown> | null) {
  const asset = asRecord(row?.equipment_assets);
  return assetName(asset) || text(row?.asset_id, 'asset');
}

function workOrderAssetLabel(row: Record<string, unknown> | null) {
  const asset = asRecord(row?.equipment_assets);
  if (!asset) return '';
  return [text(asset.asset_code), text(asset.name)].filter(Boolean).join(' - ');
}

function criticalActionLabel(row: Record<string, unknown> | null) {
  if (!row) return 'the top critical action';
  const title = text(row.title, text(row.assetName));
  const category = text(row.category).replace(/_/g, ' ');
  const score = row.score != null ? `score ${Math.round(count(row.score))}` : '';
  const urgency = text(row.urgency);
  return [title, category ? `(${category})` : '', score, urgency].filter(Boolean).join(' ');
}

function summarizeStatusFields(row: Record<string, unknown> | null, fields: string[]) {
  if (!row) return [];
  return fields
    .map((field) => {
      const value = text(row[field]);
      return value ? `${field.replace(/_/g, ' ')}: ${value}` : '';
    })
    .filter(Boolean);
}

function buildOperationalPriorityAnswer(params: DeterministicAnswerParams): AssistantContent | null {
  const { blocks, profile } = params;
  const commandSnapshot = asRecord(toolData(blocks, 'read_command_center_snapshot'));
  const criticalActions = asRows(commandSnapshot?.criticalActions).slice(0, 4);
  const queue = asRows(blocks.rankedOperationalQueue).slice(0, 4);
  const workOrders = asRows(blocks.assignedWorkOrders);
  const overduePm = asRows(blocks.overduePm);
  const flags = asRows(blocks.recommendationFlags);
  const lowStock = asRows(blocks.lowStockParts).length ? asRows(blocks.lowStockParts) : asRows(toolData(blocks, 'read_stock_blockers'));
  const roleCategory = getCopilotRoleCategory(profile);

  if (!criticalActions.length && !queue.length && !workOrders.length && !overduePm.length && !flags.length && !lowStock.length) return null;

  if ((roleCategory === 'bme_head' || roleCategory === 'admin' || roleCategory === 'developer') && criticalActions.length) {
    const first = criticalActions[0];
    const label = criticalActionLabel(first);
    const breakdown = asRows(first?.scoreBreakdown).length
      ? asRows(first?.scoreBreakdown).map((row) => text(row))
      : Array.isArray(first?.scoreBreakdown)
        ? (first.scoreBreakdown as unknown[]).map((item) => text(item)).filter(Boolean)
        : [];
    return baseAssistant(params, {
      summary: `On the Command Center, the most urgent action is ${label}. This is ranked by the Critical Action Score, which combines the category base weight with item signals like condition, RPN, age, PM/calibration delay, stock state, or procurement delay depending on the category.`,
      key_findings: criticalActions.map((item, index) => {
        const department = text(item.departmentName);
        const reason = text(item.reason);
        return `${index + 1}. ${criticalActionLabel(item)}${department ? ` in ${department}` : ''}${reason ? `: ${reason}` : ''}.`;
      }),
      priority_reasoning: [
        ...breakdown,
        'Urgency bands: critical >= 180, high >= 150, medium >= 100.',
        ...criticalActions.slice(1, 4).map((item) => `${criticalActionLabel(item)} is next because its Critical Action Score is lower than the top item.`),
      ],
      recommended_actions: [
        text(first?.primaryAction)
          ? `${text(first.primaryAction)} for ${text(first.title, 'the top item')} and confirm owner, blocker, and next evidence.`
          : 'Open the top Critical Action item and confirm owner, blocker, and next evidence.',
        'Handle safety/downtime corrective and needs-request items before routine PM unless clinical availability requires a coordinated window.',
        lowStock.length ? 'Coordinate stock blockers with Store before assigning technician time to a blocked repair.' : '',
      ].filter(Boolean),
      confidence: 'high',
      intelligence_mode: 'prioritization',
      source_tables: ['work_orders', 'maintenance_requests', 'equipment_assets', 'equipment_risk_scores', 'v_calibration_due', 'v_overdue_pm', 'work_order_parts_needed', 'procurement_requests'],
    });
  }

  if (roleCategory === 'technician') {
    const first = workOrders[0];
    if (!first && !overduePm.length) return null;
    const firstWo = first ? text(first.work_order_number, text(first.id, 'assigned work order')) : '';
    const asset = first ? workOrderAssetLabel(first) : '';
    const summary = first
      ? `For your technician queue, work on ${firstWo}${asset ? ` on ${asset}` : ''} first. It is ${text(first.priority, 'unprioritized')} priority and currently ${text(first.status, 'open')}, so start by confirming the observed fault, safety state, parts blocker, and evidence needed before changing status.`
      : `I do not see an assigned active work order in the retrieved technician queue. The next useful check is the oldest or most critical PM/calibration item visible in your scope.`;
    return baseAssistant(params, {
      summary,
      key_findings: [
        workOrders.length ? `${workOrders.length} active work order(s) assigned to you are visible.` : 'No assigned active work order was retrieved.',
        overduePm.length ? `${overduePm.length} overdue PM item(s) are visible in your scope.` : '',
        first ? `Top assigned work: ${firstWo}${asset ? `, ${asset}` : ''}, ${text(first.status)} / ${text(first.priority, 'priority not recorded')}.` : '',
      ].filter(Boolean),
      priority_reasoning: [
        first ? `Assigned work comes before broad hospital triage for the technician role.` : '',
        first ? `${firstWo} is already in your queue, with status ${text(first.status, 'unknown')} and priority ${text(first.priority, 'not recorded')}.` : '',
        overduePm.length ? 'Overdue PM remains important, but active assigned repair work should be checked first when it affects service availability.' : '',
      ].filter(Boolean),
      recommended_actions: [
        first ? 'Open the work order, verify the user-reported symptom, and record findings against the work order.' : 'Check assigned work and PM/calibration queues before starting new work.',
        'If parts or vendor support block progress, add a note and escalate to BME Head or Store instead of reassigning work yourself.',
      ],
      confidence: first ? 'high' : 'medium',
      intelligence_mode: 'prioritization',
    });
  }

  const first = queue[0];
  const firstLabel = text(first?.label, workOrders[0] ? `work order ${text(workOrders[0].work_order_number, text(workOrders[0].id))}` : 'the highest-risk open signal');
  const summary =
    roleCategory === 'viewer'
      ? `Based on current system records, the main management concern is ${firstLabel}. I found operational pressure from ${workOrders.length} active work order(s), ${overduePm.length} overdue PM item(s), and ${flags.length} recommendation flag(s).`
      : `Based on current system records, start with ${firstLabel}. After that, review the remaining active work, overdue PM, and any stock blockers that can delay service restoration.`;

  const reasoning = queue.length
    ? [
        ...queue.map((item) => `${text(item.label, 'Priority item')} ${item.score != null ? `(score ${text(item.score)})` : ''}`.trim()),
        // R30: surface the documented urgency bands so a viewer/BME Head can
        // see WHY the engine ranked these items in this order — not just the
        // scores themselves.
        'Urgency bands: critical ≥ 180, high ≥ 150, medium ≥ 100 (corrective base 100, calibration 85, PM 75, stock 70, replacement 55, procurement 45, training 35).',
      ]
    : [
        workOrders.length ? `${workOrders.length} active work order(s) are in scope.` : '',
        overduePm.length ? `${overduePm.length} PM item(s) are overdue.` : '',
        flags.length ? `${flags.length} recommendation flag(s) are open.` : '',
        lowStock.length ? `${lowStock.length} stock blocker(s) may delay work.` : '',
      ].filter(Boolean);

  const actions =
    roleCategory === 'store_user'
      ? [
          lowStock.length ? 'Start with stockout and low-stock rows that are linked to active work.' : 'Review stock blockers before procurement follow-up.',
          'Open the linked evidence instead of creating maintenance execution work from the store role.',
        ]
      : [
          queue[0] ? `Open ${text(queue[0].label)} and confirm owner, blocker, and next action.` : 'Open the highest-urgency record and confirm ownership.',
          lowStock.length ? 'Coordinate with store/procurement for stock blockers before assigning technician time.' : '',
          overduePm.length ? 'Schedule overdue PM after active safety or downtime work is controlled.' : '',
        ].filter(Boolean);

  return baseAssistant(params, {
    summary,
    key_findings: [
      workOrders.length ? `${workOrders.length} active/assigned work order(s) are visible in this scope.` : '',
      overduePm.length ? `${overduePm.length} overdue PM item(s) are visible.` : '',
      flags.length ? `${flags.length} recommendation flag(s) are visible.` : '',
      lowStock.length ? `${lowStock.length} low-stock or stockout row(s) may block service.` : '',
    ].filter(Boolean),
    priority_reasoning: reasoning,
    recommended_actions: actions,
    confidence: queue.length ? 'high' : 'medium',
    intelligence_mode: 'prioritization',
  });
}

function buildAssetContextAnswer(params: DeterministicAnswerParams): AssistantContent | null {
  const { blocks, evidence, profile } = params;
  const asset = getEquipment(blocks, evidence);
  const embeddedHistory = asRows(asset?.recentMaintenanceEvents);
  const history = asRows(toolData(blocks, 'read_equipment_history')).length
    ? asRows(toolData(blocks, 'read_equipment_history'))
    : embeddedHistory.length
      ? embeddedHistory
      : evidence.maintenanceHistory;
  const analytics = asRecord(blocks.focusedAssetAnalytics);
  const roleCategory = getCopilotRoleCategory(profile);

  if (!asset && !history.length && !analytics) return null;

  const name = assetName(asset);
  const condition = text(asset?.condition, 'condition not recorded');
  const status = text(asset?.status, 'status not recorded');
  const category = asRecord(asset?.equipment_categories);
  const department = asRecord(asset?.departments);
  const model = asRecord(asset?.equipment_models);
  const manufacturer = asRecord(asset?.manufacturers);
  const criticality = text(category?.criticality_level);
  const qrStatus = text(asset?.qr_label_status);
  const selectionReason = text(asset?.selection_reason);
  const riskScores = asRows(analytics?.riskScores);
  const reliabilityMetrics = asRows(analytics?.reliabilityMetrics);
  const replacementPriority = asRows(analytics?.replacementPriority);
  const openWorkOrders = evidence.openWorkOrders ?? [];
  const maintenanceRequests = evidence.maintenanceRequests ?? [];

  const summaryParts = [`Based on current system records, ${name} is marked ${condition} with status ${status}.`];
  if (criticality) summaryParts.push(`Its category criticality is ${criticality}.`);
  if (selectionReason) summaryParts.push(selectionReason);
  if (openWorkOrders.length) summaryParts.push(`There are ${openWorkOrders.length} visible open work order(s) for this asset.`);
  if (maintenanceRequests.length) summaryParts.push(`There are ${maintenanceRequests.length} recent maintenance request(s) linked to it.`);
  if (history.length) summaryParts.push(`I found ${history.length} recent maintenance event(s) linked to it.`);
  if (riskScores.length || reliabilityMetrics.length || replacementPriority.length) {
    summaryParts.push('Risk, reliability, or replacement evidence is available for review.');
  }
  if (qrStatus && params.capability === 'qr_asset_context') summaryParts.push(`The QR label state is ${qrStatus}.`);

  const actions =
    roleCategory === 'technician'
      ? [
          'Check the latest work/order history before inspection so you do not duplicate an existing repair path.',
          'Create or update a corrective request only if you observe a new fault or condition change.',
        ]
      : roleCategory === 'department_user' || roleCategory === 'department_head'
        ? [
            'Report a new problem only if the department is observing a current fault.',
            'Use the linked asset evidence to avoid duplicate requests.',
          ]
        : [
            'Review linked work, PM, calibration, and risk evidence before changing operational priority.',
            'Open the asset profile for the full record trail.',
          ];

  return baseAssistant(params, {
    summary: summaryParts.join(' '),
    key_findings: [
      ...summarizeStatusFields(asset, ['asset_code', 'name', 'condition', 'status', 'qr_label_status']),
      text(model?.name) ? `model: ${text(model?.name)}` : '',
      text(manufacturer?.name) ? `manufacturer: ${text(manufacturer?.name)}` : '',
      text(department?.name) ? `department: ${text(department?.name)}` : '',
      criticality ? `criticality: ${criticality}` : '',
      text(asset?.installation_date) ? `installation date: ${text(asset?.installation_date)}` : '',
      text(asset?.warranty_expiry) ? `warranty expiry: ${text(asset?.warranty_expiry)}` : '',
      text(asset?.service_contract_expiry) ? `service contract expiry: ${text(asset?.service_contract_expiry)}` : '',
      openWorkOrders.length ? `${openWorkOrders.length} open work order(s) visible for this asset.` : '',
      maintenanceRequests.length ? `${maintenanceRequests.length} maintenance request(s) retrieved.` : '',
      history.length ? `${history.length} recent maintenance event(s) retrieved.` : '',
      riskScores.length ? `${riskScores.length} risk score row(s) available.` : '',
      reliabilityMetrics.length ? `${reliabilityMetrics.length} reliability metric row(s) available.` : '',
      replacementPriority.length ? `${replacementPriority.length} replacement priority row(s) available.` : '',
    ].filter(Boolean),
    recommended_actions: actions,
    confidence: asset ? 'high' : 'medium',
    intelligence_mode: 'synthesis',
  });
}

function buildWorkOrderAnswer(params: DeterministicAnswerParams): AssistantContent | null {
  const { blocks, evidence, profile } = params;
  const wo = getWorkOrder(blocks, evidence);
  if (!wo) return null;

  const number = text(wo.work_order_number, text(wo.id, 'this work order'));
  const status = text(wo.status, 'status not recorded');
  const priority = text(wo.priority, 'priority not recorded');
  const type = text(wo.work_type);
  const roleCategory = getCopilotRoleCategory(profile);
  const asset = asRecord(wo.equipment_assets);
  const assetLabel = assetName(asset);

  const summary = `Based on the retrieved work-order record, ${number} is ${status} with ${priority} priority${type ? ` for ${type} work` : ''}${asset ? ` on ${assetLabel}` : ''}. The useful next step is to confirm the current blocker, owner, and completion criteria before changing status.`;

  return baseAssistant(params, {
    summary,
    key_findings: summarizeStatusFields(wo, ['work_order_number', 'status', 'priority', 'work_type', 'created_at']),
    recommended_actions:
      roleCategory === 'technician'
        ? ['Confirm the observed fault and document only verified work.', 'Escalate if parts, vendor support, or safety risk blocks progress.']
        : ['Open the exact work order and confirm assignment/blocker state.', 'Use the work-order trail as the evidence record for follow-up.'],
    confidence: 'high',
    intelligence_mode: 'synthesis',
  });
}

function buildDepartmentStatusAnswer(params: DeterministicAnswerParams): AssistantContent | null {
  const readiness = asRows(toolData(params.blocks, 'read_department_readiness')).length
    ? asRows(toolData(params.blocks, 'read_department_readiness'))
    : asRows(params.blocks.readinessSnapshot);
  const flags = asRows(params.blocks.recommendationFlags);
  const overduePm = asRows(params.blocks.overduePm);
  const roleCategory = getCopilotRoleCategory(params.profile);
  const page = pageContext(params.blocks, params.moduleContext);
  const counts = asRecord(page.visibleCounts);
  if (!readiness.length && !flags.length && !overduePm.length) return null;

  const latest = readiness[0];
  const rawReadinessScore = latest?.readiness_score != null ? count(latest.readiness_score) : null;
  const readinessScore = rawReadinessScore != null
    ? `${Math.round(rawReadinessScore <= 1 ? rawReadinessScore * 100 : rawReadinessScore)}%`
    : '';
  const departmentName = text(params.profile.departmentName, roleCategory === 'viewer' || roleCategory === 'bme_head' ? 'hospital scope' : 'your department');
  const countSummary = counts
    ? Object.entries(counts)
        .map(([key, value]) => `${key.replace(/_/g, ' ')} ${text(value)}`)
        .slice(0, 4)
        .join(', ')
    : '';
  const summary = readinessScore
    ? roleCategory === 'viewer'
      ? `For the read-only hospital view, the latest readiness snapshot is ${readinessScore}. The main oversight risks are open/high-severity flags, overdue PM, calibration gaps, stock blockers, and replacement pressure; use these as questions for the BME team rather than edit actions.`
      : `Based on current readiness records for ${departmentName}, the latest readiness score is ${readinessScore}. The main follow-up is to address equipment issues, overdue PM, and high-severity flags that reduce clinical readiness.`
    : `Based on current scoped records${countSummary ? ` (${countSummary})` : ''}, I found ${flags.length} recommendation flag(s) and ${overduePm.length} overdue PM item(s) affecting readiness.`;

  return baseAssistant(params, {
    summary,
    key_findings: [
      roleCategory !== 'viewer' && departmentName ? `Scope: ${departmentName}.` : '',
      readinessScore ? `Latest readiness score: ${readinessScore}.` : '',
      latest?.essential_total != null ? `${text(latest.essential_functional, '0')} of ${text(latest.essential_total)} essential assets are functional in the latest snapshot.` : '',
      flags.length ? `${flags.length} recommendation flag(s) are visible.` : '',
      overduePm.length ? `${overduePm.length} overdue PM item(s) are visible.` : '',
      countSummary ? `Visible page counts: ${countSummary}.` : '',
    ].filter(Boolean),
    recommended_actions: roleCategory === 'viewer'
      ? ['Ask BME which critical action or compliance gap explains the readiness pressure first.', 'Use the evidence links for review; this role should not create or mutate records.']
      : ['Open the lowest-readiness evidence first.', 'Follow up on active requests and compliance blockers before treating the score as recovered.'],
    confidence: readiness.length ? 'high' : 'medium',
  });
}

function buildDepartmentRequestIntakeAnswer(params: DeterministicAnswerParams): AssistantContent | null {
  const roleCategory = getCopilotRoleCategory(params.profile);
  const msg = params.message.toLowerCase();
  const route = params.moduleContext?.route ?? params.moduleContext?.pathname ?? '';
  const requestIntent = route.startsWith('/maintenance/requests/new') || /\b(help me report|report a problem|problem with this equipment|maintenance request)\b/i.test(msg);
  if (!requestIntent || (roleCategory !== 'department_user' && roleCategory !== 'department_head' && roleCategory !== 'technician')) return null;

  const page = pageContext(params.blocks, params.moduleContext);
  const selected = text(page.selectedRecordLabel);
  const scope = text(params.profile.departmentName, roleCategory === 'technician' ? 'your assigned work scope' : 'your department');

  return baseAssistant(params, {
    title: 'Maintenance Request Intake',
    summary: `I can help prepare a ${roleCategory === 'technician' ? 'work note or maintenance request' : 'department-scoped maintenance request'}${selected ? ` for ${selected}` : ''}. Keep it factual: identify the asset, describe the observed fault, explain clinical impact, and include safe external details. Do not attempt BME execution steps from this role.`,
    key_findings: [
      `Scope: ${scope}.`,
      selected ? `Selected context: ${selected}.` : 'No exact asset was attached, so the request should name or scan the equipment first.',
      'A useful request includes asset/code, department/location, observed symptom, urgency, when noticed, user impact, visible error code, and photo/evidence if supported.',
    ],
    recommended_actions: [
      'Confirm the asset label or QR page before drafting so the request links to the right equipment.',
      'State whether the equipment is unsafe for clinical use, unavailable, intermittent, or still usable with caution.',
      'Leave assignment, work-order creation, and repair execution to the BME workflow.',
    ],
    confidence: selected || route.startsWith('/maintenance/requests/new') ? 'high' : 'medium',
    answer_basis: 'system_capabilities',
  });
}

function buildPmStatusAnswer(params: DeterministicAnswerParams): AssistantContent | null {
  const pm = asRecord(toolData(params.blocks, 'read_pm_compliance'));
  const overdue = asRows(pm?.overdue).length ? asRows(pm?.overdue) : asRows(params.blocks.overduePm);
  const compliance = asRows(pm?.compliance);
  if (!overdue.length && !compliance.length) return null;

  const first = overdue[0];
  const firstLabel = first
    ? `${text(first.plan_name, 'PM task')} for ${text(first.asset_code)} ${text(first.asset_name)}`.trim()
    : '';
  const summary = overdue.length
    ? `Based on current PM records, ${overdue.length} overdue PM task(s) are visible in your permitted scope. Start with ${firstLabel || 'the oldest overdue critical task'} because it is ${text(first?.days_overdue, 'unknown')} day(s) overdue.`
    : `Based on current PM compliance records, I found ${compliance.length} PM compliance row(s) and no overdue PM rows in the permitted scope.`;

  return baseAssistant(params, {
    summary,
    key_findings: [
      overdue.length ? `${overdue.length} overdue PM task(s) retrieved.` : 'No overdue PM rows were retrieved.',
      first?.scheduled_date ? `Oldest visible scheduled date: ${text(first.scheduled_date)}.` : '',
      compliance.length ? `${compliance.length} PM compliance metric row(s) retrieved.` : '',
    ].filter(Boolean),
    recommended_actions: [
      overdue.length ? 'Open the overdue PM schedule and confirm assignment, clinical criticality, and availability window.' : 'Keep monitoring scheduled PM compliance.',
      'Treat PM compliance as a support signal; BME staff should confirm operational priority before rescheduling clinical equipment.',
    ],
    confidence: overdue.length || compliance.length ? 'high' : 'medium',
  });
}

function buildCalibrationStatusAnswer(params: DeterministicAnswerParams): AssistantContent | null {
  const calibration = asRecord(toolData(params.blocks, 'read_calibration_status'));
  const dueRows = asRows(calibration?.dueSoonOrOverdue);
  const latestRecords = asRows(calibration?.latestRecords);
  if (!dueRows.length && !latestRecords.length && !params.evidence.calibrationStatus) return null;

  const first = dueRows[0];
  const days = count(first?.days_until_due);
  const duePhrase = first
    ? days < 0
      ? `${Math.abs(days)} day(s) overdue`
      : `due in ${days} day(s)`
    : '';
  const summary = first
    ? `Based on current calibration records, ${text(first.asset_code)} ${text(first.asset_name)} is the first visible calibration concern and is ${duePhrase}. I found ${dueRows.length} equipment item(s) due soon or overdue in the permitted scope.`
    : `Based on current calibration records, I found ${latestRecords.length} recent calibration record(s), but no due-soon/overdue calibration rows in the permitted scope.`;

  return baseAssistant(params, {
    summary,
    key_findings: [
      dueRows.length ? `${dueRows.length} due-soon/overdue calibration row(s) retrieved.` : 'No due-soon/overdue calibration row was retrieved.',
      first?.next_due_date ? `Next due date: ${text(first.next_due_date)}.` : '',
      first?.result ? `Last result shown in due view: ${text(first.result)}.` : '',
      latestRecords.length ? `${latestRecords.length} latest calibration record(s) available.` : '',
    ].filter(Boolean),
    recommended_actions: [
      dueRows.length ? 'Open the calibration module and schedule/confirm the highest-urgency due item.' : 'Use calibration records as evidence and keep monitoring upcoming due dates.',
      'Do not perform calibration steps without approved standards, tools, SOP, or manufacturer documentation.',
    ],
    confidence: dueRows.length || latestRecords.length ? 'high' : 'medium',
  });
}

function buildRiskAndReplacementAnswer(params: DeterministicAnswerParams): AssistantContent | null {
  const msg = params.message.toLowerCase();
  const replacementTool = asRows(toolData(params.blocks, 'read_replacement_risk'));
  const replacementRows = replacementTool.length ? replacementTool : asRows(params.blocks.replacementPriority);
  const riskRows = asRows(params.blocks.riskScores);
  const reliabilityRows = asRows(params.blocks.reliabilityMetrics);
  const flagRows = asRows(params.blocks.recommendationFlags);
  const wantsReplacement = /\breplacement|rpi|replace|end[-\s]?of[-\s]?life/.test(msg);
  const rows = wantsReplacement ? replacementRows : riskRows;
  if (!rows.length && !replacementRows.length && !reliabilityRows.length && !flagRows.length) return null;

  const first = rows[0] ?? replacementRows[0] ?? reliabilityRows[0] ?? flagRows[0];
  const firstLabel = linkedAssetLabel(first);
  const metricText = wantsReplacement
    ? first?.replacement_priority_index != null
      ? `RPI ${text(first.replacement_priority_index)}${first.rank != null ? `, rank ${text(first.rank)}` : ''}`
      : 'replacement score unavailable'
    : first?.rpn != null
      ? `RPN ${text(first.rpn)} (${text(first.risk_level, 'risk level unavailable')})`
      : 'risk score unavailable';

  const summary = wantsReplacement
    ? `Based on current replacement-priority records, ${firstLabel} is the first visible replacement candidate (${metricText}). This is decision-support evidence, not an automatic replacement approval.`
    : `Based on current risk records, ${firstLabel} is the first visible high-risk item (${metricText}). Risk ranking supports BME review; it does not replace staff judgement.`;

  const topFindings = rows.slice(0, 4).map((row, index) => {
    if (wantsReplacement) {
      return `${index + 1}. ${linkedAssetLabel(row)} - RPI ${text(row.replacement_priority_index, 'n/a')}${row.rank != null ? `, rank ${text(row.rank)}` : ''}.`;
    }
    return `${index + 1}. ${linkedAssetLabel(row)} - RPN ${text(row.rpn, 'n/a')} (${text(row.risk_level, 'risk level unavailable')}).`;
  });

  return baseAssistant(params, {
    summary,
    key_findings: [
      ...topFindings,
      reliabilityRows.length ? `${reliabilityRows.length} reliability metric row(s) are also visible for MTBF/MTTR/availability review.` : '',
      flagRows.length ? `${flagRows.length} active recommendation flag(s) may explain urgency or blockers.` : '',
    ].filter(Boolean),
    recommended_actions: [
      wantsReplacement ? 'Open replacement priority evidence and confirm age, failures, availability, maintenance burden, parts, risk, and cost inputs.' : 'Open the risk/FMEA or asset evidence before changing priority.',
      'Use the ranking as BME decision support; final action should be reviewed by authorized biomedical staff.',
    ],
    priority_reasoning: topFindings,
    confidence: rows.length ? 'high' : 'medium',
    intelligence_mode: 'prioritization',
  });
}

function buildTrainingStatusAnswer(params: DeterministicAnswerParams): AssistantContent | null {
  const rows = asRows(toolData(params.blocks, 'read_training_status')).length
    ? asRows(toolData(params.blocks, 'read_training_status'))
    : asRows(params.blocks.trainingRequests);
  if (!rows.length) return null;
  return baseAssistant(params, {
    summary: `Based on current training records, I found ${rows.length} active training request(s) in the permitted scope. Start with pending or scheduled requests tied to critical equipment or departments with readiness concerns.`,
    key_findings: rows.slice(0, 5).map((row) => `${text(row.request_number, text(row.id))}: ${text(row.training_type, 'training')} is ${text(row.status, 'status unavailable')}.`),
    recommended_actions: ['Open the training module for the exact request evidence.', 'Use training status as workflow evidence; do not assume attendance or competency unless records show it.'],
    confidence: 'high',
  });
}

function buildDisposalStatusAnswer(params: DeterministicAnswerParams): AssistantContent | null {
  const rows = asRows(toolData(params.blocks, 'read_disposal_status')).length
    ? asRows(toolData(params.blocks, 'read_disposal_status'))
    : asRows(params.blocks.disposalPipeline);
  if (!rows.length) return null;
  return baseAssistant(params, {
    summary: `Based on current disposal records, I found ${rows.length} pending or approved disposal request(s) in the permitted scope. These are formal workflow records; replacement candidates alone are not counted as disposal requests.`,
    key_findings: rows.slice(0, 5).map((row) => `${text(row.request_number, text(row.id))}: ${text(row.status, 'status unavailable')} - ${text(row.disposal_method_proposed, 'method not recorded')}.`),
    recommended_actions: ['Open the disposal module and review the exact request before approval or follow-up.', 'Keep replacement evidence separate from formal disposal approval.'],
    confidence: 'high',
  });
}

function buildStockBlockerAnswer(params: DeterministicAnswerParams): AssistantContent | null {
  const lowStock = asRows(toolData(params.blocks, 'read_stock_blockers')).length
    ? asRows(toolData(params.blocks, 'read_stock_blockers'))
    : asRows(params.blocks.lowStockParts);
  const procurement = asRows(toolData(params.blocks, 'read_procurement_pipeline')).length
    ? asRows(toolData(params.blocks, 'read_procurement_pipeline'))
    : asRows(params.blocks.procurementPipeline);
  const askedBlockers = /\b(block|blocker|stockout|low stock|parts? needed|parts?\b.*work)\b/i.test(params.message);
  if (!lowStock.length && !procurement.length) {
    if (!askedBlockers) return null;
    return baseAssistant(params, {
      summary:
        'I do not see an open stock blocker in the retrieved BMEDIS context. System-specific reasons can be: no open work_order_parts_needed rows, the part is above reorder level, the work order is not linked to a part need, filters are hiding the row, or fixture data did not load for this role.',
      key_findings: ['No open work_order_parts_needed blocker rows were retrieved.', 'No low-stock rows were retrieved from the stock blocker view.'],
      recommended_actions: ['Check Spare Parts filters and open work-order parts-needed declarations.', 'If a technician is waiting on a part, ask them to declare the part need on the work order so Store can act on it.'],
      confidence: 'medium',
      source_tables: ['work_order_parts_needed', 'v_low_stock_parts', 'spare_parts'],
    });
  }

  const declared = lowStock.filter((row) => text(row.blocker_source) === 'work_order_parts_needed');
  const first = declared[0] ?? lowStock[0];
  const firstLabel = first ? `${text(first.part_code)} ${text(first.name)}`.trim() : '';
  const linkedWork = text(first?.linked_work_order_number || first?.linked_work_order_id);
  const linkedAsset = [text(first?.linked_asset_code), text(first?.linked_asset_name)].filter(Boolean).join(' - ');
  const summary = firstLabel
    ? declared.length
      ? `Based on declared work_order_parts_needed blockers, start with ${firstLabel}${linkedWork ? ` for work order ${linkedWork}` : ''}${linkedAsset ? ` on ${linkedAsset}` : ''}. It has ${text(first.current_stock, 'unknown')} on hand against reorder level ${text(first.reorder_level, 'unknown')}, and the open parts-needed row makes it a real work blocker rather than just generic low stock.`
      : `Based on current stock records, start with ${firstLabel}. It has ${text(first.current_stock, 'unknown')} on hand against a reorder level of ${text(first.reorder_level, 'unknown')}, so it is the clearest stock risk in the retrieved rows.`
    : `Based on current logistics records, I found ${procurement.length} procurement row(s) that may affect service restoration.`;

  return baseAssistant(params, {
    summary,
    key_findings: [
      declared.length ? `${declared.length} open work_order_parts_needed blocker row(s) were retrieved.` : '',
      lowStock.length ? `${lowStock.length} total stock blocker/low-stock row(s) were retrieved.` : '',
      procurement.length ? `${procurement.length} procurement pipeline row(s) were retrieved.` : '',
      first?.deficit != null ? `Top deficit: ${text(first.deficit)}.` : '',
      ...lowStock.slice(0, 4).map((row) => {
        const source = text(row.blocker_source) === 'work_order_parts_needed' ? 'declared blocker' : 'low-stock signal';
        const wo = text(row.linked_work_order_number || row.linked_work_order_id);
        const asset = [text(row.linked_asset_code), text(row.linked_asset_name)].filter(Boolean).join(' - ');
        return `${text(row.part_code)} ${text(row.name)}: ${source}${wo ? `, WO ${wo}` : ''}${asset ? `, ${asset}` : ''}, stock ${text(row.current_stock, 'unknown')} / reorder ${text(row.reorder_level, 'unknown')}.`;
      }),
    ].filter(Boolean),
    recommended_actions: [
      declared.length ? 'Handle declared parts-needed blockers before generic low-stock cleanup.' : lowStock.length ? 'Open spare parts and resolve stockout/low-stock rows tied to active work first.' : '',
      procurement.length ? 'Track existing procurement before drafting a duplicate request.' : '',
      'Use exact stock/procurement evidence rather than guessing part availability.',
    ].filter(Boolean),
    confidence: 'high',
    source_tables: ['work_order_parts_needed', 'spare_parts', 'work_orders', 'equipment_assets', 'v_low_stock_parts'],
  });
}

function buildTroubleshootingAnswer(params: DeterministicAnswerParams): AssistantContent {
  const checks = asRows(params.blocks.tier1Troubleshooting)
    .map((row) => text(row.check || row.step))
    .filter(Boolean);
  const safeChecks = checks.length
    ? checks
    : [
        'Confirm the power source, plug, socket, cable, and battery state.',
        'Inspect external accessories, probes, connectors, and visible damage.',
        'Check for overheating, blocked ventilation, cleaning issues, and displayed error messages.',
        'Review PM/calibration status and recent work history before escalation.',
      ];

  return baseAssistant(params, {
    title: 'Safe First-Line Troubleshooting',
    summary:
      'I can help with safe first-line checks, but not internal repair, alarm bypass, service mode, firmware, or manufacturer-specific calibration steps. Start with external checks and system history, then escalate if the fault persists or affects clinical safety.',
    troubleshooting_steps: safeChecks,
    recommended_actions: [
      'Stop using the equipment clinically if there is any safety concern.',
      'Record the observed symptom, displayed message, and checks already completed.',
      'Escalate to a qualified biomedical engineer or vendor for internal repair or calibration work.',
    ],
    escalation_guidance: 'Escalate when safe external checks do not restore function, when alarms/safety functions are involved, or when the equipment is critical for care.',
    confidence: checks.length ? 'medium' : 'low',
    answer_basis: hasRecordData(params) ? 'system_data' : 'general_safe_guidance',
    intelligence_mode: 'troubleshooting',
  });
}

function buildReliabilityEvidenceAnswer(params: DeterministicAnswerParams): AssistantContent | null {
  if (!/\b(reliability|metrics? update|mttr|mtbf|availability|repair_duration|downtime|failure_date|evidence)\b/i.test(params.message)) return null;
  if (!/\b(record|log|need|required|update|evidence)\b/i.test(params.message)) return null;

  return baseAssistant(params, {
    title: 'Reliability Evidence',
    summary:
      'To make BMEDIS reliability metrics update, record the work-order completion evidence as structured fields, not just a free-text note. The important fields are repair_duration_hours, downtime_start, downtime_end, failure_date, completion_outcome, and final_equipment_condition. BMEDIS stores the completion event in maintenance_events and derives downtime_logs from the event trigger.',
    key_findings: [
      'repair_duration_hours feeds repair-time evidence for MTTR.',
      'downtime_start and downtime_end feed downtime evidence and the derived downtime_logs row.',
      'failure_date anchors when the failure occurred for reliability timelines.',
      'completion_outcome and final_equipment_condition are required when completing a work order.',
    ],
    recommended_actions: [
      'Before closing the work order, capture when the failure began, when downtime ended, how long repair work took, the outcome, and the final condition.',
      'If a part, vendor, or safety issue blocked completion, record that blocker instead of marking the work complete.',
    ],
    source_tables: ['work_orders', 'maintenance_events', 'downtime_logs', 'equipment_reliability_metrics'],
    confidence: 'high',
    answer_basis: 'system_data',
  });
}

function buildMetricZeroAnswer(params: DeterministicAnswerParams): AssistantContent | null {
  if (params.capability !== 'metric_debug' && !/\bwhy\b.*\b(metric|card|number|value)\b.*\b(0|zero)\b/i.test(params.message)) return null;
  const roleCategory = getCopilotRoleCategory(params.profile);
  const page = pageContext(params.blocks, params.moduleContext);
  const tables = sourceTables(params.blocks);
  const domainTables = tables.filter((table) => !['profiles', 'user_roles', 'moduleContext'].includes(table));
  const defaultMetricTables = ['clinical_readiness_snapshots', 'maintenance_events', 'downtime_logs', 'v_overdue_pm', 'v_calibration_due', 'work_order_parts_needed'];
  const pageLabel = text(page.pageLabel || page.moduleLabel || page.route);
  const pageName = pageLabel && !pageLabel.startsWith('/') ? pageLabel : 'this page';
  const normalSourceLine =
    domainTables.length
      ? `I would check these retrieved sources first: ${domainTables.slice(0, 6).join(', ')}.`
      : `I would check the metric-specific sources first, such as ${defaultMetricTables.slice(0, 4).join(', ')}.`;

  return baseAssistant(params, {
    title: 'Metric Source Check',
    summary:
      `A zero metric in BMEDIS should be treated as "the source produced zero for this scope," not as proof that nothing exists. On ${pageName}, common reasons are: no rows in the source table for your role scope, a stale or missing snapshot refresh, page filters, missing fixture data, or the metric depending on completed events that have not been recorded yet. ${normalSourceLine}`,
    key_findings: [
      'MTTR/MTBF/availability can be zero or empty when maintenance_events lacks repair_duration_hours, failure_date, downtime_start, or downtime_end.',
      'PM/calibration counts can be zero when v_overdue_pm or v_calibration_due has no rows for the current filter/scope.',
      'Stock blockers can be zero when there are no open work_order_parts_needed rows and no part below reorder level.',
      roleCategory === 'developer' ? 'Developer can inspect raw tool trace and freshness metadata in Developer Lab.' : 'This role gets source/freshness explanation only; raw developer traces are hidden.',
    ],
    recommended_actions: [
      'Check the page filters and role scope first.',
      'Ask "where did you get that?" to see the lightweight source list.',
      'Ask BME/Developer to refresh snapshots if the source data should exist but the card still shows zero.',
    ],
    source_tables: domainTables.length ? domainTables : defaultMetricTables,
    confidence: 'medium',
    answer_basis: 'system_data',
  });
}

function buildOfflineSyncAnswer(params: DeterministicAnswerParams): AssistantContent | null {
  const summary = asRecord(toolData(params.blocks, 'read_offline_sync_summary'));
  const rows = asRows(summary?.rows);
  const queueStatus = asRecord(summary?.pageQueueStatus) ?? asRecord(params.moduleContext?.queueStatus);
  if (!summary && !queueStatus) return null;

  const conflicts = rows.filter((row) => lower(row.resolution_status).includes('conflict') || lower(row.sync_status).includes('conflict'));
  const failed = rows.filter((row) => lower(row.sync_status).includes('fail') || lower(row.reported_status).includes('fail'));
  const queued = queueStatus?.queued != null ? count(queueStatus.queued) : rows.filter((row) => lower(row.sync_status).includes('queued')).length;

  return baseAssistant(params, {
    summary: `Based on the offline sync context, I found ${queued} queued item(s), ${failed.length} failed item(s), and ${conflicts.length} conflict item(s) in the available scope. Review conflicts before replaying or trusting the queue as fully synchronized.`,
    key_findings: [
      `Queued: ${queued}.`,
      `Failed: ${failed.length}.`,
      `Conflicts needing review: ${conflicts.length}.`,
      queueStatus?.lastSyncedAt ? `Last synced: ${text(queueStatus.lastSyncedAt)}.` : '',
    ].filter(Boolean),
    recommended_actions: ['Open offline sync and resolve conflicts first.', 'Retry failed rows only after confirming the source record and duplicate risk.'],
    confidence: 'high',
  });
}

function buildQrAssetAnswer(params: DeterministicAnswerParams): AssistantContent | null {
  const asset = getEquipment(params.blocks, params.evidence);
  const scans = asRows(toolData(params.blocks, 'read_qr_scan_evidence'));
  const page = pageContext(params.blocks, params.moduleContext);
  if (!asset && !page.qrToken && !scans.length) return null;

  const name = assetName(asset);
  const labelStatus = text(asset?.qr_label_status, page.qrToken ? 'QR token available from page context' : 'QR status unavailable');
  const revoked = labelStatus === 'revoked';
  const summary = asset
    ? `Based on the QR-linked asset context, ${name} has QR label status ${labelStatus}${revoked ? ' and the token is revoked' : ''}. I found ${scans.length} recent QR scan row(s) in the permitted evidence.`
    : `I can see this is a QR page, but the full linked asset record was not available in the current context. I can still use the page context and any scan evidence that loaded.`;

  return baseAssistant(params, {
    summary,
    key_findings: [
      asset ? `Asset: ${name}.` : '',
      `QR label status: ${labelStatus}.`,
      revoked ? 'QR token is revoked.' : '',
      scans.length ? `${scans.length} recent scan row(s) loaded.` : '',
    ].filter(Boolean),
    recommended_actions: [
      revoked ? 'Do not rely on this label for live workflow; open QR coverage or asset evidence.' : 'Use the linked asset profile for exact maintenance, PM, and calibration evidence.',
      'Create a corrective request only if inspection finds a new current fault.',
    ],
    confidence: asset ? 'high' : 'medium',
  });
}

function buildReportSummaryAnswer(params: DeterministicAnswerParams): AssistantContent | null {
  const report = asRecord(toolData(params.blocks, 'read_report_snapshot')) ?? pageContext(params.blocks, params.moduleContext);
  const reportType = text(report.reportType ?? params.moduleContext?.reportType);
  const pageSummary = text(report.pageSummary ?? params.moduleContext?.pageSummary);
  const counts = asRecord(report.visibleCounts ?? params.moduleContext?.visibleCounts);
  if (!reportType && !pageSummary && !counts) return null;

  const countFindings = counts
    ? Object.entries(counts)
        .map(([key, value]) => `${key.replace(/_/g, ' ')}: ${text(value)}`)
        .slice(0, 5)
    : [];
  return baseAssistant(params, {
    summary: pageSummary
      ? `Based on this report page, ${pageSummary}`
      : `Based on the current report context${reportType ? ` for ${reportType}` : ''}, summarize the visible evidence first and treat missing drilldown data as unavailable rather than inferred.`,
    key_findings: [reportType ? `Report type: ${reportType}.` : '', ...countFindings].filter(Boolean),
    recommended_actions: ['Open the report evidence link for the underlying rows.', 'Use exported report data for formal decisions or audit evidence.'],
    confidence: pageSummary || countFindings.length ? 'medium' : 'low',
  });
}

function buildDeveloperDiagnosticAnswer(params: DeterministicAnswerParams): AssistantContent | null {
  const roleCategory = getCopilotRoleCategory(params.profile);
  if (roleCategory !== 'developer') return null;
  const formalTrace = asRecord(params.blocks.formalToolTrace);
  const selectedTools = Array.isArray(formalTrace?.selectedTools) ? formalTrace.selectedTools.map((item) => text(item)).filter(Boolean) : [];
  const reasons = params.classified?.reasons ?? [];
  const signals = params.classified?.matchedSignals ?? [];
  const candidates = params.classified?.candidates
    ?.slice(0, 4)
    .map((candidate) => `${candidate.capability} (${candidate.confidence.toFixed(2)})`) ?? [];
  const routing = params.classified
    ? [
        `Capability: ${params.classified.capability}.`,
        `Intent: ${params.classified.intent}.`,
        `Classifier confidence: ${params.classified.confidenceLabel} (${params.classified.confidence.toFixed(2)}).`,
        reasons.length ? `Matched reason: ${reasons.slice(0, 2).join(' ')}` : '',
        signals.length ? `Matched signal(s): ${signals.slice(0, 4).join(', ')}.` : '',
        candidates.length ? `Top candidates: ${candidates.join(', ')}.` : '',
        params.classified.fallbackReason ? `Fallback flag: ${params.classified.fallbackReason}.` : '',
      ].filter(Boolean)
    : [];
  if (!selectedTools.length && !routing.length) return null;

  return baseAssistant(params, {
    summary:
      params.classified
        ? `Based on the classifier metadata for this turn, this prompt is routed to ${params.classified.capability}. The main driver is ${reasons[0] ?? signals[0] ?? 'the highest-scoring capability match'}, and developer diagnostics are kept ahead of page-context overrides so routing details do not get swallowed by the current module.`
        : 'Developer diagnostic view: the answer was routed from classifier signals, page context, and the selected read-only copilot tools. Raw provider output stays out of the normal response surface.',
    key_findings: [...routing, selectedTools.length ? `Tools selected: ${selectedTools.join(', ')}.` : ''].filter(Boolean),
    recommended_actions: ['Use Developer Lab for full telemetry and smoke-test actions.', 'Check source tables and tool warnings before treating missing data as a product bug.'],
    routing_explanation: routing,
    confidence: 'high',
  });
}

function buildConceptualAnswer(params: DeterministicAnswerParams): AssistantContent | null {
  const msg = params.message.toLowerCase();
  if (/\brpn\b/.test(msg)) {
    return baseAssistant(params, {
      summary:
        'RPN means Risk Priority Number. In biomedical equipment management, it is a risk-ranking score that combines severity, occurrence, and detectability so the team can compare which equipment risks deserve attention first.',
      key_findings: ['Higher RPN means higher relative risk.', 'RPN is a prioritization aid, not an automatic approval or replacement decision.'],
      recommended_actions: ['Use RPN alongside clinical criticality, downtime, PM/calibration evidence, and parts availability.'],
      answer_basis: 'general_safe_guidance',
      confidence: 'high',
    });
  }
  if (/\bmttr\b/.test(msg)) {
    return baseAssistant(params, {
      summary:
        'MTTR means Mean Time To Repair. It estimates how long repair work usually takes after a failure is reported, so high MTTR can point to repair bottlenecks, parts delays, vendor dependency, or slow diagnosis.',
      recommended_actions: ['Compare MTTR with work-order history and stock/procurement blockers before deciding why it is high.'],
      answer_basis: 'general_safe_guidance',
      confidence: 'high',
    });
  }
  if (/\bmtbf\b/.test(msg)) {
    return baseAssistant(params, {
      summary:
        'MTBF means Mean Time Between Failures. In BMEDIS it helps show reliability: lower MTBF means the equipment is failing more often and may need closer PM, user training review, or replacement evidence review.',
      recommended_actions: ['Use MTBF with failure history, PM compliance, criticality, and replacement score evidence.'],
      answer_basis: 'general_safe_guidance',
      confidence: 'high',
    });
  }
  if (/\bpm compliance\b|\bpreventive maintenance\b/.test(msg)) {
    return baseAssistant(params, {
      summary:
        'PM compliance describes how well scheduled preventive maintenance is being completed on time. For hospital equipment, low PM compliance can increase downtime, safety risk, and calibration or inspection gaps.',
      recommended_actions: ['Prioritize overdue PM for critical clinical areas and equipment with active failures or risk flags.'],
      answer_basis: 'general_safe_guidance',
      confidence: 'high',
    });
  }
  if (/\bavailability\b/.test(msg)) {
    return baseAssistant(params, {
      summary:
        'Availability describes the proportion of time equipment is practically ready for service. In reliability terms, BMEDIS uses MTBF and MTTR together: higher MTBF and lower MTTR usually improve availability.',
      key_findings: ['Formula meaning: Availability = MTBF / (MTBF + MTTR).', 'It is a readiness signal, not a guarantee that a device is clinically safe for use today.'],
      recommended_actions: ['Review downtime, open work orders, PM, calibration, and current condition before treating availability as operational clearance.'],
      answer_basis: 'general_safe_guidance',
      confidence: 'high',
    });
  }
  if (/\bhealth score\b|\bequipment health\b/.test(msg)) {
    return baseAssistant(params, {
      summary:
        'Equipment health score is a decision-support snapshot that combines operational evidence such as condition, reliability, risk, PM/calibration posture, and active blockers where available. It helps identify assets that need BME review.',
      key_findings: ['A low health score should trigger evidence review, not automatic removal or replacement.', 'Always confirm current condition and active workflow records.'],
      recommended_actions: ['Open the asset profile, risk/FMEA evidence, PM/calibration rows, and open work orders before making an operational decision.'],
      answer_basis: 'general_safe_guidance',
      confidence: 'high',
    });
  }
  if (/\brpi\b|\breplacement priority\b|\breplacement index\b/.test(msg)) {
    return baseAssistant(params, {
      summary:
        'RPI means Replacement Priority Index. It ranks equipment for replacement review using evidence such as age, failure pattern, availability, maintenance burden, spare-part pressure, risk, and cost where those inputs are available.',
      key_findings: ['Higher RPI means stronger replacement-review pressure.', 'RPI is decision support only; BME Head/admin review and hospital policy decide final replacement action.'],
      recommended_actions: ['Use RPI alongside service history, current clinical need, procurement constraints, and management approval evidence.'],
      answer_basis: 'general_safe_guidance',
      confidence: 'high',
    });
  }
  if (/\bhow do i use (this page|this system|bmedis)\b|\bwhat can (this|the) page do\b/.test(msg)) {
    const page = pageContext(params.blocks, params.moduleContext);
    return baseAssistant(params, {
      summary: `Use this page to review ${text(page.pageLabel || page.moduleLabel, 'the current BMEDIS workflow')}, check the visible evidence, and open the exact linked records before taking action. I can summarize what is visible here or explain which record to open next.`,
      recommended_actions: ['Ask “summarize this page” for a quick readout.', 'Ask “what should I prioritize?” when you need an operational order.', 'Ask “help me report this problem” only when you want a draft action.'],
      answer_basis: hasRecordData(params) ? 'system_data' : 'system_capabilities',
      confidence: 'medium',
    });
  }
  return null;
}

function buildViewerExecutiveAnswer(params: DeterministicAnswerParams): AssistantContent | null {
  if (getCopilotRoleCategory(params.profile) !== 'viewer') return null;
  const priority = buildOperationalPriorityAnswer(params);
  if (priority) {
    return {
      ...priority,
      summary: priority.summary.replace('start with', 'the first management concern is'),
      recommended_actions: ['Open evidence links for the underlying records.', 'Use this as a management summary, not a mutation workflow.'],
      action_drafts: [],
    };
  }
  return null;
}

export function buildDeterministicAnswerCandidate(params: DeterministicAnswerParams): AssistantContent | null {
  const developer = buildDeveloperDiagnosticAnswer(params);
  if (developer && (params.capability === 'copilot_diagnostics' || params.capability === 'metric_debug' || /classified|classifier|telemetry|provider|parser|usage/i.test(params.message))) {
    return developer;
  }

  // Phase 3: short pronoun-y follow-ups ("why?", "explain simply", "where did
  // you get that?", "what if I ignore it?", "is that safe?", "what happens
  // next?"). Runs before workflow / capability builders so a follow-up is
  // anchored on the previous turn instead of being treated as a brand-new
  // generic question. Only activates when the orchestrator supplied
  // `followUpMemory` — pure capability tests that don't thread memory keep
  // the old behavior so e.g. "why that one first?" still reaches the
  // operational-priority builder.
  if (params.followUpMemory) {
    const followUp = handleFollowUp({
      message: params.message,
      profile: params.profile,
      memory: params.followUpMemory,
      decision: params.decision,
    });
    if (followUp) {
      return followUp.answer;
    }
  }

  // Phase 2: workflow / formula / notification / QR / offline / report /
  // validation explainers. These run before capability-specific builders so
  // questions like "What happens after I complete this WO?" get a real
  // workflow chain answer instead of a generic summary.
  const explainer = buildWorkflowExplainerAnswer({
    message: params.message,
    capability: params.capability,
    profile: params.profile,
    contextRefs: params.contextRefs,
    moduleContext: params.moduleContext,
    evidence: params.evidence,
    decision: params.decision,
  });
  if (explainer) {
    return workflowExplainerToAssistant(explainer, params.decision);
  }

  const metricZero = buildMetricZeroAnswer(params);
  if (metricZero) return metricZero;

  const conceptual = buildConceptualAnswer(params);
  if (conceptual && !hasRecordData(params)) return conceptual;

  if (params.capability === 'safe_troubleshooting' || params.classified?.troubleshootingSubtype === 'safe_general_troubleshooting') {
    return buildTroubleshootingAnswer(params);
  }

  const reliabilityEvidence = buildReliabilityEvidenceAnswer(params);
  if (reliabilityEvidence) return reliabilityEvidence;

  if (params.capability === 'qr_asset_context' || params.moduleContext?.qrToken || params.moduleContext?.route?.startsWith('/qr/a/')) {
    const answer = buildQrAssetAnswer(params);
    if (answer) return answer;
  }

  if (params.capability === 'offline_sync_status' || params.moduleContext?.route?.startsWith('/offline-sync')) {
    const answer = buildOfflineSyncAnswer(params);
    if (answer) return answer;
  }

  if (params.capability === 'report_summary' || params.moduleContext?.reportType || params.moduleContext?.route?.startsWith('/reports')) {
    const answer = buildReportSummaryAnswer(params);
    if (answer) return answer;
  }

  {
    const answer = buildDepartmentRequestIntakeAnswer(params);
    if (answer) return answer;
  }

  if (params.capability === 'logistics_status' || params.capability === 'procurement_status') {
    const answer = buildStockBlockerAnswer(params);
    if (answer) return answer;
  }

  if (params.capability === 'training_status') {
    const answer = buildTrainingStatusAnswer(params);
    if (answer) return answer;
  }

  if (params.capability === 'disposal_status') {
    const answer = buildDisposalStatusAnswer(params);
    if (answer) return answer;
  }

  if (params.capability === 'summarize_work_order') {
    const answer = buildWorkOrderAnswer(params);
    if (answer) return answer;
  }

  if (params.capability === 'summarize_equipment' || params.capability === 'explain_equipment_risk') {
    const answer = buildAssetContextAnswer(params);
    if (answer) return answer;
  }

  if (params.capability === 'explain_equipment_risk') {
    const answer = buildRiskAndReplacementAnswer(params);
    if (answer) return answer;
  }

  if (params.capability === 'explain_pm_status' && /\bcalibration\b/i.test(params.message)) {
    const answer = buildCalibrationStatusAnswer(params);
    if (answer) return answer;
  }

  if (params.capability === 'explain_pm_status') {
    const answer = buildPmStatusAnswer(params);
    if (answer) return answer;
  }

  if (params.capability === 'summarize_department_readiness' || params.capability === 'explain_pm_status') {
    const answer = buildDepartmentStatusAnswer(params);
    if (answer) return answer;
  }

  if (params.capability === 'prioritize_tasks' || params.capability === 'my_tasks' || params.moduleContext?.route?.startsWith('/command')) {
    const viewer = buildViewerExecutiveAnswer(params);
    if (viewer) return viewer;
    const answer = buildOperationalPriorityAnswer(params);
    if (answer) return answer;
  }

  const page = pageContext(params.blocks, params.moduleContext);
  if (page.pageSummary || page.visibleCounts || page.selectedRecordLabel || page.pageDataHints?.length) {
    return baseAssistant(params, {
      summary: page.pageSummary
        ? `Based on the current page context, ${page.pageSummary}`
        : `Based on the current page context, this is ${text(page.selectedRecordLabel || page.pageLabel || page.moduleLabel, 'the active BMEDIS page')}. I can summarize the visible records, explain the evidence, or help draft an action when you explicitly ask for one.`,
      key_findings: [
        page.selectedRecordLabel ? `Selected record: ${page.selectedRecordLabel}.` : '',
        ...(page.pageDataHints ?? []).slice(0, 4),
        ...Object.entries(page.visibleCounts ?? {})
          .map(([key, value]) => `${key.replace(/_/g, ' ')}: ${text(value)}`)
          .slice(0, 4),
      ].filter(Boolean),
      recommended_actions: ['Open exact evidence links before acting.', 'Ask for a draft only when you want the copilot to prepare a request, note, or report.'],
      confidence: 'medium',
    });
  }

  return conceptual;
}

export function deterministicAnswerForPrompt(answer: AssistantContent | null) {
  if (!answer) return null;
  return {
    summary: answer.summary,
    key_findings: answer.key_findings.slice(0, 5),
    recommended_actions: answer.recommended_actions.slice(0, 5),
    priority_reasoning: answer.priority_reasoning.slice(0, 5),
    troubleshooting_steps: answer.troubleshooting_steps.slice(0, 5),
    evidence_used: answer.evidence_used.slice(0, 6),
    links: answer.links.slice(0, 5),
    limitations: answer.limitations.slice(0, 4),
    source_tables: answer.source_tables.slice(0, 8),
    answer_basis: answer.answer_basis,
    confidence: answer.confidence,
  };
}
