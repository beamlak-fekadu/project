// Pure, testable handler for Telegram webhook updates.
// The Next.js route file (src/app/api/telegram/webhook/route.ts) is a thin
// shim that adapts NextRequest → handleTelegramWebhook(). Keeping the handler
// pure lets us unit-test secret validation, command parsing, and reply
// dispatch without spinning up an HTTP server.

import { handleTelegramCommand } from '@/services/notifications/telegram-commands';
import {
  sendTelegramCommandReply,
  type TelegramSendResult,
} from '@/services/notifications/telegram-provider';

export interface TelegramWebhookRequest {
  secretHeader: string | null;
  parseBody: () => Promise<unknown>;
}

export interface TelegramWebhookResponse {
  status: 200 | 401;
  body: { ok: boolean };
}

interface RawUpdate {
  message?: {
    chat?: { id?: number | string };
    text?: string;
  };
}

export type TelegramSender = (chatId: string, text: string) => Promise<TelegramSendResult>;

export function validateTelegramSecret(secretHeader: string | null): boolean {
  const expected = (process.env.TELEGRAM_WEBHOOK_SECRET ?? '').trim();
  if (!expected) {
    // Secret not configured — accept request. (Dev / pre-production posture.)
    return true;
  }
  return (secretHeader ?? '') === expected;
}

export async function handleTelegramWebhook(
  request: TelegramWebhookRequest,
  options?: { sendReply?: TelegramSender },
): Promise<TelegramWebhookResponse> {
  if (!validateTelegramSecret(request.secretHeader)) {
    return { status: 401, body: { ok: false } };
  }

  let body: RawUpdate;
  try {
    body = (await request.parseBody()) as RawUpdate;
  } catch {
    // Malformed JSON — acknowledge so Telegram doesn't retry forever.
    return { status: 200, body: { ok: true } };
  }

  const chatIdRaw = body?.message?.chat?.id;
  const text = body?.message?.text;
  if (chatIdRaw == null || typeof text !== 'string' || text.trim().length === 0) {
    // Non-message update or missing identifiers — always acknowledge.
    return { status: 200, body: { ok: true } };
  }

  const chatId = String(chatIdRaw);
  const result = handleTelegramCommand({ chatId, text });

  if (result.replyText) {
    const sender = options?.sendReply ?? sendTelegramCommandReply;
    try {
      const sendResult = await sender(chatId, result.replyText);
      if (!sendResult.ok) {
        // Avoid leaking the token; only log a short reason code.
        console.error('[telegram-webhook] command reply failed', {
          command: result.command,
          unknown: result.unknown,
          reason: sendResult.error ?? sendResult.skipReason ?? 'unknown',
        });
      }
    } catch (err) {
      console.error('[telegram-webhook] command reply exception', {
        command: result.command,
        error: err instanceof Error ? err.message : 'unknown',
      });
    }
  }

  return { status: 200, body: { ok: true } };
}
