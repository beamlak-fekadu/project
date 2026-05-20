'use server';

import { z } from 'zod';
import {
  getActionContext,
  getActionContextForCapability,
  revalidateMany,
  actionError,
  logServerAuditEvent,
  type ActionResult,
} from './_shared';
import {
  markNotificationStatus,
  markAllMyNotificationsRead,
  getMyNotifications,
  getMyNotificationSummary,
  getNotificationDiagnostics,
  listNotificationDeliveries,
  listNotificationRuleLogs,
  runNotificationRuleCheck,
} from '@/services/notifications/notification.service';
import {
  createNotificationEvent,
  emitNotificationEvent,
} from '@/services/notifications/notification-engine';
import {
  getAppBaseUrl,
  getTelegramBotUpdates,
  getTelegramWebhookInfo,
  isTelegramConfigured,
  isTelegramMonitorConfigured,
  getTelegramMonitorChatId,
  sendTelegramMessage,
  setTelegramWebhook,
  testTelegramBot,
} from '@/services/notifications/telegram-provider';
import { deliverTelegramIfEligible } from '@/services/notifications/notification-delivery.service';

const notificationPaths = ['/notifications', '/command', '/developer-lab'];

const statusSchema = z.enum(['unread', 'read', 'reviewed', 'dismissed']);

export async function markNotificationStatusAction(
  notificationId: string,
  status: string,
): Promise<ActionResult> {
  try {
    const parsedStatus = statusSchema.parse(status);
    const result = await markNotificationStatus(notificationId, parsedStatus);
    if (!result.ok) return { success: false, error: result.error ?? 'failed_to_update' };
    revalidateMany(notificationPaths);
    return { success: true };
  } catch (err) {
    return actionError(err, 'Failed to update notification');
  }
}

export async function markAllNotificationsReadAction(): Promise<ActionResult> {
  try {
    const result = await markAllMyNotificationsRead();
    if (!result.ok) return { success: false, error: result.error ?? 'failed_to_update' };
    revalidateMany(notificationPaths);
    return { success: true, data: { updated: result.updated } };
  } catch (err) {
    return actionError(err, 'Failed to mark all read');
  }
}

export async function getMyNotificationSummaryAction(): Promise<ActionResult> {
  try {
    const summary = await getMyNotificationSummary();
    return { success: true, data: summary };
  } catch (err) {
    return actionError(err, 'Failed to load summary');
  }
}

export async function getMyNotificationsAction(filters: Record<string, unknown> = {}): Promise<ActionResult> {
  try {
    const sanitized: Parameters<typeof getMyNotifications>[0] = {};
    if (filters.status && typeof filters.status === 'string') {
      sanitized.status = filters.status as never;
    }
    if (filters.category && typeof filters.category === 'string') {
      sanitized.category = filters.category as never;
    }
    if (filters.priority && typeof filters.priority === 'string') {
      sanitized.priority = filters.priority as never;
    }
    if (filters.search && typeof filters.search === 'string') {
      sanitized.search = filters.search;
    }
    if (filters.since && typeof filters.since === 'string') {
      sanitized.since = filters.since;
    }
    if (filters.limit && typeof filters.limit === 'number') {
      sanitized.limit = filters.limit;
    }
    const rows = await getMyNotifications(sanitized);
    return { success: true, data: rows };
  } catch (err) {
    return actionError(err, 'Failed to load notifications');
  }
}

// ─── Developer-only diagnostics + tests ─────────────────────────────────────

export async function getNotificationDiagnosticsAction(): Promise<ActionResult> {
  try {
    const { error } = await getActionContextForCapability('developer.diagnostics');
    if (error) return { success: false, error };
    const diagnostics = await getNotificationDiagnostics();
    return { success: true, data: diagnostics };
  } catch (err) {
    return actionError(err, 'Failed to load notification diagnostics');
  }
}

export async function listDeliveriesAction(filters: Record<string, unknown> = {}): Promise<ActionResult> {
  try {
    const { error } = await getActionContextForCapability('developer.diagnostics');
    if (error) return { success: false, error };
    const channel =
      filters.channel === 'telegram' || filters.channel === 'telegram_monitor'
        ? filters.channel
        : undefined;
    const status =
      filters.status === 'sent' || filters.status === 'skipped' || filters.status === 'failed'
        ? filters.status
        : undefined;
    const rows = await listNotificationDeliveries({ channel, status });
    return { success: true, data: rows };
  } catch (err) {
    return actionError(err, 'Failed to load delivery logs');
  }
}

export async function listRuleLogsAction(filters: Record<string, unknown> = {}): Promise<ActionResult> {
  try {
    const { error } = await getActionContextForCapability('developer.diagnostics');
    if (error) return { success: false, error };
    const statusFilter =
      filters.status === 'matched' || filters.status === 'skipped' || filters.status === 'failed'
        ? filters.status
        : undefined;
    const rows = await listNotificationRuleLogs({ statusFilter });
    return { success: true, data: rows };
  } catch (err) {
    return actionError(err, 'Failed to load rule logs');
  }
}

export async function runNotificationRuleCheckAction(): Promise<ActionResult> {
  try {
    const { supabase, profile, error } = await getActionContextForCapability('developer.diagnostics');
    if (error || !profile) return { success: false, error };
    const result = await runNotificationRuleCheck();
    // R33: audit rule check runs so governance can see who triggered scans
    // and what they produced. Per-scan summary is structured (R1) so the
    // audit details capture the same shape Developer Lab renders.
    await logServerAuditEvent({
      supabase,
      profileId: profile.id,
      action: 'notification.rule_check_run',
      entityType: 'notification_diagnostics',
      details: {
        ok: result.ok,
        events_created: result.events_created,
        errors: result.errors,
        scans: result.scans.map((s) => ({
          ruleId: s.ruleId,
          scanned: s.scanned,
          eventsCreated: s.eventsCreated,
          error: s.error,
        })),
      },
    });
    revalidateMany(notificationPaths);
    return { success: true, data: result };
  } catch (err) {
    return actionError(err, 'Failed to run rule check');
  }
}

export async function createTestNotificationToSelfAction(): Promise<ActionResult> {
  try {
    const { supabase, profile, error } = await getActionContext(['developer', 'admin', 'bme_head', 'technician', 'department_head', 'department_user', 'store_user', 'viewer']);
    if (error || !profile) return { success: false, error: error ?? 'Not authenticated' };

    // Direct insert path. We intentionally do NOT go through the engine's
    // event → rule fan-out for this test: this guarantees a visible row in
    // public.notifications immediately. recipient_profile_id must be the
    // current profile.id (NOT auth.uid()), so the bell drawer picks it up.
    //
    // Some deployments created `notifications` with `event_id NOT NULL` before
    // migration 00056 relaxed it. To stay robust on either schema, we first
    // create the `notification_events` row, then attach its id to the
    // notification insert. If the event insert fails (RLS or otherwise), we
    // still fall back to a notification insert with `event_id = null`; on a
    // post-00056 database that succeeds, and on a legacy database the caller
    // sees the actual constraint error rather than a silent failure.
    const timestamp = new Date().toLocaleString();
    let eventId: string | null = null;

    const eventInsert = await supabase
      .from('notification_events')
      .insert({
        event_type: 'system.test_notification',
        source_table: 'notifications',
        source_id: null,
        asset_id: null,
        department_id: profile.department_id ?? null,
        priority: 'info',
        payload: {
          target_profile_id: profile.id,
          message: `Test notification at ${timestamp}.`,
        },
        processing_status: 'processed',
        processed_at: new Date().toISOString(),
        created_by: profile.id,
      } as never)
      .select('id')
      .single();

    if (eventInsert.error) {
      console.error('[notifications] best-effort test event insert failed:', eventInsert.error.message);
    } else {
      eventId = (eventInsert.data as { id?: string } | null)?.id ?? null;
    }

    const notificationPayload = {
      recipient_profile_id: profile.id,
      recipient_role: profile.roleNames?.[0] ?? null,
      title: 'Test notification',
      message: `This is a test notification created at ${timestamp}. It confirms the in-app notification path is working.`,
      priority: 'info' as const,
      category: 'system' as const,
      source_type: 'system.test_notification',
      source_id: null,
      event_id: eventId,
      asset_id: null,
      department_id: profile.department_id ?? null,
      action_href: '/notifications',
      action_label: 'Open Notifications',
      status: 'unread' as const,
      dedupe_key: null,
      metadata: { test: true, created_by_profile_id: profile.id, generated_at: new Date().toISOString() },
    };

    const insert = await supabase
      .from('notifications')
      .insert(notificationPayload as never)
      .select('id')
      .single();

    if (insert.error) {
      console.error('[notifications] test-to-self insert failed:', insert.error.message);
      return { success: false, error: insert.error.message };
    }

    const insertedId = (insert.data as { id?: string } | null)?.id ?? null;

    revalidateMany(notificationPaths);
    return { success: true, data: { notification_id: insertedId, event_id: eventId } };
  } catch (err) {
    return actionError(err, 'Failed to send test notification');
  }
}

export async function sendTelegramTestMessageAction(): Promise<ActionResult> {
  try {
    const { supabase, profile, error } = await getActionContextForCapability('developer.diagnostics');
    if (error || !profile) return { success: false, error };
    if (!isTelegramConfigured()) {
      // R33: audit the failed attempt — operationally important to know
      // someone tried to test Telegram on a deployment where the env is
      // missing.
      await logServerAuditEvent({
        supabase,
        profileId: profile.id,
        action: 'telegram.test_send_skipped',
        entityType: 'telegram_diagnostics',
        details: { reason: 'telegram_not_configured' },
      });
      return { success: false, error: 'Telegram is disabled or bot token is missing.' };
    }
    const monitorChatId = getTelegramMonitorChatId();
    if (!monitorChatId) {
      await logServerAuditEvent({
        supabase,
        profileId: profile.id,
        action: 'telegram.test_send_skipped',
        entityType: 'telegram_diagnostics',
        details: { reason: 'monitor_chat_id_missing' },
      });
      return { success: false, error: 'TELEGRAM_DEV_MONITOR_CHAT_ID is not configured.' };
    }
    const text = `BMEDIS Telegram test — ${new Date().toLocaleString()}\nThis confirms the bot can reach the monitor chat.`;
    const result = await sendTelegramMessage(monitorChatId, text);
    if (!result.ok) {
      // R33: capture the failure reason in audit.
      await logServerAuditEvent({
        supabase,
        profileId: profile.id,
        action: 'telegram.test_send_failed',
        entityType: 'telegram_diagnostics',
        details: { error: result.error ?? result.skipReason ?? 'telegram_test_failed' },
      });
      return {
        success: false,
        error: result.error ?? result.skipReason ?? 'telegram_test_failed',
      };
    }
    // R33: success audit. provider_message_id is the Telegram API id, not
    // a user PII identifier — safe to record.
    await logServerAuditEvent({
      supabase,
      profileId: profile.id,
      action: 'telegram.test_send',
      entityType: 'telegram_diagnostics',
      details: {
        provider_message_id: result.providerMessageId ?? null,
        monitor_enabled: isTelegramMonitorConfigured(),
      },
    });
    return {
      success: true,
      data: {
        provider_message_id: result.providerMessageId ?? null,
        monitor_enabled: isTelegramMonitorConfigured(),
      },
    };
  } catch (err) {
    return actionError(err, 'Failed to send Telegram test');
  }
}

const sampleVariantSchema = z.enum([
  'bme_head_critical',
  'technician_assignment',
  'store_stock_blocker',
  'department_update',
  'viewer_readiness',
  'developer_system',
]);

export async function sendSampleRoleNotificationAction(variant: string): Promise<ActionResult> {
  try {
    const { error } = await getActionContextForCapability('developer.diagnostics');
    if (error) return { success: false, error };
    const parsed = sampleVariantSchema.parse(variant);
    let event;
    switch (parsed) {
      case 'bme_head_critical':
        event = await createNotificationEvent({
          event_type: 'maintenance_request.created',
          priority: 'critical',
          payload: {
            asset_name: 'ICU Ventilator (TEST)',
            asset_code: 'TEST-VENT-002',
            request_number: 'TEST-MR-' + Date.now().toString(36).toUpperCase(),
            urgency: 'critical',
          },
        });
        break;
      case 'technician_assignment':
        event = await createNotificationEvent({
          event_type: 'work_order.assigned',
          priority: 'critical',
          payload: {
            asset_name: 'ICU Ventilator (TEST)',
            asset_code: 'TEST-VENT-002',
            work_order_number: 'TEST-WO-' + Date.now().toString(36).toUpperCase(),
            priority: 'critical',
          },
        });
        break;
      case 'store_stock_blocker':
        event = await createNotificationEvent({
          event_type: 'work_order.stock_blocked',
          priority: 'high',
          payload: {
            asset_name: 'ICU Ventilator (TEST)',
            asset_code: 'TEST-VENT-002',
            part_name: 'Oxygen Sensor (TEST)',
          },
        });
        break;
      case 'department_update':
        event = await createNotificationEvent({
          event_type: 'department.critical_asset_down',
          priority: 'critical',
          payload: {
            asset_name: 'ICU Ventilator (TEST)',
            asset_code: 'TEST-VENT-002',
            department_name: 'ICU',
          },
        });
        break;
      case 'viewer_readiness':
        event = await createNotificationEvent({
          event_type: 'department.readiness_risk',
          priority: 'high',
          payload: { department_name: 'ICU' },
        });
        break;
      case 'developer_system':
        event = await createNotificationEvent({
          event_type: 'notification.rule_failed',
          priority: 'medium',
          payload: { rule_name: 'sample_test' },
        });
        break;
    }
    revalidateMany(notificationPaths);
    return {
      success: true,
      data: {
        event_id: event?.event?.id ?? null,
        notifications_created: event?.notifications?.length ?? 0,
      },
    };
  } catch (err) {
    return actionError(err, 'Failed to send sample notification');
  }
}

export async function fetchTelegramBotUpdatesAction(): Promise<ActionResult> {
  try {
    const { error } = await getActionContextForCapability('developer.diagnostics');
    if (error) return { success: false, error };
    if (!isTelegramConfigured()) {
      return { success: false, error: 'Telegram is disabled or bot token is missing.' };
    }
    const result = await getTelegramBotUpdates();
    if (!result.ok) return { success: false, error: result.error ?? 'getUpdates_failed' };
    return { success: true, data: result.updates ?? [] };
  } catch (err) {
    return actionError(err, 'Failed to fetch Telegram updates');
  }
}

function buildWebhookUrl(): string {
  const base = getAppBaseUrl();
  return `${base.replace(/\/+$/, '')}/api/telegram/webhook`;
}

export async function getTelegramWebhookSetupAction(): Promise<ActionResult> {
  try {
    const { error } = await getActionContextForCapability('developer.diagnostics');
    if (error) return { success: false, error };
    const expectedUrl = buildWebhookUrl();
    const secretConfigured = (process.env.TELEGRAM_WEBHOOK_SECRET ?? '').trim().length > 0;

    let info: Awaited<ReturnType<typeof getTelegramWebhookInfo>>['info'] | null = null;
    let infoError: string | null = null;
    if (isTelegramConfigured()) {
      const res = await getTelegramWebhookInfo();
      if (res.ok && res.info) info = res.info;
      else infoError = res.error ?? 'getWebhookInfo_failed';
    } else {
      infoError = 'Telegram is disabled or bot token is missing.';
    }

    const registeredMatches = info?.url ? info.url === expectedUrl : null;

    return {
      success: true,
      data: {
        expected_webhook_url: expectedUrl,
        secret_token_configured: secretConfigured,
        registered_webhook_url: info?.url ?? null,
        registered_url_matches_expected: registeredMatches,
        pending_update_count: info?.pending_update_count ?? 0,
        last_error_date: info?.last_error_date ?? null,
        last_error_message: info?.last_error_message ?? null,
        ip_address: info?.ip_address ?? null,
        max_connections: info?.max_connections ?? null,
        allowed_updates: info?.allowed_updates ?? null,
        info_error: infoError,
      },
    };
  } catch (err) {
    return actionError(err, 'Failed to load Telegram webhook setup');
  }
}

export async function setTelegramWebhookAction(): Promise<ActionResult> {
  try {
    const { error } = await getActionContextForCapability('developer.diagnostics');
    if (error) return { success: false, error };
    if (!isTelegramConfigured()) {
      return { success: false, error: 'Telegram is disabled or bot token is missing.' };
    }
    const expectedUrl = buildWebhookUrl();
    const secret = (process.env.TELEGRAM_WEBHOOK_SECRET ?? '').trim();
    const res = await setTelegramWebhook({
      url: expectedUrl,
      secretToken: secret.length > 0 ? secret : null,
    });
    if (!res.ok) return { success: false, error: res.error ?? 'setWebhook_failed' };
    revalidateMany(['/developer-lab']);
    return {
      success: true,
      data: {
        url: expectedUrl,
        secret_token_configured: secret.length > 0,
        description: res.description ?? null,
      },
    };
  } catch (err) {
    return actionError(err, 'Failed to register Telegram webhook');
  }
}

export async function testTelegramBotAction(): Promise<ActionResult> {
  try {
    const { error } = await getActionContextForCapability('developer.diagnostics');
    if (error) return { success: false, error };
    if (!isTelegramConfigured()) {
      return { success: false, error: 'Telegram is disabled or bot token is missing.' };
    }
    const result = await testTelegramBot();
    if (!result.ok) return { success: false, error: result.error ?? 'unknown_error' };
    return {
      success: true,
      data: { bot_username: result.botUsername ?? null },
    };
  } catch (err) {
    return actionError(err, 'Failed to test Telegram bot');
  }
}

const saveTelegramConnectionSchema = z.object({
  profile_id: z.string().min(1),
  telegram_chat_id: z.string().trim().min(1),
  telegram_username: z.string().trim().optional().nullable(),
  is_enabled: z.boolean().optional(),
});

export async function saveTelegramConnectionAction(payload: Record<string, unknown>): Promise<ActionResult> {
  try {
    const { supabase, profile, error } = await getActionContextForCapability('developer.diagnostics');
    if (error || !profile) return { success: false, error };
    const parsed = saveTelegramConnectionSchema.parse(payload);
    const existing = await supabase
      .from('telegram_connections')
      .select('id')
      .eq('profile_id', parsed.profile_id)
      .maybeSingle();
    const upsertData = {
      profile_id: parsed.profile_id,
      telegram_chat_id: parsed.telegram_chat_id,
      telegram_username: parsed.telegram_username ?? null,
      is_enabled: parsed.is_enabled ?? true,
      verified_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    let result;
    if (existing.data) {
      result = await supabase
        .from('telegram_connections')
        .update(upsertData as never)
        .eq('id', (existing.data as { id: string }).id)
        .select('*')
        .single();
    } else {
      result = await supabase
        .from('telegram_connections')
        .insert(upsertData as never)
        .select('*')
        .single();
    }
    if (result.error) return { success: false, error: result.error.message };
    revalidateMany(['/developer-lab']);
    return { success: true, data: result.data };
  } catch (err) {
    return actionError(err, 'Failed to save Telegram connection');
  }
}

export async function deliverNotificationAgainAction(notificationId: string): Promise<ActionResult> {
  try {
    const { supabase, error } = await getActionContextForCapability('developer.diagnostics');
    if (error) return { success: false, error };
    const { data: notification } = (await supabase
      .from('notifications')
      .select('*')
      .eq('id', notificationId)
      .maybeSingle()) as { data: Awaited<ReturnType<typeof deliverTelegramIfEligible>> extends never ? never : import('@/types/notifications').NotificationRow | null };
    if (!notification) return { success: false, error: 'notification_not_found' };
    const result = await deliverTelegramIfEligible(supabase, notification);
    return { success: true, data: result };
  } catch (err) {
    return actionError(err, 'Failed to re-deliver notification');
  }
}

// Allows the engine to be called fire-and-forget from non-action server code
// (services). Exposed as an action so it remains usable from client code if
// ever needed (e.g. fallback emit from offline sync flows).
export async function emitNotificationEventAction(
  input: Record<string, unknown>,
): Promise<ActionResult> {
  try {
    const { error } = await getActionContext([
      'developer',
      'admin',
      'bme_head',
      'technician',
      'store_user',
      'department_head',
      'department_user',
    ]);
    if (error) return { success: false, error };
    await emitNotificationEvent(input as unknown as Parameters<typeof emitNotificationEvent>[0]);
    return { success: true };
  } catch (err) {
    return actionError(err, 'Failed to emit event');
  }
}
