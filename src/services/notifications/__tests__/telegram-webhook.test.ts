import test from 'node:test';
import assert from 'node:assert/strict';

import {
  handleTelegramWebhook,
  validateTelegramSecret,
  type TelegramSender,
} from '@/services/notifications/telegram-webhook-handler';

function captureSender(): { calls: Array<{ chatId: string; text: string }>; send: TelegramSender } {
  const calls: Array<{ chatId: string; text: string }> = [];
  const send: TelegramSender = async (chatId, text) => {
    calls.push({ chatId, text });
    return { ok: true, status: 'sent', providerMessageId: 'm-1' };
  };
  return { calls, send };
}

function makeRequest(payload: unknown, secretHeader: string | null = null) {
  return {
    secretHeader,
    parseBody: async () => payload,
  };
}

test('webhook /start replies with welcome text and 200', async () => {
  delete process.env.TELEGRAM_WEBHOOK_SECRET;
  process.env.NEXT_PUBLIC_APP_URL = 'https://bmedis.example.com';
  const { calls, send } = captureSender();
  const res = await handleTelegramWebhook(
    makeRequest({ message: { chat: { id: 100 }, text: '/start' } }),
    { sendReply: send },
  );
  assert.equal(res.status, 200);
  assert.deepEqual(res.body, { ok: true });
  assert.equal(calls.length, 1);
  assert.equal(calls[0]?.chatId, '100');
  assert.match(calls[0]?.text ?? '', /Welcome to BMEDIS Notifications/);
});

test('webhook /help replies with help text', async () => {
  delete process.env.TELEGRAM_WEBHOOK_SECRET;
  const { calls, send } = captureSender();
  const res = await handleTelegramWebhook(
    makeRequest({ message: { chat: { id: '200' }, text: '/help' } }),
    { sendReply: send },
  );
  assert.equal(res.status, 200);
  assert.equal(calls.length, 1);
  assert.match(calls[0]?.text ?? '', /BMEDIS Notifications/);
  assert.match(calls[0]?.text ?? '', /Maintenance requests/);
});

test('webhook /reset replies with reset text', async () => {
  delete process.env.TELEGRAM_WEBHOOK_SECRET;
  const { calls, send } = captureSender();
  const res = await handleTelegramWebhook(
    makeRequest({ message: { chat: { id: 300 }, text: '/reset' } }),
    { sendReply: send },
  );
  assert.equal(res.status, 200);
  assert.equal(calls.length, 1);
  assert.match(calls[0]?.text ?? '', /Temporary bot session cleared/);
  assert.match(calls[0]?.text ?? '', /notification connection/);
});

test('webhook unknown command replies with allowlist message', async () => {
  delete process.env.TELEGRAM_WEBHOOK_SECRET;
  const { calls, send } = captureSender();
  const res = await handleTelegramWebhook(
    makeRequest({ message: { chat: { id: 400 }, text: '/status' } }),
    { sendReply: send },
  );
  assert.equal(res.status, 200);
  assert.equal(calls.length, 1);
  assert.equal(calls[0]?.text, 'I only support /start, /help, and /reset.');
});

test('webhook non-message update returns 200 and does not call sender', async () => {
  delete process.env.TELEGRAM_WEBHOOK_SECRET;
  const { calls, send } = captureSender();
  const res = await handleTelegramWebhook(
    makeRequest({ edited_message: { chat: { id: 1 }, text: '/start' } }),
    { sendReply: send },
  );
  assert.equal(res.status, 200);
  assert.deepEqual(res.body, { ok: true });
  assert.equal(calls.length, 0);
});

test('webhook missing chat id returns 200 without crashing', async () => {
  delete process.env.TELEGRAM_WEBHOOK_SECRET;
  const { calls, send } = captureSender();
  const res = await handleTelegramWebhook(
    makeRequest({ message: { text: '/start' } }),
    { sendReply: send },
  );
  assert.equal(res.status, 200);
  assert.equal(calls.length, 0);
});

test('webhook empty text returns 200 without sending', async () => {
  delete process.env.TELEGRAM_WEBHOOK_SECRET;
  const { calls, send } = captureSender();
  const res = await handleTelegramWebhook(
    makeRequest({ message: { chat: { id: 1 }, text: '   ' } }),
    { sendReply: send },
  );
  assert.equal(res.status, 200);
  assert.equal(calls.length, 0);
});

test('webhook plain text (not a command) returns 200 without sending', async () => {
  delete process.env.TELEGRAM_WEBHOOK_SECRET;
  const { calls, send } = captureSender();
  const res = await handleTelegramWebhook(
    makeRequest({ message: { chat: { id: 1 }, text: 'hello' } }),
    { sendReply: send },
  );
  assert.equal(res.status, 200);
  assert.equal(calls.length, 0);
});

test('webhook malformed body returns 200 (no Telegram retry storm)', async () => {
  delete process.env.TELEGRAM_WEBHOOK_SECRET;
  const { calls, send } = captureSender();
  const res = await handleTelegramWebhook(
    {
      secretHeader: null,
      parseBody: async () => {
        throw new Error('bad json');
      },
    },
    { sendReply: send },
  );
  assert.equal(res.status, 200);
  assert.equal(calls.length, 0);
});

test('webhook invalid secret returns 401 when TELEGRAM_WEBHOOK_SECRET is configured', async () => {
  process.env.TELEGRAM_WEBHOOK_SECRET = 'expected-secret';
  const { calls, send } = captureSender();
  const res = await handleTelegramWebhook(
    {
      secretHeader: 'wrong-secret',
      parseBody: async () => ({ message: { chat: { id: 1 }, text: '/start' } }),
    },
    { sendReply: send },
  );
  assert.equal(res.status, 401);
  assert.equal(calls.length, 0);
  delete process.env.TELEGRAM_WEBHOOK_SECRET;
});

test('webhook accepts request when secret matches', async () => {
  process.env.TELEGRAM_WEBHOOK_SECRET = 'expected-secret';
  const { calls, send } = captureSender();
  const res = await handleTelegramWebhook(
    {
      secretHeader: 'expected-secret',
      parseBody: async () => ({ message: { chat: { id: 1 }, text: '/start' } }),
    },
    { sendReply: send },
  );
  assert.equal(res.status, 200);
  assert.equal(calls.length, 1);
  delete process.env.TELEGRAM_WEBHOOK_SECRET;
});

test('webhook accepts request when TELEGRAM_WEBHOOK_SECRET is not set', async () => {
  delete process.env.TELEGRAM_WEBHOOK_SECRET;
  assert.equal(validateTelegramSecret(null), true);
  assert.equal(validateTelegramSecret('anything'), true);
});

test('webhook handler source never references telegram_connections (R reset safety)', async () => {
  const { readFileSync } = await import('node:fs');
  const { dirname, join } = await import('node:path');
  const { fileURLToPath } = await import('node:url');
  const here = dirname(fileURLToPath(import.meta.url));
  const src = readFileSync(join(here, '../telegram-webhook-handler.ts'), 'utf8');
  assert.doesNotMatch(src, /telegram_connections/);
  assert.doesNotMatch(src, /supabase/i);
});

test('webhook reply bodies never contain bot token', async () => {
  const fakeToken = '7000000000:ABCDEF_test_only_never_real';
  process.env.TELEGRAM_BOT_TOKEN = fakeToken;
  delete process.env.TELEGRAM_WEBHOOK_SECRET;
  const { calls, send } = captureSender();
  for (const text of ['/start', '/help', '/reset', '/unknown']) {
    await handleTelegramWebhook(
      makeRequest({ message: { chat: { id: 1 }, text } }),
      { sendReply: send },
    );
  }
  for (const c of calls) {
    assert.doesNotMatch(c.text, new RegExp(fakeToken.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  }
  delete process.env.TELEGRAM_BOT_TOKEN;
});

test('webhook sender failure is swallowed and still returns 200', async () => {
  delete process.env.TELEGRAM_WEBHOOK_SECRET;
  const failing: TelegramSender = async () => ({
    ok: false,
    status: 'failed',
    error: 'telegram_api_down',
  });
  const res = await handleTelegramWebhook(
    makeRequest({ message: { chat: { id: 1 }, text: '/start' } }),
    { sendReply: failing },
  );
  assert.equal(res.status, 200);
});
