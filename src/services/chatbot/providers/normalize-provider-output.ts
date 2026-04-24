import { AssistantContentSchema, type AssistantContent, type ChatDecision } from '@/types/chatbot';

const FALLBACK_SUMMARY =
  "I couldn't generate a reliably structured response from the AI provider. Please try again or use the equipment manual/escalation path.";
const DISPLAY_REPAIR_SUMMARY = 'I generated a response but it could not be displayed reliably. Please try again.';

export const AI_UNAVAILABLE_SUMMARY = 'AI temporarily unavailable';
export const AI_UNAVAILABLE_SUGGESTION = 'Try again shortly';

function coerceStringArray(value: unknown, maxItems: number, maxLength: number) {
  if (Array.isArray(value)) {
    return value
      .map((item) => (typeof item === 'string' ? item.trim() : ''))
      .filter(Boolean)
      .slice(0, maxItems)
      .map((item) => item.slice(0, maxLength));
  }

  if (typeof value === 'string' && value.trim()) {
    return value
      .split(/\n|;|•|-/g)
      .map((item) => item.trim())
      .filter(Boolean)
      .slice(0, maxItems)
      .map((item) => item.slice(0, maxLength));
  }

  return [];
}

function extractJsonCandidates(raw: string) {
  const candidates: string[] = [];
  const trimmed = raw.trim();
  if (trimmed) candidates.push(trimmed);

  const fenceRegex = /```(?:json)?\s*([\s\S]*?)```/gi;
  let match: RegExpExecArray | null;
  while ((match = fenceRegex.exec(raw)) !== null) {
    const fenced = match[1]?.trim();
    if (fenced) candidates.push(fenced);
  }

  const firstBrace = raw.indexOf('{');
  const lastBrace = raw.lastIndexOf('}');
  if (firstBrace >= 0 && lastBrace > firstBrace) {
    candidates.push(raw.slice(firstBrace, lastBrace + 1).trim());
  }

  return Array.from(new Set(candidates));
}

function repairJsonString(candidate: string) {
  let normalized = candidate.trim();
  normalized = normalized.replace(/[“”]/g, '"').replace(/[‘’]/g, "'");
  normalized = normalized.replace(/,\s*([}\]])/g, '$1');
  normalized = normalized.replace(/\u0000/g, '');
  return normalized;
}

function safeJsonParse(candidate: string): unknown | null {
  try {
    return JSON.parse(candidate) as unknown;
  } catch {
    try {
      return JSON.parse(repairJsonString(candidate)) as unknown;
    } catch {
      return null;
    }
  }
}

function stripCodeFences(text: string) {
  const trimmed = text.trim();
  const fenceMatch = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  if (fenceMatch?.[1]) return fenceMatch[1].trim();
  return trimmed;
}

function looksLikeJsonPayload(text: string) {
  const t = text.trim();
  if (!t) return false;
  if (t.startsWith('{') && t.endsWith('}')) return true;
  if (t.startsWith('```')) return true;
  if (/"summary"\s*:|{"decision"|{"title"/i.test(t)) return true;
  return false;
}

function sanitizeSummaryText(input: string) {
  const noFence = stripCodeFences(input);
  if (!looksLikeJsonPayload(noFence)) return noFence.slice(0, 2000);
  const parsed = safeJsonParse(noFence);
  if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
    const summary = (parsed as { summary?: unknown }).summary;
    if (typeof summary === 'string' && summary.trim()) return summary.trim().slice(0, 2000);
  }
  return DISPLAY_REPAIR_SUMMARY;
}

function normalizeFromObject(rawObject: Record<string, unknown>, requiredDecision: ChatDecision): AssistantContent {
  const snake = rawObject;
  const camel = rawObject as Record<string, unknown>;

  const normalized: AssistantContent = {
    decision:
      (typeof snake.decision === 'string' ? snake.decision : typeof camel.decision === 'string' ? camel.decision : requiredDecision) as ChatDecision,
    summary: (
      (typeof snake.summary === 'string' && snake.summary) ||
      (typeof camel.summary === 'string' && camel.summary) ||
      FALLBACK_SUMMARY
    ).slice(0, 2000),
    title:
      typeof snake.title === 'string'
        ? snake.title.slice(0, 180)
        : typeof camel.title === 'string'
          ? camel.title.slice(0, 180)
          : undefined,
    key_findings: coerceStringArray(snake.key_findings ?? camel.keyFindings, 10, 400),
    recommended_actions: coerceStringArray(snake.recommended_actions ?? camel.recommendedActions, 10, 400),
    priority_reasoning: coerceStringArray(snake.priority_reasoning ?? camel.priorityReasoning, 10, 400),
    likely_causes: coerceStringArray(snake.likely_causes ?? camel.likelyCauses, 8, 300),
    troubleshooting_steps: coerceStringArray(snake.troubleshooting_steps ?? camel.troubleshootingSteps, 10, 400),
    maintenance_tips: coerceStringArray(snake.maintenance_tips ?? camel.maintenanceTips, 10, 400),
    required_tools_or_parts: coerceStringArray(snake.required_tools_or_parts ?? camel.requiredToolsOrParts, 10, 200),
    actions: coerceStringArray(snake.actions ?? camel.actions, 10, 400),
    insights: coerceStringArray(snake.insights ?? camel.insights, 10, 400),
    recommendations: coerceStringArray(snake.recommendations ?? camel.recommendations, 10, 400),
    entities_referenced: coerceStringArray(snake.entities_referenced ?? camel.entitiesReferenced, 12, 160),
    follow_up_suggestions: coerceStringArray(snake.follow_up_suggestions ?? camel.followUpSuggestions, 8, 240),
    escalation_recommendation:
      typeof snake.escalation_recommendation === 'string'
        ? snake.escalation_recommendation.slice(0, 600)
        : typeof camel.escalationRecommendation === 'string'
          ? camel.escalationRecommendation.slice(0, 600)
          : undefined,
    escalation_guidance:
      typeof snake.escalation_guidance === 'string'
        ? snake.escalation_guidance.slice(0, 600)
        : typeof camel.escalationGuidance === 'string'
          ? camel.escalationGuidance.slice(0, 600)
          : undefined,
    reason_for_limit:
      typeof snake.reason_for_limit === 'string'
        ? snake.reason_for_limit.slice(0, 600)
        : typeof camel.reasonForLimit === 'string'
          ? camel.reasonForLimit.slice(0, 600)
          : undefined,
    answer_basis:
      (typeof snake.answer_basis === 'string'
        ? snake.answer_basis
        : typeof camel.answerBasis === 'string'
          ? camel.answerBasis
          : 'insufficient_data') as AssistantContent['answer_basis'],
    confidence:
      (typeof snake.confidence === 'string'
        ? snake.confidence
        : typeof camel.confidence === 'string'
          ? camel.confidence
          : 'low') as AssistantContent['confidence'],
    escalation_required:
      typeof snake.escalation_required === 'boolean'
        ? snake.escalation_required
        : typeof camel.escalationRequired === 'boolean'
          ? camel.escalationRequired
          : false,
    proactive_signals: coerceStringArray(snake.proactive_signals ?? camel.proactiveSignals, 8, 400),
    routing_explanation: coerceStringArray(snake.routing_explanation ?? camel.routingExplanation, 8, 320),
    intelligence_mode: (() => {
      const raw = snake.intelligence_mode ?? camel.intelligenceMode;
      if (raw === 'standard' || raw === 'troubleshooting' || raw === 'prioritization' || raw === 'synthesis') return raw;
      return undefined;
    })(),
  };

  const validated = AssistantContentSchema.safeParse(normalized);
  if (validated.success) {
    return {
      ...validated.data,
      decision: validated.data.decision === requiredDecision ? validated.data.decision : requiredDecision,
    };
  }

  return buildSafeFallback(requiredDecision);
}

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

export function normalizeProviderOutput(rawOutput: string, requiredDecision: ChatDecision) {
  const candidates = extractJsonCandidates(rawOutput);

  for (const candidate of candidates) {
    const parsed = safeJsonParse(candidate);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      continue;
    }

    const assistant = normalizeFromObject(parsed as Record<string, unknown>, requiredDecision);
    const usedFallback = assistant.summary === FALLBACK_SUMMARY;
    return {
      assistant: ensureUiSafeAssistant(assistant, requiredDecision),
      metadata: {
        parserStrategy: 'json_candidate',
        usedFallback,
        candidateCount: candidates.length,
        rawPreview: rawOutput.slice(0, 500),
      },
    };
  }

  if (rawOutput.trim()) {
    const plainTextFallback = buildSafeFallback(requiredDecision);
    return {
      assistant: ensureUiSafeAssistant(plainTextFallback, requiredDecision),
      metadata: {
        parserStrategy: 'plain_text_fallback',
        usedFallback: true,
        candidateCount: candidates.length,
        rawPreview: rawOutput.slice(0, 500),
      },
    };
  }

  return {
    assistant: ensureUiSafeAssistant(buildSafeFallback(requiredDecision), requiredDecision),
    metadata: {
      parserStrategy: 'empty_output_fallback',
      usedFallback: true,
      candidateCount: candidates.length,
      rawPreview: '',
    },
  };
}

export function normalizeTextModeOutput(rawOutput: string, requiredDecision: ChatDecision): AssistantContent {
  const summary = rawOutput.trim() ? sanitizeSummaryText(rawOutput) : FALLBACK_SUMMARY;
  const decision: ChatDecision = requiredDecision === 'answer' ? 'answer' : 'limited_answer';
  const normalized: AssistantContent = {
    decision,
    title: 'BMERMS Assistant',
    summary: summary.slice(0, 2000),
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
    follow_up_suggestions: ['What is on my to-do?', 'Summarize this work order', 'Show open alerts'],
    proactive_signals: [],
    routing_explanation: [],
    intelligence_mode: 'standard',
    answer_basis: 'general_safe_guidance',
    confidence: 'medium',
    escalation_required: false,
  };

  const validated = AssistantContentSchema.safeParse(normalized);
  return validated.success ? validated.data : buildSafeFallback(requiredDecision);
}

export function normalizeTextModeProviderOutput(rawOutput: string, requiredDecision: ChatDecision) {
  const candidates = extractJsonCandidates(rawOutput);

  for (const candidate of candidates) {
    const parsed = safeJsonParse(candidate);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) continue;
    const assistant = ensureUiSafeAssistant(normalizeFromObject(parsed as Record<string, unknown>, requiredDecision), requiredDecision);
    return {
      assistant,
      metadata: {
        parserStrategy: 'text_mode_json_candidate',
        usedFallback: false,
        candidateCount: candidates.length,
        rawPreview: rawOutput.slice(0, 500),
      },
    };
  }

  if (rawOutput.trim()) {
    return {
      assistant: normalizeTextModeOutput(rawOutput, requiredDecision),
      metadata: {
        parserStrategy: 'text_mode_plain_text',
        usedFallback: false,
        candidateCount: candidates.length,
        rawPreview: rawOutput.slice(0, 500),
      },
    };
  }

  return {
    assistant: ensureUiSafeAssistant(buildSafeFallback(requiredDecision), requiredDecision),
    metadata: {
      parserStrategy: 'text_mode_empty_output_fallback',
      usedFallback: true,
      candidateCount: candidates.length,
      rawPreview: '',
    },
  };
}
