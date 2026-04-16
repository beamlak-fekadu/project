import {
  type ChatLlmProvider,
  type ChatModelMessage,
  type ChatProviderName,
  type LlmGenerateParams,
  type LlmProviderResult,
} from '@/types/chatbot';
import { normalizeProviderOutput } from './normalize-provider-output';

interface GroqResponse {
  id?: string;
  model?: string;
  choices?: Array<{
    finish_reason?: string | null;
    message?: {
      content?: string | null;
    };
  }>;
}

function toGroqMessages(messages: ChatModelMessage[]) {
  return messages
    .filter((message) => message.role === 'system' || message.role === 'user' || message.role === 'assistant')
    .map((message) => ({
      role: message.role,
      content: message.content,
    }));
}

function readNumberEnv(name: string, fallback: number) {
  const value = process.env[name];
  if (!value) return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function debugRawProviderLogs() {
  return (process.env.CHAT_DEBUG_RAW_PROVIDER ?? '').toLowerCase() === 'true';
}

export const groqProvider: ChatLlmProvider = {
  name: 'groq',
  async generate(params: LlmGenerateParams): Promise<LlmProviderResult> {
    const apiKey = process.env.GROQ_API_KEY;
    if (!apiKey) {
      throw new Error('GROQ_API_KEY is required when CHAT_PROVIDER=groq');
    }

    const baseUrl = process.env.GROQ_BASE_URL ?? 'https://api.groq.com/openai/v1';
    const model = process.env.GROQ_MODEL ?? 'llama-3.1-8b-instant';
    const temperature = Number(process.env.GROQ_TEMPERATURE ?? 0.1);
    const timeoutMs = readNumberEnv('GROQ_TIMEOUT_MS', 30000);
    const maxCompletionTokens = readNumberEnv('GROQ_MAX_COMPLETION_TOKENS', 800);
    const shouldDebugRaw = debugRawProviderLogs();

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await fetch(`${baseUrl.replace(/\/$/, '')}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model,
          temperature,
          response_format: { type: 'json_object' },
          max_completion_tokens: maxCompletionTokens,
          messages: toGroqMessages(params.messages),
        }),
        signal: controller.signal,
      });

      if (!response.ok) {
        const details = await response.text().catch(() => '');
        throw new Error(`Groq request failed (${response.status}): ${details || 'No response body'}`);
      }

      const rawResponseText = await response.text();
      const parsedPayload = (() => {
        try {
          return JSON.parse(rawResponseText) as GroqResponse;
        } catch {
          return null;
        }
      })();
      const modelText = parsedPayload?.choices?.[0]?.message?.content ?? rawResponseText;
      const normalized = normalizeProviderOutput(modelText, params.requiredDecision);

      if (shouldDebugRaw) {
        console.info('[chatbot][groq][raw-response]', {
          provider: 'groq',
          modelConfigured: model,
          modelReturned: parsedPayload?.model ?? model,
          finishReason: parsedPayload?.choices?.[0]?.finish_reason ?? null,
          responseId: parsedPayload?.id ?? null,
          rawContent: modelText,
        });
      }

      return {
        assistant: normalized.assistant,
        provider: 'groq' as ChatProviderName,
        model: parsedPayload?.model ?? model,
        providerMetadata: {
          parser: normalized.metadata,
          finishReason: parsedPayload?.choices?.[0]?.finish_reason ?? null,
          responseId: parsedPayload?.id ?? null,
          maxCompletionTokens,
          nonJsonProviderBody: parsedPayload ? false : true,
        },
      };
    } finally {
      clearTimeout(timer);
    }
  },
};
