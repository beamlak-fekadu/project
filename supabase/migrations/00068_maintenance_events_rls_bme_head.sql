-- Migration 00068: maintenance_events RLS — grant bme_head INSERT/UPDATE
--
-- Symptom: BME Head (or any role with work_order.complete capability that is
-- not currently in the maintenance_events policy allowlist) completes a
-- corrective work order. The work_orders UPDATE succeeds (migration 00067
-- already added bme_head there), the equipment condition sync succeeds
-- (migration 00059's SECURITY DEFINER RPC), but the follow-up
-- maintenance_events INSERT/UPDATE in updateWorkOrderAction is denied with:
--
--   ERROR: new row violates row-level security policy for table
--          "maintenance_events"
--
-- This surfaces on the UI as a "Work order completed. Reliability evidence
-- could not be recorded…" amber toast and a Completed-with-no-evidence
-- banner on the Work Order Detail page. MTTR / MTBF / availability never
-- refresh for the asset, defeating the R2 evidence pipeline.
--
-- Root cause: the legacy `insert_maintenance_events` and
-- `update_maintenance_events` policies from migration 00012 (and
-- regranted by 00026) gate on:
--
--   INSERT: admin / technician / developer / store_user
--   UPDATE: admin / technician / developer
--
-- The application capability matrix (src/lib/rbac.ts → CAPABILITY_MATRIX)
-- gives `work_order.complete` to: developer, admin, bme_head, technician.
-- The DB layer must mirror the application layer or completion silently
-- skips the reliability evidence writer.
--
-- This is the SAME systemic gap that migration 00067 closed for
-- maintenance_requests and work_orders. We use the same shape here for
-- maintenance_events: explicit USING + WITH CHECK against the canonical
-- four-role allowlist (developer / admin / bme_head / technician), plus
-- keep store_user on the INSERT side so existing offline stock-issue
-- replay paths that log a maintenance_events note (replayMaintenanceEvent
-- in offline-sync.actions.ts) are not regressed.
--
-- Department-scoped SELECT policies are NOT touched. select_maintenance_events
-- from migration 00012 (USING (true)) remains the SELECT contract — the
-- Work Order Detail page already enforces department scope at the
-- application layer for department roles.

-- ============================================================================
-- maintenance_events INSERT policy
-- ============================================================================
DROP POLICY IF EXISTS insert_maintenance_events ON maintenance_events;
CREATE POLICY insert_maintenance_events ON maintenance_events
FOR INSERT TO authenticated
WITH CHECK (
  auth_user_has_role('developer')
  OR auth_user_has_role('admin')
  OR auth_user_has_role('bme_head')
  OR auth_user_has_role('technician')
  OR auth_user_has_role('store_user')
);

-- ============================================================================
-- maintenance_events UPDATE policy
-- ============================================================================
-- UPDATE intentionally does NOT include store_user — they should not be
-- amending completion events. They are kept on INSERT only for offline
-- replay of parts-needed / stock-context notes.
DROP POLICY IF EXISTS update_maintenance_events ON maintenance_events;
CREATE POLICY update_maintenance_events ON maintenance_events
FOR UPDATE TO authenticated
USING (
  auth_user_has_role('developer')
  OR auth_user_has_role('admin')
  OR auth_user_has_role('bme_head')
  OR auth_user_has_role('technician')
)
WITH CHECK (
  auth_user_has_role('developer')
  OR auth_user_has_role('admin')
  OR auth_user_has_role('bme_head')
  OR auth_user_has_role('technician')
);

-- ============================================================================
-- Note on idempotency: the application-layer completion writer
-- (updateWorkOrderAction in src/actions/maintenance.actions.ts) detects an
-- existing "completion event" by querying for the WO's events where
-- completion_date IS NOT NULL and UPDATEs that row instead of inserting.
-- Hence UPDATE permission is required alongside INSERT for the same role
-- set; otherwise re-completion would fail even after the first completion
-- succeeded.
-- ============================================================================
