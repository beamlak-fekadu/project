// Telegram bot provider — server-only.
//
// All Telegram API calls live here. The bot token is read from
// TELEGRAM_BOT_TOKEN and never leaves the server. Callers receive a
// structured result; we never throw uncaught errors from these functions.
//
// We use plain text by default. Telegram MarkdownV2 is fragile when message
// content contains hospital data, so we prefer escaped HTML when richer
// formatting is needed.

import type { NotificationRow } from '@/types/notifications';

const TELEGRAM_API_BASE = 'https://api.telegram.org';
const DEFAULT_TIMEOUT_MS = 12_000;

export interface TelegramSendResult {
  ok: boolean;
  status?: 'sent' | 'skipped' | 'failed';
  providerMessageId?: string | null;
  skipReason?: string;
  error?: string;
  rawStatus?: number;
}

export function isTelegramConfigured(): boolean {
  return (
    (process.env.TELEGRAM_BOT_TOKEN ?? '').trim().length > 0 &&
    (process.env.TELEGRAM_NOTIFICATIONS_ENABLED ?? '').toLowerCase() === 'true'
  );
}

export function isTelegramMonitorConfigured(): boolean {
  return (
    isTelegramConfigured() &&
    (process.env.TELEGRAM_DEV_MONITOR_ENABLED ?? '').toLowerCase() === 'true' &&
    (process.env.TELEGRAM_DEV_MONITOR_CHAT_ID ?? '').trim().length > 0
  );
}

export function getTelegramMonitorChatId(): string | null {
  const value = (process.env.TELEGRAM_DEV_MONITOR_CHAT_ID ?? '').trim();
  return value.length > 0 ? value : null;
}

export function maskTelegramChatId(chatId: string | null | undefined): string | null {
  if (!chatId) return null;
  const trimmed = chatId.trim();
  if (trimmed.length === 0) return null;
  if (trimmed.length <= 4) return '••' + trimmed.slice(-2);
  return '••' + trimmed.slice(-4);
}

async function postJsonWithTimeout<T>(
  url: string,
  body: Record<string, unknown>,
  timeoutMs = DEFAULT_TIMEOUT_MS,
): Promise<{ ok: boolean; status: number; data?: T; error?: string }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    const status = response.status;
    let data: T | undefined;
    try {
      data = (await response.json()) as T;
    } catch {
      data = undefined;
    }
    if (!response.ok) {
      return {
        ok: false,
        status,
        data,
        error: `Telegram API HTTP ${status}`,
      };
    }
    return { ok: true, status, data };
  } catch (err) {
    const error = err instanceof Error ? err.message : 'Unknown Telegram error';
    return { ok: false, status: 0, error };
  } finally {
    clearTimeout(timer);
  }
}

interface TelegramSendApiResponse {
  ok: boolean;
  result?: { message_id?: number };
  description?: string;
  error_code?: number;
}

export async function sendTelegramMessage(
  chatId: string,
  text: string,
  options?: { disablePreview?: boolean },
): Promise<TelegramSendResult> {
  const token = (process.env.TELEGRAM_BOT_TOKEN ?? '').trim();
  if (!token) {
    return { ok: false, status: 'skipped', skipReason: 'bot_token_missing' };
  }
  if ((process.env.TELEGRAM_NOTIFICATIONS_ENABLED ?? '').toLowerCase() !== 'true') {
    return { ok: false, status: 'skipped', skipReason: 'telegram_disabled' };
  }
  if (!chatId || chatId.trim().length === 0) {
    return { ok: false, status: 'skipped', skipReason: 'no_chat_id' };
  }

  const safeText = String(text ?? '').slice(0, 3800);
  const url = `${TELEGRAM_API_BASE}/bot${token}/sendMessage`;
  const result = await postJsonWithTimeout<TelegramSendApiResponse>(url, {
    chat_id: chatId,
    text: safeText,
    disable_web_page_preview: options?.disablePreview ?? false,
  });

  if (!result.ok) {
    return {
      ok: false,
      status: 'failed',
      error: result.data?.description || result.error || 'telegram_send_failed',
      rawStatus: result.status,
    };
  }
  const data = result.data;
  if (!data?.ok) {
    return {
      ok: false,
      status: 'failed',
      error: data?.description || 'telegram_response_not_ok',
      rawStatus: result.status,
    };
  }
  return {
    ok: true,
    status: 'sent',
    providerMessageId: data.result?.message_id != null
      ? String(data.result.message_id)
      : null,
    rawStatus: result.status,
  };
}

/** Command replies (/start, /help, /reset) — token only; not gated on TELEGRAM_NOTIFICATIONS_ENABLED. */
export async function sendTelegramCommandReply(
  chatId: string,
  text: string,
): Promise<TelegramSendResult> {
  const token = (process.env.TELEGRAM_BOT_TOKEN ?? '').trim();
  if (!token) {
    return { ok: false, status: 'skipped', skipReason: 'bot_token_missing' };
  }
  if (!chatId || chatId.trim().length === 0) {
    return { ok: false, status: 'skipped', skipReason: 'no_chat_id' };
  }

  const safeText = String(text ?? '').slice(0, 3800);
  const url = `${TELEGRAM_API_BASE}/bot${token}/sendMessage`;
  const result = await postJsonWithTimeout<TelegramSendApiResponse>(url, {
    chat_id: chatId,
    text: safeText,
    disable_web_page_preview: false,
  });

  if (!result.ok) {
    return {
      ok: false,
      status: 'failed',
      error: result.data?.description || result.error || 'telegram_send_failed',
      rawStatus: result.status,
    };
  }
  const data = result.data;
  if (!data?.ok) {
    return {
      ok: false,
      status: 'failed',
      error: data?.description || 'telegram_response_not_ok',
      rawStatus: result.status,
    };
  }
  return {
    ok: true,
    status: 'sent',
    providerMessageId: data.result?.message_id != null
      ? String(data.result.message_id)
      : null,
    rawStatus: result.status,
  };
}

export interface TelegramBotUpdate {
  update_id: number;
  chat_id?: string;
  chat_type?: string;
  chat_title?: string | null;
  username?: string | null;
  first_name?: string | null;
  text?: string | null;
  date?: string | null;
}

interface RawTelegramUpdate {
  update_id: number;
  message?: {
    chat?: {
      id?: number | string;
      type?: string;
      title?: string;
      username?: string;
      first_name?: string;
    };
    text?: string;
    date?: number;
  };
}

export async function getTelegramBotUpdates(): Promise<{
  ok: boolean;
  updates?: TelegramBotUpdate[];
  error?: string;
}> {
  const token = (process.env.TELEGRAM_BOT_TOKEN ?? '').trim();
  if (!token) return { ok: false, error: 'bot_token_missing' };
  const url = `${TELEGRAM_API_BASE}/bot${token}/getUpdates`;
  const result = await postJsonWithTimeout<{
    ok?: boolean;
    result?: RawTelegramUpdate[];
    description?: string;
  }>(url, { limit: 25 });
  if (!result.ok) {
    return { ok: false, error: result.data?.description || result.error || 'updates_failed' };
  }
  const data = result.data;
  if (!data?.ok) {
    return { ok: false, error: data?.description || 'updates_not_ok' };
  }
  const updates = (data.result ?? []).map((raw): TelegramBotUpdate => {
    const chat = raw.message?.chat ?? {};
    return {
      update_id: raw.update_id,
      chat_id: chat.id != null ? String(chat.id) : undefined,
      chat_type: chat.type,
      chat_title: chat.title ?? null,
      username: chat.username ?? null,
      first_name: chat.first_name ?? null,
      text: raw.message?.text ?? null,
      date: raw.message?.date != null
        ? new Date(raw.message.date * 1000).toISOString()
        : null,
    };
  });
  return { ok: true, updates };
}

export interface TelegramWebhookInfo {
  url: string | null;
  has_custom_certificate: boolean;
  pending_update_count: number;
  last_error_date: string | null;
  last_error_message: string | null;
  ip_address: string | null;
  max_connections: number | null;
  allowed_updates: string[] | null;
}

export async function getTelegramWebhookInfo(): Promise<{
  ok: boolean;
  info?: TelegramWebhookInfo;
  error?: string;
}> {
  const token = (process.env.TELEGRAM_BOT_TOKEN ?? '').trim();
  if (!token) return { ok: false, error: 'bot_token_missing' };
  const url = `${TELEGRAM_API_BASE}/bot${token}/getWebhookInfo`;
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);
    const response = await fetch(url, { signal: controller.signal });
    clearTimeout(timer);
    const data = (await response.json()) as {
      ok?: boolean;
      result?: {
        url?: string;
        has_custom_certificate?: boolean;
        pending_update_count?: number;
        last_error_date?: number;
        last_error_message?: string;
        ip_address?: string;
        max_connections?: number;
        allowed_updates?: string[];
      };
      description?: string;
    };
    if (!response.ok || !data?.ok || !data.result) {
      return { ok: false, error: data?.description || `HTTP ${response.status}` };
    }
    const r = data.result;
    return {
      ok: true,
      info: {
        url: r.url && r.url.length > 0 ? r.url : null,
        has_custom_certificate: Boolean(r.has_custom_certificate),
        pending_update_count: r.pending_update_count ?? 0,
        last_error_date:
          r.last_error_date != null ? new Date(r.last_error_date * 1000).toISOString() : null,
        last_error_message: r.last_error_message ?? null,
        ip_address: r.ip_address ?? null,
        max_connections: r.max_connections ?? null,
        allowed_updates: r.allowed_updates ?? null,
      },
    };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'unknown_error' };
  }
}

export async function setTelegramWebhook(params: {
  url: string;
  secretToken?: string | null;
}): Promise<{ ok: boolean; description?: string; error?: string }> {
  const token = (process.env.TELEGRAM_BOT_TOKEN ?? '').trim();
  if (!token) return { ok: false, error: 'bot_token_missing' };
  const url = `${TELEGRAM_API_BASE}/bot${token}/setWebhook`;
  const body: Record<string, unknown> = {
    url: params.url,
    allowed_updates: ['message'],
  };
  if (params.secretToken && params.secretToken.trim().length > 0) {
    body.secret_token = params.secretToken.trim();
  }
  const result = await postJsonWithTimeout<{
    ok?: boolean;
    description?: string;
    result?: boolean;
  }>(url, body);
  if (!result.ok) {
    return { ok: false, error: result.data?.description || result.error || 'setWebhook_failed' };
  }
  const data = result.data;
  if (!data?.ok) {
    return { ok: false, error: data?.description || 'setWebhook_not_ok' };
  }
  return { ok: true, description: data.description };
}

export async function testTelegramBot(): Promise<{
  ok: boolean;
  botUsername?: string;
  error?: string;
}> {
  const token = (process.env.TELEGRAM_BOT_TOKEN ?? '').trim();
  if (!token) return { ok: false, error: 'bot_token_missing' };
  const url = `${TELEGRAM_API_BASE}/bot${token}/getMe`;
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);
    const response = await fetch(url, { signal: controller.signal });
    clearTimeout(timer);
    const data = (await response.json()) as {
      ok?: boolean;
      result?: { username?: string };
      description?: string;
    };
    if (!response.ok || !data?.ok) {
      return { ok: false, error: data?.description || `HTTP ${response.status}` };
    }
    return { ok: true, botUsername: data.result?.username };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'unknown_error' };
  }
}

export function getAppBaseUrl(): string {
  const explicit = (process.env.NEXT_PUBLIC_APP_URL ?? '').trim();
  if (explicit) return explicit.replace(/\/+$/, '');
  const site = (process.env.NEXT_PUBLIC_SITE_URL ?? '').trim();
  if (site) return site.replace(/\/+$/, '');
  const vercel = (process.env.NEXT_PUBLIC_VERCEL_URL ?? '').trim();
  if (vercel) return `https://${vercel.replace(/\/+$/, '')}`;
  return 'http://localhost:3000';
}

function categoryEmoji(category: string): string {
  switch (category) {
    case 'critical':
      return '🚨';
    case 'task':
      return '🛠';
    case 'request':
      return '📋';
    case 'compliance':
      return '✅';
    case 'stock':
      return '📦';
    case 'procurement':
      return '🚚';
    case 'replacement':
      return '🔁';
    case 'offline':
      return '🔄';
    case 'qr':
      return '🔖';
    case 'system':
      return '🧪';
    case 'management':
      return '📊';
    default:
      return '🔔';
  }
}

export function formatTelegramNotification(
  notification: NotificationRow,
  recipient: { full_name?: string | null; primaryRole?: string | null } | null,
): string {
  const lines: string[] = [];
  const emoji = categoryEmoji(notification.category);
  lines.push(`${emoji} ${notification.title}`);
  lines.push('');
  lines.push(notification.message);
  const role = recipient?.primaryRole;
  if (role) {
    lines.push('');
    lines.push(`Role: ${role}`);
  }
  if (notification.action_href) {
    const base = getAppBaseUrl();
    const path = notification.action_href.startsWith('http')
      ? notification.action_href
      : `${base}${notification.action_href.startsWith('/') ? '' : '/'}${notification.action_href}`;
    lines.push('');
    lines.push(`Open: ${path}`);
  }
  return lines.join('\n');
}

export function formatTelegramMonitorMessage(
  notification: NotificationRow,
  originalRecipient: { full_name?: string | null; primaryRole?: string | null } | null,
  actualDelivery: { status: 'sent' | 'skipped' | 'failed'; skipReason?: string | null; error?: string | null },
): string {
  const lines: string[] = [];
  lines.push('🧪 BMEDIS Notification Monitor');
  lines.push('');
  lines.push(`Original recipient: ${originalRecipient?.full_name ?? 'unknown'}`);
  lines.push(`Role: ${originalRecipient?.primaryRole ?? 'unknown'}`);
  lines.push(`Priority: ${notification.priority}`);
  lines.push(`Category: ${notification.category}`);
  lines.push(`Source: ${notification.source_type ?? '-'}${notification.source_id ? `:${notification.source_id}` : ''}`);
  lines.push('');
  if (actualDelivery.status === 'sent') {
    lines.push('Actual Telegram delivery: sent');
  } else if (actualDelivery.status === 'skipped') {
    lines.push(`Actual Telegram delivery: skipped — ${actualDelivery.skipReason ?? 'no_reason'}`);
  } else {
    lines.push(`Actual Telegram delivery: failed — ${actualDelivery.error ?? 'unknown_error'}`);
  }
  lines.push('');
  lines.push(`Title: ${notification.title}`);
  lines.push('');
  lines.push(notification.message);
  if (notification.action_href) {
    const base = getAppBaseUrl();
    const path = notification.action_href.startsWith('http')
      ? notification.action_href
      : `${base}${notification.action_href.startsWith('/') ? '' : '/'}${notification.action_href}`;
    lines.push('');
    lines.push(`Open: ${path}`);
  }
  return lines.join('\n');
}
