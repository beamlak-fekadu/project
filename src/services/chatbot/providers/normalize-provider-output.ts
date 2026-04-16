import { AssistantContentSchema, type AssistantContent, type ChatDecision } from '@/types/chatbot';

const FALLBACK_SUMMARY =
  "I couldn't generate a reliably structured response from the AI provider. Please try again or use the equipment manual/escalation path.";

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
    likely_causes: coerceStringArray(snake.likely_causes ?? camel.likelyCauses, 8, 300),
    troubleshooting_steps: coerceStringArray(snake.troubleshooting_steps ?? camel.troubleshootingSteps, 10, 400),
    maintenance_tips: coerceStringArray(snake.maintenance_tips ?? camel.maintenanceTips, 10, 400),
    required_tools_or_parts: coerceStringArray(snake.required_tools_or_parts ?? camel.requiredToolsOrParts, 10, 200),
    actions: coerceStringArray(snake.actions ?? camel.actions, 10, 400),
    insights: coerceStringArray(snake.insights ?? camel.insights, 10, 400),
    recommendations: coerceStringArray(snake.recommendations ?? camel.recommendations, 10, 400),
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
    summary: FALLBACK_SUMMARY,
    likely_causes: [],
    troubleshooting_steps: [],
    maintenance_tips: [],
    required_tools_or_parts: [],
    actions: [],
    insights: [],
    recommendations: [],
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
      assistant,
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
      assistant: plainTextFallback,
      metadata: {
        parserStrategy: 'plain_text_fallback',
        usedFallback: true,
        candidateCount: candidates.length,
        rawPreview: rawOutput.slice(0, 500),
      },
    };
  }

  return {
    assistant: buildSafeFallback(requiredDecision),
    metadata: {
      parserStrategy: 'empty_output_fallback',
      usedFallback: true,
      candidateCount: candidates.length,
      rawPreview: '',
    },
  };
}
