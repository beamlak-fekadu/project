import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  UNKNOWN_COMMAND_REPLY,
  buildTelegramCommandReply,
  handleTelegramCommand,
  parseTelegramCommand,
} from '@/services/notifications/telegram-commands';
import {
  _clearAllTelegramCommandSessionsForTests,
  clearTelegramCommandSession,
  getTelegramCommandSession,
  touchTelegramCommandSession,
} from '@/services/notifications/telegram-command-session';

const __dirname = dirname(fileURLToPath(import.meta.url));

test('/start response welcomes and explains in-app actions', () => {
  process.env.NEXT_PUBLIC_APP_URL = 'https://bmedis.example.com';
  const reply = buildTelegramCommandReply('start');
  assert.match(reply, /Welcome to BMEDIS Notifications/i);
  assert.match(reply, /role-aware operational alerts/i);
  assert.match(reply, /secure BMEDIS app/i);
  assert.match(reply, /https:\/\/bmedis\.example\.com/);
});

test('/help response lists notification categories and channel-only role', () => {
  process.env.NEXT_PUBLIC_APP_URL = 'https://bmedis.example.com';
  const reply = buildTelegramCommandReply('help');
  assert.match(reply, /Maintenance requests/i);
  assert.match(reply, /Work orders/i);
  assert.match(reply, /Planned maintenance \(PM\)/i);
  assert.match(reply, /Calibration/i);
  assert.match(reply, /Stock blockers/i);
  assert.match(reply, /QR label events/i);
  assert.match(reply, /Offline sync issues/i);
  assert.match(reply, /Readiness \/ risk signals/i);
  assert.match(reply, /notification channel only/i);
  assert.match(reply, /sign in/i);
});

test('/reset response confirms session cleared and connection remains', () => {
  const reply = buildTelegramCommandReply('reset');
  assert.match(reply, /Temporary bot session cleared/i);
  assert.match(reply, /notification connection/i);
  assert.match(reply, /remains active/i);
  assert.match(reply, /history and delivery logs were not changed/i);
});

test('unknown command returns exact allowlist message', () => {
  const result = handleTelegramCommand({ chatId: 'chat-1', text: '/status' });
  assert.equal(result.replyText, UNKNOWN_COMMAND_REPLY);
  assert.equal(result.unknown, true);
  assert.equal(result.command, 'status');
});

test('/reset clears ephemeral session only, not telegram_connections', () => {
  _clearAllTelegramCommandSessionsForTests();
  const chatId = '999888777';
  touchTelegramCommandSession(chatId, 'start');
  assert.ok(getTelegramCommandSession(chatId));

  const result = handleTelegramCommand({ chatId, text: '/reset' });
  assert.equal(result.command, 'reset');
  assert.equal(getTelegramCommandSession(chatId), null);

  const sessionSource = readFileSync(
    join(__dirname, '../telegram-command-session.ts'),
    'utf8',
  );
  assert.doesNotMatch(sessionSource, /telegram_connections/);
  assert.doesNotMatch(sessionSource, /supabase/i);
  assert.doesNotMatch(sessionSource, /\.delete\(/i);
});

test('replies and handler output never expose bot token', () => {
  const fakeToken = '123456789:AAFakeTokenForTestOnly';
  process.env.TELEGRAM_BOT_TOKEN = fakeToken;
  process.env.NEXT_PUBLIC_APP_URL = 'https://bmedis.example.com';

  for (const cmd of ['start', 'help', 'reset'] as const) {
    const reply = buildTelegramCommandReply(cmd);
    assert.doesNotMatch(reply, /bot\d+/i);
    assert.doesNotMatch(reply, new RegExp(fakeToken.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  }

  const unknown = handleTelegramCommand({ chatId: 'c1', text: '/notifications' });
  assert.doesNotMatch(unknown.replyText ?? '', /bot\d+/i);
  assert.doesNotMatch(unknown.replyText ?? '', new RegExp(fakeToken.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));

  delete process.env.TELEGRAM_BOT_TOKEN;
});

test('unsupported commands do not trigger app actions', () => {
  const commandsSource = readFileSync(join(__dirname, '../telegram-commands.ts'), 'utf8');
  assert.doesNotMatch(commandsSource, /from ['"]@\/actions\//);
  assert.doesNotMatch(commandsSource, /notification-engine/);
  assert.doesNotMatch(commandsSource, /notification-delivery/);
  assert.doesNotMatch(commandsSource, /saveTelegramConnection/);
  assert.doesNotMatch(commandsSource, /createClient/);
  assert.doesNotMatch(commandsSource, /supabase/i);

  const plain = handleTelegramCommand({ chatId: 'c2', text: 'hello there' });
  assert.equal(plain.replyText, null);
  assert.equal(plain.command, null);

  const unknown = handleTelegramCommand({ chatId: 'c2', text: '/open' });
  assert.equal(unknown.replyText, UNKNOWN_COMMAND_REPLY);
  assert.equal(unknown.unknown, true);
});

test('parseTelegramCommand normalizes bot username suffix', () => {
  assert.deepEqual(parseTelegramCommand('/start@BmedisBot'), { command: 'start', raw: '/start@BmedisBot' });
  assert.equal(parseTelegramCommand('not a command'), null);
});

test('clearTelegramCommandSession is idempotent', () => {
  _clearAllTelegramCommandSessionsForTests();
  assert.equal(clearTelegramCommandSession('missing'), false);
  touchTelegramCommandSession('x', 'help', { helpShown: true });
  assert.equal(clearTelegramCommandSession('x'), true);
  assert.equal(clearTelegramCommandSession('x'), false);
});
