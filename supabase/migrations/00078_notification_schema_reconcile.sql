-- =============================================================================
-- Migration 00078 — Full notification schema reconciliation.
-- =============================================================================
--
-- The deployed notification tables diverge from the in-tree schema in three
-- ways that cause every in-app and Telegram notification to fail silently.
-- This migration fixes all three in the correct dependency order so that
-- applying it once makes the full notification pipeline functional.
--
-- ── Problem 1: notification_events.entity_type NOT NULL, no default ────────
-- The engine's createNotificationEvent() insert payload does not include
-- entity_type (the column is not part of the in-tree schema). The deployed
-- table declares it NOT NULL with no default, so every event insert fails:
--   "null value in column "entity_type" of relation "notification_events""
-- Fix: drop the NOT NULL constraint and give the column an empty-string
-- default so legacy rows are unaffected and new inserts succeed silently.
--
-- ── Problem 2: notifications.status default 'queued' violates CHECK ────────
-- The deployed notifications table has status DEFAULT 'queued'. Migration
-- 00057 replaced the legacy CHECK with chk_notifications_status which only
-- allows unread|read|reviewed|dismissed. Every notification insert (which
-- does not write status explicitly) therefore fails:
--   "new row for relation "notifications" violates check constraint
--    "chk_notifications_status""
-- Fix: change the column default to 'unread' to match the CHECK and the
-- application's NotificationStatus type.
--
-- ── Problem 3: notification_rule_logs CHECK missing no_recipients/no_rule ──
-- Migration 00076 tried to add 'no_recipients' and 'no_rule' to the rule-log
-- status CHECK, but the deployed DB still shows the 00057 version of the
-- constraint (matched|skipped|failed only). The engine emits ruleLogStatus
-- = 'no_recipients' and 'no_rule' on zero-recipient and unhandled-event
-- paths, so those log inserts fail silently.
-- Fix: drop and re-add the constraint with the full vocabulary.
--
-- All three fixes are idempotent guards using existence checks.
-- =============================================================================

BEGIN;

-- ── Fix 1: notification_events.entity_type ───────────────────────────────
DO $$
BEGIN
  -- Drop NOT NULL if present
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'notification_events'
      AND column_name = 'entity_type'
      AND is_nullable = 'NO'
  ) THEN
    ALTER TABLE public.notification_events
      ALTER COLUMN entity_type DROP NOT NULL;
  END IF;

  -- Set a safe default so legacy inserts that omit the column don't fail
  -- even if some consumer expects a non-null value.
  ALTER TABLE public.notification_events
    ALTER COLUMN entity_type SET DEFAULT '';
END $$;

-- While we're here, do the same defensive sweep for any other legacy NOT NULL
-- column on notification_events that the engine doesn't write (mirrors 00077).
DO $$
DECLARE
  c TEXT;
BEGIN
  FOREACH c IN ARRAY ARRAY[
    'entity_id', 'action', 'triggered_by', 'notification_type',
    'source_record_id', 'aggregate_key'
  ]
  LOOP
    IF EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'notification_events'
        AND column_name = c
        AND is_nullable = 'NO'
        AND column_default IS NULL
    ) THEN
      EXECUTE format(
        'ALTER TABLE public.notification_events ALTER COLUMN %I DROP NOT NULL',
        c
      );
    END IF;
  END LOOP;
END $$;

-- ── Fix 2: notifications.status default must be 'unread' ─────────────────
DO $$
BEGIN
  -- Only act if the current default is 'queued' (the legacy value).
  -- If it is already 'unread' (the correct value) this is a no-op.
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'notifications'
      AND column_name = 'status'
      AND column_default LIKE '%queued%'
  ) THEN
    ALTER TABLE public.notifications
      ALTER COLUMN status SET DEFAULT 'unread';
  END IF;
END $$;

-- ── Fix 3: notification_rule_logs CHECK vocabulary ────────────────────────
ALTER TABLE public.notification_rule_logs
  DROP CONSTRAINT IF EXISTS chk_notification_rule_logs_status;

ALTER TABLE public.notification_rule_logs
  ADD CONSTRAINT chk_notification_rule_logs_status
  CHECK (
    status IS NULL
    OR status = ANY (ARRAY[
      'matched'::text,
      'skipped'::text,
      'failed'::text,
      'no_recipients'::text,
      'no_rule'::text
    ])
  );

COMMIT;
