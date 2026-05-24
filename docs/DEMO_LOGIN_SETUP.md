# BMEDIS Demo Login Setup Guide

This document explains how to configure the 7 demo accounts so every role logs
in reliably in the deployed Vercel environment.

---

## Production URL

Always use **HTTPS**:

```
https://project-ruby-ten-46.vercel.app
```

Never use `http://` or a bare IP. The app enforces HTTPS redirects and Supabase
auth cookies require a secure context.

---

## Demo Accounts

| Email | Password | Role |
|---|---|---|
| `developer@bmerms-demo.local` | `BMERMS@2026Dev!` | Developer |
| `bme.head@bmerms-demo.local` | `BMERMS@2026Head!` | BME Head |
| `department.head@bmerms-demo.local` | `BMERMS@2026DeptHead!` | Department Head (ICU) |
| `department.user@bmerms-demo.local` | `BMERMS@2026Dept!` | Department User (Radiology) |
| `technician@bmerms-demo.local` | `BMERMS@2026Tech!` | Technician |
| `store.user@bmerms-demo.local` | `BMERMS@2026Store!` | Store User |
| `viewer@bmerms-demo.local` | `BMERMS@2026View!` | Viewer |

The `.local` TLD is intentional — it is the legacy demo domain used when the
Supabase project was created. These addresses cannot receive real emails, which
is why **email confirmation must be bypassed** by the setup script (see below).

---

## Why Login Was Unreliable

Three root causes:

1. **Auth users not created / not email-confirmed.**
   Supabase requires auth users to exist _and_ have `email_confirmed_at` set.
   `.local` addresses cannot receive confirmation emails, so the accounts must
   be confirmed programmatically using the Admin API.

2. **profiles.user_id not linked.**
   The seed SQL creates profile rows but cannot link them to `auth.users.id`
   until the auth users actually exist. If the link is missing, the app finds
   no profile for the logged-in user, shows "Profile Setup Required", and
   blocks access.

3. **Stale session on shared devices.**
   If User A stayed logged in on a shared browser, User B visiting the same URL
   would be redirected away from `/login` by the middleware — inheriting User A's
   session. The login page now calls `signOut()` before every `signInWithPassword`
   to clear any previous session.

---

## Required Environment Variables

Set these in Vercel → Project Settings → Environment Variables:

| Variable | Where to find it |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase Dashboard → Project Settings → API → Project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase Dashboard → Project Settings → API → anon/public key |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase Dashboard → Project Settings → API → service_role key |
| `NEXT_PUBLIC_APP_URL` | `https://project-ruby-ten-46.vercel.app` |

> **Security note:** `SUPABASE_SERVICE_ROLE_KEY` bypasses Row-Level Security.
> It must **never** appear in client-side code, must **never** be committed to
> version control, and must be set as a server-side-only env var in Vercel
> (not prefixed with `NEXT_PUBLIC_`).

Add the same variables to your local `.env.local` for running the setup script.

---

## One-Time Setup: Running the Demo User Script

The `scripts/setup-demo-users.ts` script creates all 7 auth users, confirms
their emails, upserts profiles, and assigns roles. It is **idempotent** — safe
to re-run at any time.

### Prerequisites

- Node.js ≥ 18
- Project dependencies installed (`npm install`)
- `.env.local` in the project root with `NEXT_PUBLIC_SUPABASE_URL` and
  `SUPABASE_SERVICE_ROLE_KEY` pointing at the **production** Supabase project

### Run it

```bash
npm run setup:demo-users
```

The script prints a verification table. Every row must show ✅ in the AUTH,
PROFILE, LINKED, and ROLE columns before deployment.

Example success output:

```
🚀  BMEDIS Demo User Setup

    Supabase URL: https://fgqyszbxzpmqzpqvdivx.supabase.co

1/4  Resolving departments...
     ICU dept:       3a1b2c3d-...
     Radiology dept: 4e5f6g7h-...

2/4  Resolving roles...
     Found 8 roles: admin, bme_head, department_head, department_user, developer, store_user, technician, viewer

3/4  Creating/updating auth users and profiles...

     developer@bmerms-demo.local ... updated auth → profile linked → role=developer ✅
     bme.head@bmerms-demo.local ... updated auth → profile linked → role=bme_head ✅
     ...

4/4  Verification

     EMAIL                                   AUTH    PROFILE    LINKED    ROLE    ASSIGNED_ROLE
     ─────────────────────────────────────────────────────────────────────────────────────────
     developer@bmerms-demo.local             ✅      ✅         ✅        ✅      developer
     bme.head@bmerms-demo.local              ✅      ✅         ✅        ✅      bme_head
     department.head@bmerms-demo.local       ✅      ✅         ✅        ✅      department_head
     department.user@bmerms-demo.local       ✅      ✅         ✅        ✅      department_user
     technician@bmerms-demo.local            ✅      ✅         ✅        ✅      technician
     store.user@bmerms-demo.local            ✅      ✅         ✅        ✅      store_user
     viewer@bmerms-demo.local                ✅      ✅         ✅        ✅      viewer

✅  All demo accounts set up correctly. Redeploy Vercel if needed.
```

---

## After Running the Script

1. **Trigger a Vercel redeploy** (or push a trivial commit) so the deployment
   picks up any env var changes.
2. **Test all 7 accounts in incognito mode** (one at a time):
   - Open a new incognito window.
   - Navigate to `https://project-ruby-ten-46.vercel.app`.
   - Enter the email and password from the table above.
   - Verify you land on the correct role dashboard (correct sidebar entries,
     correct page title).
   - Click **Sign out** (top-right or sidebar) before testing the next account.
3. **Verify session isolation**: After signing out as Developer, sign in as
   Viewer — the Viewer should see only read-only nav items, not the Developer
   Lab or Admin settings.

---

## Supabase Email Confirmation Setting

For demo purposes Supabase's **"Confirm email"** setting does not need to be
disabled globally — the setup script sets `email_confirm: true` on each auth
user via the Admin API, bypassing the confirmation step for those specific
accounts only.

If you want to disable email confirmation entirely for easier testing:

1. Supabase Dashboard → Authentication → Email → **Confirm email** → toggle OFF
2. Re-run the setup script to ensure existing accounts are confirmed regardless.

---

## Troubleshooting

### "Profile Setup Required" screen after login

The auth user exists but the profile is not linked. Re-run:

```bash
npm run setup:demo-users
```

### "Incorrect email or password"

The auth user does not exist or the password is wrong. The setup script creates
or updates all accounts, so re-running it resolves this.

### Middleware redirects to `/` instead of showing login form

Another user's session is active in the browser. The login form now calls
`signOut()` automatically before every login attempt, so submitting the form
again will clear the stale session.

### Role looks wrong (e.g., Developer sees Viewer nav)

1. Check Supabase → Table Editor → `user_roles` → filter by the profile's `id`.
2. Confirm the `role_id` maps to the expected role name in the `roles` table.
3. Re-run the setup script to re-assign roles cleanly.

---

## Security Notes for the Demo

- Passwords for `.local` demo accounts are intentionally simple for
  demonstration purposes. **Do not use these passwords in production.**
- The service-role key must not appear anywhere in client-side code.
  The app's `src/lib/supabase/admin.ts` is marked `server-only` and is never
  bundled into the browser.
- Row-Level Security (RLS) is active on all tables. The demo accounts have
  exactly the permissions their database role grants — the UI role labels are
  just a reflection of what RLS actually enforces.
