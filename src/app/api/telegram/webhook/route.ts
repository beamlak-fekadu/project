import { NextResponse, type NextRequest } from 'next/server';
import { handleTelegramCommand } from '@/services/notifications/telegram-commands';
import { sendTelegramCommandReply } from '@/services/notifications/telegram-provider';

export const dynamic = 'force-dynamic';

interface TelegramWebhookMessage {
  message?: {
    chat?: { id?: number | string };
    text?: string;
  };
}

function validateWebhookSecret(request: NextRequest): boolean {
  const expected = (process.env.TELEGRAM_WEBHOOK_SECRET ?? '').trim();
  if (!expected) {
    console.warn('[telegram-webhook] TELEGRAM_WEBHOOK_SECRET is not set — accepting request (dev only).');
    return true;
  }
  const header = request.headers.get('x-telegram-bot-api-secret-token') ?? '';
  return header === expected;
}

export async function POST(request: NextRequest) {
  if (!validateWebhookSecret(request)) {
    return NextResponse.json({ ok: false }, { status: 401 });
  }

  let body: TelegramWebhookMessage;
  try {
    body = (await request.json()) as TelegramWebhookMessage;
  } catch {
    return NextResponse.json({ ok: true });
  }

  const chatId = body.message?.chat?.id;
  const text = body.message?.text;
  if (chatId == null || text == null || text.trim().length === 0) {
    return NextResponse.json({ ok: true });
  }

  const chatIdStr = String(chatId);
  const result = handleTelegramCommand({ chatId: chatIdStr, text });

  if (result.replyText) {
    try {
      const sendResult = await sendTelegramCommandReply(chatIdStr, result.replyText);
      if (!sendResult.ok) {
        console.error('[telegram-webhook] command reply failed', {
          command: result.command,
          unknown: result.unknown,
          error: sendResult.error ?? sendResult.skipReason,
        });
      }
    } catch (err) {
      console.error('[telegram-webhook] command reply exception', {
        command: result.command,
        error: err instanceof Error ? err.message : 'unknown',
      });
    }
  }

  return NextResponse.json({ ok: true });
}
