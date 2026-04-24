import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { resolveGeminiBaseUrl, runGeminiConnectivitySmoke } from '@/services/chatbot/providers/gemini-provider';

function smokeEnabled() {
  return (process.env.CHAT_AI_SMOKE_ENABLED ?? '').toLowerCase() === 'true';
}

function logEnvPresence() {
  let baseHost: string | null = null;
  try {
    baseHost = new URL(resolveGeminiBaseUrl()).host;
  } catch {
    baseHost = null;
  }
  console.info('[ai-smoke-test]', {
    event: 'route_entered',
    smokeEnabled: true,
    geminiApiKeySet: Boolean(process.env.GEMINI_API_KEY?.trim()),
    geminiBaseUrlSet: Boolean(process.env.GEMINI_BASE_URL?.trim()),
    geminiModelSet: Boolean(process.env.GEMINI_MODEL?.trim()),
    aiProvider: process.env.AI_PROVIDER ?? '(default gemini)',
    baseUrlHost: baseHost,
    modelConfiguredLength: (process.env.GEMINI_MODEL ?? 'gemini-2.5-flash').length,
  });
}

async function guardAuthenticated() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return user;
}

export async function GET() {
  if (!smokeEnabled()) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  const user = await guardAuthenticated();
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  logEnvPresence();
  console.info('[ai-smoke-test]', { event: 'request_start', provider: 'gemini' });

  const result = await runGeminiConnectivitySmoke();

  if (result.ok) {
    console.info('[ai-smoke-test]', {
      event: 'provider_responded',
      ok: true,
      httpStatus: result.httpStatus,
      model: result.model,
      contentLength: result.content.length,
      parseSucceeded: true,
    });
    return NextResponse.json({
      ok: true,
      provider: result.provider,
      model: result.model,
      content: result.content,
      raw: result.rawPreview,
    });
  }

  console.info('[ai-smoke-test]', {
    event: 'provider_failed',
    ok: false,
    error: result.error,
    httpStatus: result.httpStatus ?? null,
  });

  const httpStatus =
    result.error === 'configuration'
      ? 503
      : result.error === 'request_failed'
        ? 502
        : 200;

  return NextResponse.json(
    {
      ok: false,
      provider: result.provider,
      error: result.error,
      details: result.details,
    },
    { status: httpStatus }
  );
}

export async function POST() {
  return GET();
}
