/**
 * BMEDIS Demo User Setup Script
 *
 * Creates and configures all 7 demo Supabase Auth users, confirms their emails,
 * upserts profiles linked to the correct auth.users.id, and assigns roles.
 * Safe to re-run — fully idempotent.
 *
 * Usage (from project root):
 *   npm run setup:demo-users
 *
 * Required env vars (loaded from .env.local automatically):
 *   NEXT_PUBLIC_SUPABASE_URL
 *   SUPABASE_SERVICE_ROLE_KEY
 *
 * What this script does:
 *   1. Creates or updates each demo auth user via Supabase Admin API
 *      (sets email_confirm = true so .local addresses never need inbox verification)
 *   2. Upserts a profile row linked to the correct auth.users.id
 *   3. Clears old role assignments and assigns exactly one role per demo profile
 *   4. Prints a final verification table showing: email, auth_user_status,
 *      profile_found, role_found, profile_link_matches_auth
 */

import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import * as path from 'path';
import * as fs from 'fs';

// Load .env.local (overrides process.env so CI can pass vars directly too)
const envPath = path.resolve(process.cwd(), '.env.local');
if (fs.existsSync(envPath)) {
  dotenv.config({ path: envPath });
} else {
  dotenv.config(); // fall back to .env
}

// ─── Config ───────────────────────────────────────────────────────────────────

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
  console.error(
    '\n❌  Missing required environment variables.\n' +
    '    Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env.local\n' +
    '    (never commit the service-role key to version control).\n'
  );
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

// ─── Demo account definitions ─────────────────────────────────────────────────

interface DemoAccount {
  email: string;
  password: string;
  fullName: string;
  jobTitle: string;
  roleName: string;
  /** 'icu' | 'radiology' | null */
  departmentKey: string | null;
}

const DEMO_ACCOUNTS: DemoAccount[] = [
  {
    email: 'developer@bmerms-demo.local',
    password: 'BMERMS@2026Dev!',
    fullName: 'BMEDIS Developer',
    jobTitle: 'Thesis Developer',
    roleName: 'developer',
    departmentKey: null,
  },
  {
    email: 'bme.head@bmerms-demo.local',
    password: 'BMERMS@2026Head!',
    fullName: 'Ermias Tadesse',
    jobTitle: 'Biomedical Engineering Head',
    roleName: 'bme_head',
    departmentKey: null,
  },
  {
    email: 'department.head@bmerms-demo.local',
    password: 'BMERMS@2026DeptHead!',
    fullName: 'Tigist Worku',
    jobTitle: 'ICU Head',
    roleName: 'department_head',
    departmentKey: 'icu',
  },
  {
    email: 'department.user@bmerms-demo.local',
    password: 'BMERMS@2026Dept!',
    fullName: 'Dr. Fitsum Haile',
    jobTitle: 'Radiologist',
    roleName: 'department_user',
    departmentKey: 'radiology',
  },
  {
    email: 'technician@bmerms-demo.local',
    password: 'BMERMS@2026Tech!',
    fullName: 'Hanna Gebremedhin',
    jobTitle: 'Clinical Engineer',
    roleName: 'technician',
    departmentKey: null,
  },
  {
    email: 'store.user@bmerms-demo.local',
    password: 'BMERMS@2026Store!',
    fullName: 'Ato Biniam Teshome',
    jobTitle: 'Medical Equipment Store Officer',
    roleName: 'store_user',
    departmentKey: null,
  },
  {
    email: 'viewer@bmerms-demo.local',
    password: 'BMERMS@2026View!',
    fullName: 'Dr. Amanuel Kifle',
    jobTitle: 'Medical Director',
    roleName: 'viewer',
    departmentKey: null,
  },
];

// ─── Helpers ──────────────────────────────────────────────────────────────────

function pad(str: string, len: number) {
  return str.length >= len ? str : str + ' '.repeat(len - str.length);
}

function ok(v: boolean | null | undefined) {
  return v ? '✅' : '❌';
}

// ─── Main ─────────────────────────────────────────────────────────────────────

interface VerificationRow {
  email: string;
  authStatus: string;
  authUserId: string | null;
  profileFound: boolean;
  profileLinked: boolean;
  roleFound: boolean;
  assignedRole: string | null;
}

async function run() {
  console.log('\n🚀  BMEDIS Demo User Setup\n');
  console.log(`    Supabase URL: ${SUPABASE_URL}\n`);

  // ── Step 1: Resolve departments ──────────────────────────────────────────
  console.log('1/4  Resolving departments...');

  type DeptRow = { id: string; name: string; code: string | null };
  const { data: depts, error: deptErr } = await supabase
    .from('departments')
    .select('id, name, code')
    .eq('is_active', true);

  if (deptErr) {
    console.error('     ❌ Could not fetch departments:', deptErr.message);
    process.exit(1);
  }

  const deptsArr: DeptRow[] = (depts ?? []) as DeptRow[];

  function findDept(key: string | null): string | null {
    if (!key) return null;
    if (key === 'icu') {
      const hit = deptsArr.find(
        (d) =>
          d.name === 'Intensive Care Unit' ||
          d.code === 'ICU' ||
          d.name.toLowerCase().includes('intensive care') ||
          d.name.toLowerCase().includes('icu')
      );
      return hit?.id ?? null;
    }
    if (key === 'radiology') {
      // Prefer exact name match
      const exact = deptsArr.find((d) => d.name === 'Radiology and Imaging');
      if (exact) return exact.id;
      const fuzzy = deptsArr.find(
        (d) =>
          d.code === 'RAD' ||
          d.name.toLowerCase().includes('radiology') ||
          d.name.toLowerCase().includes('imaging')
      );
      return fuzzy?.id ?? null;
    }
    return null;
  }

  const icuId = findDept('icu');
  const radId = findDept('radiology');
  console.log(`     ICU dept:       ${icuId ?? '(not found — department_head will have no dept)'}`);
  console.log(`     Radiology dept: ${radId ?? '(not found — department_user will have no dept)'}`);

  // ── Step 2: Resolve roles ────────────────────────────────────────────────
  console.log('\n2/4  Resolving roles...');

  type RoleRow = { id: string; name: string };
  const { data: rolesData, error: rolesErr } = await supabase
    .from('roles')
    .select('id, name');

  if (rolesErr) {
    console.error('     ❌ Could not fetch roles:', rolesErr.message);
    process.exit(1);
  }

  const rolesArr: RoleRow[] = (rolesData ?? []) as RoleRow[];
  const rolesByName: Record<string, string> = {};
  for (const r of rolesArr) rolesByName[r.name] = r.id;

  const missingRoles = DEMO_ACCOUNTS.map((a) => a.roleName).filter(
    (rn) => !rolesByName[rn]
  );
  if (missingRoles.length > 0) {
    console.error(
      `     ❌ Missing roles in DB: ${missingRoles.join(', ')}.\n` +
      '        Run seed/100_demo_role_users.sql in Supabase SQL Editor first.'
    );
    process.exit(1);
  }
  console.log(`     Found ${rolesArr.length} roles: ${rolesArr.map((r) => r.name).join(', ')}`);

  // ── Step 3: Create/update auth users and link profiles ───────────────────
  console.log('\n3/4  Creating/updating auth users and profiles...\n');

  const verificationRows: VerificationRow[] = [];

  for (const account of DEMO_ACCOUNTS) {
    process.stdout.write(`     ${account.email} ... `);

    // 3a. List existing auth users to check if this email already exists
    const { data: listData, error: listErr } = await supabase.auth.admin.listUsers({
      perPage: 1000,
    });
    if (listErr) {
      console.log(`SKIP (list error: ${listErr.message})`);
      verificationRows.push({
        email: account.email,
        authStatus: `LIST_ERROR: ${listErr.message}`,
        authUserId: null,
        profileFound: false,
        profileLinked: false,
        roleFound: false,
        assignedRole: null,
      });
      continue;
    }

    const existingUser = listData.users.find((u) => u.email === account.email);
    let authUserId: string;

    if (existingUser) {
      // Update password and force-confirm email
      const { error: updateErr } = await supabase.auth.admin.updateUserById(
        existingUser.id,
        {
          password: account.password,
          email_confirm: true,
        }
      );
      if (updateErr) {
        console.log(`SKIP (update error: ${updateErr.message})`);
        verificationRows.push({
          email: account.email,
          authStatus: `UPDATE_ERROR: ${updateErr.message}`,
          authUserId: existingUser.id,
          profileFound: false,
          profileLinked: false,
          roleFound: false,
          assignedRole: null,
        });
        continue;
      }
      authUserId = existingUser.id;
      process.stdout.write('updated auth → ');
    } else {
      // Create new auth user
      const { data: createData, error: createErr } = await supabase.auth.admin.createUser({
        email: account.email,
        password: account.password,
        email_confirm: true,
        user_metadata: { full_name: account.fullName },
      });
      if (createErr || !createData.user) {
        console.log(`SKIP (create error: ${createErr?.message ?? 'no user returned'})`);
        verificationRows.push({
          email: account.email,
          authStatus: `CREATE_ERROR: ${createErr?.message ?? 'no user returned'}`,
          authUserId: null,
          profileFound: false,
          profileLinked: false,
          roleFound: false,
          assignedRole: null,
        });
        continue;
      }
      authUserId = createData.user.id;
      process.stdout.write('created auth → ');
    }

    // 3b. Upsert profile row linked to this auth user
    const departmentId =
      account.departmentKey === 'icu'
        ? icuId
        : account.departmentKey === 'radiology'
        ? radId
        : null;

    // Check if a profile with this email already exists
    const { data: existingProfile } = await supabase
      .from('profiles')
      .select('id, user_id')
      .eq('email', account.email)
      .maybeSingle();

    let profileId: string;

    if (existingProfile) {
      // Update existing profile: force link user_id, name, job_title, department
      const { data: updatedProfile, error: upErr } = await supabase
        .from('profiles')
        .update({
          user_id: authUserId,
          full_name: account.fullName,
          job_title: account.jobTitle,
          department_id: departmentId,
          is_active: true,
        })
        .eq('id', existingProfile.id)
        .select('id')
        .single();

      if (upErr || !updatedProfile) {
        console.log(`SKIP (profile update error: ${upErr?.message ?? 'no row'})`);
        verificationRows.push({
          email: account.email,
          authStatus: 'OK',
          authUserId,
          profileFound: true,
          profileLinked: false,
          roleFound: false,
          assignedRole: null,
        });
        continue;
      }
      profileId = updatedProfile.id;
      process.stdout.write('profile linked → ');
    } else {
      // Insert new profile
      const { data: newProfile, error: insErr } = await supabase
        .from('profiles')
        .insert({
          user_id: authUserId,
          full_name: account.fullName,
          email: account.email,
          job_title: account.jobTitle,
          department_id: departmentId,
          is_active: true,
        })
        .select('id')
        .single();

      if (insErr || !newProfile) {
        console.log(`SKIP (profile insert error: ${insErr?.message ?? 'no row'})`);
        verificationRows.push({
          email: account.email,
          authStatus: 'OK',
          authUserId,
          profileFound: false,
          profileLinked: false,
          roleFound: false,
          assignedRole: null,
        });
        continue;
      }
      profileId = newProfile.id;
      process.stdout.write('profile created → ');
    }

    // 3c. Clear old role assignments and assign exactly one role
    await supabase.from('user_roles').delete().eq('user_id', profileId);

    const roleId = rolesByName[account.roleName];
    const { error: roleErr } = await supabase
      .from('user_roles')
      .insert({ user_id: profileId, role_id: roleId });

    if (roleErr) {
      console.log(`SKIP (role assign error: ${roleErr.message})`);
      verificationRows.push({
        email: account.email,
        authStatus: 'OK',
        authUserId,
        profileFound: true,
        profileLinked: true,
        roleFound: false,
        assignedRole: null,
      });
      continue;
    }

    console.log(`role=${account.roleName} ✅`);
    verificationRows.push({
      email: account.email,
      authStatus: 'OK',
      authUserId,
      profileFound: true,
      profileLinked: true,
      roleFound: true,
      assignedRole: account.roleName,
    });
  }

  // ── Step 4: Verification table ───────────────────────────────────────────
  console.log('\n4/4  Verification\n');

  const header = [
    pad('EMAIL', 38),
    pad('AUTH', 6),
    pad('PROFILE', 9),
    pad('LINKED', 8),
    pad('ROLE', 6),
    'ASSIGNED_ROLE',
  ].join('  ');
  const divider = '-'.repeat(header.length);

  console.log('     ' + header);
  console.log('     ' + divider);

  let allOk = true;
  for (const row of verificationRows) {
    const rowOk = row.profileFound && row.profileLinked && row.roleFound;
    if (!rowOk) allOk = false;

    console.log(
      '     ' +
      [
        pad(row.email, 38),
        pad(ok(row.authStatus === 'OK'), 6),
        pad(ok(row.profileFound), 9),
        pad(ok(row.profileLinked), 8),
        pad(ok(row.roleFound), 6),
        row.assignedRole ?? row.authStatus,
      ].join('  ')
    );
  }

  console.log('\n' + (allOk
    ? '✅  All demo accounts set up correctly. Redeploy Vercel if needed.\n'
    : '❌  Some accounts failed. Fix the errors above and re-run this script.\n'
  ));

  if (!allOk) process.exit(1);
}

run().catch((err) => {
  console.error('\n❌  Unexpected error:', err);
  process.exit(1);
});
