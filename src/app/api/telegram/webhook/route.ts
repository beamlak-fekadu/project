import { NextResponse, type NextRequest } from 'next/server';
import { handleTelegramWebhook } from '@/services/notifications/telegram-webhook-handler';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  const result = await handleTelegramWebhook({
    secretHeader: request.headers.get('x-telegram-bot-api-secret-token'),
    parseBody: () => request.json(),
  });
  return NextResponse.json(result.body, { status: result.status });
}

export function GET() {
  return NextResponse.json(
    { ok: true, route: 'telegram-webhook', method: 'POST' },
    { status: 200 },
  );
}
