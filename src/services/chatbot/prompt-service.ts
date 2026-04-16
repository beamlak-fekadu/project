import type {
  CapabilityId,
  ChatDecision,
  ChatEvidence,
  ChatIntent,
  ConfidenceLevel,
  MemorySnapshot,
  ResolvedEntity,
  SafetyMode,
} from '@/types/chatbot';

export const CHATBOT_SYSTEM_PROMPT = `
You are a hospital biomedical equipment assistant.
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
  } = params;

  const groundingContext = {
    intent,
    capability,
    classifierConfidence: {
      label: confidenceLabel,
      score: confidenceScore,
    },
    safetyMode: safetyMode ?? 'normal',
    requiredDecision: decision,
    resolvedEntities: resolvedEntities ?? [],
    memory: memory
      ? {
          summary: memory.shortSummary,
          focus: memory.focus,
          recentTurns: memory.recentTurns,
        }
      : null,
    contextBlocks: contextBlocks ?? {},
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
      evidenceSignals: evidence.evidenceSignals,
    },
    outputContract: {
      decision: 'answer | limited_answer | check_manual | escalate | refuse',
      summary: 'string',
      actions: 'string[]',
      insights: 'string[]',
      recommendations: 'string[]',
      escalation_guidance: 'string | optional',
      likely_causes: 'string[]',
      troubleshooting_steps: 'string[]',
      maintenance_tips: 'string[]',
      required_tools_or_parts: 'string[]',
      escalation_recommendation: 'string | optional',
      reason_for_limit: 'string | optional',
      answer_basis: 'system_data | manual_or_sop | general_safe_guidance | insufficient_data',
      confidence: 'high | medium | low',
      escalation_required: 'boolean',
    },
  };

  const userPrompt = `
User request:
${message}

Grounding context (JSON):
${JSON.stringify(groundingContext)}

Instructions:
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
- Return JSON only and match outputContract keys exactly.
`.trim();

  return {
    systemPrompt: CHATBOT_SYSTEM_PROMPT,
    userPrompt,
  };
}
