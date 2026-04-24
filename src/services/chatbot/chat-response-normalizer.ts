import { CHAT_DECISIONS, type AssistantContent, type ChatDecision } from '@/types/chatbot';

function coerceChatDecision(value: unknown): ChatDecision {
  if (typeof value === 'string' && (CHAT_DECISIONS as readonly string[]).includes(value)) {
    return value as ChatDecision;
  }
  return 'limited_answer';
}
import { ensureUiSafeAssistant } from './providers/normalize-provider-output';

const DEFAULT_SUMMARY =
  "I couldn't generate a reliably structured response from the AI provider. Please try again or use the equipment manual/escalation path.";

function sanitizeUiSummary(value: string) {
  const trimmed = value.trim();
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  const candidate = fenced?.[1]?.trim() ?? trimmed;
  if (!candidate) return DEFAULT_SUMMARY;
  if ((candidate.startsWith('{') && candidate.endsWith('}')) || /"summary"\s*:|{"decision"|{"title"/i.test(candidate)) {
    try {
      const parsed = JSON.parse(candidate) as { summary?: unknown };
      if (typeof parsed.summary === 'string' && parsed.summary.trim()) return parsed.summary.trim().slice(0, 2000);
      return 'I generated a response but it could not be displayed reliably. Please try again.';
    } catch {
      return 'I generated a response but it could not be displayed reliably. Please try again.';
    }
  }
  return candidate.slice(0, 2000);
}

function stringOrUndefined(value: unknown) {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function arrayOfStrings(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value.map((item) => (typeof item === 'string' ? item.trim() : '')).filter(Boolean);
}

export function normalizeAssistantPayload(raw: unknown, fallbackSummary?: string): AssistantContent {
  const source = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const summaryRaw = stringOrUndefined(source.summary) ?? fallbackSummary ?? DEFAULT_SUMMARY;
  const summary = sanitizeUiSummary(summaryRaw);

  const decision = stringOrUndefined(source.decision);
  const answerBasis = stringOrUndefined(source.answer_basis) ?? stringOrUndefined(source.answerBasis);
  const confidence = stringOrUndefined(source.confidence);
  const intelligenceRaw = stringOrUndefined(source.intelligence_mode) ?? stringOrUndefined(source.intelligenceMode);
  const intelligence_mode =
    intelligenceRaw === 'standard' ||
    intelligenceRaw === 'troubleshooting' ||
    intelligenceRaw === 'prioritization' ||
    intelligenceRaw === 'synthesis'
      ? intelligenceRaw
      : undefined;

  return {
    decision: (decision as AssistantContent['decision']) ?? 'limited_answer',
    title: stringOrUndefined(source.title),
    intelligence_mode,
    summary: summary.slice(0, 2000),
    key_findings: arrayOfStrings(source.key_findings ?? source.keyFindings),
    recommended_actions: arrayOfStrings(source.recommended_actions ?? source.recommendedActions),
    priority_reasoning: arrayOfStrings(source.priority_reasoning ?? source.priorityReasoning),
    likely_causes: arrayOfStrings(source.likely_causes ?? source.likelyCauses),
    troubleshooting_steps: arrayOfStrings(source.troubleshooting_steps ?? source.troubleshootingSteps),
    maintenance_tips: arrayOfStrings(source.maintenance_tips ?? source.maintenanceTips),
    required_tools_or_parts: arrayOfStrings(source.required_tools_or_parts ?? source.requiredToolsOrParts),
    actions: arrayOfStrings(source.actions),
    insights: arrayOfStrings(source.insights),
    recommendations: arrayOfStrings(source.recommendations),
    entities_referenced: arrayOfStrings(source.entities_referenced ?? source.entitiesReferenced),
    follow_up_suggestions: arrayOfStrings(source.follow_up_suggestions ?? source.followUpSuggestions),
    proactive_signals: arrayOfStrings(source.proactive_signals ?? source.proactiveSignals),
    routing_explanation: arrayOfStrings(source.routing_explanation ?? source.routingExplanation),
    escalation_recommendation: stringOrUndefined(source.escalation_recommendation ?? source.escalationRecommendation),
    escalation_guidance: stringOrUndefined(source.escalation_guidance ?? source.escalationGuidance),
    reason_for_limit: stringOrUndefined(source.reason_for_limit ?? source.reasonForLimit),
    answer_basis: (answerBasis as AssistantContent['answer_basis']) ?? 'insufficient_data',
    confidence: (confidence as AssistantContent['confidence']) ?? 'low',
    escalation_required:
      typeof source.escalation_required === 'boolean'
        ? source.escalation_required
        : typeof source.escalationRequired === 'boolean'
          ? source.escalationRequired
          : false,
  };
}

/** Client/server: coerce persisted or API assistant JSON into a schema-safe shape for rendering. */
export function normalizeAssistantPayloadForUi(
  raw: unknown,
  fallbackSummary?: string,
  requiredDecision?: ChatDecision
): AssistantContent {
  const base = normalizeAssistantPayload(raw, fallbackSummary);
  return ensureUiSafeAssistant(base, requiredDecision ?? coerceChatDecision(base.decision));
}
