// Minimal Telegram bot commands — read-only, no DB, no app mutations.

import { getAppBaseUrl } from '@/services/notifications/telegram-provider';
import {
  clearTelegramCommandSession,
  touchTelegramCommandSession,
} from '@/services/notifications/telegram-command-session';

export const SUPPORTED_TELEGRAM_COMMANDS = ['start', 'help', 'reset'] as const;

export type SupportedTelegramCommand = (typeof SUPPORTED_TELEGRAM_COMMANDS)[number];

export const UNKNOWN_COMMAND_REPLY =
  'I only support /start, /help, and /reset.';

export interface ParsedTelegramCommand {
  command: string;
  raw: string;
}

export interface TelegramCommandHandleResult {
  replyText: string | null;
  command: string | null;
  unknown: boolean;
}

export function parseTelegramCommand(text: string | null | undefined): ParsedTelegramCommand | null {
  const trimmed = (text ?? '').trim();
  if (!trimmed.startsWith('/')) return null;
  const withoutSlash = trimmed.slice(1);
  const commandPart = withoutSlash.split(/\s+/)[0] ?? '';
  const atIndex = commandPart.indexOf('@');
  const command = (atIndex >= 0 ? commandPart.slice(0, atIndex) : commandPart).toLowerCase();
  if (!command) return null;
  return { command, raw: trimmed };
}

export function isSupportedTelegramCommand(command: string): command is SupportedTelegramCommand {
  return (SUPPORTED_TELEGRAM_COMMANDS as readonly string[]).includes(command);
}

export function buildTelegramCommandReply(command: SupportedTelegramCommand): string {
  const appUrl = getAppBaseUrl();

  switch (command) {
    case 'start':
      return [
        'Welcome to BMEDIS Notifications.',
        '',
        'This bot sends role-aware operational alerts from Menelik II Hospital BMEDIS.',
        'Real authorization and actions happen only inside the secure BMEDIS app.',
        '',
        `Open BMEDIS: ${appUrl}`,
        '',
        'Commands: /help — what we may notify you about · /reset — clear temporary bot session',
      ].join('\n');

    case 'help':
      return [
        'BMEDIS Notifications — what this bot may send:',
        '• Maintenance requests',
        '• Work orders',
        '• Planned maintenance (PM)',
        '• Calibration',
        '• Stock blockers',
        '• QR label events',
        '• Offline sync issues',
        '• Readiness / risk signals',
        '',
        'This bot is a notification channel only.',
        'Authorization, department scope, and actions are handled inside BMEDIS after you sign in.',
        '',
        `Open BMEDIS: ${appUrl}`,
        '',
        'Commands: /start — welcome · /reset — clear temporary bot session (connection stays active)',
      ].join('\n');

    case 'reset':
      return [
        'Temporary bot session cleared.',
        '',
        'Your BMEDIS notification connection (if linked by an administrator) remains active.',
        'Notification history and delivery logs were not changed.',
        '',
        'Use /start or /help anytime.',
      ].join('\n');
  }
}

export function handleTelegramCommand(params: {
  chatId: string;
  text: string | null | undefined;
}): TelegramCommandHandleResult {
  const parsed = parseTelegramCommand(params.text);
  if (!parsed) {
    return { replyText: null, command: null, unknown: false };
  }

  if (!isSupportedTelegramCommand(parsed.command)) {
    return {
      replyText: UNKNOWN_COMMAND_REPLY,
      command: parsed.command,
      unknown: true,
    };
  }

  if (parsed.command === 'reset') {
    clearTelegramCommandSession(params.chatId);
    return {
      replyText: buildTelegramCommandReply('reset'),
      command: 'reset',
      unknown: false,
    };
  }

  touchTelegramCommandSession(params.chatId, parsed.command, {
    helpShown: parsed.command === 'help',
  });

  return {
    replyText: buildTelegramCommandReply(parsed.command),
    command: parsed.command,
    unknown: false,
  };
}
