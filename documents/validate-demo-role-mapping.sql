-- documents/validate-demo-role-mapping.sql
--
-- Read-only validation for the seven BMERMS demo login accounts.
-- Paste into the Supabase SQL Editor. No INSERT / UPDATE / DELETE.
--
-- Use this to confirm the mapping after running
-- documents/apply-demo-role-mapping.sql (or after seed 100 has been applied
-- via `supabase db push`).
--
-- IMPORTANT — job titles vs database roles:
--   * job_title is FREE TEXT (Clinical Engineer, Radiologist, ICU Head, etc.).
--   * Database role names are the eight LOWERCASE values:
--       developer, admin, bme_head, technician, department_head,
--       department_user, store_user, viewer
--   * Comparisons in this script are made against the lowercase role names,
--     never against job titles.
--
-- Expected output (status = 'OK' for every row):
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
--
-- Possible status values:
--   OK
--   MISSING AUTH USER
--   MISSING PROFILE
--   PROFILE NOT LINKED TO AUTH
--   WRONG NAME
--   WRONG JOB TITLE
--   WRONG ROLE
--   MULTIPLE ROLES
--   WRONG DEPARTMENT
--   MISSING ICU DEPARTMENT
--   MISSING RADIOLOGY AND IMAGING DEPARTMENT
--
-- Notable cases this catches:
--   * Dr. Fitsum Haile assigned to "Intensive Care Unit" -> WRONG DEPARTMENT
--   * "Radiology and Imaging" department missing entirely -> MISSING RADIOLOGY AND IMAGING DEPARTMENT
--   * Demo profile carrying more than one user_roles row -> MULTIPLE ROLES

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
