-- documents/apply-demo-role-mapping.sql
--
-- Apply the BMERMS demo login mapping to a LIVE Supabase database
-- (Supabase SQL Editor, paste-and-run).
--
-- This script is transactional and idempotent — safe to re-run.
--
-- It will:
--   1. Ensure the eight application roles exist.
--   2. Resolve each demo Supabase Auth user BY EMAIL in auth.users
--      (no hardcoded auth UUIDs).
--   3. Resolve the ICU and Radiology-and-Imaging departments by name/code
--      (separate CTEs; the Radiology lookup never falls back to ICU).
--   4. Update existing profiles by email and FORCE the intended
--      full_name, job_title, and department_id (overwriting prior values
--      such as "BME Department Head", "Sr. Tigist Worku", "ICU Head Nurse",
--      or Dr. Fitsum incorrectly assigned to ICU).
--   5. Insert a profile for any demo account that does not yet have one,
--      but ONLY when the corresponding Auth user exists (so we never
--      violate the profiles.user_id NOT NULL / FK contract).
--   6. Clear all user_roles for the seven demo profiles and assign
--      EXACTLY one intended role per demo profile.
--   7. Print a validation result so you can confirm each row.
--
-- IMPORTANT — job titles vs database roles:
--   * "Clinical Engineer", "Radiologist", "ICU Head",
--     "Biomedical Engineering Head", "Medical Director",
--     "Thesis Developer", "Medical Equipment Store Officer"
--     are FREE-TEXT JOB TITLES stored in profiles.job_title.
--   * The database roles are the eight lowercase names:
--       developer, admin, bme_head, technician, department_head,
--       department_user, store_user, viewer
--   * Do NOT invent roles such as clinical_engineer, radiologist, icu_head.
--
-- Final intended mapping:
--
--   email                              | full_name           | job_title                       | role            | department
--   -----------------------------------+---------------------+---------------------------------+-----------------+-----------------------
--   developer@bmerms-demo.local        | BMERMS Developer    | Thesis Developer                | developer       | (none)
--   bme.head@bmerms-demo.local         | Ermias Tadesse      | Biomedical Engineering Head     | bme_head        | (none)
--   technician@bmerms-demo.local       | Hanna Gebremedhin   | Clinical Engineer               | technician      | (none)
--   department.head@bmerms-demo.local  | Tigist Worku        | ICU Head                        | department_head | Intensive Care Unit
--   department.user@bmerms-demo.local  | Dr. Fitsum Haile    | Radiologist                     | department_user | Radiology and Imaging
--   store.user@bmerms-demo.local       | Ato Biniam Teshome  | Medical Equipment Store Officer | store_user      | (none)
--   viewer@bmerms-demo.local           | Dr. Amanuel Kifle   | Medical Director                | viewer          | (none)

BEGIN;

-- ----------------------------------------------------------------------------
-- 1) Ensure the eight application roles exist
-- ----------------------------------------------------------------------------
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

-- ----------------------------------------------------------------------------
-- 2) Apply demo profile + department + role assignment by EMAIL lookup
-- ----------------------------------------------------------------------------
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
-- Radiology: require exact "Radiology and Imaging" first; only fall back to
-- a fuzzy match if no exact row exists. Never silently routes to ICU.
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
JOIN roles r ON r.name = d.expected_role  -- LOWERCASE DB role name
ON CONFLICT (user_id, role_id) DO NOTHING;

COMMIT;

-- ----------------------------------------------------------------------------
-- 3) Validation (read-only). Inspect each row for correctness.
--    Expected: status = 'OK' for every email.
--
--    Possible status values:
--      OK
--      MISSING AUTH USER
--      MISSING PROFILE
--      PROFILE NOT LINKED TO AUTH
--      WRONG NAME
--      WRONG JOB TITLE
--      WRONG ROLE
--      MULTIPLE ROLES
--      WRONG DEPARTMENT
--      MISSING ICU DEPARTMENT
--      MISSING RADIOLOGY AND IMAGING DEPARTMENT
-- ----------------------------------------------------------------------------
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
),
dept_presence AS (
  SELECT
    EXISTS (
      SELECT 1 FROM departments
      WHERE is_active = true AND (name = 'Intensive Care Unit' OR code = 'ICU'
        OR name ILIKE '%intensive care%' OR name ILIKE '%ICU%')
    ) AS icu_exists,
    EXISTS (
      SELECT 1 FROM departments
      WHERE is_active = true AND name = 'Radiology and Imaging'
    ) AS radiology_exists
),
aggregated AS (
  SELECT
    d.email,
    au.id AS auth_user_uuid,
    p.id  AS profile_id,
    p.full_name,
    d.expected_full_name,
    p.job_title,
    d.expected_job_title,
    p.user_id AS linked_auth_user_uuid,
    dep.name AS department_name,
    d.expected_department_name,
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
)
SELECT
  a.email,
  CASE WHEN a.auth_user_uuid IS NULL THEN 'MISSING AUTH USER' ELSE 'OK' END AS auth_user_status,
  a.auth_user_uuid,
  a.profile_id,
  a.full_name,
  a.expected_full_name,
  (a.full_name = a.expected_full_name) AS has_expected_name,
  a.job_title,
  a.expected_job_title,
  (a.job_title = a.expected_job_title) AS has_expected_job_title,
  a.linked_auth_user_uuid,
  (a.linked_auth_user_uuid IS NOT NULL AND a.linked_auth_user_uuid = a.auth_user_uuid) AS profile_link_matches_auth,
  a.department_name,
  a.expected_department_name,
  (a.department_name IS NOT DISTINCT FROM a.expected_department_name) AS has_expected_department,
  a.expected_role,
  a.assigned_roles,
  a.role_count,
  a.has_expected_role,
  CASE
    WHEN a.auth_user_uuid IS NULL                                          THEN 'MISSING AUTH USER'
    WHEN a.profile_id IS NULL                                              THEN 'MISSING PROFILE'
    WHEN a.linked_auth_user_uuid IS NULL
      OR a.linked_auth_user_uuid <> a.auth_user_uuid                       THEN 'PROFILE NOT LINKED TO AUTH'
    WHEN a.full_name IS DISTINCT FROM a.expected_full_name                 THEN 'WRONG NAME'
    WHEN a.job_title IS DISTINCT FROM a.expected_job_title                 THEN 'WRONG JOB TITLE'
    WHEN a.expected_department_name = 'Intensive Care Unit'
         AND NOT dp.icu_exists                                             THEN 'MISSING ICU DEPARTMENT'
    WHEN a.expected_department_name = 'Radiology and Imaging'
         AND NOT dp.radiology_exists                                       THEN 'MISSING RADIOLOGY AND IMAGING DEPARTMENT'
    WHEN a.department_name IS DISTINCT FROM a.expected_department_name     THEN 'WRONG DEPARTMENT'
    WHEN NOT a.has_expected_role                                           THEN 'WRONG ROLE'
    WHEN a.role_count > 1                                                  THEN 'MULTIPLE ROLES'
    ELSE 'OK'
  END AS status
FROM aggregated a
CROSS JOIN dept_presence dp
ORDER BY a.email;
