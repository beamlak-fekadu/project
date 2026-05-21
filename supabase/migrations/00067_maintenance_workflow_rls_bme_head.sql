-- Migration 00067: Maintenance workflow RLS — grant bme_head
--
-- Symptom: BME Head clicking Approve on /maintenance/requests/[id] toasted
-- "Cannot coerce the result to a single JSON object" (PostgREST PGRST116).
--
-- Root cause: the legacy `manage_maintenance_requests` (UPDATE) policy from
-- migration 00026 only grants admin / technician / developer. `bme_head` is
-- not on the list. When the BME Head's session runs
--   UPDATE maintenance_requests SET status='approved' WHERE id=:id
--      RETURNING ...
-- the RLS USING clause returns false, so the UPDATE affects 0 rows. The
-- server action then calls `.select('*').single()` on the empty result,
-- and PostgREST raises:
--   "Cannot coerce the result to a single JSON object" (single-row JSON
--   requested, 0 rows returned).
--
-- Same systemic gap existed for `manage_work_orders` — the WO insert path
-- right after approval would have hit the same error once approval got
-- past the request UPDATE.
--
-- The application capability matrix (src/lib/rbac.ts) already grants
-- `maintenance.request.approve` and `work_order.create`/`assign`/etc. to
-- bme_head; this migration brings the DB authorization layer in lock-step.
--
-- Department-scoped SELECT policies from migration 00060 are NOT touched.

-- ============================================================================
-- maintenance_requests UPDATE policy
-- ============================================================================
DROP POLICY IF EXISTS manage_maintenance_requests ON maintenance_requests;
CREATE POLICY manage_maintenance_requests ON maintenance_requests
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
-- work_orders manage policy (FOR ALL = INSERT/UPDATE/DELETE; SELECT is
-- handled by select_work_orders + select_work_orders_dept_scope from 00060).
-- ============================================================================
DROP POLICY IF EXISTS manage_work_orders ON work_orders;
CREATE POLICY manage_work_orders ON work_orders
FOR ALL TO authenticated
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
