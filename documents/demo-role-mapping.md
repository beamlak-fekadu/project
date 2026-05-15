# BMERMS Demo Role Mapping

This document is the canonical reference for the seven BMERMS demo login accounts: which Supabase Auth email maps to which profile name, job title, department, and **database role**.

## Job titles vs database roles

BMERMS keeps two distinct concepts separate:

- **Job title** — free-text label stored in `profiles.job_title`. **This is what the top-right of the app shows under the user's name.** It does not control authorization. Examples: `Clinical Engineer`, `Radiologist`, `ICU Head`, `Biomedical Engineering Head`, `Medical Director`, `Thesis Developer`, `Medical Equipment Store Officer`.
- **Database role** — one of exactly eight lowercase role names stored in `roles.name` and assigned via `user_roles`. **This controls authorization** (RLS policies, `useRole()` hook, settings/admin UI):

  ```
  developer
  admin
  bme_head
  technician
  department_head
  department_user
  store_user
  viewer
  ```

`Radiologist`, `Clinical Engineer`, `ICU Head`, and `Biomedical Engineering Head` are **job titles, not roles**. Do not invent new roles like `clinical_engineer`, `radiologist`, or `icu_head`.

## Final demo login mapping

| Email | Profile `full_name` | Profile `job_title` (UI display) | Database role (authorization) | Department |
|---|---|---|---|---|
| `developer@bmerms-demo.local` | BMERMS Developer | Thesis Developer | `developer` | — |
| `bme.head@bmerms-demo.local` | Ermias Tadesse | Biomedical Engineering Head | `bme_head` | — |
| `technician@bmerms-demo.local` | Hanna Gebremedhin | Clinical Engineer | `technician` | — |
| `department.head@bmerms-demo.local` | Tigist Worku | ICU Head | `department_head` | Intensive Care Unit |
| `department.user@bmerms-demo.local` | Dr. Fitsum Haile | Radiologist | `department_user` | Radiology and Imaging |
| `store.user@bmerms-demo.local` | Ato Biniam Teshome | Medical Equipment Store Officer | `store_user` | — |
| `viewer@bmerms-demo.local` | Dr. Amanuel Kifle | Medical Director | `viewer` | — |

Notes:

- The previous `BME Department Head` placeholder name and the `Sr. Tigist Worku` / `ICU Head Nurse` strings are no longer used; they are overwritten by both the seed and the live SQL script.
- **Dr. Fitsum Haile is `department_user` for the `Radiology and Imaging` department.** Earlier mappings that placed him on `Intensive Care Unit` are corrected. The apply script uses a separate `radiology_department` CTE that resolves `Radiology and Imaging` exactly; if that row does not exist it leaves `department_id = NULL` rather than silently routing to ICU, and the validator emits `MISSING RADIOLOGY AND IMAGING DEPARTMENT`.
- **Tigist Worku is `department_head` for the `Intensive Care Unit` department.**
- `bme.head` and `technician` are intentionally department-less unless a `Biomedical Engineering` department is added to the seed later.

## Top-right user display (Topbar)

The top-right of the app shows, in this order:

1. **Line 1** — `profile.full_name`
2. **Line 2** — `profile.job_title` (the free-text job title), falling back to `formatRoleName(primaryRole)` if `job_title` is empty.

Raw lowercase role names (`bme_head`, `department_head`, `store_user`) must not appear in the Topbar. Expected display for the seven demo accounts:

| Line 1 | Line 2 |
|---|---|
| BMERMS Developer | Thesis Developer |
| Ermias Tadesse | Biomedical Engineering Head |
| Hanna Gebremedhin | Clinical Engineer |
| Tigist Worku | ICU Head |
| Dr. Fitsum Haile | Radiologist |
| Ato Biniam Teshome | Medical Equipment Store Officer |
| Dr. Amanuel Kifle | Medical Director |

The role label helper `formatRoleName` in [src/utils/roles.ts](../src/utils/roles.ts) is still used by settings/admin/developer screens that intentionally show the database role (e.g. role badges in `/settings`):

```
bme_head        -> BME Head
admin           -> Admin
developer       -> Developer
technician      -> Technician
department_head -> Department Head
department_user -> Department User
store_user      -> Store User
viewer          -> Viewer
```

## Applying this mapping to the live Supabase database

1. Make sure the seven Supabase Auth users exist in `auth.users` (Supabase Dashboard → Authentication → Users). The emails must exactly match the table above.
2. Open the Supabase SQL Editor and paste the contents of [apply-demo-role-mapping.sql](apply-demo-role-mapping.sql).
3. Run it. The script is transactional and idempotent — re-running it is safe.
4. Run [validate-demo-role-mapping.sql](validate-demo-role-mapping.sql) and confirm every row reports `status = 'OK'`.

The apply script:

- Ensures all eight application roles exist.
- Looks up `auth.users.id` by **email** (no hardcoded auth UUIDs).
- Resolves ICU and Radiology-and-Imaging through **separate CTEs**. The Radiology lookup never falls back to ICU.
- Updates existing profiles and FORCES the intended `full_name`, `job_title`, and `department_id`.
- Inserts a profile only when the auth user exists (no NULL-`user_id` rows for demo logins).
- Clears any prior `user_roles` for the seven demo profiles and assigns exactly one intended role per profile.

## Validation status values

[validate-demo-role-mapping.sql](validate-demo-role-mapping.sql) is read-only. Per-row `status` can be:

- `OK`
- `MISSING AUTH USER` — `auth.users` row not found for the demo email.
- `MISSING PROFILE` — no `profiles` row by email.
- `PROFILE NOT LINKED TO AUTH` — `profiles.user_id` is NULL or does not match `auth.users.id`.
- `WRONG NAME` — `profiles.full_name` does not match the expected value.
- `WRONG JOB TITLE` — `profiles.job_title` does not match the expected value.
- `MISSING ICU DEPARTMENT` — the demo expects the ICU department to exist but none is present.
- `MISSING RADIOLOGY AND IMAGING DEPARTMENT` — `Radiology and Imaging` row missing; Dr. Fitsum Haile cannot be placed.
- `WRONG DEPARTMENT` — `profiles.department_id` resolves to a department that does not match the expected value (e.g. Dr. Fitsum on `Intensive Care Unit`).
- `WRONG ROLE` — assigned `user_roles` does not include the expected lowercase role.
- `MULTIPLE ROLES` — more than one role assigned (demo profiles must have exactly one).

## If the app still shows the old role or department after the SQL is correct

The Supabase client caches the auth session and profile in the browser. After updating profiles/roles:

- Log out and log back in, **or**
- Clear the site data for the deployment (DevTools → Application → Storage → Clear site data), **or**
- Use an incognito / private window for the new sign-in.

The Topbar reads `profile.full_name`, `profile.job_title`, and `profile.primaryRole` from the `profiles` and `user_roles` tables via `useProfile()`. Once those rows are correct in the database and the auth session is refreshed, the display updates automatically.

## Where this lives in the codebase

- Seed (local + `supabase db push`): [supabase/seed/100_demo_role_users.sql](../supabase/seed/100_demo_role_users.sql)
- Live apply script (Supabase SQL Editor): [documents/apply-demo-role-mapping.sql](apply-demo-role-mapping.sql)
- Live validation script (read-only): [documents/validate-demo-role-mapping.sql](validate-demo-role-mapping.sql)
- Role label formatter (used by settings/admin): [src/utils/roles.ts](../src/utils/roles.ts)
- Topbar display: [src/components/layout/Topbar.tsx](../src/components/layout/Topbar.tsx)
- Settings UI role display: [src/app/(dashboard)/settings/page.tsx](../src/app/(dashboard)/settings/page.tsx)
