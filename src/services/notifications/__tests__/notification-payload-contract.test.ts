import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { buildNotificationLink } from '@/services/notifications/notification-links';

// Phase 1 regression tests for NOTIF-01, NOTIF-02, NOTIF-03.

const repoRoot = process.cwd();

function readSource(rel: string): string {
  return readFileSync(path.resolve(repoRoot, rel), 'utf8');
}

// NOTIF-01: createWorkOrderAction must emit both `technician_profile_id`
// (canonical, expected by rule_workOrderAssigned) and `assigned_to`.
test('NOTIF-01: createWorkOrderAction emits technician_profile_id for assignment', () => {
  const src = readSource('src/actions/maintenance.actions.ts');
  // Find the createWorkOrder emit block (work_order.assigned/created path).
  const idx = src.indexOf("'work_order.assigned'");
  assert.ok(idx > 0, 'work_order.assigned literal must exist');
  // Look at the next ~1500 chars for the payload block.
  const block = src.slice(idx, idx + 1500);
  assert.match(block, /technician_profile_id:\s*woRow\.assigned_to/);
  assert.match(block, /assigned_to:\s*woRow\.assigned_to/);
});

test('NOTIF-01: assign/reassign work order emits both assignee payload keys', () => {
  const src = readSource('src/actions/maintenance.actions.ts');
  const idx = src.indexOf('assignment_kind: action');
  assert.ok(idx > 0, 'assignment notification block must exist');
  const block = src.slice(idx - 700, idx + 700);
  assert.match(block, /technician_profile_id:\s*parsedId/);
  assert.match(block, /assigned_to:\s*parsedId/);
  assert.match(block, /technician_user_id_present/);
});

// NOTIF-01: rule_workOrderAssigned must accept either payload key.
test('NOTIF-01: rule_workOrderAssigned reads either technician_profile_id or assigned_to', () => {
  const src = readSource('src/services/notifications/notification-rules.ts');
  // Look at rule_workOrderAssigned section.
  const idx = src.indexOf('function rule_workOrderAssigned');
  assert.ok(idx > 0);
  const block = src.slice(idx, idx + 2000);
  // Must check both keys with `??` fallback.
  assert.match(block, /technician_profile_id/);
  assert.match(block, /assigned_to/);
  // [\s\S] is the portable equivalent of `.` with the `s` flag enabled.
  assert.match(block, /pickPayloadString[\s\S]*technician_profile_id[\s\S]*\?\?/);
});

// NOTIF-02: calibration request status change includes requester id and request number.
test('NOTIF-02: updateCalibrationRequestStatusAction includes requested_by + request_id', () => {
  const src = readSource('src/actions/calibration.actions.ts');
  const idx = src.indexOf("'calibration.request_status_changed'");
  assert.ok(idx > 0, 'event type literal must exist');
  // Look ahead ~2500 chars for the payload block.
  const block = src.slice(idx, idx + 2500);
  assert.match(block, /requested_by:/);
  assert.match(block, /request_id:/);
  assert.match(block, /request_number:/);
});

test('NOTIF-02: calibration failed_or_adjusted emits record_id', () => {
  const src = readSource('src/actions/calibration.actions.ts');
  const idx = src.indexOf("'calibration.failed_or_adjusted'");
  assert.ok(idx > 0);
  const block = src.slice(idx, idx + 1500);
  assert.match(block, /record_id:/);
});

// NOTIF-02: link builder routes calibration.failed_or_adjusted to /calibration/records/<id>.
test('NOTIF-02: link builder uses record_id for calibration.failed_or_adjusted', () => {
  const link = buildNotificationLink('calibration.failed_or_adjusted', {
    source_id: 'rec-uuid-123',
    asset_id: 'asset-1',
    payload: { record_id: 'rec-uuid-123' },
  });
  assert.ok(link);
  assert.equal(link!.href, '/calibration/records/rec-uuid-123');
});

// NOTIF-02: link builder uses request_id for calibration.request_status_changed.
test('NOTIF-02: link builder uses request_id for calibration.request_status_changed', () => {
  const link = buildNotificationLink('calibration.request_status_changed', {
    source_id: 'req-uuid-456',
    payload: { request_id: 'req-uuid-456' },
  });
  assert.ok(link);
  assert.equal(link!.href, '/calibration/requests/req-uuid-456');
});

// NOTIF-02 fallback: when payload omits request_id, link builder uses
// source_id as a last-resort exact route for the request.
test('NOTIF-02: link builder falls back to source_id for calibration.request_status_changed', () => {
  const link = buildNotificationLink('calibration.request_status_changed', {
    source_id: 'req-uuid-789',
    payload: {},
  });
  assert.ok(link);
  assert.equal(link!.href, '/calibration/requests/req-uuid-789');
});

// NOTIF-03: viewer self-test is no longer silently broken — server returns
// a structured cause when RLS denies the insert.
test('NOTIF-03: self-test action returns structured RLS denial message', () => {
  const src = readSource('src/actions/notifications.actions.ts');
  const idx = src.indexOf('createTestNotificationToSelfAction');
  assert.ok(idx > 0);
  const block = src.slice(idx, idx + 5000);
  // Must classify RLS denial separately from generic insert error.
  assert.match(block, /row-level security|new row violates/);
  assert.match(block, /isRlsDenial/);
  // Must reference migration 00073.
  assert.match(block, /00073/);
});

// NOTIF-03: migration 00073 adds self-insert policy.
test('NOTIF-03: migration 00073 adds Self insert notifications policy', () => {
  const src = readSource('supabase/migrations/00073_notification_self_test_rls.sql');
  assert.match(src, /Self insert notifications/);
  assert.match(src, /recipient_profile_id IN \(\s*SELECT id FROM profiles WHERE user_id = auth\.uid\(\)/);
  assert.match(src, /Self insert test notification_events/);
  assert.match(src, /event_type = 'system\.test_notification'/);
});

// PART 4: in-app notifications must still be created even when Telegram fails.
// Verified at code level: createNotificationForProfile inserts the in-app row
// first, then attempts Telegram inside try/catch.
test('PART 4: in-app notification is created before Telegram delivery is attempted', () => {
  const src = readSource('src/services/notifications/notification-engine.ts');
  // Locate the non-dedupe insert path: it's the `notifications.insert(...)`
  // call after the dedupe-matched branch. Then the next deliverTelegram
  // call must come after that insert.
  const insertIdx = src.indexOf("from('notifications')\n      .insert(payload");
  assert.ok(insertIdx > 0, 'must find the notifications.insert(payload) call');
  // Find the next deliverTelegramIfEligible after the insert.
  const afterInsert = src.slice(insertIdx);
  const telegramRelativeIdx = afterInsert.indexOf('deliverTelegramIfEligible');
  assert.ok(telegramRelativeIdx > 0, 'deliverTelegram must be called after insert');
  // Telegram delivery must be wrapped in try/catch. Use [\s\S] instead of
  // the `s` flag for compatibility with the project's TypeScript target.
  assert.match(
    afterInsert.slice(telegramRelativeIdx - 200, telegramRelativeIdx + 200),
    /try\s*\{[\s\S]*?deliverTelegramIfEligible/,
  );
});

// PART 4: recipient resolver uses correct identity chain
// auth.users.id = profiles.user_id, profiles.id = user_roles.user_id.
test('PART 4: recipient resolver does NOT confuse auth uid with profile id', () => {
  const src = readSource('src/services/notifications/recipient-resolver.ts');
  // Must use the user_roles.user_id FK (which equals profiles.id), not the
  // assigned_by FK. The FK hint guards against PostgREST ambiguity.
  assert.match(src, /user_roles!user_roles_user_id_fkey/);
  // toRecipient returns row.id (= profiles.id) as the recipient id.
  assert.match(src, /id:\s*row\.id/);
  // Contract constant documents the identity chain.
  assert.match(src, /NOTIFICATION_RECIPIENT_IDENTITY_CONTRACT/);
  assert.match(src, /recipientProfileId.*profiles\.id/);
});

test('PART 4: recipient resolver requires auth-linked profiles for deliverable recipients', () => {
  const src = readSource('src/services/notifications/recipient-resolver.ts');
  assert.match(src, /authLink.*profiles\.user_id = auth\.users\.id/);
  assert.match(src, /if \(!row\.user_id\) return null/);
  assert.match(src, /missing_auth_link/);
  assert.match(src, /getProfileRecipientReadiness/);
});

test('INSTANT-01: notification engine uses trusted server fan-out and records no-recipient states', () => {
  const src = readSource('src/services/notifications/notification-engine.ts');
  assert.match(src, /createAdminClient/);
  assert.match(src, /SUPABASE_SERVICE_ROLE_KEY/);
  assert.match(src, /no_recipients/);
  assert.match(src, /no_rule/);
  assert.match(src, /notificationDeliveryNeedsReview/);
  assert.match(src, /expected_recipient_profile_ids/);
  assert.match(src, /active auth-linked recipients/);
});

test('INSTANT-01: rule diagnostics record expected roles and profile auth readiness', () => {
  const rules = readSource('src/services/notifications/notification-rules.ts');
  const actions = readSource('src/actions/notifications.actions.ts');
  assert.match(rules, /expected_profile_recipients/);
  assert.match(rules, /expected_recipient_roles/);
  assert.match(rules, /getProfileRecipientReadiness/);
  assert.match(actions, /\.not\('user_id', 'is', null\)/);
});

test('INSTANT-02: migration 00076 enables rule diagnostics and realtime notifications', () => {
  const src = readSource('supabase/migrations/00076_notification_instant_fanout.sql');
  assert.match(src, /no_recipients/);
  assert.match(src, /no_rule/);
  assert.match(src, /ALTER TABLE notifications REPLICA IDENTITY FULL/);
  assert.match(src, /ALTER PUBLICATION supabase_realtime ADD TABLE notifications/);
});

// EVENT-INSERT-01: the engine writes a fixed set of columns to
// `notification_events`. Some legacy deployments shipped extra columns
// (category, status, severity, channel, type, title, body, message) as
// NOT NULL, which causes every emit to fail with
// "null value in column 'category' of relation 'notification_events'"
// across maintenance_request.created / status_changed, work_order.*,
// pm.*, calibration.*, procurement.*, spare_part.*, qr.*, offline_sync.*,
// system.test_notification, and notification.rule_failed.
// Migration 00077 unconditionally drops those legacy NOT NULL constraints.
test('EVENT-INSERT-01: engine insert payload does NOT include legacy event columns', () => {
  const src = readSource('src/services/notifications/notification-engine.ts');
  // Locate the createNotificationEvent insertPayload literal.
  const idx = src.indexOf('const insertPayload =');
  assert.ok(idx > 0, 'createNotificationEvent insertPayload must exist');
  const block = src.slice(idx, idx + 800);
  // None of these legacy column names should appear as object keys in the
  // insert payload — the engine intentionally writes only the canonical
  // event columns.
  for (const legacy of ['category', 'severity', 'channel', 'title', 'body', 'message']) {
    assert.doesNotMatch(block, new RegExp(`\\b${legacy}\\s*:`), `payload must not write ${legacy}`);
  }
});

test('EVENT-INSERT-01: migration 00077 relaxes legacy NOT NULL on notification_events', () => {
  const src = readSource('supabase/migrations/00077_notification_events_legacy_not_null.sql');
  assert.match(src, /notification_events/);
  for (const col of ['category', 'status', 'severity', 'channel', 'type', 'title', 'body', 'message']) {
    assert.match(src, new RegExp(`'${col}'`));
  }
  assert.match(src, /DROP NOT NULL/);
  assert.match(src, /is_nullable = 'NO'/);
});

test('INSTANT-03: bell and notifications page use realtime/event refresh, not 45-second polling only', () => {
  const bell = readSource('src/components/notifications/NotificationBell.tsx');
  const page = readSource('src/app/(dashboard)/notifications/page.tsx');
  assert.match(bell, /useNotificationRealtime/);
  assert.match(bell, /publishNotificationsUpdated/);
  assert.doesNotMatch(bell, /45_000/);
  assert.match(bell, /15_000/);
  assert.match(page, /useNotificationRealtime/);
  assert.match(page, /publishNotificationsUpdated/);
});

test('INSTANT-04: workflow warnings use review wording instead of generic queue failure', () => {
  const pm = readSource('src/actions/pm.actions.ts');
  const pmPage = readSource('src/app/(dashboard)/pm/schedules/[id]/page.tsx');
  assert.doesNotMatch(pm, /notification_queue_failed/);
  assert.doesNotMatch(pmPage, /notification delivery could not be queued/);
  assert.match(pm, /notification_delivery_needs_review/);
  assert.match(pmPage, /notification delivery needs review/);
});

test('DEMO-CM: completed maintenance request notification names requester outcome and final condition', () => {
  const rules = readSource('src/services/notifications/notification-rules.ts');
  const actions = readSource('src/actions/maintenance.actions.ts');
  assert.match(rules, /Your maintenance request for \$\{asset\} has been completed\. The equipment is now functional\./);
  assert.match(rules, /final_equipment_condition/);
  assert.match(actions, /final_equipment_condition:\s*conditionToSet/);
  assert.match(actions, /event_type:\s*'maintenance_request\.status_changed'/);
});
