import {
  CHAT_CAPABILITIES,
  CHAT_DECISIONS,
  type AssistantContent,
  type CapabilityId,
  type ChatDecision,
} from '@/types/chatbot';
import { normalizeAssistantResponse } from './assistant-response-pipeline';
import { ensureUiSafeAssistant } from './providers/normalize-provider-output';

function coerceChatDecision(value: unknown): ChatDecision {
  if (typeof value === 'string' && (CHAT_DECISIONS as readonly string[]).includes(value)) {
    return value as ChatDecision;
  }
  return 'limited_answer';
}

function coerceCapability(value: unknown): CapabilityId {
  if (typeof value === 'string' && (CHAT_CAPABILITIES as readonly string[]).includes(value)) {
    return value as CapabilityId;
  }
  return 'general_system_fallback';
}

const DEFAULT_SUMMARY =
  "I could not load the full system context for that question. Try rephrasing, or open the related asset, work order, or report page and ask again.";

export function normalizeAssistantPayload(
  raw: unknown,
  fallbackSummary?: string,
  capability?: CapabilityId | string
): AssistantContent {
  const normalized = normalizeAssistantResponse({
    rawProviderContent: raw ?? fallbackSummary ?? DEFAULT_SUMMARY,
    capability: coerceCapability(capability),
    responseMode: 'structured',
    providerStatus: 'success',
    requiredDecision: 'limited_answer',
  });
  return normalized.assistant;
}

/** Client/server: coerce persisted or API assistant JSON into a schema-safe shape for rendering. */
export function normalizeAssistantPayloadForUi(
  raw: unknown,
  fallbackSummary?: string,
  requiredDecision?: ChatDecision,
  capability?: CapabilityId | string
): AssistantContent {
  const base = normalizeAssistantPayload(raw, fallbackSummary, capability);
  return ensureUiSafeAssistant(base, requiredDecision ?? coerceChatDecision(base.decision));
}
