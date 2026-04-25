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

export const CHATBOT_SYSTEM_PROMPT = `
You are the BMERMS hospital biomedical operations assistant embedded in a biomedical engineering resource management system.
You only answer within medical equipment management workflows.
Allowed scope: maintenance tips, preventive maintenance, safe first-line troubleshooting, work-order support, equipment status explanation, analytics explanation, calibration/logistics explanation.
Never provide manufacturer-specific repair steps, exact error-code meanings, calibration service-mode procedures, board-level servicing, bypass or override instructions unless explicitly grounded in provided context.
If context is insufficient, say:
"I can't provide that reliably from the available information. Check the equipment manual or escalate to a qualified biomedical engineer/vendor."
For safe first-line operational troubleshooting, prefer limited safe guidance over refusal.
Use check-manual or escalation for exact unsupported technical specifics or unsafe requests.
Keep responses concise, operational, and professional.
Return JSON only.
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
You are the BMERMS biomedical equipment management copilot.

Introduce yourself and explain how you can help.

Mention:
- tasks and prioritization
- work orders
- equipment summaries
- PM and calibration
- logistics and procurement
- alerts and decision support
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
      return 'Describe BMERMS copilot capabilities briefly and operationally.';
    case 'general_conversation':
    case 'off_topic_safe':
      return 'Give a short, harmless general response, then redirect to BMERMS help in one sentence. Do not invent system data.';
    case 'my_tasks':
      return 'Focus on commitments visible in contextBlocks (work orders, approvals, PM signals). Do not invent assignments. Prefer toolTrace.getMyTasks when present.';
    case 'prioritize_tasks':
      return 'Use rankedOperationalQueue and priorityReasoning as authoritative ordering hints; explain tradeoffs briefly. Surface proactiveSignals from context when present.';
    case 'summarize_equipment':
    case 'summarize_work_order':
      return 'Anchor on evidence + toolTrace (getEquipmentSummary / getWorkOrderSummary) and focusedAssetAnalytics; cite concrete fields (dates, statuses, metrics).';
    case 'safe_troubleshooting':
      return 'Follow tier1Troubleshooting (checklist + message_hints) order. troubleshooting_steps must be safe verification checks, not internal repair. Map hypotheses only to evidence; otherwise state unknown.';
    case 'summarize_alerts':
      return 'Use alertSynthesis.countsBySeverity and getAlertsSummary from toolTrace; group by severity and asset where possible.';
    case 'logistics_status':
    case 'procurement_status':
      return 'Use getInventoryLogisticsStatus / getProcurementStatus in toolTrace; do not invent SKUs or delivery dates.';
    case 'summarize_department_readiness':
      return 'Use getDepartmentReadiness and decision-support blocks; stay role-scoped.';
    default:
      return 'Stay within capability scope; prefer system_data and toolTrace fields over speculation.';
  }
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
        }
      : null,
    contextBlocks: compactContextBlocks(contextBlocks),
    evidence: {
      equipment: evidence.equipment,
      workOrder: evidence.workOrder,
      department: evidence.department,
      maintenanceHistory: evidence.maintenanceHistory,
      pmSnapshot: evidence.pmSnapshot,
      calibrationStatus: evidence.calibrationStatus,
      logisticsSnapshot: evidence.logisticsSnapshot,
      analyticsSnapshot: evidence.analyticsSnapshot,
      manualOrSopTexts: evidence.manualOrSopTexts,
      documentRetrieval: evidence.documentRetrieval,
      evidenceSignals: evidence.evidenceSignals,
    },
    outputContract: {
      decision: 'answer | limited_answer | check_manual | escalate | refuse',
      intelligence_mode: 'standard | troubleshooting | prioritization | synthesis',
      summary: 'string',
      actions: 'string[]',
      insights: 'string[]',
      recommendations: 'string[]',
      escalation_guidance: 'string | optional',
      title: 'string | optional',
      key_findings: 'string[]',
      recommended_actions: 'string[]',
      priority_reasoning: 'string[]',
      likely_causes: 'string[]',
      troubleshooting_steps: 'string[]',
      maintenance_tips: 'string[]',
      required_tools_or_parts: 'string[]',
      escalation_recommendation: 'string | optional',
      reason_for_limit: 'string | optional',
      answer_basis:
        'system_data | system_capabilities | manual_or_sop | general_safe_guidance | insufficient_data | model_output | format_recovery',
      confidence: 'high | medium | low',
      escalation_required: 'boolean',
      entities_referenced: 'string[]',
      follow_up_suggestions: 'string[]',
      proactive_signals: 'string[]',
      routing_explanation: 'string[]',
    },
  };

  const responseInstruction =
    responseMode === 'text'
      ? `Instructions:
- Provide a concise, plain-language response.
- Do not output JSON unless explicitly requested.
- Keep it short and safe.
- For harmless off-topic prompts, answer briefly and add one line inviting BMERMS operational questions.
- Never include toolTrace, routing, telemetry, or provider metadata in the response text.`
      : `Instructions:
- Respect requiredDecision.
- Do not add unsupported technical details.
- Preserve capability focus and avoid drifting into unrelated domains.
- Keep list fields concise and practical.
- If requiredDecision is check_manual/escalate/refuse, make summary direct and operational.
- Never claim model-specific or manufacturer-specific procedures unless explicit manualOrSopTexts evidence exists.
- Include reason_for_limit whenever requiredDecision is limited_answer, check_manual, escalate, or refuse.
- If decision is limited_answer, provide only safe first-line checks and clearly recommend escalation criteria.
- Always populate actions, insights, and recommendations arrays.
- Set escalation_guidance when escalation_required is true.
- Keep proactive_signals concise and sparse (max 3) and never include them in summary.
- Do not include routing metadata, matcher confidence, toolTrace, or telemetry details in summary/actions/insights/recommendations.
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
    systemPrompt: capability === 'assistant_intro' ? ASSISTANT_INTRO_SYSTEM_PROMPT : CHATBOT_SYSTEM_PROMPT,
    userPrompt,
  };
}
