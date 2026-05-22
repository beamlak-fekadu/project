-- Migration 00079: Comprehensive RLS ↔ capability-matrix alignment
--
-- Root cause pattern: every hotfix migration (00067, 00068, 00070, 00071,
-- 00072) repaired one table at a time after a user reported a broken
-- workflow. The systemic gap is that the 00012 / 00026 policy-generation
-- loops wrote "admin / technician / developer" as the write allowlist for
-- ALL operational tables, without knowing that future roles (bme_head,
-- department_head, department_user) would later receive operational
-- capabilities in the application RBAC matrix (src/lib/rbac.ts).
--
-- This migration does one pass across every remaining table and brings the
-- DB authorization layer into full alignment with the capability matrix.
-- No table is touched more than once; no existing policy from 00067–00078
-- is regressed.
--
-- Alignment rules applied:
--
--   capability          → who can perform the DB write
--   ──────────────────────────────────────────────────────────────────────
--   calibration.request.approve / .schedule
--                       → developer, admin, bme_head, technician (UPDATE)
--   calibration.record_result
--                       → developer, admin, bme_head, technician
--   pm.plan.create      → developer, admin, bme_head
--   pm.complete         → developer, admin, bme_head, technician
--   training.request.create
--                       → developer, admin, bme_head, technician,
--                          department_head, department_user
--   training.schedule   → developer, admin, bme_head (INSERT sessions)
--   training.record_attendance
--                       → developer, admin, bme_head, technician
--   disposal.request.create
--                       → developer, admin, bme_head,
--                          department_head, department_user
--   disposal.approve    → developer, admin, bme_head (UPDATE)
--   disposal.record     → developer, admin, bme_head
--   spare_parts.manage  → developer, admin, bme_head, store_user
--   stock.receive       → developer, admin, bme_head, store_user
--   stock.issue         → developer, admin, bme_head, store_user
--   procurement.request → developer, admin, bme_head, technician,
--                          store_user (department_user kept from 00026)
--   procurement.status_update
--                       → developer, admin, bme_head (+ store_user kept
--                          for logistics receive workflow)
--   equipment.create/edit (documents)
--                       → developer, admin, bme_head, technician
--   users.manage        → developer, admin, bme_head  (profiles UPDATE)
--   roles.manage        → developer, admin, bme_head  (user_roles writes)
--   audit.view          → developer, admin, bme_head  (audit_logs SELECT)
--
-- DELETE policies remain restricted to developer / admin (or admin only)
-- unless the application action explicitly permits technician deletion
-- (equipment_documents).
--
-- Tables already fixed in prior migrations and NOT touched here:
--   maintenance_requests UPDATE  → 00067
--   work_orders ALL              → 00067
--   maintenance_events INSERT/UPDATE → 00068
--   pm_schedules INSERT/UPDATE   → 00070
--   calibration_requests INSERT  → 00072
--   work_order_parts_needed      → 00062 (written correctly from the start)
--   installation_requests        → 00040 (written correctly from the start)
--   specification_requests       → 00041 (written correctly from the start)
--   command_center_acknowledgements → 00037 (written correctly)
--   notification_* tables        → 00055 (written correctly)
--   equipment_assets             → 00066 (equipment_assets_privileged_write)

BEGIN;

-- ============================================================================
-- 1. calibration_requests — UPDATE (approve / schedule / status changes)
--    INSERT is already fixed by 00072; only UPDATE was left behind.
-- ============================================================================
DROP POLICY IF EXISTS update_calibration_requests ON calibration_requests;
CREATE POLICY update_calibration_requests ON calibration_requests
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
-- 2. calibration_records — INSERT / UPDATE
--    calibration.record_result → developer / admin / bme_head / technician
-- ============================================================================
DROP POLICY IF EXISTS insert_calibration_records ON calibration_records;
CREATE POLICY insert_calibration_records ON calibration_records
FOR INSERT TO authenticated
WITH CHECK (
  auth_user_has_role('developer')
  OR auth_user_has_role('admin')
  OR auth_user_has_role('bme_head')
  OR auth_user_has_role('technician')
);

DROP POLICY IF EXISTS update_calibration_records ON calibration_records;
CREATE POLICY update_calibration_records ON calibration_records
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
-- 3. calibration_certificates — INSERT / UPDATE
--    Evidence documents linked to calibration records.
-- ============================================================================
DROP POLICY IF EXISTS insert_calibration_certificates ON calibration_certificates;
CREATE POLICY insert_calibration_certificates ON calibration_certificates
FOR INSERT TO authenticated
WITH CHECK (
  auth_user_has_role('developer')
  OR auth_user_has_role('admin')
  OR auth_user_has_role('bme_head')
  OR auth_user_has_role('technician')
);

DROP POLICY IF EXISTS update_calibration_certificates ON calibration_certificates;
CREATE POLICY update_calibration_certificates ON calibration_certificates
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
-- 4. pm_plans — INSERT / UPDATE
--    pm.plan.create → developer / admin / bme_head
--    Technician does not create or edit PM plans; they execute schedules.
-- ============================================================================
DROP POLICY IF EXISTS insert_pm_plans ON pm_plans;
CREATE POLICY insert_pm_plans ON pm_plans
FOR INSERT TO authenticated
WITH CHECK (
  auth_user_has_role('developer')
  OR auth_user_has_role('admin')
  OR auth_user_has_role('bme_head')
);

DROP POLICY IF EXISTS update_pm_plans ON pm_plans;
CREATE POLICY update_pm_plans ON pm_plans
FOR UPDATE TO authenticated
USING (
  auth_user_has_role('developer')
  OR auth_user_has_role('admin')
  OR auth_user_has_role('bme_head')
)
WITH CHECK (
  auth_user_has_role('developer')
  OR auth_user_has_role('admin')
  OR auth_user_has_role('bme_head')
);

-- ============================================================================
-- 5. pm_completions — INSERT / UPDATE
--    pm.complete → developer / admin / bme_head / technician
-- ============================================================================
DROP POLICY IF EXISTS insert_pm_completions ON pm_completions;
CREATE POLICY insert_pm_completions ON pm_completions
FOR INSERT TO authenticated
WITH CHECK (
  auth_user_has_role('developer')
  OR auth_user_has_role('admin')
  OR auth_user_has_role('bme_head')
  OR auth_user_has_role('technician')
);

DROP POLICY IF EXISTS update_pm_completions ON pm_completions;
CREATE POLICY update_pm_completions ON pm_completions
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
-- 6. pm_checklists — INSERT / UPDATE
--    Used during PM execution (pm.complete path).
-- ============================================================================
DROP POLICY IF EXISTS insert_pm_checklists ON pm_checklists;
CREATE POLICY insert_pm_checklists ON pm_checklists
FOR INSERT TO authenticated
WITH CHECK (
  auth_user_has_role('developer')
  OR auth_user_has_role('admin')
  OR auth_user_has_role('bme_head')
  OR auth_user_has_role('technician')
);

DROP POLICY IF EXISTS update_pm_checklists ON pm_checklists;
CREATE POLICY update_pm_checklists ON pm_checklists
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
-- 7. training_requests — INSERT / UPDATE
--    training.request.create → developer / admin / bme_head / technician /
--                               department_head / department_user
--    UPDATE path for scheduling / processing requests.
-- ============================================================================
DROP POLICY IF EXISTS insert_training_requests ON training_requests;
CREATE POLICY insert_training_requests ON training_requests
FOR INSERT TO authenticated
WITH CHECK (
  auth_user_has_role('developer')
  OR auth_user_has_role('admin')
  OR auth_user_has_role('bme_head')
  OR auth_user_has_role('technician')
  OR auth_user_has_role('department_head')
  OR auth_user_has_role('department_user')
);

DROP POLICY IF EXISTS update_training_requests ON training_requests;
CREATE POLICY update_training_requests ON training_requests
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
-- 8. training_sessions — INSERT / UPDATE
--    training.schedule → developer / admin / bme_head
--    Technicians can update session status (mark completed / record results).
-- ============================================================================
DROP POLICY IF EXISTS insert_training_sessions ON training_sessions;
CREATE POLICY insert_training_sessions ON training_sessions
FOR INSERT TO authenticated
WITH CHECK (
  auth_user_has_role('developer')
  OR auth_user_has_role('admin')
  OR auth_user_has_role('bme_head')
);

DROP POLICY IF EXISTS update_training_sessions ON training_sessions;
CREATE POLICY update_training_sessions ON training_sessions
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
-- 9. staff_training_records — INSERT / UPDATE
--    training.record_attendance → developer / admin / bme_head / technician
-- ============================================================================
DROP POLICY IF EXISTS insert_staff_training_records ON staff_training_records;
CREATE POLICY insert_staff_training_records ON staff_training_records
FOR INSERT TO authenticated
WITH CHECK (
  auth_user_has_role('developer')
  OR auth_user_has_role('admin')
  OR auth_user_has_role('bme_head')
  OR auth_user_has_role('technician')
);

DROP POLICY IF EXISTS update_staff_training_records ON staff_training_records;
CREATE POLICY update_staff_training_records ON staff_training_records
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
-- 10. equipment_training_records — INSERT / UPDATE
--     Companion evidence to staff_training_records.
-- ============================================================================
DROP POLICY IF EXISTS insert_equipment_training_records ON equipment_training_records;
CREATE POLICY insert_equipment_training_records ON equipment_training_records
FOR INSERT TO authenticated
WITH CHECK (
  auth_user_has_role('developer')
  OR auth_user_has_role('admin')
  OR auth_user_has_role('bme_head')
  OR auth_user_has_role('technician')
);

DROP POLICY IF EXISTS update_equipment_training_records ON equipment_training_records;
CREATE POLICY update_equipment_training_records ON equipment_training_records
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
-- 11. disposal_requests — INSERT / UPDATE
--    INSERT: disposal.request.create → developer / admin / bme_head /
--            department_head / department_user
--    UPDATE: disposal.approve → developer / admin / bme_head
-- ============================================================================
DROP POLICY IF EXISTS insert_disposal_requests ON disposal_requests;
CREATE POLICY insert_disposal_requests ON disposal_requests
FOR INSERT TO authenticated
WITH CHECK (
  auth_user_has_role('developer')
  OR auth_user_has_role('admin')
  OR auth_user_has_role('bme_head')
  OR auth_user_has_role('department_head')
  OR auth_user_has_role('department_user')
);

DROP POLICY IF EXISTS update_disposal_requests ON disposal_requests;
CREATE POLICY update_disposal_requests ON disposal_requests
FOR UPDATE TO authenticated
USING (
  auth_user_has_role('developer')
  OR auth_user_has_role('admin')
  OR auth_user_has_role('bme_head')
)
WITH CHECK (
  auth_user_has_role('developer')
  OR auth_user_has_role('admin')
  OR auth_user_has_role('bme_head')
);

-- ============================================================================
-- 12. disposed_assets — INSERT / UPDATE
--    disposal.record → developer / admin / bme_head
-- ============================================================================
DROP POLICY IF EXISTS insert_disposed_assets ON disposed_assets;
CREATE POLICY insert_disposed_assets ON disposed_assets
FOR INSERT TO authenticated
WITH CHECK (
  auth_user_has_role('developer')
  OR auth_user_has_role('admin')
  OR auth_user_has_role('bme_head')
);

DROP POLICY IF EXISTS update_disposed_assets ON disposed_assets;
CREATE POLICY update_disposed_assets ON disposed_assets
FOR UPDATE TO authenticated
USING (
  auth_user_has_role('developer')
  OR auth_user_has_role('admin')
  OR auth_user_has_role('bme_head')
)
WITH CHECK (
  auth_user_has_role('developer')
  OR auth_user_has_role('admin')
  OR auth_user_has_role('bme_head')
);

-- ============================================================================
-- 13. spare_parts — INSERT / UPDATE
--    spare_parts.manage → developer / admin / bme_head / store_user
-- ============================================================================
DROP POLICY IF EXISTS insert_spare_parts ON spare_parts;
CREATE POLICY insert_spare_parts ON spare_parts
FOR INSERT TO authenticated
WITH CHECK (
  auth_user_has_role('developer')
  OR auth_user_has_role('admin')
  OR auth_user_has_role('bme_head')
  OR auth_user_has_role('store_user')
);

DROP POLICY IF EXISTS update_spare_parts ON spare_parts;
CREATE POLICY update_spare_parts ON spare_parts
FOR UPDATE TO authenticated
USING (
  auth_user_has_role('developer')
  OR auth_user_has_role('admin')
  OR auth_user_has_role('bme_head')
  OR auth_user_has_role('store_user')
)
WITH CHECK (
  auth_user_has_role('developer')
  OR auth_user_has_role('admin')
  OR auth_user_has_role('bme_head')
  OR auth_user_has_role('store_user')
);

-- ============================================================================
-- 14. stock_receipts — INSERT / UPDATE
--    stock.receive → developer / admin / bme_head / store_user
-- ============================================================================
DROP POLICY IF EXISTS insert_stock_receipts ON stock_receipts;
CREATE POLICY insert_stock_receipts ON stock_receipts
FOR INSERT TO authenticated
WITH CHECK (
  auth_user_has_role('developer')
  OR auth_user_has_role('admin')
  OR auth_user_has_role('bme_head')
  OR auth_user_has_role('store_user')
);

DROP POLICY IF EXISTS update_stock_receipts ON stock_receipts;
CREATE POLICY update_stock_receipts ON stock_receipts
FOR UPDATE TO authenticated
USING (
  auth_user_has_role('developer')
  OR auth_user_has_role('admin')
  OR auth_user_has_role('bme_head')
  OR auth_user_has_role('store_user')
)
WITH CHECK (
  auth_user_has_role('developer')
  OR auth_user_has_role('admin')
  OR auth_user_has_role('bme_head')
  OR auth_user_has_role('store_user')
);

-- ============================================================================
-- 15. stock_issues — INSERT / UPDATE
--    stock.issue → developer / admin / bme_head / store_user
-- ============================================================================
DROP POLICY IF EXISTS insert_stock_issues ON stock_issues;
CREATE POLICY insert_stock_issues ON stock_issues
FOR INSERT TO authenticated
WITH CHECK (
  auth_user_has_role('developer')
  OR auth_user_has_role('admin')
  OR auth_user_has_role('bme_head')
  OR auth_user_has_role('store_user')
);

DROP POLICY IF EXISTS update_stock_issues ON stock_issues;
CREATE POLICY update_stock_issues ON stock_issues
FOR UPDATE TO authenticated
USING (
  auth_user_has_role('developer')
  OR auth_user_has_role('admin')
  OR auth_user_has_role('bme_head')
  OR auth_user_has_role('store_user')
)
WITH CHECK (
  auth_user_has_role('developer')
  OR auth_user_has_role('admin')
  OR auth_user_has_role('bme_head')
  OR auth_user_has_role('store_user')
);

-- ============================================================================
-- 16. procurement_requests — INSERT / UPDATE
--    INSERT: procurement.request → developer / admin / bme_head / technician /
--            store_user (department_user retained from 00026 — they initiate
--            procurement through specification requests)
--    UPDATE: procurement.status_update → developer / admin / bme_head /
--            store_user (store_user retained for logistics receive workflow
--            even though the app capability is not explicitly granted)
-- ============================================================================
DROP POLICY IF EXISTS insert_procurement_requests ON procurement_requests;
CREATE POLICY insert_procurement_requests ON procurement_requests
FOR INSERT TO authenticated
WITH CHECK (
  auth_user_has_role('developer')
  OR auth_user_has_role('admin')
  OR auth_user_has_role('bme_head')
  OR auth_user_has_role('technician')
  OR auth_user_has_role('store_user')
  OR auth_user_has_role('department_user')
);

DROP POLICY IF EXISTS update_procurement_requests ON procurement_requests;
CREATE POLICY update_procurement_requests ON procurement_requests
FOR UPDATE TO authenticated
USING (
  auth_user_has_role('developer')
  OR auth_user_has_role('admin')
  OR auth_user_has_role('bme_head')
  OR auth_user_has_role('store_user')
)
WITH CHECK (
  auth_user_has_role('developer')
  OR auth_user_has_role('admin')
  OR auth_user_has_role('bme_head')
  OR auth_user_has_role('store_user')
);

-- ============================================================================
-- 17. equipment_documents — INSERT / UPDATE / DELETE
--    documents.actions.ts gates INSERT on:
--      admin / bme_head / technician / department_head / department_user /
--      store_user
--    DELETE on: admin / bme_head / technician
-- ============================================================================
DROP POLICY IF EXISTS insert_equipment_documents ON equipment_documents;
CREATE POLICY insert_equipment_documents ON equipment_documents
FOR INSERT TO authenticated
WITH CHECK (
  auth_user_has_role('developer')
  OR auth_user_has_role('admin')
  OR auth_user_has_role('bme_head')
  OR auth_user_has_role('technician')
  OR auth_user_has_role('department_head')
  OR auth_user_has_role('department_user')
  OR auth_user_has_role('store_user')
);

DROP POLICY IF EXISTS update_equipment_documents ON equipment_documents;
CREATE POLICY update_equipment_documents ON equipment_documents
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

DROP POLICY IF EXISTS delete_equipment_documents ON equipment_documents;
CREATE POLICY delete_equipment_documents ON equipment_documents
FOR DELETE TO authenticated
USING (
  auth_user_has_role('developer')
  OR auth_user_has_role('admin')
  OR auth_user_has_role('bme_head')
  OR auth_user_has_role('technician')
);

-- ============================================================================
-- 18. installation_records — INSERT / UPDATE
--    installation.actions.ts gates on admin / bme_head / technician
-- ============================================================================
DROP POLICY IF EXISTS insert_installation_records ON installation_records;
CREATE POLICY insert_installation_records ON installation_records
FOR INSERT TO authenticated
WITH CHECK (
  auth_user_has_role('developer')
  OR auth_user_has_role('admin')
  OR auth_user_has_role('bme_head')
  OR auth_user_has_role('technician')
);

DROP POLICY IF EXISTS update_installation_records ON installation_records;
CREATE POLICY update_installation_records ON installation_records
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
-- 19. downtime_logs — INSERT / UPDATE
--    Primarily written by the SECURITY DEFINER trigger in 00061, but the
--    policy must still permit bme_head for any direct action-layer writes.
-- ============================================================================
DROP POLICY IF EXISTS insert_downtime_logs ON downtime_logs;
CREATE POLICY insert_downtime_logs ON downtime_logs
FOR INSERT TO authenticated
WITH CHECK (
  auth_user_has_role('developer')
  OR auth_user_has_role('admin')
  OR auth_user_has_role('bme_head')
  OR auth_user_has_role('technician')
);

DROP POLICY IF EXISTS update_downtime_logs ON downtime_logs;
CREATE POLICY update_downtime_logs ON downtime_logs
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
-- 20. maintenance_parts_used — INSERT / UPDATE
--    Parts tracking during maintenance execution.
-- ============================================================================
DROP POLICY IF EXISTS insert_maintenance_parts_used ON maintenance_parts_used;
CREATE POLICY insert_maintenance_parts_used ON maintenance_parts_used
FOR INSERT TO authenticated
WITH CHECK (
  auth_user_has_role('developer')
  OR auth_user_has_role('admin')
  OR auth_user_has_role('bme_head')
  OR auth_user_has_role('technician')
  OR auth_user_has_role('store_user')
);

DROP POLICY IF EXISTS update_maintenance_parts_used ON maintenance_parts_used;
CREATE POLICY update_maintenance_parts_used ON maintenance_parts_used
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
-- 21. asset_status_history — INSERT
--    equipment.condition.update includes bme_head / technician /
--    department_head / department_user; widen INSERT to match.
-- ============================================================================
DROP POLICY IF EXISTS insert_asset_status_history ON asset_status_history;
CREATE POLICY insert_asset_status_history ON asset_status_history
FOR INSERT TO authenticated
WITH CHECK (
  auth_user_has_role('developer')
  OR auth_user_has_role('admin')
  OR auth_user_has_role('bme_head')
  OR auth_user_has_role('technician')
  OR auth_user_has_role('department_head')
  OR auth_user_has_role('department_user')
);

DROP POLICY IF EXISTS update_asset_status_history ON asset_status_history;
CREATE POLICY update_asset_status_history ON asset_status_history
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
-- 22. audit_logs — SELECT
--    audit.view capability → developer / admin / bme_head
--    Before this fix bme_head saw no audit history.
-- ============================================================================
DROP POLICY IF EXISTS select_audit_logs ON audit_logs;
CREATE POLICY select_audit_logs ON audit_logs
FOR SELECT TO authenticated
USING (
  auth_user_has_role('developer')
  OR auth_user_has_role('admin')
  OR auth_user_has_role('bme_head')
);

-- ============================================================================
-- 23. profiles — UPDATE (admin management path)
--    users.manage capability → developer / admin / bme_head
--    The own-profile UPDATE policy (update_own_profile) is unchanged.
-- ============================================================================
DROP POLICY IF EXISTS admin_manage_profiles ON profiles;
CREATE POLICY admin_manage_profiles ON profiles
FOR ALL TO authenticated
USING (
  auth_user_has_role('developer')
  OR auth_user_has_role('admin')
  OR auth_user_has_role('bme_head')
)
WITH CHECK (
  auth_user_has_role('developer')
  OR auth_user_has_role('admin')
  OR auth_user_has_role('bme_head')
);

-- ============================================================================
-- 24. user_roles — ALL (role assignment / removal)
--    roles.manage capability → developer / admin / bme_head
-- ============================================================================
DROP POLICY IF EXISTS admin_manage_user_roles ON user_roles;
CREATE POLICY admin_manage_user_roles ON user_roles
FOR ALL TO authenticated
USING (
  auth_user_has_role('developer')
  OR auth_user_has_role('admin')
  OR auth_user_has_role('bme_head')
)
WITH CHECK (
  auth_user_has_role('developer')
  OR auth_user_has_role('admin')
  OR auth_user_has_role('bme_head')
);

COMMIT;
