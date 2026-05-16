-- =============================================================================
-- Migration 00046 — Offline Sync Events Phase 3 schema
-- =============================================================================
--
-- Adds first-class columns to `offline_sync_events` so Phase 3 conflict
-- resolution and Sync Review Center evidence don't have to live entirely inside
-- the payload JSONB. Non-breaking:
--
--   - New columns are NULLABLE.
--   - The CHECK on sync_status is relaxed to accept the Phase 3 statuses while
--     keeping the legacy values (`pending`/`synced`/`failed`).
--   - RLS is unchanged for SELECT/INSERT. UPDATE permission is reaffirmed for
--     developer/admin/bme_head so the Sync Review Center can mark resolution
--     fields without rewriting the row from scratch.
--
-- The Phase 3 client-side code keeps writing payload mirrors of every new
-- column. Phase 1 + Phase 2 events that lived only in payload remain readable.
-- =============================================================================

BEGIN;

-- ─── New columns ────────────────────────────────────────────────────────────
ALTER TABLE offline_sync_events
  ADD COLUMN IF NOT EXISTS reported_status TEXT,
  ADD COLUMN IF NOT EXISTS resolution_status TEXT,
  ADD COLUMN IF NOT EXISTS conflict_type TEXT,
  ADD COLUMN IF NOT EXISTS conflict_reason TEXT,
  ADD COLUMN IF NOT EXISTS error_message TEXT,
  ADD COLUMN IF NOT EXISTS role_name TEXT,
  ADD COLUMN IF NOT EXISTS source_route TEXT,
  ADD COLUMN IF NOT EXISTS asset_id UUID,
  ADD COLUMN IF NOT EXISTS retry_count INTEGER,
  ADD COLUMN IF NOT EXISTS resolved_by UUID REFERENCES profiles(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS resolved_at TIMESTAMPTZ;

-- ─── Backfill from payload (Phase 1 / Phase 2 historical rows) ──────────────
-- Best-effort: copy known string fields out of payload into the new columns
-- when they're present and not already populated. This is idempotent.
UPDATE offline_sync_events
SET
  reported_status   = COALESCE(reported_status,   NULLIF(payload->>'reported_status',   '')),
  conflict_reason   = COALESCE(conflict_reason,   NULLIF(payload->>'conflict_reason',   '')),
  error_message     = COALESCE(error_message,     NULLIF(payload->>'error_message',     '')),
  role_name         = COALESCE(role_name,         NULLIF(payload->>'role_name',         '')),
  source_route      = COALESCE(source_route,      NULLIF(payload->>'source_route',      '')),
  resolution_status = COALESCE(resolution_status, NULLIF(payload->>'resolution_status', '')),
  conflict_type     = COALESCE(
    conflict_type,
    NULLIF((payload->'conflict_detail'->>'conflict_type'), '')
  ),
  retry_count       = COALESCE(retry_count, NULLIF(payload->>'retry_count','')::INTEGER)
WHERE payload IS NOT NULL;

-- ─── CHECK constraint: accept Phase 3 statuses, keep legacy ones ────────────
ALTER TABLE offline_sync_events DROP CONSTRAINT IF EXISTS chk_offline_sync_events_status;
ALTER TABLE offline_sync_events
  ADD CONSTRAINT chk_offline_sync_events_status
  CHECK (sync_status IN (
    'pending',
    'synced',
    'failed',
    'conflict',
    'under_review',
    'resolved_synced',
    'resolved_discarded'
  ));

-- ─── CHECK constraint for resolution_status (nullable + enum) ───────────────
ALTER TABLE offline_sync_events DROP CONSTRAINT IF EXISTS chk_offline_sync_events_resolution;
ALTER TABLE offline_sync_events
  ADD CONSTRAINT chk_offline_sync_events_resolution
  CHECK (
    resolution_status IS NULL
    OR resolution_status IN (
      'conflict',
      'under_review',
      'resolved_synced',
      'resolved_discarded',
      'resolved_manual',
      'discarded',
      'manual_resolved'
    )
  );

-- ─── Indexes for Sync Review Center queries ─────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_offline_sync_events_created_at_desc
  ON offline_sync_events (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_offline_sync_events_actor_created
  ON offline_sync_events (actor_user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_offline_sync_events_action_type
  ON offline_sync_events (action_type);
CREATE INDEX IF NOT EXISTS idx_offline_sync_events_conflict_type
  ON offline_sync_events (conflict_type)
  WHERE conflict_type IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_offline_sync_events_reported_status
  ON offline_sync_events (reported_status)
  WHERE reported_status IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_offline_sync_events_asset_id
  ON offline_sync_events (asset_id)
  WHERE asset_id IS NOT NULL;

-- ─── RLS UPDATE policy reaffirmation ────────────────────────────────────────
-- The existing UPDATE policy already includes developer/admin/technician. We
-- explicitly include `bme_head` so the Sync Review Center can patch resolution
-- columns without falling back to insert-only audit rows.
DROP POLICY IF EXISTS update_offline_sync_events ON offline_sync_events;
CREATE POLICY update_offline_sync_events ON offline_sync_events
  FOR UPDATE TO authenticated
  USING (
    auth_user_has_role('admin')
    OR auth_user_has_role('bme_head')
    OR auth_user_has_role('developer')
    OR auth_user_has_role('technician')
  );

COMMIT;
