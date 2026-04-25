import { AssistantContentSchema, type AssistantContent, type ChatDecision } from '@/types/chatbot';

export const FALLBACK_SUMMARY =
  "I couldn't generate a reliably structured response from the AI provider. Please try again or use the equipment manual/escalation path.";

export const AI_UNAVAILABLE_SUMMARY = 'AI temporarily unavailable';
export const AI_UNAVAILABLE_SUGGESTION = 'Try again shortly';

function buildSafeFallback(requiredDecision: ChatDecision): AssistantContent {
  const fallbackDecision: ChatDecision = requiredDecision === 'answer' ? 'limited_answer' : requiredDecision;
  return {
    decision: fallbackDecision,
    title: 'Operational guidance unavailable',
    summary: FALLBACK_SUMMARY,
    key_findings: [],
    recommended_actions: [],
    priority_reasoning: [],
    likely_causes: [],
    troubleshooting_steps: [],
    maintenance_tips: [],
    required_tools_or_parts: [],
    actions: [],
    insights: [],
    recommendations: [],
    entities_referenced: [],
    follow_up_suggestions: [],
    proactive_signals: [],
    routing_explanation: [],
    intelligence_mode: undefined,
    reason_for_limit: 'Provider output was not reliably parseable into the required structure.',
    answer_basis: 'insufficient_data',
    confidence: 'low',
    escalation_required: fallbackDecision === 'escalate',
    escalation_recommendation:
      fallbackDecision === 'escalate'
        ? 'Escalate to a qualified biomedical engineer or vendor.'
        : undefined,
  };
}

/** When the provider fails after retries or throws; always schema-safe for the UI. */
export function buildAiUnavailableAssistant(requiredDecision: ChatDecision): AssistantContent {
  const decision: ChatDecision =
    requiredDecision === 'refuse' || requiredDecision === 'escalate' ? 'limited_answer' : requiredDecision;
  const candidate: AssistantContent = {
    decision,
    title: 'Service notice',
    summary: AI_UNAVAILABLE_SUMMARY,
    key_findings: [],
    recommended_actions: [],
    priority_reasoning: [],
    likely_causes: [],
    troubleshooting_steps: [],
    maintenance_tips: [],
    required_tools_or_parts: [],
    actions: [AI_UNAVAILABLE_SUGGESTION],
    insights: [],
    recommendations: [AI_UNAVAILABLE_SUGGESTION],
    entities_referenced: [],
    follow_up_suggestions: [AI_UNAVAILABLE_SUGGESTION],
    proactive_signals: [],
    routing_explanation: [],
    intelligence_mode: undefined,
    reason_for_limit: 'The AI service could not complete this request. You can retry in a moment.',
    answer_basis: 'insufficient_data',
    confidence: 'low',
    escalation_required: false,
  };
  const validated = AssistantContentSchema.safeParse(candidate);
  return validated.success ? validated.data : buildSafeFallback('limited_answer');
}

/** Coerce any assistant-like object into a valid AssistantContent for API/UI consumers. */
export function ensureUiSafeAssistant(
  assistant: AssistantContent | null | undefined,
  requiredDecision: ChatDecision
): AssistantContent {
  if (!assistant || typeof assistant !== 'object') {
    return buildAiUnavailableAssistant(requiredDecision);
  }

  const merged: AssistantContent = {
    decision: (assistant.decision as ChatDecision) ?? requiredDecision,
    title: typeof assistant.title === 'string' ? assistant.title.slice(0, 180) : undefined,
    summary:
      typeof assistant.summary === 'string' && assistant.summary.trim()
        ? assistant.summary.slice(0, 2000)
        : FALLBACK_SUMMARY,
    key_findings: Array.isArray(assistant.key_findings) ? assistant.key_findings : [],
    recommended_actions: Array.isArray(assistant.recommended_actions) ? assistant.recommended_actions : [],
    priority_reasoning: Array.isArray(assistant.priority_reasoning) ? assistant.priority_reasoning : [],
    likely_causes: Array.isArray(assistant.likely_causes) ? assistant.likely_causes : [],
    troubleshooting_steps: Array.isArray(assistant.troubleshooting_steps) ? assistant.troubleshooting_steps : [],
    maintenance_tips: Array.isArray(assistant.maintenance_tips) ? assistant.maintenance_tips : [],
    required_tools_or_parts: Array.isArray(assistant.required_tools_or_parts) ? assistant.required_tools_or_parts : [],
    actions: Array.isArray(assistant.actions) ? assistant.actions : [],
    insights: Array.isArray(assistant.insights) ? assistant.insights : [],
    recommendations: Array.isArray(assistant.recommendations) ? assistant.recommendations : [],
    entities_referenced: Array.isArray(assistant.entities_referenced) ? assistant.entities_referenced : [],
    follow_up_suggestions: Array.isArray(assistant.follow_up_suggestions) ? assistant.follow_up_suggestions : [],
    proactive_signals: Array.isArray(assistant.proactive_signals) ? assistant.proactive_signals : [],
    routing_explanation: Array.isArray(assistant.routing_explanation) ? assistant.routing_explanation : [],
    intelligence_mode: assistant.intelligence_mode,
    escalation_recommendation: assistant.escalation_recommendation,
    escalation_guidance: assistant.escalation_guidance,
    reason_for_limit: assistant.reason_for_limit,
    answer_basis: assistant.answer_basis ?? 'insufficient_data',
    confidence: assistant.confidence ?? 'low',
    escalation_required: Boolean(assistant.escalation_required),
  };

  const validated = AssistantContentSchema.safeParse(merged);
  if (!validated.success) {
    return buildAiUnavailableAssistant(requiredDecision);
  }

  const out = validated.data;
  if (out.decision === requiredDecision) {
    return out;
  }
  const withDecision = AssistantContentSchema.safeParse({ ...out, decision: requiredDecision });
  return withDecision.success ? withDecision.data : buildAiUnavailableAssistant(requiredDecision);
}

