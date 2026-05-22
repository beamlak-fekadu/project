// Notification engine — orchestrates event creation, rule processing,
// dedupe, insert, and external delivery. Designed so any failure here is
// surfaced via console.error + audit/diagnostics rather than thrown back to
// the caller. Primary workflows must continue if notifications break.

import type { SupabaseClient } from '@supabase/supabase-js';
import { applyNotificationRules } from './notification-rules';
import { applyDedupe } from './notification-dedupe';
import { deliverTelegramIfEligible, type DeliverResult } from './notification-delivery.service';
import type {
  CreateNotificationInput,
  NotificationDeliverySummary,
  NotificationEventInput,
  NotificationEventRow,
  NotificationProcessRuleLog,
  NotificationProcessResult,
  NotificationRow,
  NotificationRuleLogStatus,
} from '@/types/notifications';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';

type DbClient = SupabaseClient;

async function getClient(): Promise<{ client: DbClient; warning: string | null }> {
  const adminClient = createAdminClient();
  if (adminClient) return { client: adminClient as DbClient, warning: null };
  return {
    client: await createClient(),
    warning:
      'SUPABASE_SERVICE_ROLE_KEY is not configured; notification fan-out is using caller RLS and may be blocked.',
  };
}

interface ProcessEventResult extends NotificationProcessResult {
  event: NotificationEventRow | null;
  notifications: NotificationRow[];
  rule_status: 'matched' | 'skipped' | 'failed';
  rule_name?: string;
  error?: string;
}

export const NOTIFICATION_DELIVERY_REVIEW_WARNING =
  'Action completed, but notification delivery needs review.';

export function notificationDeliveryNeedsReview(
  result: Pick<NotificationProcessResult, 'ok' | 'notificationCount' | 'recipientsResolved' | 'warnings' | 'errors'> | null | undefined,
): boolean {
  // null means the catch block fired before a result was produced — the
  // action catch block now always supplies makeFailedNotificationResult()
  // instead of null, so null here is a true unexpected edge-case that
  // should not produce a user-visible toast (it is logged separately).
  if (!result) return false;
  // Only flag when the in-app delivery genuinely failed.
  // Telegram failures land in warnings (not errors) so they do NOT count
  // as "needs review" from the user's perspective.
  return !result.ok || result.notificationCount === 0 || result.recipientsResolved === 0 || result.errors.length > 0;
}

export function notificationReviewDetail(
  result: Pick<NotificationProcessResult, 'eventType' | 'notificationCount' | 'recipientsResolved' | 'warnings' | 'errors'> | null | undefined,
): string | null {
  if (!result) return 'notification engine did not return a processing result';
  const reason = result.errors[0] ?? result.warnings[0] ?? null;
  if (reason) return `${result.eventType}: ${reason}`;
  if (result.recipientsResolved === 0) return `${result.eventType}: no deliverable recipients were resolved`;
  if (result.notificationCount === 0) return `${result.eventType}: no in-app notification row was created`;
  return null;
}

// Build a well-typed failed result for use inside action catch blocks so
// the notification result variable is never left as null. This prevents the
// "notification engine did not return a processing result" false-positive.
export function makeFailedNotificationResult(
  eventType: string,
  err: unknown,
): NotificationProcessResult {
  const message = err instanceof Error ? err.message : String(err ?? 'notification_emit_failed');
  return {
    ok: false,
    eventType,
    notificationCount: 0,
    recipientsResolved: 0,
    ruleLogs: [],
    delivery: {
      inAppCreated: 0,
      telegramSent: 0,
      telegramSkipped: 0,
      telegramFailed: 0,
      monitorSent: 0,
      monitorSkipped: 0,
      monitorFailed: 0,
    },
    warnings: [],
    errors: [message],
  };
}

export function notificationProcessSnapshot(
  result: NotificationProcessResult,
): Record<string, unknown> {
  return {
    event_id: result.eventId ?? null,
    event_type: result.eventType,
    notification_count: result.notificationCount,
    recipients_resolved: result.recipientsResolved,
    delivery: result.delivery,
    warnings: result.warnings,
    errors: result.errors,
    rule_logs: result.ruleLogs,
  };
}

function emptyDeliverySummary(): NotificationDeliverySummary {
  return {
    inAppCreated: 0,
    telegramSent: 0,
    telegramSkipped: 0,
    telegramFailed: 0,
    monitorSent: 0,
    monitorSkipped: 0,
    monitorFailed: 0,
  };
}

function emptyProcessResult(input: {
  eventType: string;
  event?: NotificationEventRow | null;
  ruleStatus?: 'matched' | 'skipped' | 'failed';
  ruleName?: string;
  warnings?: string[];
  errors?: string[];
}): ProcessEventResult {
  const errors = input.errors ?? [];
  return {
    ok: errors.length === 0,
    event: input.event ?? null,
    eventId: input.event?.id,
    eventType: input.eventType,
    notifications: [],
    notificationCount: 0,
    recipientsResolved: 0,
    ruleLogs: [],
    delivery: emptyDeliverySummary(),
    warnings: input.warnings ?? [],
    errors,
    rule_status: input.ruleStatus ?? (errors.length > 0 ? 'failed' : 'skipped'),
    rule_name: input.ruleName,
    error: errors[0],
  };
}

function foldDelivery(summary: NotificationDeliverySummary, result: DeliverResult | null | undefined): void {
  if (result?.telegram?.status === 'sent') summary.telegramSent++;
  if (result?.telegram?.status === 'skipped') summary.telegramSkipped++;
  if (result?.telegram?.status === 'failed') summary.telegramFailed++;
  if (result?.monitor?.status === 'sent') summary.monitorSent++;
  if (result?.monitor?.status === 'skipped') summary.monitorSkipped++;
  if (result?.monitor?.status === 'failed') summary.monitorFailed++;
}

function isInsertFailure(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const message = String((error as { message?: unknown }).message ?? '');
  return /row-level security|violates|permission|policy|duplicate|constraint|insert/i.test(message);
}

function expectedRecipientProfileIdsFromPayload(payload: Record<string, unknown> | null | undefined): string[] {
  const ids = new Set<string>();
  for (const key of ['technician_profile_id', 'assigned_to', 'requested_by', 'actor_profile_id', 'target_profile_id']) {
    const value = payload?.[key];
    if (typeof value === 'string' && value.length > 0) ids.add(value);
  }
  return Array.from(ids);
}

export async function createNotificationEvent(
  input: NotificationEventInput,
  options?: { client?: DbClient; createdBy?: string | null; autoProcess?: boolean },
): Promise<ProcessEventResult> {
  const clientContext = options?.client
    ? { client: options.client, warning: null }
    : await getClient();
  const client = clientContext.client;
  const warnings = clientContext.warning ? [clientContext.warning] : [];
  const insertPayload = {
    event_type: input.event_type,
    source_table: input.source_table ?? null,
    source_id: input.source_id ?? null,
    asset_id: input.asset_id ?? null,
    department_id: input.department_id ?? null,
    priority: input.priority,
    payload: input.payload ?? {},
    dedupe_key: input.dedupe_key ?? null,
    processing_status: 'pending' as const,
    created_by: options?.createdBy ?? null,
  };
  const { data, error } = (await client
    .from('notification_events')
    .insert(insertPayload as never)
    .select('*')
    .single()) as { data: NotificationEventRow | null; error: { message?: string } | null };

  if (error || !data) {
    const message = error?.message ?? 'unknown_event_insert_error';
    console.error('[notifications] failed to insert event:', message);
    return {
      ...emptyProcessResult({
        eventType: input.event_type,
        ruleStatus: 'failed',
        warnings,
        errors: [message],
      }),
      event: null,
      notifications: [],
      rule_status: 'failed',
      error: message,
    };
  }

  if (options?.autoProcess === false) {
    return {
      ...emptyProcessResult({
        eventType: data.event_type,
        event: data,
        ruleStatus: 'skipped',
        warnings,
      }),
      rule_status: 'skipped',
    };
  }
  return await processNotificationEvent(data, { client, initialWarnings: warnings });
}

export async function processNotificationEvent(
  eventOrId: NotificationEventRow | string,
  options?: { client?: DbClient; initialWarnings?: string[] },
): Promise<ProcessEventResult> {
  const clientContext = options?.client
    ? { client: options.client, warning: null }
    : await getClient();
  const client = clientContext.client;
  const warnings = [
    ...(options?.initialWarnings ?? []),
    ...(clientContext.warning ? [clientContext.warning] : []),
  ];
  const errors: string[] = [];
  const delivery = emptyDeliverySummary();
  let event: NotificationEventRow | null;
  if (typeof eventOrId === 'string') {
    const { data } = (await client
      .from('notification_events')
      .select('*')
      .eq('id', eventOrId)
      .maybeSingle()) as { data: NotificationEventRow | null };
    event = data;
  } else {
    event = eventOrId;
  }
  if (!event) {
    return emptyProcessResult({
      eventType: typeof eventOrId === 'string' ? 'unknown' : eventOrId.event_type,
      ruleStatus: 'failed',
      warnings,
      errors: ['event_not_found'],
    });
  }

  // Apply rules — role-aware fan-out. Wrapped in try/catch so any
  // unhandled throw inside rule functions or diagnostics builders returns
  // a structured error result rather than propagating to the caller.
  let ruleResult: Awaited<ReturnType<typeof applyNotificationRules>>;
  try {
    ruleResult = await applyNotificationRules(client, event);
  } catch (ruleErr) {
    const message = ruleErr instanceof Error ? ruleErr.message : 'notification_rule_threw';
    console.error('[notifications] applyNotificationRules threw:', message);
    await client.from('notification_events').update({
      processing_status: 'failed',
      processing_error: message,
      processed_at: new Date().toISOString(),
    } as never).eq('id', event.id);
    return {
      ...emptyProcessResult({ eventType: event.event_type, event, ruleStatus: 'failed', errors: [message] }),
      rule_status: 'failed',
    };
  }
  let ruleLogStatus: NotificationRuleLogStatus = ruleResult.status;
  let processingStatus: NotificationEventRow['processing_status'] =
    ruleResult.status === 'failed' ? 'failed' : ruleResult.status === 'skipped' ? 'skipped' : 'processed';
  let processingError: string | null = ruleResult.error ?? null;

  if (ruleResult.status === 'skipped') {
    ruleLogStatus = ruleResult.rule_name === 'unhandled' ? 'no_rule' : 'skipped';
    if (ruleLogStatus === 'no_rule') {
      const warning = `No notification rule matched event type "${event.event_type}".`;
      warnings.push(warning);
      processingError = warning;
    }
  } else if (ruleResult.status === 'matched' && ruleResult.rows.length === 0) {
    ruleLogStatus = 'no_recipients';
    processingStatus = 'failed';
    const warning = `Notification rule "${ruleResult.rule_name}" matched but resolved zero active auth-linked recipients. Check profile role assignment and profiles.user_id linkage.`;
    warnings.push(warning);
    processingError = warning;
  }

  // Log rule processing
  const ruleLog = await logRule(client, {
    event_id: event.id,
    rule_name: ruleResult.rule_name,
    status: ruleLogStatus,
    recipient_count: ruleResult.rows.length,
    error_message: processingError,
    metadata: {
      event_type: event.event_type,
      source_table: event.source_table,
      source_id: event.source_id,
      priority: event.priority,
      auth_link_required: true,
      expected_recipient_profile_ids: expectedRecipientProfileIdsFromPayload(event.payload ?? {}),
      recipient_profile_ids: ruleResult.rows.map((row) => row.recipient_profile_id),
      diagnostics: ruleResult.diagnostics ?? null,
    },
  });
  const ruleLogs = ruleLog ? [ruleLog] : [];

  if (ruleResult.status === 'failed' || ruleLogStatus === 'no_recipients' || ruleLogStatus === 'no_rule') {
    await client
      .from('notification_events')
      .update({
        processing_status: processingStatus,
        processing_error: processingError,
        processed_at: new Date().toISOString(),
      } as never)
      .eq('id', event.id);
    if (ruleResult.status === 'failed') {
      errors.push(ruleResult.error ?? 'notification_rule_failed');
    }
    return {
      ok: false,
      event,
      eventId: event.id,
      eventType: event.event_type,
      notifications: [],
      notificationCount: 0,
      recipientsResolved: ruleResult.rows.length,
      ruleLogs,
      delivery,
      warnings,
      errors,
      rule_status: 'failed',
      rule_name: ruleResult.rule_name,
      error: errors[0] ?? processingError ?? undefined,
    };
  }

  // Insert each notification (with dedupe), then attempt delivery.
  const created: NotificationRow[] = [];
  for (const input of ruleResult.rows) {
    const inserted = await createNotificationForProfileWithResult(client, {
      ...input,
      event_id: event.id,
    });
    if (inserted.notification) {
      created.push(inserted.notification);
      delivery.inAppCreated += inserted.inAppCreated;
      foldDelivery(delivery, inserted.delivery);
    }
    if (inserted.error) {
      if (inserted.inAppCreated > 0) {
        // In-app row was created; the error came from the Telegram delivery
        // path. Telegram is a bonus channel — its failure must not trigger a
        // user-visible "needs review" warning, so this goes to warnings only.
        warnings.push(`telegram_delivery_failed for ${input.recipient_profile_id}: ${inserted.error}`);
      } else {
        // In-app insert actually failed — this is a genuine delivery gap.
        const message = `Notification insert failed for recipient ${input.recipient_profile_id}: ${inserted.error}`;
        errors.push(message);
        if (isInsertFailure({ message: inserted.error })) warnings.push(message);
      }
    }
  }

  if (ruleResult.rows.length > 0 && created.length === 0) {
    errors.push('notification_insert_failed_for_all_recipients');
  }

  if (errors.length > 0) {
    processingStatus = 'failed';
    processingError = errors.join('; ');
  }

  // Mark event processed.
  await client
    .from('notification_events')
    .update({
      processing_status: processingStatus,
      processing_error: processingError,
      processed_at: new Date().toISOString(),
    } as never)
    .eq('id', event.id);

  return {
    ok: errors.length === 0 && created.length > 0,
    event,
    eventId: event.id,
    eventType: event.event_type,
    notifications: created,
    notificationCount: created.length,
    recipientsResolved: ruleResult.rows.length,
    ruleLogs,
    delivery,
    warnings,
    errors,
    rule_status: ruleResult.status,
    rule_name: ruleResult.rule_name,
    error: errors[0],
  };
}

export async function createNotificationForProfile(
  client: DbClient,
  input: CreateNotificationInput,
): Promise<NotificationRow | null> {
  const result = await createNotificationForProfileWithResult(client, input);
  return result.notification;
}

async function createNotificationForProfileWithResult(
  client: DbClient,
  input: CreateNotificationInput,
): Promise<{
  notification: NotificationRow | null;
  inAppCreated: number;
  delivery: DeliverResult | null;
  error?: string;
}> {
  try {
    // Dedupe first.
    const dedupe = await applyDedupe(client, input);
    if (dedupe.matched) {
      const updated = dedupe.updated ?? dedupe.existing ?? null;
      let delivery: DeliverResult | null = null;
      if (updated && !dedupe.shouldSuppressTelegram) {
        try {
          delivery = await deliverTelegramIfEligible(client, updated);
        } catch (err) {
          // Telegram failure on a deduped row: in-app was already delivered.
          // Log but do NOT propagate as an error — this must not trigger a
          // user-visible "needs review" warning.
          console.error('[notifications] dedupe delivery error:', err);
        }
      }
      return { notification: updated, inAppCreated: 0, delivery };
    }
    const payload = {
      recipient_profile_id: input.recipient_profile_id,
      recipient_role: input.recipient_role ?? null,
      title: input.title,
      message: input.message,
      priority: input.priority,
      category: input.category,
      source_type: input.source_type ?? null,
      source_id: input.source_id ?? null,
      event_id: input.event_id ?? null,
      asset_id: input.asset_id ?? null,
      department_id: input.department_id ?? null,
      action_href: input.action_href ?? null,
      action_label: input.action_label ?? null,
      dedupe_key: input.dedupe_key ?? null,
      metadata: input.metadata ?? {},
    };
    const { data, error } = (await client
      .from('notifications')
      .insert(payload as never)
      .select('*')
      .single()) as { data: NotificationRow | null; error: { message?: string } | null };
    if (error || !data) {
      // In-app insert failed — this is a real error that blocks delivery.
      console.error('[notifications] failed to insert notification:', error?.message);
      return {
        notification: null,
        inAppCreated: 0,
        delivery: null,
        error: error?.message ?? 'notification_insert_failed',
      };
    }
    let delivery: DeliverResult | null = null;
    try {
      delivery = await deliverTelegramIfEligible(client, data);
    } catch (err) {
      // Telegram delivery failed after in-app succeeded. The in-app
      // notification is the source of truth; Telegram is a bonus channel.
      // Log for diagnostics but do NOT set error — returning without an
      // error ensures this is treated as a successful delivery.
      console.error('[notifications] telegram delivery error:', err);
    }
    return { notification: data, inAppCreated: 1, delivery };
  } catch (err) {
    console.error('[notifications] create error:', err);
    return {
      notification: null,
      inAppCreated: 0,
      delivery: null,
      error: err instanceof Error ? err.message : 'notification_create_error',
    };
  }
}

async function logRule(
  client: DbClient,
  row: {
    event_id: string | null;
    rule_name: string;
    status: NotificationRuleLogStatus;
    recipient_count: number;
    error_message?: string | null;
    metadata?: Record<string, unknown>;
  },
): Promise<NotificationProcessRuleLog | null> {
  const payload = {
    event_id: row.event_id ?? null,
    rule_name: row.rule_name,
    status: row.status,
    recipient_count: row.recipient_count ?? 0,
    error_message: row.error_message ?? null,
    metadata: row.metadata ?? {},
  };
  const { data, error } = (await client
    .from('notification_rule_logs')
    .insert(payload as never)
    .select('*')
    .single()) as {
    data: NotificationProcessRuleLog | null;
    error: { message?: string } | null;
  };
  if (error) {
    console.error('[notifications] failed to log rule:', error.message);
    return null;
  }
  return data ?? {
    event_id: payload.event_id,
    rule_name: payload.rule_name,
    status: payload.status,
    recipient_count: payload.recipient_count,
    error_message: payload.error_message,
    metadata: payload.metadata,
  };
}

/**
 * Convenience wrapper: enqueue + process an event in one call, suppressing
 * exceptions so callers can fire-and-forget after their primary action.
 */
export async function emitNotificationEvent(input: NotificationEventInput): Promise<void> {
  try {
    await createNotificationEvent(input);
  } catch (err) {
    console.error('[notifications] emit error:', err);
  }
}
