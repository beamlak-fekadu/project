-- Migration 00071: calibration_requests RLS — department request creation
--
-- Symptom: Department Head and Department User can see the "create calibration
-- request" workflow because the application capability matrix grants
-- `calibration.request.create`, but the database INSERT policy on
-- calibration_requests still comes from the old operational-table allowlist:
--
--   developer / admin / technician / store_user
--
-- Result: department roles hit PostgREST RLS denial when submitting a
-- calibration request for equipment in their own department.
--
-- Fix: align the DB write policy with the app capability. Developer, admin,
-- bme_head, and technician may create calibration requests across departments.
-- Department Head/User may create only when the target asset belongs to their
-- own profile.department_id. Store User is intentionally not included because
-- the app capability matrix does not grant stock/logistics users calibration
-- request creation.
--
-- SELECT department scoping from migration 00060 is not touched.

DROP POLICY IF EXISTS insert_calibration_requests ON calibration_requests;
CREATE POLICY insert_calibration_requests ON calibration_requests
FOR INSERT TO authenticated
WITH CHECK (
  auth_user_has_role('developer')
  OR auth_user_has_role('admin')
  OR auth_user_has_role('bme_head')
  OR auth_user_has_role('technician')
  OR (
    is_dept_scoped_role()
    AND EXISTS (
      SELECT 1
      FROM equipment_assets ea
      WHERE ea.id = calibration_requests.asset_id
        AND ea.department_id IS NOT NULL
        AND ea.department_id = auth_profile_department_id()
    )
  )
);
