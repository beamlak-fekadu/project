-- Migration 00069: work-order completion reliability evidence idempotency
--
-- Symptom: completing a corrective work order can surface:
--
--   there is no unique or exclusion constraint matching the ON CONFLICT specification
--
-- The completion action now upserts maintenance_events on work_order_id, and
-- migration 00061's downtime trigger upserts downtime_logs on event_id. Both
-- conflict targets need real non-partial unique arbiters. A plain non-unique
-- index is not enough, and a partial unique index is not a valid arbiter for
-- an ON CONFLICT target that does not include the same predicate.
--
-- Design: a non-null maintenance_events.work_order_id identifies the canonical
-- reliability event for that work order. Rows with NULL work_order_id remain
-- normal asset-level history; PostgreSQL unique indexes allow multiple NULLs.

-- ============================================================================
-- 1) Repair downtime_logs arbiter used by sync_downtime_logs_from_event()
-- ============================================================================
-- Preserve historical downtime rows if duplicate event_id links already exist.
-- Keep the most complete/latest row as canonical and clear event_id on the
-- others so no downtime evidence is deleted.
WITH ranked_downtime AS (
  SELECT
    id,
    ROW_NUMBER() OVER (
      PARTITION BY event_id
      ORDER BY
        (end_time IS NOT NULL) DESC,
        (duration_hours IS NOT NULL) DESC,
        created_at DESC,
        id
    ) AS rn
  FROM downtime_logs
  WHERE event_id IS NOT NULL
)
UPDATE downtime_logs dl
SET
  event_id = NULL,
  reason = concat_ws(
    ' ',
    NULLIF(dl.reason, ''),
    '[Migration 00069: duplicate event_id link cleared; row preserved as historical downtime evidence.]'
  )
FROM ranked_downtime rd
WHERE dl.id = rd.id
  AND rd.rn > 1;

-- Migration 00061 created this as a partial unique index, but the trigger uses
-- ON CONFLICT (event_id) without a predicate. Recreate it as a normal unique
-- index; multiple manual rows with NULL event_id are still allowed.
DROP INDEX IF EXISTS idx_downtime_logs_event_id_unique;
CREATE UNIQUE INDEX idx_downtime_logs_event_id_unique
  ON downtime_logs(event_id);

-- ============================================================================
-- 2) Repair maintenance_events.work_order_id duplicates before uniqueness
-- ============================================================================
-- Preserve all event rows. If several rows point at the same work order, keep
-- the completion-marked/latest row as canonical and clear work_order_id on the
-- other rows. Those rows remain visible in asset-level maintenance history.
WITH ranked_events AS (
  SELECT
    id,
    ROW_NUMBER() OVER (
      PARTITION BY work_order_id
      ORDER BY
        (completion_date IS NOT NULL) DESC,
        completion_date DESC NULLS LAST,
        updated_at DESC,
        created_at DESC,
        id
    ) AS rn
  FROM maintenance_events
  WHERE work_order_id IS NOT NULL
)
UPDATE maintenance_events me
SET
  work_order_id = NULL,
  notes = concat_ws(
    E'\n',
    NULLIF(me.notes, ''),
    'Migration 00069: duplicate work_order_id link cleared; row preserved as asset-level maintenance history.'
  )
FROM ranked_events re
WHERE me.id = re.id
  AND re.rn > 1;

-- This is deliberately a normal unique index, not partial. It is still NULL
-- friendly, but it can also satisfy Supabase/PostgREST ON CONFLICT
-- (work_order_id) upserts.
DROP INDEX IF EXISTS maintenance_events_one_per_work_order_idx;
CREATE UNIQUE INDEX maintenance_events_one_per_work_order_idx
  ON maintenance_events(work_order_id);

-- ============================================================================
-- 3) Backfill completed corrective work orders that are missing event evidence
-- ============================================================================
-- Do not overwrite existing maintenance_events. Use only data already present
-- on work_orders and originating maintenance_requests.
INSERT INTO maintenance_events (
  work_order_id,
  asset_id,
  event_type,
  failure_date,
  downtime_start,
  downtime_end,
  repair_duration_hours,
  action_taken,
  completed_by,
  completion_date,
  notes
)
SELECT
  wo.id,
  wo.asset_id,
  'corrective',
  COALESCE(mr.created_at, wo.created_at)::date,
  CASE
    WHEN COALESCE(wo.completed_at, wo.updated_at, wo.created_at) > COALESCE(wo.started_at, wo.created_at)
      THEN COALESCE(wo.started_at, wo.created_at)
    ELSE NULL
  END,
  CASE
    WHEN COALESCE(wo.completed_at, wo.updated_at, wo.created_at) > COALESCE(wo.started_at, wo.created_at)
      THEN COALESCE(wo.completed_at, wo.updated_at, wo.created_at)
    ELSE NULL
  END,
  COALESCE(
    wo.actual_hours,
    CASE
      WHEN COALESCE(wo.completed_at, wo.updated_at, wo.created_at) > COALESCE(wo.started_at, wo.created_at)
        THEN ROUND((EXTRACT(EPOCH FROM (COALESCE(wo.completed_at, wo.updated_at, wo.created_at) - COALESCE(wo.started_at, wo.created_at))) / 3600.0)::numeric, 2)
      ELSE NULL
    END
  ),
  COALESCE(
    NULLIF(BTRIM(wo.action_taken), ''),
    NULLIF(BTRIM(wo.closure_notes), ''),
    CASE wo.completion_outcome
      WHEN 'resolved' THEN 'Resolved - issue fully fixed.'
      WHEN 'partially_resolved' THEN 'Partially resolved - some issues remain.'
      WHEN 'not_resolved' THEN 'Not resolved - equipment still non-functional.'
      WHEN 'awaiting_parts_or_vendor' THEN 'Awaiting parts or vendor - blocked.'
      ELSE 'Backfilled from completed corrective work order.'
    END
  ),
  wo.assigned_to,
  COALESCE(wo.completed_at, wo.updated_at, wo.created_at)::date,
  concat_ws(
    ' ',
    'Backfilled from completed corrective work order by migration 00069.',
    CASE
      WHEN wo.completion_outcome IS NOT NULL THEN 'completion_outcome=' || wo.completion_outcome || '.'
      ELSE NULL
    END,
    CASE
      WHEN wo.final_equipment_condition IS NOT NULL THEN 'final_equipment_condition=' || wo.final_equipment_condition || '.'
      ELSE NULL
    END,
    CASE
      WHEN mr.id IS NOT NULL THEN 'failure_date_source=originating_maintenance_request.'
      ELSE 'failure_date_source=work_order_created_at.'
    END
  )
FROM work_orders wo
LEFT JOIN maintenance_requests mr ON mr.id = wo.request_id
WHERE wo.status = 'completed'
  AND wo.work_type = 'corrective'
  AND NOT EXISTS (
    SELECT 1
    FROM maintenance_events me
    WHERE me.work_order_id = wo.id
  )
ON CONFLICT (work_order_id) DO NOTHING;

COMMENT ON INDEX maintenance_events_one_per_work_order_idx IS
  'Canonical reliability evidence rule: at most one maintenance_events row may link to a non-null work_order_id. Multiple NULL work_order_id asset-history rows are allowed.';
