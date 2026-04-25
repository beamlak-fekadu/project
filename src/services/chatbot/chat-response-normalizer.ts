import { CHAT_DECISIONS, type AssistantContent, type ChatDecision } from '@/types/chatbot';
import { normalizeAssistantResponse } from './assistant-response-pipeline';

function coerceChatDecision(value: unknown): ChatDecision {
  if (typeof value === 'string' && (CHAT_DECISIONS as readonly string[]).includes(value)) {
    return value as ChatDecision;
  }
  return 'limited_answer';
}
import { ensureUiSafeAssistant } from './providers/normalize-provider-output';

const DEFAULT_SUMMARY =
  "I couldn't generate a reliably structured response from the AI provider. Please try again or use the equipment manual/escalation path.";

export function normalizeAssistantPayload(raw: unknown, fallbackSummary?: string): AssistantContent {
  const normalized = normalizeAssistantResponse({
    rawProviderContent: raw ?? fallbackSummary ?? DEFAULT_SUMMARY,
    capability: 'general_system_fallback',
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
  requiredDecision?: ChatDecision
): AssistantContent {
  const base = normalizeAssistantPayload(raw, fallbackSummary);
  return ensureUiSafeAssistant(base, requiredDecision ?? coerceChatDecision(base.decision));
}
