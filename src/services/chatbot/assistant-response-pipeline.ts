import {
  AssistantContentSchema,
  type AssistantContent,
  type CapabilityId,
  type ChatDecision,
  type CopilotParserMetadata,
  type CopilotParserStrategy,
  type ResponseMode,
} from '@/types/chatbot';
import { getCapabilityResponseDefaults } from './capability-response-defaults';
import { AI_UNAVAILABLE_SUMMARY, buildAiUnavailableAssistant, ensureUiSafeAssistant } from './providers/normalize-provider-output';

const DISPLAY_REPAIR_SUMMARY =
  "I could not finish formatting that response. Try rephrasing your question or open the related asset, work order, or report and ask again.";
const DEFAULT_SUMMARY =
  "I could not load the structured details for that question yet. Try rephrasing, or open the related asset/work order/report and ask again.";

type ProviderStatus = 'success' | 'failure';

type NormalizeAssistantResponseParams = {
  rawProviderContent: unknown;
  capability: CapabilityId;
  responseMode: ResponseMode;
  providerStatus: ProviderStatus;
  requiredDecision: ChatDecision;
  fallbackReason?: string;
};

function parserMetadata(params: {
  strategy: CopilotParserStrategy;
  rawText?: string;
  responseMode: ResponseMode;
  structuredValidationPassed?: boolean;
  recovery?: boolean;
  failureReason?: string | null;
  deterministicFallbackUsed?: boolean;
  candidateCount?: number;
}): CopilotParserMetadata {
  return {
    parserStrategy: params.strategy,
    parserRecoveryUsed: Boolean(params.recovery),
    parserFailureReason: params.failureReason ?? null,
    rawContentLength: params.rawText?.length ?? 0,
    structuredValidationPassed: Boolean(params.structuredValidationPassed),
    deterministicFallbackUsed: Boolean(params.deterministicFallbackUsed),
    responseMode: params.responseMode,
    candidateCount: params.candidateCount,
    rawPreview: process.env.CHAT_DEBUG_RAW_PROVIDER === 'true' ? params.rawText?.slice(0, 500) ?? '' : undefined,
  };
}

function coerceString(value: unknown): string {
  if (typeof value === 'string') return value;
  if (value == null) return '';
  if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint') return String(value);
  if (Array.isArray(value)) return value.map(coerceString).filter(Boolean).join('; ');
  if (typeof value === 'object') {
    try {
      return JSON.stringify(value).slice(0, 1000);
    } catch {
      return '[object]';
    }
  }
  return '';
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
  const matches = extractAllBalancedJsonObjects(text);
  return matches.length > 0 ? matches[0] : null;
}

/**
 * Extracts every balanced JSON object substring from the input. Used by the
 * multi-object candidate scorer so the provider can emit several JSON
 * blocks (markdown commentary + assistant payload, retries, etc.) without
 * silently picking the first one.
 */
function extractAllBalancedJsonObjects(text: string): string[] {
  const source = text;
  const results: string[] = [];
  let cursor = 0;
  while (cursor < source.length) {
    const first = source.indexOf('{', cursor);
    if (first < 0) break;
    let depth = 0;
    let inString = false;
    let escaped = false;
    let closed = -1;
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
        if (depth === 0) {
          closed = i;
          break;
        }
      }
    }
    if (closed < 0) break;
    results.push(source.slice(first, closed + 1));
    cursor = closed + 1;
    if (results.length >= 8) break;
  }
  return results;
}

/** Heuristic completeness score for picking the best assistant candidate. */
function scoreAssistantCandidate(candidate: Record<string, unknown>): number {
  let score = 0;
  if (typeof candidate.summary === 'string' && candidate.summary.trim().length > 0) score += 4;
  if (typeof candidate.decision === 'string') score += 2;
  if (typeof candidate.answer_basis === 'string' || typeof candidate.answerBasis === 'string') score += 2;
  if (typeof candidate.confidence === 'string') score += 1;
  const arrayFields = [
    'key_findings',
    'recommended_actions',
    'priority_reasoning',
    'troubleshooting_steps',
    'maintenance_tips',
    'actions',
    'insights',
    'recommendations',
    'evidence_used',
    'links',
    'limitations',
    'source_tables',
    'follow_up_suggestions',
  ];
  for (const field of arrayFields) {
    const value = (candidate as Record<string, unknown>)[field];
    if (Array.isArray(value) && value.length > 0) score += 1;
  }
  return score;
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
      .map((item) => coerceString(item).trim())
      .filter(Boolean)
      .slice(0, maxItems)
      .map((item) => item.slice(0, maxLength));
  }
  const scalar = coerceString(value).trim();
  if (scalar) return [scalar.slice(0, maxLength)];
  return [];
}

function linkArray(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item) => item && typeof item === 'object')
    .map((item) => {
      const row = item as Record<string, unknown>;
      const label = coerceString(row.label).trim().slice(0, 120);
      const href = coerceString(row.href).trim().slice(0, 250);
      const type = coerceString(row.type).trim().slice(0, 60);
      return label && href.startsWith('/') ? { label, href, type: type || undefined } : null;
    })
    .filter(Boolean)
    .slice(0, 10) as Array<{ label: string; href: string; type?: string }>;
}

function sanitizeAssistantSummaryForUi(summary: string) {
  const text = stripCodeFences(summary).trim();
  if (!text) return DISPLAY_REPAIR_SUMMARY;
  if (/toolTrace|providerMetadata|routingExplanation|top candidates|matcher confidence|telemetry/gi.test(text)) {
    return 'I cleaned up internal metadata before showing this response. Try rephrasing if the answer feels incomplete.';
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

function stripIrrelevantTroubleshootingFields(assistant: AssistantContent, capability: CapabilityId): AssistantContent {
  if (capability === 'safe_troubleshooting') return assistant;
  return {
    ...assistant,
    intelligence_mode: assistant.intelligence_mode === 'troubleshooting' ? 'standard' : assistant.intelligence_mode,
    likely_causes: [],
    troubleshooting_steps: [],
    required_tools_or_parts: [],
    maintenance_tips: capability === 'maintenance_tips' ? assistant.maintenance_tips : [],
  };
}

function normalizeObjectPayload(
  rawObject: Record<string, unknown>,
  requiredDecision: ChatDecision,
  capability: CapabilityId
): { assistant: AssistantContent; validationPassed: boolean } {
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
    evidence_used: stringArray(rawObject.evidence_used ?? rawObject.evidenceUsed, 12, 320),
    links: linkArray(rawObject.links),
    limitations: stringArray(rawObject.limitations, 8, 320),
    missingDataFlags: stringArray(rawObject.missingDataFlags ?? rawObject.missing_data_flags, 12, 120),
    data_freshness: typeof rawObject.data_freshness === 'string' ? rawObject.data_freshness.slice(0, 200) : undefined,
    source_tables: stringArray(rawObject.source_tables ?? rawObject.sourceTables, 12, 120),
    data_mode: (() => {
      const v = (rawObject.data_mode ?? rawObject.dataMode) as unknown;
      return typeof v === 'string' && ['live', 'snapshot', 'stale', 'sandbox', 'missing', 'unknown'].includes(v)
        ? (v as AssistantContent['data_mode'])
        : undefined;
    })(),
    data_age_label:
      typeof rawObject.data_age_label === 'string'
        ? rawObject.data_age_label.slice(0, 120)
        : typeof rawObject.dataAgeLabel === 'string'
          ? rawObject.dataAgeLabel.slice(0, 120)
          : undefined,
    action_drafts: [],
  };

  const scoped = stripIrrelevantTroubleshootingFields(normalized, capability);
  const parsed = AssistantContentSchema.safeParse(scoped);
  return {
    assistant: ensureUiSafeAssistant(parsed.success ? parsed.data : scoped, requiredDecision),
    validationPassed: parsed.success,
  };
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
      evidence_used: [],
      links: [],
      limitations: [],
      missingDataFlags: [],
      data_freshness: undefined,
      source_tables: [],
      action_drafts: [],
    },
    requiredDecision
  );
}

function formatRecoveryAssistant(capability: CapabilityId, requiredDecision: ChatDecision): AssistantContent {
  const defaults = getCapabilityResponseDefaults(capability);
  return ensureUiSafeAssistant(
    {
      decision: 'limited_answer',
      title: defaults.title === 'BMEDIS Copilot' ? 'Response formatting issue' : defaults.title,
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
      evidence_used: [],
      links: [],
      limitations: [],
      missingDataFlags: [],
      data_freshness: undefined,
      source_tables: [],
      action_drafts: [],
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
      metadata: parserMetadata({
        strategy: 'provider_failure',
        responseMode,
        recovery: true,
        failureReason: fallbackReason ?? 'provider_unavailable',
      }),
    };
  }

  if (rawProviderContent && typeof rawProviderContent === 'object' && !Array.isArray(rawProviderContent)) {
    const normalized = normalizeObjectPayload(rawProviderContent as Record<string, unknown>, requiredDecision, capability);
    return {
      assistant: normalized.assistant,
      metadata: parserMetadata({
        strategy: 'assistant_object',
        responseMode,
        structuredValidationPassed: normalized.validationPassed,
        recovery: !normalized.validationPassed || normalized.assistant.summary === AI_UNAVAILABLE_SUMMARY,
        failureReason: normalized.validationPassed ? null : 'schema_validation_recovered',
      }),
    };
  }

  const rawText = coerceString(rawProviderContent);
  if (!rawText.trim()) {
    const assistant = formatRecoveryAssistant(capability, requiredDecision);
    return {
      assistant,
      metadata: parserMetadata({
        strategy: 'empty_content',
        rawText,
        responseMode,
        recovery: true,
        failureReason: 'empty_provider_content',
      }),
    };
  }

  if (responseMode === 'text' && !likelyJsonPayload(rawText)) {
    const assistant = wrapPlainTextAsAssistant({ text: rawText, capability, requiredDecision });
    return {
      assistant,
      metadata: parserMetadata({
        strategy: 'plain_text_wrapped',
        rawText,
        responseMode,
      }),
    };
  }

  // Collect every JSON object the provider produced — fenced, raw, multiple
  // — and pick the candidate that validates best against
  // AssistantContentSchema (rather than blindly picking the first).
  const fenceCandidates = collectJsonCandidates(rawText);
  const balancedCandidates = extractAllBalancedJsonObjects(rawText);
  const allCandidatesText = Array.from(new Set([...fenceCandidates, ...balancedCandidates]));

  const parsedCandidates: Array<{ obj: Record<string, unknown>; score: number; validationPassed: boolean; source: 'fence' | 'balanced' }>
    = [];
  for (const candidate of allCandidatesText) {
    const parsed = safeJsonParse(candidate);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) continue;
    const obj = parsed as Record<string, unknown>;
    const normalized = normalizeObjectPayload(obj, requiredDecision, capability);
    parsedCandidates.push({
      obj,
      score: scoreAssistantCandidate(obj) + (normalized.validationPassed ? 6 : 0),
      validationPassed: normalized.validationPassed,
      source: fenceCandidates.includes(candidate) ? 'fence' : 'balanced',
    });
  }

  if (parsedCandidates.length > 0) {
    parsedCandidates.sort((a, b) => b.score - a.score);
    const best = parsedCandidates[0];
    const normalized = normalizeObjectPayload(best.obj, requiredDecision, capability);
    const strategy = best.source === 'balanced' ? 'balanced_json' : 'json_candidate';
    return {
      assistant: normalized.assistant,
      metadata: parserMetadata({
        strategy,
        rawText,
        responseMode,
        structuredValidationPassed: normalized.validationPassed,
        recovery: !normalized.validationPassed || parsedCandidates.length > 1,
        failureReason: normalized.validationPassed ? null : 'schema_validation_recovered',
        candidateCount: parsedCandidates.length,
      }),
    };
  }

  const cleanedText = sanitizeAssistantSummaryForUi(rawText);
  if (cleanedText && cleanedText !== DISPLAY_REPAIR_SUMMARY && !/^\{/.test(cleanedText)) {
    const assistant = wrapPlainTextAsAssistant({ text: cleanedText, capability, requiredDecision });
    return {
      assistant,
      metadata: parserMetadata({
        strategy: 'plain_text_wrapped',
        rawText,
        responseMode,
      }),
    };
  }

  const assistant = formatRecoveryAssistant(capability, requiredDecision);
  return {
    assistant,
    metadata: parserMetadata({
      strategy: 'format_recovery',
      rawText,
      responseMode,
      recovery: true,
      failureReason: 'no_parseable_provider_output',
    }),
  };
}
