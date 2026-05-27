import {
  ANSWER_BASIS,
  AssistantContentSchema,
  CHAT_DECISIONS,
  CONFIDENCE_LEVELS,
  type AssistantContent,
  type ChatDecision,
} from '@/types/chatbot';

export const FALLBACK_SUMMARY =
  "I could not load the structured details for that request right now. Try rephrasing, or open the asset, work order, or report page and ask again.";

export const AI_UNAVAILABLE_SUMMARY =
  'AI service is temporarily unavailable. The system data was not changed.';
export const AI_UNAVAILABLE_SUGGESTION = 'Try again after a moment';

function buildSafeFallback(requiredDecision: ChatDecision): AssistantContent {
  const fallbackDecision: ChatDecision = requiredDecision === 'answer' ? 'limited_answer' : requiredDecision;
  return {
    decision: fallbackDecision,
    title: 'I need a bit more context',
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
    evidence_used: [],
    links: [],
    limitations: [],
    missingDataFlags: [],
    data_freshness: undefined,
    source_tables: [],
    action_drafts: [],
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

function clampString(value: unknown, maxLength: number) {
  if (typeof value === 'string') return value.trim().slice(0, maxLength);
  if (value == null) return '';
  return String(value).trim().slice(0, maxLength);
}

function clampStringArray(value: unknown, maxItems: number, maxLength: number) {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => clampString(item, maxLength))
    .filter(Boolean)
    .slice(0, maxItems);
}

const RAW_UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Drop chip strings that are nothing more than a raw UUID. */
function filterRawUuidChips(value: unknown, maxItems: number, maxLength: number) {
  const arr = clampStringArray(value, maxItems, maxLength);
  return arr.filter((entry) => !RAW_UUID_PATTERN.test(entry));
}

function looksLikeRawJsonSummary(text: string) {
  const trimmed = text.trim();
  if (!trimmed) return false;
  if (trimmed.startsWith('```')) return true;
  if (/^\{[\s\S]*\}$/.test(trimmed)) return true;
  if (/\[object Object\]/.test(trimmed)) return true;
  return false;
}

function sanitizeSummary(text: string, fallback: string) {
  if (!text) return fallback;
  const cleaned = text.replace(/\[object Object\]/g, '').trim();
  if (!cleaned) return fallback;
  if (looksLikeRawJsonSummary(cleaned)) return fallback;
  return cleaned;
}

function clampLinks(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => {
      if (!item || typeof item !== 'object') return null;
      const row = item as Record<string, unknown>;
      const label = clampString(row.label, 120);
      const href = clampString(row.href, 250);
      const type = clampString(row.type, 60);
      if (!label || !href.startsWith('/')) return null;
      return { label, href, type: type || undefined };
    })
    .filter(Boolean)
    .slice(0, 10) as AssistantContent['links'];
}

function coerceDecision(value: unknown, requiredDecision: ChatDecision): ChatDecision {
  return typeof value === 'string' && (CHAT_DECISIONS as readonly string[]).includes(value)
    ? (value as ChatDecision)
    : requiredDecision;
}

function coerceAnswerBasis(value: unknown): AssistantContent['answer_basis'] {
  return typeof value === 'string' && (ANSWER_BASIS as readonly string[]).includes(value)
    ? (value as AssistantContent['answer_basis'])
    : 'insufficient_data';
}

function coerceConfidence(value: unknown): AssistantContent['confidence'] {
  return typeof value === 'string' && (CONFIDENCE_LEVELS as readonly string[]).includes(value)
    ? (value as AssistantContent['confidence'])
    : 'low';
}

/** When the provider fails after retries or throws; always schema-safe for the UI. */
export function buildAiUnavailableAssistant(requiredDecision: ChatDecision): AssistantContent {
  const decision: ChatDecision =
    requiredDecision === 'refuse' || requiredDecision === 'escalate' ? 'limited_answer' : requiredDecision;
  const candidate: AssistantContent = {
    decision,
    title: 'One moment',
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
    evidence_used: [],
    links: [],
    limitations: [],
    missingDataFlags: [],
    data_freshness: undefined,
    source_tables: [],
    action_drafts: [],
    intelligence_mode: undefined,
    reason_for_limit: 'Provider call did not complete; retry will most likely succeed.',
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
    decision: coerceDecision(assistant.decision, requiredDecision),
    title: typeof assistant.title === 'string' ? clampString(assistant.title, 180) : undefined,
    summary:
      typeof assistant.summary === 'string' && assistant.summary.trim()
        ? clampString(sanitizeSummary(assistant.summary, FALLBACK_SUMMARY), 2000)
        : FALLBACK_SUMMARY,
    key_findings: clampStringArray(assistant.key_findings, 10, 400),
    recommended_actions: clampStringArray(assistant.recommended_actions, 10, 400),
    priority_reasoning: clampStringArray(assistant.priority_reasoning, 10, 400),
    likely_causes: clampStringArray(assistant.likely_causes, 8, 300),
    troubleshooting_steps: clampStringArray(assistant.troubleshooting_steps, 10, 400),
    maintenance_tips: clampStringArray(assistant.maintenance_tips, 10, 400),
    required_tools_or_parts: clampStringArray(assistant.required_tools_or_parts, 10, 200),
    actions: clampStringArray(assistant.actions, 10, 400),
    insights: clampStringArray(assistant.insights, 10, 400),
    recommendations: clampStringArray(assistant.recommendations, 10, 400),
    entities_referenced: filterRawUuidChips(assistant.entities_referenced, 12, 160),
    follow_up_suggestions: clampStringArray(assistant.follow_up_suggestions, 8, 240),
    proactive_signals: clampStringArray(assistant.proactive_signals, 8, 400),
    routing_explanation: clampStringArray(assistant.routing_explanation, 8, 320),
    evidence_used: filterRawUuidChips(assistant.evidence_used, 12, 320),
    links: clampLinks(assistant.links),
    limitations: clampStringArray(assistant.limitations, 8, 320),
    missingDataFlags: clampStringArray(assistant.missingDataFlags, 12, 120),
    data_freshness: typeof assistant.data_freshness === 'string' ? clampString(assistant.data_freshness, 200) : undefined,
    source_tables: clampStringArray(assistant.source_tables, 12, 120),
    data_mode: ['live', 'snapshot', 'stale', 'sandbox', 'missing', 'unknown'].includes(
      assistant.data_mode as string
    )
      ? (assistant.data_mode as AssistantContent['data_mode'])
      : undefined,
    data_age_label:
      typeof assistant.data_age_label === 'string' ? clampString(assistant.data_age_label, 120) : undefined,
    action_drafts: Array.isArray(assistant.action_drafts) ? assistant.action_drafts : [],
    intelligence_mode: assistant.intelligence_mode,
    escalation_recommendation: typeof assistant.escalation_recommendation === 'string' ? clampString(assistant.escalation_recommendation, 600) : undefined,
    escalation_guidance: typeof assistant.escalation_guidance === 'string' ? clampString(assistant.escalation_guidance, 600) : undefined,
    reason_for_limit: typeof assistant.reason_for_limit === 'string' ? clampString(assistant.reason_for_limit, 600) : undefined,
    answer_basis: coerceAnswerBasis(assistant.answer_basis),
    confidence: coerceConfidence(assistant.confidence),
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
