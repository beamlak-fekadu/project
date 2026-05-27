import type {
  CapabilityId,
  ChatDecision,
  ChatEvidence,
  ChatIntent,
  ClassifiedRequest,
  ConfidenceLevel,
  MemorySnapshot,
  ResolvedEntity,
  SafetyMode,
  UserChatProfile,
  ChatModuleContext,
  ResponseMode,
} from '@/types/chatbot';
import { buildRoutingExplanation } from './classifier-service';
import { buildCopilotRolePromptPolicy } from './role-prompt-policy';

export const CHATBOT_SYSTEM_PROMPT = `
You are BMEDIS Copilot, a role-aware biomedical equipment management assistant embedded in a hospital equipment management system.
BMEDIS records, retrieved tools, current page context, scoped Supabase data, reports, QR/offline context, and deterministic system logic are the source of truth.
Gemini is used only to explain, summarize, and draft from the provided facts. Do not invent asset status, counts, work orders, calibration state, PM compliance, stockouts, procurement state, QR evidence, usage numbers, or department readiness.
If system records are provided, answer from them first. If a deterministicAnswerDraft is provided, treat it as the grounding skeleton and make it clearer, more natural, and more role-appropriate without changing its facts.
Write naturally, like a useful biomedical operations copilot. Avoid raw bullet dumps unless the user asks for a list or the task is operational prioritization.
For normal roles, do not expose routing, parser, provider, telemetry, classifier, or tool-trace details. Developer diagnostics may summarize those details only when the role policy/context allows it.
Include compact evidence and limitations when useful. If data is missing, say exactly what could not be accessed.
For harmless general or conceptual questions, answer normally and connect back to BMEDIS when relevant.
Only support action drafts when the user clearly asks to create, draft, request, report, log, reorder, write, submit, or queue something.
Avoid phrases like "I think", "probably", or "maybe." Use "Based on current system records", "The available evidence shows", or "This is an inference because..." when needed.
Return JSON only.
`.trim();

const NON_TROUBLESHOOTING_SYSTEM_ADDENDUM = `
Unless the selected capability is safe_troubleshooting, do not generate troubleshooting_steps, likely_causes, required_tools_or_parts, maintenance_tips, or generic first-line checks. For summary, status, analytics, report, workflow, and inventory requests, answer only the requested question using available BMEDIS system data and disclose missing data.
`.trim();

const SAFE_TROUBLESHOOTING_SYSTEM_ADDENDUM = `
The selected capability is safe_troubleshooting. Provide only safe first-line external checks, system-history review, and escalation criteria. Never provide internal board-level repair, alarm bypass, service mode, hidden-menu, firmware, component-level, or manufacturer-specific calibration steps.
`.trim();

const JSON_OUTPUT_HARDENING_RULES = `
- Return ONLY a valid JSON object.
- Do not use markdown fences.
- Do not include explanations outside JSON.
- Keep array fields short and practical.
- Limit proactive_signals to at most 3 items.
- Do not include routing metadata in JSON.
- Do not include toolTrace in JSON.
- If data is missing, state that clearly in summary.
`.trim();

const ASSISTANT_INTRO_SYSTEM_PROMPT = `
You are the BMEDIS biomedical equipment management copilot.

Introduce yourself and explain how you can help.

Mention:
- tasks and prioritization
- work orders
- equipment summaries
- PM and calibration
- logistics and procurement
- notifications and decision support
- safe first-line troubleshooting

Be concise and helpful.
`.trim();

function truncateArray<T>(items: T[] | undefined, maxItems: number) {
  if (!Array.isArray(items)) return [];
  return items.slice(0, maxItems);
}

function compactContextBlocks(blocks: Record<string, unknown> | undefined) {
  if (!blocks) return {};
  const compacted = { ...blocks } as Record<string, unknown>;
  for (const [key, value] of Object.entries(compacted)) {
    if (Array.isArray(value)) {
      compacted[key] = truncateArray(value, 8);
    }
  }
  return compacted;
}

function capabilityAddendum(capability: CapabilityId): string {
  switch (capability) {
    case 'assistant_intro':
      return 'Describe BMEDIS copilot capabilities briefly and operationally.';
    case 'general_conversation':
    case 'off_topic_safe':
      return 'Give a short, harmless natural response. If relevant, connect it to BMEDIS help in one sentence. Do not invent system data.';
    case 'my_tasks':
      return 'Focus on commitments visible in contextBlocks (work orders, approvals, PM signals). Do not invent assignments. Prefer toolTrace.getMyTasks when present.';
    case 'prioritize_tasks':
      return 'Use rankedOperationalQueue and priorityReasoning as authoritative ordering hints; explain tradeoffs briefly. Surface proactiveSignals from context when present.';
    case 'summarize_equipment':
    case 'summarize_work_order':
      return 'Anchor on evidence + toolTrace (getEquipmentSummary / getWorkOrderSummary) and focusedAssetAnalytics; cite concrete fields (dates, statuses, metrics).';
    case 'explain_equipment_risk':
      return 'Anchor on risk scores, reliability metrics, replacement priority, recommendation flags, and focused asset analytics. Explain RPN, MTBF, MTTR, availability, health score, or RPI in biomedical terms when asked. Scores support BME review and are not automatic decisions.';
    case 'explain_pm_status':
      return 'Use overdue PM, PM compliance, and calibration-status tools. Separate PM evidence from calibration evidence, cite due/overdue dates when available, and do not invent due dates.';
    case 'safe_troubleshooting':
      return 'Follow tier1Troubleshooting (checklist + message_hints) order. troubleshooting_steps must be safe verification checks, not internal repair. Map hypotheses only to evidence; otherwise state unknown.';
    case 'summarize_alerts':
      return 'Use notification signal synthesis and getAlertsSummary from toolTrace; group by severity and asset where possible. Refer to the user-facing surface as Notifications, not /alerts.';
    case 'logistics_status':
    case 'procurement_status':
      return 'Use getInventoryLogisticsStatus / getProcurementStatus in toolTrace; do not invent SKUs or delivery dates.';
    case 'summarize_department_readiness':
      return 'Use getDepartmentReadiness and decision-support blocks; stay role-scoped.';
    case 'qr_asset_context':
      return 'Use read_qr_asset_context and read_qr_scan_evidence when available. Do not expose raw QR tokens unless already provided by page context and role allows it.';
    case 'offline_sync_status':
      return 'Use read_offline_sync_summary. Explain queue/conflict/stale state without executing sync actions.';
    case 'report_summary':
      return 'Use read_report_snapshot and exact report route links. Summarize evidence and limitations.';
    case 'metric_debug':
      return 'Developer-only metric debugging: explain source table/view, missing data, zero/null meaning, and exact route evidence.';
    case 'copilot_diagnostics':
      return 'Developer-only diagnostics: explain routing/tool/provider/parser/telemetry metadata using provided traces only.';
    case 'usage_status':
      return 'Explain app-tracked Gemini usage. Do not claim exact Google AI Studio billing usage unless provider metadata explicitly reports tokens.';
    default:
      return 'Stay within capability scope; prefer system_data and toolTrace fields over speculation.';
  }
}

function systemPromptForCapability(capability: CapabilityId) {
  if (capability === 'assistant_intro') return ASSISTANT_INTRO_SYSTEM_PROMPT;
  return [
    CHATBOT_SYSTEM_PROMPT,
    capability === 'safe_troubleshooting'
      ? SAFE_TROUBLESHOOTING_SYSTEM_ADDENDUM
      : NON_TROUBLESHOOTING_SYSTEM_ADDENDUM,
  ].join('\n\n');
}

function buildOutputContract(capability: CapabilityId) {
  const base = {
    decision: 'answer | limited_answer | check_manual | escalate | refuse',
    intelligence_mode: 'standard | troubleshooting | prioritization | synthesis',
    summary: 'string',
    title: 'string | optional',
    key_findings: 'string[]',
    recommended_actions: 'string[]',
    actions: 'string[]',
    insights: 'string[]',
    recommendations: 'string[]',
    reason_for_limit: 'string | optional',
    answer_basis:
      'system_data | system_capabilities | manual_or_sop | general_safe_guidance | insufficient_data | model_output | format_recovery',
    confidence: 'high | medium | low',
    escalation_required: 'boolean',
    entities_referenced: 'string[]',
    follow_up_suggestions: 'string[]',
    proactive_signals: 'string[]',
    evidence_used: 'string[]',
    links: '{ label: string, href: string, type?: string }[]',
    limitations: 'string[]',
    missingDataFlags: 'string[]; echo only provided missingDataFlags that materially affect the answer',
    data_freshness: 'string | optional',
    source_tables: 'string[]',
  };

  if (capability === 'safe_troubleshooting') {
    return {
      ...base,
      intelligence_mode: 'troubleshooting',
      troubleshooting_steps: 'string[]',
      likely_causes: 'string[]',
      required_tools_or_parts: 'string[]',
      escalation_guidance: 'string | optional',
      escalation_recommendation: 'string | optional',
    };
  }

  if (capability === 'prioritize_tasks' || capability === 'my_tasks') {
    return {
      ...base,
      intelligence_mode: 'prioritization',
      priority_reasoning: 'string[]',
    };
  }

  if (capability === 'metric_debug' || capability === 'report_summary' || capability === 'copilot_diagnostics') {
    return {
      ...base,
      evidence_used: 'string[] required when available',
      source_tables: 'string[] required when available',
      data_freshness: 'string required when available',
    };
  }

  return base;
}

export function buildPromptPayload(params: {
  message: string;
  intent: ChatIntent;
  capability: CapabilityId;
  confidenceLabel: ConfidenceLevel;
  confidenceScore: number;
  decision: ChatDecision;
  evidence: ChatEvidence;
  contextBlocks?: Record<string, unknown>;
  memory?: MemorySnapshot;
  resolvedEntities?: ResolvedEntity[];
  safetyMode?: SafetyMode;
  classified?: ClassifiedRequest;
  moduleContext?: ChatModuleContext;
  profile?: UserChatProfile;
  responseMode?: ResponseMode;
}) {
  const {
    message,
    intent,
    capability,
    confidenceLabel,
    confidenceScore,
    decision,
    evidence,
    contextBlocks,
    memory,
    resolvedEntities,
    safetyMode,
    classified,
    moduleContext,
    profile,
    responseMode,
  } = params;

  const routingExplanation = classified ? buildRoutingExplanation(classified) : [];
  const toolTrace = contextBlocks && typeof contextBlocks === 'object' && 'toolTrace' in contextBlocks
    ? (contextBlocks as { toolTrace?: unknown }).toolTrace
    : undefined;
  const lastEntityLabels = (resolvedEntities ?? []).map((e) => `${e.type}:${e.label}`).slice(0, 6);
  const lastFocus = [memory?.shortSummary?.slice(0, 400), lastEntityLabels.length ? `Last entities: ${lastEntityLabels.join(', ')}` : '']
    .filter(Boolean)
    .join(' | ')
    .slice(0, 900);

  const groundingContext = {
    intent,
    capability,
    classifierConfidence: {
      label: confidenceLabel,
      score: confidenceScore,
    },
    routingExplanation,
    capabilityInstructions: capabilityAddendum(capability),
    rolePolicy: buildCopilotRolePromptPolicy(profile),
    sessionContext: {
      lastFocus: lastFocus || null,
      threadIntent: memory?.threadIntent,
      toolTrace: toolTrace ?? null,
    },
    safetyMode: safetyMode ?? 'normal',
    requiredDecision: decision,
    resolvedEntities: resolvedEntities ?? [],
    moduleContext: moduleContext ?? null,
    identity: profile
      ? {
          displayName: profile.displayName,
          roleNames: profile.roleNames,
          departmentName: profile.departmentName ?? null,
          departmentId: profile.departmentId,
        }
      : null,
    memory: memory
      ? {
      summary: memory.shortSummary,
      focus: memory.focus,
      recentTurns: memory.recentTurns,
      activeCapability: memory.activeCapability,
      memoryConfidence: memory.memoryConfidence,
      memoryAgeTurns: memory.memoryAgeTurns,
      lastEvidenceCompleteness: memory.lastEvidenceCompleteness,
    }
      : null,
    contextBlocks: compactContextBlocks(contextBlocks),
    evidence: {
      equipment: evidence.equipment,
      workOrder: evidence.workOrder,
      department: evidence.department,
      maintenanceHistory: evidence.maintenanceHistory,
      openWorkOrders: evidence.openWorkOrders ?? [],
      maintenanceRequests: evidence.maintenanceRequests ?? [],
      pmSnapshot: evidence.pmSnapshot,
      calibrationStatus: evidence.calibrationStatus,
      logisticsSnapshot: evidence.logisticsSnapshot,
      analyticsSnapshot: evidence.analyticsSnapshot,
      manualOrSopTexts: evidence.manualOrSopTexts,
      documentRetrieval: evidence.documentRetrieval,
      missingDataFlags: evidence.missingDataFlags,
      evidenceCompleteness: evidence.evidenceCompleteness,
      evidenceSignals: evidence.evidenceSignals,
    },
    outputContract: buildOutputContract(capability),
  };

  const responseInstruction =
    responseMode === 'text'
      ? `Instructions:
- Provide a concise, plain-language response.
- Do not output JSON unless explicitly requested.
- Keep it short and safe.
- For harmless off-topic prompts, answer briefly and add one line inviting BMEDIS operational questions only when it feels relevant.
- Never include toolTrace, routing, telemetry, or provider metadata in the response text.`
      : `Instructions:
- Respect requiredDecision.
- Do not add unsupported technical details.
- Use deterministicAnswerDraft as the factual skeleton when it is present.
- If retrieved records exist, never answer with generic advice alone.
- If evidenceCompleteness is partial or insufficient, answer only from present evidence, state what required evidence is missing, and avoid filling gaps with guesses.
- If context conflict signals are present, prefer explicitly named text entities over page or memory context and mention the limitation briefly.
- Preserve capability focus and avoid drifting into unrelated domains.
- Keep list fields concise and practical.
- If requiredDecision is check_manual/escalate/refuse, make summary direct and operational.
- Never claim model-specific or manufacturer-specific procedures unless explicit manualOrSopTexts evidence exists.
- Include reason_for_limit whenever requiredDecision is limited_answer, check_manual, escalate, or refuse.
- If capability is safe_troubleshooting and decision is limited_answer, provide only safe first-line checks and clearly recommend escalation criteria.
- If capability is not safe_troubleshooting, keep troubleshooting_steps, likely_causes, required_tools_or_parts, and maintenance_tips empty. Do not add generic check power/cables/alarms guidance unless it is directly requested and supported by retrieved evidence.
- For non-troubleshooting limited answers, explain the available system data and what context is missing instead of switching into a troubleshooting checklist.
- Always populate actions, insights, and recommendations arrays.
- Populate evidence_used, source_tables, limitations, data_freshness, and links when tool results provide them.
- Links must use exact href values from tool/page context only; never invent routes or raw HTML.
- Set escalation_guidance when escalation_required is true.
- Keep proactive_signals concise and sparse (max 3) and never include them in summary.
- Do not include routing metadata, matcher confidence, toolTrace, or telemetry details in summary/actions/insights/recommendations.
- Do not show action-draft language unless the user explicitly asked to draft/create/request/log/report/reorder/write/submit/queue.
- Do not say "couldn't generate" or "AI unavailable" when system data or deterministicAnswerDraft can answer the request.
- Set intelligence_mode to troubleshooting when capability is safe_troubleshooting; prioritization for prioritize_tasks; synthesis for summarize_alerts; otherwise standard.
- Return JSON only and match outputContract keys exactly.
- Follow strict output contract:
${JSON_OUTPUT_HARDENING_RULES}`;

  const userPrompt = `
User request:
${message}

Grounding context (JSON):
${JSON.stringify(groundingContext)}

${responseInstruction}
`.trim();

  return {
    systemPrompt: systemPromptForCapability(capability),
    userPrompt,
  };
}
