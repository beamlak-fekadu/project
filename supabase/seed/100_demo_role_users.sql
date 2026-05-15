-- Seed 100: BMERMS demo login accounts (7 roles)
--
-- IMPORTANT — Job titles vs database roles:
--   Job titles are stored in profiles.job_title and are FREE TEXT
--   (e.g. "Clinical Engineer", "Radiologist", "ICU Head",
--   "Biomedical Engineering Head", "Medical Director", "Thesis Developer",
--   "Medical Equipment Store Officer").
--   They are NOT database roles. Do NOT create roles like clinical_engineer,
--   radiologist, or icu_head.
--
--   Database roles are the lowercase role names used by RLS and the app's
--   useRole() hook. There are exactly eight valid role names:
--     developer, admin, bme_head, technician, department_head,
--     department_user, store_user, viewer
--
-- This file is idempotent and safe to re-run:
--   * It ensures the eight application roles exist.
--   * It looks up each demo Supabase Auth user BY EMAIL in auth.users
--     (no hardcoded auth UUIDs).
--   * It upserts the seven demo profiles and FORCES the intended
--     full_name and job_title (overwriting prior demo values like
--     "BME Department Head" or "Sr. Tigist Worku / ICU Head Nurse").
--   * It assigns Tigist Worku to "Intensive Care Unit" and Dr. Fitsum Haile
--     to "Radiology and Imaging". If "Radiology and Imaging" does NOT exist,
--     department_id is left NULL (validation will flag this) — Dr. Fitsum is
--     never silently moved to ICU.
--   * It clears any pre-existing user_roles for those seven demo
--     profiles and assigns exactly one intended database role per profile.
--   * If a demo Auth user is missing, the corresponding profile row is
--     left unchanged (no profile is inserted with user_id = NULL,
--     because that would violate the login contract). The final
--     validation SELECT reports such cases as MISSING AUTH USER.

-- ============================================================================
-- 1) Ensure the eight application roles exist (lowercase database role names)
-- ============================================================================
INSERT INTO roles (name, description, permissions)
VALUES
  ('developer', 'Thesis developer with full system access and demo/debug controls',
   '["manage_users", "manage_settings", "manage_equipment", "manage_maintenance", "manage_pm", "manage_calibration", "manage_spare_parts", "manage_training", "manage_disposal", "view_analytics", "manage_analytics", "view_reports", "export_reports", "manage_documents", "developer_tools"]'::jsonb),
  ('admin', 'Legacy system administrator with broad system access',
   '["manage_users", "manage_settings", "manage_equipment", "manage_maintenance", "manage_pm", "manage_calibration", "manage_spare_parts", "manage_training", "manage_disposal", "view_analytics", "manage_analytics", "view_reports", "export_reports", "manage_documents"]'::jsonb),
  ('bme_head', 'Biomedical Engineering Head with operational and decision-support access',
   '["manage_equipment", "manage_maintenance", "manage_pm", "manage_calibration", "manage_spare_parts", "manage_training", "manage_disposal", "view_analytics", "manage_analytics", "view_reports", "export_reports", "manage_documents"]'::jsonb),
  ('technician', 'Biomedical Engineer / Technician for equipment and maintenance workflows',
   '["manage_equipment", "manage_maintenance", "manage_pm", "manage_calibration", "manage_spare_parts", "manage_training", "view_analytics", "view_reports", "manage_documents"]'::jsonb),
  ('department_head', 'Department Head for department-level equipment, requests, work orders, and reports',
   '["view_equipment", "create_maintenance_request", "create_training_request", "create_calibration_request", "create_disposal_request", "view_department_work_orders", "view_reports"]'::jsonb),
  ('department_user', 'Department User / Equipment Focal Person for request intake and department equipment visibility',
   '["view_equipment", "create_maintenance_request", "create_training_request", "create_calibration_request", "create_disposal_request", "view_reports"]'::jsonb),
  ('store_user', 'Store / Logistics Officer for spare parts, logistics, procurement, and reports',
   '["manage_spare_parts", "view_equipment", "view_maintenance", "view_procurement", "view_reports"]'::jsonb),
  ('viewer', 'Hospital Management / Evaluator with read-only dashboards, decision support, and reports',
   '["view_equipment", "view_maintenance", "view_analytics", "view_reports", "export_reports"]'::jsonb)
ON CONFLICT (name) DO UPDATE
SET
  description = EXCLUDED.description,
  permissions = EXCLUDED.permissions;

-- ============================================================================
-- 2) Demo account mapping (department assignment is explicit per account)
--
--   email                              | full_name           | job_title (free text)            | role            | department
--   -----------------------------------+---------------------+----------------------------------+-----------------+-----------------------
--   developer@bmerms-demo.local        | BMERMS Developer    | Thesis Developer                 | developer       | (none)
--   bme.head@bmerms-demo.local         | Ermias Tadesse      | Biomedical Engineering Head      | bme_head        | (none)
--   technician@bmerms-demo.local       | Hanna Gebremedhin   | Clinical Engineer                | technician      | (none)
--   department.head@bmerms-demo.local  | Tigist Worku        | ICU Head                         | department_head | Intensive Care Unit
--   department.user@bmerms-demo.local  | Dr. Fitsum Haile    | Radiologist                      | department_user | Radiology and Imaging
--   store.user@bmerms-demo.local       | Ato Biniam Teshome  | Medical Equipment Store Officer  | store_user      | (none)
--   viewer@bmerms-demo.local           | Dr. Amanuel Kifle   | Medical Director                 | viewer          | (none)
--
-- Reminder: "Clinical Engineer", "Radiologist", "ICU Head",
-- "Biomedical Engineering Head", "Medical Director" are JOB TITLES.
-- They are stored in profiles.job_title. They are NOT roles.
-- ============================================================================

WITH demo_accounts AS (
  SELECT *
  FROM (
    VALUES
      ('developer@bmerms-demo.local',       'BMERMS Developer',    'Thesis Developer',                  'developer',       NULL::text),
      ('bme.head@bmerms-demo.local',        'Ermias Tadesse',      'Biomedical Engineering Head',       'bme_head',        NULL::text),
      ('technician@bmerms-demo.local',      'Hanna Gebremedhin',   'Clinical Engineer',                 'technician',      NULL::text),
      ('department.head@bmerms-demo.local', 'Tigist Worku',        'ICU Head',                          'department_head', 'icu'),
      ('department.user@bmerms-demo.local', 'Dr. Fitsum Haile',    'Radiologist',                       'department_user', 'radiology'),
      ('store.user@bmerms-demo.local',      'Ato Biniam Teshome',  'Medical Equipment Store Officer',   'store_user',      NULL::text),
      ('viewer@bmerms-demo.local',          'Dr. Amanuel Kifle',   'Medical Director',                  'viewer',          NULL::text)
  ) AS t(email, full_name, job_title, expected_role, department_key)
),
-- ICU department: prefer exact name match, then ICU code, then fuzzy match.
icu_department AS (
  SELECT id
  FROM departments
  WHERE is_active = true
    AND (
      name = 'Intensive Care Unit'
      OR code = 'ICU'
      OR name ILIKE '%intensive care%'
      OR name ILIKE '%ICU%'
    )
  ORDER BY
    CASE WHEN name = 'Intensive Care Unit' THEN 0
         WHEN code = 'ICU' THEN 1
         ELSE 2 END,
    name
  LIMIT 1
),
-- Radiology department: REQUIRE exact "Radiology and Imaging" first; only if
-- that does not exist, fall back to fuzzy match. If nothing matches, the
-- subquery returns NULL and department_id is left NULL (NOT ICU).
radiology_department AS (
  SELECT id FROM (
    SELECT id, 0 AS rank
    FROM departments
    WHERE is_active = true AND name = 'Radiology and Imaging'
    UNION ALL
    SELECT id, 1 AS rank
    FROM departments
    WHERE is_active = true
      AND name <> 'Radiology and Imaging'
      AND (
        code = 'RAD'
        OR name ILIKE '%radiology%'
        OR name ILIKE '%imaging%'
      )
    ORDER BY rank, id
    LIMIT 1
  ) AS r
),
-- Resolve auth.users.id by email (NO hardcoded UUIDs).
auth_resolved AS (
  SELECT d.email,
         d.full_name,
         d.job_title,
         d.expected_role,
         au.id AS auth_user_id,
         CASE d.department_key
           WHEN 'icu'       THEN (SELECT id FROM icu_department)
           WHEN 'radiology' THEN (SELECT id FROM radiology_department)
           ELSE NULL
         END AS department_id
  FROM demo_accounts d
  LEFT JOIN auth.users au ON au.email = d.email
),
-- Update existing profiles by email. FORCE the intended full_name,
-- job_title, AND department_id so older demo values are overwritten
-- (e.g. "BME Department Head", "Sr. Tigist Worku", "ICU Head Nurse",
-- or Dr. Fitsum previously stuck on ICU).
updated_profiles AS (
  UPDATE profiles p
  SET
    user_id       = COALESCE(a.auth_user_id, p.user_id),
    full_name     = a.full_name,
    job_title     = a.job_title,
    department_id = a.department_id,
    is_active     = true
  FROM auth_resolved a
  WHERE p.email = a.email
  RETURNING p.id, p.email
),
-- Insert profiles for demo accounts that do not exist yet — but ONLY when
-- an auth user exists, since profiles.user_id has a FK to auth.users.id
-- and cannot be NULL for a working login.
inserted_profiles AS (
  INSERT INTO profiles (user_id, full_name, email, department_id, job_title, is_active)
  SELECT a.auth_user_id, a.full_name, a.email, a.department_id, a.job_title, true
  FROM auth_resolved a
  WHERE a.auth_user_id IS NOT NULL
    AND NOT EXISTS (SELECT 1 FROM profiles p WHERE p.email = a.email)
  RETURNING id, email
),
demo_profiles AS (
  SELECT id, email FROM updated_profiles
  UNION
  SELECT id, email FROM inserted_profiles
),
-- Clear all existing role assignments for the seven demo profiles so we end
-- up with exactly one role per demo profile after the INSERT below.
removed_existing_roles AS (
  DELETE FROM user_roles ur
  USING demo_profiles dp
  WHERE ur.user_id = dp.id
  RETURNING ur.user_id
)
INSERT INTO user_roles (user_id, role_id)
SELECT dp.id, r.id
FROM demo_profiles dp
JOIN demo_accounts d ON d.email = dp.email
JOIN roles r ON r.name = d.expected_role  -- validates against LOWERCASE DB role names
ON CONFLICT (user_id, role_id) DO NOTHING;

-- ============================================================================
-- 3) Validation: confirm name, job title, auth link, department, and role
-- ============================================================================
WITH demo_accounts AS (
  SELECT *
  FROM (
    VALUES
      ('developer@bmerms-demo.local',       'BMERMS Developer',    'Thesis Developer',                  'developer',       NULL::text),
      ('bme.head@bmerms-demo.local',        'Ermias Tadesse',      'Biomedical Engineering Head',       'bme_head',        NULL::text),
      ('technician@bmerms-demo.local',      'Hanna Gebremedhin',   'Clinical Engineer',                 'technician',      NULL::text),
      ('department.head@bmerms-demo.local', 'Tigist Worku',        'ICU Head',                          'department_head', 'Intensive Care Unit'),
      ('department.user@bmerms-demo.local', 'Dr. Fitsum Haile',    'Radiologist',                       'department_user', 'Radiology and Imaging'),
      ('store.user@bmerms-demo.local',      'Ato Biniam Teshome',  'Medical Equipment Store Officer',   'store_user',      NULL::text),
      ('viewer@bmerms-demo.local',          'Dr. Amanuel Kifle',   'Medical Director',                  'viewer',          NULL::text)
  ) AS t(email, expected_full_name, expected_job_title, expected_role, expected_department_name)
)
SELECT
  d.email,
  CASE WHEN au.id IS NULL THEN 'MISSING AUTH USER' ELSE 'OK' END AS auth_user_status,
  au.id AS auth_user_uuid,
  p.id  AS profile_id,
  p.full_name,
  d.expected_full_name,
  (p.full_name = d.expected_full_name) AS has_expected_name,
  p.job_title,
  d.expected_job_title,
  (p.job_title = d.expected_job_title) AS has_expected_job_title,
  p.user_id AS linked_auth_user_uuid,
  (p.user_id = au.id) AS profile_link_matches_auth,
  dep.name AS department_name,
  d.expected_department_name,
  (dep.name IS NOT DISTINCT FROM d.expected_department_name) AS has_expected_department,
  d.expected_role,
  ARRAY_REMOVE(ARRAY_AGG(DISTINCT r.name ORDER BY r.name), NULL) AS assigned_roles,
  COUNT(DISTINCT r.name) AS role_count,
  BOOL_OR(r.name = d.expected_role) AS has_expected_role
FROM demo_accounts d
LEFT JOIN auth.users au ON au.email = d.email
LEFT JOIN profiles   p  ON p.email = d.email
LEFT JOIN departments dep ON dep.id = p.department_id
LEFT JOIN user_roles ur ON ur.user_id = p.id
LEFT JOIN roles      r  ON r.id = ur.role_id
GROUP BY d.email, au.id, p.id, p.full_name, d.expected_full_name,
         p.job_title, d.expected_job_title, p.user_id, dep.name,
         d.expected_department_name, d.expected_role
ORDER BY d.email;
