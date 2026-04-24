/**
 * Gemini (Google) via OpenAI-compatible Chat Completions API.
 *
 * Environment (server-side only; never log values of secrets):
 * - AI_PROVIDER: must be `gemini` (see providers/index.ts) or getChatProvider throws.
 * - GEMINI_API_KEY: required for production generate() and smoke test.
 * - GEMINI_BASE_URL: default https://generativelanguage.googleapis.com/v1beta/openai/
 * - GEMINI_MODEL: default gemini-2.5-flash
 * - GEMINI_TIMEOUT_MS, GEMINI_TEMPERATURE, GEMINI_MAX_COMPLETION_TOKENS
 *
 * HTTP 503 UNAVAILABLE: postGeminiChatCompletions retries up to 3 times with backoff 1s, 2s, 4s
 * (other error statuses are not retried). Transient network errors are not retried here.
 *
 * Production path (generate): sends response_format json_object because output is normalized
 * to AssistantContent JSON. The connectivity smoke test (runGeminiConnectivitySmoke) does NOT
 * use json_object so the model can return plain text "GEMINI_OK".
 *
 * generate() catches failures and returns a schema-safe assistant payload so the UI never breaks.
 */
import {
  type ChatLlmProvider,
  type ChatModelMessage,
  type LlmGenerateParams,
  type LlmProviderResult,
} from '@/types/chatbot';
import { buildAiUnavailableAssistant, normalizeProviderOutput, normalizeTextModeProviderOutput } from './normalize-provider-output';

interface GeminiResponse {
  id?: string;
  model?: string;
  choices?: Array<{
    finish_reason?: string | null;
    message?: {
      content?: string | null;
    };
  }>;
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

export function resolveGeminiBaseUrl(): string {
  const raw = process.env.GEMINI_BASE_URL ?? 'https://generativelanguage.googleapis.com/v1beta/openai/';
  const trimmed = raw.trim();
  if (!trimmed) {
    throw new Error('GEMINI_BASE_URL is set but empty. Use the default Google OpenAI-compatible base URL or a valid https URL.');
  }
  try {
    const u = new URL(trimmed);
    if (u.protocol !== 'https:' && u.protocol !== 'http:') {
      throw new Error(`GEMINI_BASE_URL must be http(s); got protocol "${u.protocol}".`);
    }
    return trimmed.replace(/\/$/, '');
  } catch (e) {
    if (e instanceof TypeError) {
      throw new Error(`GEMINI_BASE_URL is not a valid URL: ${trimmed.slice(0, 80)}`);
    }
    throw e;
  }
}

function resolveGeminiChatCompletionsUrl(): string {
  return `${resolveGeminiBaseUrl()}/chat/completions`;
}

function toOpenAiMessages(messages: ChatModelMessage[]) {
  return messages
    .filter((message) => message.role === 'system' || message.role === 'user' || message.role === 'assistant')
    .map((message) => ({
      role: message.role,
      content: message.content,
    }));
}

const HTTP_503_BACKOFF_MS = [1000, 2000, 4000] as const;
const MAX_HTTP_503_RETRIES = 3;

function sleep(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}

export type PostGeminiChatCompletionsResult = {
  response: Response;
  /** Number of 503 responses that triggered a retry (0 if first response was ok). */
  http503RetriesUsed: number;
};

/**
 * POST to Gemini OpenAI-compatible chat/completions. Retries only on HTTP 503 with 1s/2s/4s backoff (max 3 retries).
 */
export async function postGeminiChatCompletions(params: {
  url: string;
  apiKey: string;
  body: Record<string, unknown>;
  timeoutMs: number;
}): Promise<PostGeminiChatCompletionsResult> {
  const { url, apiKey, body, timeoutMs } = params;
  let http503RetriesUsed = 0;

  for (;;) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    let response: Response;
    try {
      response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`Gemini request failed (network): ${message}`);
    } finally {
      clearTimeout(timer);
    }

    if (response.ok) {
      return { response, http503RetriesUsed };
    }

    const details = await response.text().catch(() => '');
    const status = response.status;

    if (status === 503 && http503RetriesUsed < MAX_HTTP_503_RETRIES) {
      console.warn('[chatbot][gemini]', {
        event: 'retry_503',
        attempt: http503RetriesUsed + 1,
        maxRetries: MAX_HTTP_503_RETRIES,
        bodyPreview: details.slice(0, 200),
      });
      const delayMs = HTTP_503_BACKOFF_MS[http503RetriesUsed] ?? 4000;
      http503RetriesUsed += 1;
      await sleep(delayMs);
      continue;
    }

    if (status === 503) {
      console.error('[chatbot][gemini]', {
        event: 'retry_503_exhausted',
        attempts: http503RetriesUsed + 1,
        bodyPreview: details.slice(0, 200),
      });
    }

    throw new Error(`Gemini request failed (${status}): ${details.slice(0, 500) || 'No response body'}`);
  }
}

export type GeminiSmokeSuccess = {
  ok: true;
  provider: 'gemini';
  model: string;
  content: string;
  httpStatus: number;
  rawPreview: string;
};

export type GeminiSmokeFailure = {
  ok: false;
  provider: 'gemini';
  error: string;
  details: string;
  httpStatus?: number;
};

export type GeminiSmokeResult = GeminiSmokeSuccess | GeminiSmokeFailure;

function safeRawPreview(text: string, maxLen = 300) {
  const slice = text.slice(0, maxLen);
  return slice.length < text.length ? `${slice}…` : slice;
}

/**
 * Minimal Gemini round-trip for connectivity checks. Does not use json_object.
 * Does not read GEMINI_API_KEY from logs; callers must not expose secrets in responses.
 */
export async function runGeminiConnectivitySmoke(): Promise<GeminiSmokeResult> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey?.trim()) {
    return {
      ok: false,
      provider: 'gemini',
      error: 'configuration',
      details: 'GEMINI_API_KEY is missing or empty.',
    };
  }

  let url: string;
  try {
    url = resolveGeminiChatCompletionsUrl();
  } catch (e) {
    return {
      ok: false,
      provider: 'gemini',
      error: 'configuration',
      details: e instanceof Error ? e.message : String(e),
    };
  }

  const model = process.env.GEMINI_MODEL ?? 'gemini-2.5-flash';
  const timeoutMs = readNumberEnv('GEMINI_TIMEOUT_MS', 30000);

  try {
    const { response } = await postGeminiChatCompletions({
      url,
      apiKey,
      body: {
        model,
        temperature: 0.1,
        max_completion_tokens: 64,
        messages: [
          { role: 'system', content: 'You are a helpful assistant.' },
          { role: 'user', content: 'Reply with exactly: GEMINI_OK' },
        ],
      },
      timeoutMs,
    });

    const rawResponseText = await response.text();
    const parsedPayload = (() => {
      try {
        return JSON.parse(rawResponseText) as GeminiResponse;
      } catch {
        return null;
      }
    })();

    const choiceContent = parsedPayload?.choices?.[0]?.message?.content;
    const content = typeof choiceContent === 'string' ? choiceContent.trim() : '';
    const modelReturned = parsedPayload?.model ?? model;

    if (!content) {
      return {
        ok: false,
        provider: 'gemini',
        error: 'empty_content',
        details: 'Model returned empty message content.',
        httpStatus: response.status,
      };
    }

    const ok = content === 'GEMINI_OK' || content.includes('GEMINI_OK');
    if (!ok) {
      return {
        ok: false,
        provider: 'gemini',
        error: 'unexpected_reply',
        details: 'Model replied but content did not match expected GEMINI_OK.',
        httpStatus: response.status,
      };
    }

    return {
      ok: true,
      provider: 'gemini',
      model: modelReturned,
      content,
      httpStatus: response.status,
      rawPreview: safeRawPreview(rawResponseText),
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const statusMatch = message.match(/Gemini request failed \((\d+)\)/);
    const httpStatus = statusMatch ? Number(statusMatch[1]) : undefined;
    return {
      ok: false,
      provider: 'gemini',
      error: 'request_failed',
      details: message.slice(0, 500),
      httpStatus,
    };
  }
}

export const geminiProvider: ChatLlmProvider = {
  name: 'gemini',
  async generate(params: LlmGenerateParams): Promise<LlmProviderResult> {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey?.trim()) {
      console.error('[chatbot][gemini]', { event: 'provider_failure_fallback', reason: 'missing_api_key' });
      return {
        assistant: buildAiUnavailableAssistant(params.requiredDecision),
        provider: 'gemini',
        model: process.env.GEMINI_MODEL ?? 'gemini-2.5-flash',
        providerMetadata: {
          providerFallback: true,
          fallbackReason: 'provider_unavailable',
          error: 'GEMINI_API_KEY is missing or empty.',
        },
      };
    }

    const url = resolveGeminiChatCompletionsUrl();
    const model = process.env.GEMINI_MODEL ?? 'gemini-2.5-flash';
    const timeoutMs = readNumberEnv('GEMINI_TIMEOUT_MS', 30000);
    const temperature = Number(process.env.GEMINI_TEMPERATURE ?? 0.1);
    const maxCompletionTokens = readNumberEnv('GEMINI_MAX_COMPLETION_TOKENS', 900);
    const shouldDebugRaw = debugRawProviderLogs();

    try {
      const { response, http503RetriesUsed } = await postGeminiChatCompletions({
        url,
        apiKey,
        body: {
          model,
          temperature,
          ...(params.responseMode === 'json' || !params.responseMode ? { response_format: { type: 'json_object' } } : {}),
          max_completion_tokens: maxCompletionTokens,
          messages: toOpenAiMessages(params.messages),
        },
        timeoutMs,
      });

      const rawResponseText = await response.text();
      const parsedPayload = (() => {
        try {
          return JSON.parse(rawResponseText) as GeminiResponse;
        } catch {
          return null;
        }
      })();
      const choiceContent = parsedPayload?.choices?.[0]?.message?.content;
      const primaryText = typeof choiceContent === 'string' ? choiceContent : '';
      const fallbackText = !primaryText.trim() && rawResponseText.trim() ? rawResponseText : '';
      const modelTextForParser = primaryText.trim() ? primaryText : fallbackText;
      const responseMode = params.responseMode ?? 'json';
      const normalized =
        responseMode === 'text'
          ? normalizeTextModeProviderOutput(modelTextForParser.trim() ? modelTextForParser : '', params.requiredDecision)
          : normalizeProviderOutput(modelTextForParser.trim() ? modelTextForParser : '', params.requiredDecision);

      if (shouldDebugRaw) {
        console.info('[chatbot][gemini][raw-response]', {
          provider: 'gemini',
          modelConfigured: model,
          modelReturned: parsedPayload?.model ?? model,
          finishReason: parsedPayload?.choices?.[0]?.finish_reason ?? null,
          responseId: parsedPayload?.id ?? null,
        });
      }

      const emptyModelContent = !String(primaryText).trim();

      return {
        assistant: normalized.assistant,
        provider: 'gemini',
        model: parsedPayload?.model ?? model,
        providerMetadata: {
          parser: normalized.metadata,
          responseMode,
          finishReason: parsedPayload?.choices?.[0]?.finish_reason ?? null,
          responseId: parsedPayload?.id ?? null,
          maxCompletionTokens,
          nonJsonProviderBody: parsedPayload ? false : true,
          emptyModelContent,
          httpStatus: response.status,
          http503RetriesUsed,
        },
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error('[chatbot][gemini]', {
        event: 'provider_failure_fallback',
        messagePreview: message.slice(0, 300),
      });
      return {
        assistant: buildAiUnavailableAssistant(params.requiredDecision),
        provider: 'gemini',
        model,
        providerMetadata: {
          providerFallback: true,
          fallbackReason: 'provider_unavailable',
          error: message.slice(0, 500),
        },
      };
    }
  },
};
