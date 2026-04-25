import { AssistantContentSchema, type AssistantContent, type CapabilityId, type ChatDecision, type ResponseMode } from '@/types/chatbot';
import { getCapabilityResponseDefaults } from './capability-response-defaults';
import { AI_UNAVAILABLE_SUMMARY, buildAiUnavailableAssistant, ensureUiSafeAssistant } from './providers/normalize-provider-output';

const DISPLAY_REPAIR_SUMMARY = 'I generated a response but it could not be displayed reliably. Please try again.';
const DEFAULT_SUMMARY = "I couldn't generate a reliably structured response from the AI provider. Please try again.";

type ProviderStatus = 'success' | 'failure';

type NormalizeAssistantResponseParams = {
  rawProviderContent: unknown;
  capability: CapabilityId;
  responseMode: ResponseMode;
  providerStatus: ProviderStatus;
  requiredDecision: ChatDecision;
  fallbackReason?: string;
};

function coerceString(value: unknown) {
  return typeof value === 'string' ? value : '';
}

function stripCodeFences(text: string) {
  const trimmed = text.trim();
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  return fenced?.[1]?.trim() ?? trimmed;
}

function repairJsonString(candidate: string) {
  return candidate
    .trim()
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'")
    .replace(/,\s*([}\]])/g, '$1')
    .replace(/\u0000/g, '');
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

function extractFirstBalancedJsonObject(text: string): string | null {
  const source = text.trim();
  const first = source.indexOf('{');
  if (first < 0) return null;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = first; i < source.length; i += 1) {
    const ch = source[i];
    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (ch === '\\') {
        escaped = true;
      } else if (ch === '"') {
        inString = false;
      }
      continue;
    }
    if (ch === '"') {
      inString = true;
      continue;
    }
    if (ch === '{') depth += 1;
    if (ch === '}') {
      depth -= 1;
      if (depth === 0) return source.slice(first, i + 1);
    }
  }
  return null;
}

function collectJsonCandidates(raw: string) {
  const candidates = new Set<string>();
  const trimmed = raw.trim();
  if (trimmed) candidates.add(trimmed);
  const noFence = stripCodeFences(raw);
  if (noFence && noFence !== trimmed) candidates.add(noFence);
  const fenceRegex = /```(?:json)?\s*([\s\S]*?)```/gi;
  let match: RegExpExecArray | null;
  while ((match = fenceRegex.exec(raw)) !== null) {
    const body = match[1]?.trim();
    if (body) candidates.add(body);
  }
  const balanced = extractFirstBalancedJsonObject(raw);
  if (balanced) candidates.add(balanced);
  return Array.from(candidates);
}

function likelyJsonPayload(raw: string) {
  const t = raw.trim();
  return t.startsWith('{') || t.startsWith('```') || /"summary"\s*:|{"decision"|{"title"/i.test(t);
}

function stringArray(value: unknown, maxItems: number, maxLength: number) {
  if (Array.isArray(value)) {
    return value
      .map((item) => (typeof item === 'string' ? item.trim() : ''))
      .filter(Boolean)
      .slice(0, maxItems)
      .map((item) => item.slice(0, maxLength));
  }
  return [];
}

function sanitizeAssistantSummaryForUi(summary: string) {
  const text = stripCodeFences(summary).trim();
  if (!text) return DISPLAY_REPAIR_SUMMARY;
  if (/toolTrace|providerMetadata|routingExplanation|top candidates|matcher confidence|telemetry/gi.test(text)) {
    return 'I generated a response but removed internal metadata for display safety.';
  }
  if (/^```/.test(summary.trim())) return DISPLAY_REPAIR_SUMMARY;
  if (/^\{[\s\S]*\}$/.test(text)) {
    const parsed = safeJsonParse(text) as { summary?: unknown } | null;
    if (parsed && typeof parsed === 'object' && typeof parsed.summary === 'string' && parsed.summary.trim()) {
      return parsed.summary.trim().slice(0, 2000);
    }
    return DISPLAY_REPAIR_SUMMARY;
  }
  return text.slice(0, 2000);
}

function normalizeObjectPayload(rawObject: Record<string, unknown>, requiredDecision: ChatDecision): AssistantContent {
  const normalized: AssistantContent = {
    decision: (typeof rawObject.decision === 'string' ? rawObject.decision : requiredDecision) as ChatDecision,
    title: typeof rawObject.title === 'string' ? rawObject.title.slice(0, 180) : undefined,
    intelligence_mode:
      rawObject.intelligence_mode === 'standard' ||
      rawObject.intelligence_mode === 'troubleshooting' ||
      rawObject.intelligence_mode === 'prioritization' ||
      rawObject.intelligence_mode === 'synthesis'
        ? rawObject.intelligence_mode
        : rawObject.intelligenceMode === 'standard' ||
            rawObject.intelligenceMode === 'troubleshooting' ||
            rawObject.intelligenceMode === 'prioritization' ||
            rawObject.intelligenceMode === 'synthesis'
          ? rawObject.intelligenceMode
          : undefined,
    summary: sanitizeAssistantSummaryForUi(coerceString(rawObject.summary) || DEFAULT_SUMMARY),
    key_findings: stringArray(rawObject.key_findings ?? rawObject.keyFindings, 10, 400),
    recommended_actions: stringArray(rawObject.recommended_actions ?? rawObject.recommendedActions, 10, 400),
    priority_reasoning: stringArray(rawObject.priority_reasoning ?? rawObject.priorityReasoning, 10, 400),
    likely_causes: stringArray(rawObject.likely_causes ?? rawObject.likelyCauses, 8, 300),
    troubleshooting_steps: stringArray(rawObject.troubleshooting_steps ?? rawObject.troubleshootingSteps, 10, 400),
    maintenance_tips: stringArray(rawObject.maintenance_tips ?? rawObject.maintenanceTips, 10, 400),
    required_tools_or_parts: stringArray(rawObject.required_tools_or_parts ?? rawObject.requiredToolsOrParts, 10, 200),
    actions: stringArray(rawObject.actions, 10, 400),
    insights: stringArray(rawObject.insights, 10, 400),
    recommendations: stringArray(rawObject.recommendations, 10, 400),
    escalation_guidance: typeof rawObject.escalation_guidance === 'string' ? rawObject.escalation_guidance.slice(0, 600) : undefined,
    escalation_recommendation:
      typeof rawObject.escalation_recommendation === 'string' ? rawObject.escalation_recommendation.slice(0, 600) : undefined,
    reason_for_limit: typeof rawObject.reason_for_limit === 'string' ? rawObject.reason_for_limit.slice(0, 600) : undefined,
    answer_basis: (typeof rawObject.answer_basis === 'string' ? rawObject.answer_basis : 'insufficient_data') as AssistantContent['answer_basis'],
    confidence: (typeof rawObject.confidence === 'string' ? rawObject.confidence : 'low') as AssistantContent['confidence'],
    escalation_required: typeof rawObject.escalation_required === 'boolean' ? rawObject.escalation_required : false,
    entities_referenced: stringArray(rawObject.entities_referenced ?? rawObject.entitiesReferenced, 12, 160),
    follow_up_suggestions: stringArray(rawObject.follow_up_suggestions ?? rawObject.followUpSuggestions, 8, 240),
    proactive_signals: stringArray(rawObject.proactive_signals ?? rawObject.proactiveSignals, 3, 400),
    routing_explanation: stringArray(rawObject.routing_explanation ?? rawObject.routingExplanation, 8, 320),
  };

  const parsed = AssistantContentSchema.safeParse(normalized);
  return ensureUiSafeAssistant(parsed.success ? parsed.data : normalized, requiredDecision);
}

function wrapPlainTextAsAssistant(params: { text: string; capability: CapabilityId; requiredDecision: ChatDecision }): AssistantContent {
  const { text, capability, requiredDecision } = params;
  const defaults = getCapabilityResponseDefaults(capability);
  const decision = requiredDecision === 'answer' ? 'answer' : 'limited_answer';
  return ensureUiSafeAssistant(
    {
      decision,
      title: defaults.title,
      intelligence_mode: defaults.intelligence_mode,
      summary: sanitizeAssistantSummaryForUi(text),
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
      escalation_guidance: undefined,
      escalation_recommendation: undefined,
      reason_for_limit: decision === 'limited_answer' ? 'Provider returned an unstructured response.' : undefined,
      answer_basis: 'model_output',
      confidence: 'medium',
      escalation_required: false,
      entities_referenced: [],
      follow_up_suggestions: defaults.follow_up_suggestions,
      proactive_signals: [],
      routing_explanation: [],
    },
    requiredDecision
  );
}

function formatRecoveryAssistant(capability: CapabilityId, requiredDecision: ChatDecision): AssistantContent {
  const defaults = getCapabilityResponseDefaults(capability);
  return ensureUiSafeAssistant(
    {
      decision: 'limited_answer',
      title: defaults.title === 'BMERMS Assistant' ? 'Response formatting issue' : defaults.title,
      intelligence_mode: defaults.intelligence_mode,
      summary: DISPLAY_REPAIR_SUMMARY,
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
      escalation_guidance: undefined,
      escalation_recommendation: undefined,
      reason_for_limit: 'Provider output could not be parsed reliably.',
      answer_basis: 'format_recovery',
      confidence: 'low',
      escalation_required: false,
      entities_referenced: [],
      follow_up_suggestions: defaults.follow_up_suggestions,
      proactive_signals: [],
      routing_explanation: [],
    },
    requiredDecision
  );
}

export function normalizeAssistantResponse(params: NormalizeAssistantResponseParams) {
  const { rawProviderContent, providerStatus, capability, requiredDecision, responseMode, fallbackReason } = params;

  if (providerStatus === 'failure') {
    const assistant = buildAiUnavailableAssistant(requiredDecision);
    return {
      assistant,
      metadata: {
        parserStrategy: 'provider_failure',
        usedFallback: true,
        responseMode,
        fallbackReason: fallbackReason ?? 'provider_unavailable',
        rawPreview: '',
      },
    };
  }

  if (rawProviderContent && typeof rawProviderContent === 'object' && !Array.isArray(rawProviderContent)) {
    const assistant = normalizeObjectPayload(rawProviderContent as Record<string, unknown>, requiredDecision);
    return {
      assistant,
      metadata: {
        parserStrategy: 'assistant_object',
        usedFallback: assistant.summary === AI_UNAVAILABLE_SUMMARY,
        responseMode,
        rawPreview: '',
      },
    };
  }

  const rawText = coerceString(rawProviderContent);
  if (!rawText.trim()) {
    const assistant = formatRecoveryAssistant(capability, requiredDecision);
    return {
      assistant,
      metadata: {
        parserStrategy: 'empty_content',
        usedFallback: true,
        responseMode,
        rawPreview: '',
      },
    };
  }

  if (responseMode === 'text' && !likelyJsonPayload(rawText)) {
    const assistant = wrapPlainTextAsAssistant({ text: rawText, capability, requiredDecision });
    return {
      assistant,
      metadata: {
        parserStrategy: 'plain_text_wrapped',
        usedFallback: false,
        responseMode,
        rawPreview: rawText.slice(0, 500),
      },
    };
  }

  const candidates = collectJsonCandidates(rawText);
  for (const candidate of candidates) {
    const parsed = safeJsonParse(candidate);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) continue;
    const assistant = normalizeObjectPayload(parsed as Record<string, unknown>, requiredDecision);
    return {
      assistant,
      metadata: {
        parserStrategy: 'json_candidate',
        usedFallback: assistant.summary === DISPLAY_REPAIR_SUMMARY,
        responseMode,
        candidateCount: candidates.length,
        rawPreview: rawText.slice(0, 500),
      },
    };
  }

  const balanced = extractFirstBalancedJsonObject(rawText);
  if (balanced) {
    const parsed = safeJsonParse(balanced);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      const assistant = normalizeObjectPayload(parsed as Record<string, unknown>, requiredDecision);
      return {
        assistant,
        metadata: {
          parserStrategy: 'balanced_json',
          usedFallback: assistant.summary === DISPLAY_REPAIR_SUMMARY,
          responseMode,
          rawPreview: rawText.slice(0, 500),
        },
      };
    }
  }

  const cleanedText = sanitizeAssistantSummaryForUi(rawText);
  if (cleanedText && cleanedText !== DISPLAY_REPAIR_SUMMARY && !/^\{/.test(cleanedText)) {
    const assistant = wrapPlainTextAsAssistant({ text: cleanedText, capability, requiredDecision });
    return {
      assistant,
      metadata: {
        parserStrategy: 'plain_text_wrapped',
        usedFallback: false,
        responseMode,
        rawPreview: rawText.slice(0, 500),
      },
    };
  }

  const assistant = formatRecoveryAssistant(capability, requiredDecision);
  return {
    assistant,
    metadata: {
      parserStrategy: 'format_recovery',
      usedFallback: true,
      responseMode,
      rawPreview: rawText.slice(0, 500),
    },
  };
}
