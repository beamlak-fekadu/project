import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// PostgREST ambiguity guard.
//
// `user_roles` has TWO foreign keys back to `profiles`:
//   - user_roles_user_id_fkey      (user_id -> profiles.id)
//   - user_roles_assigned_by_fkey  (assigned_by -> profiles.id)
//
// When a select() embeds `user_roles(...)` from `profiles` without specifying
// which FK to use, PostgREST raises PGRST201:
//
//   "Could not embed because more than one relationship was found for
//    'profiles' and 'user_roles'"
//
// The browser client returns `{ data: null, error: <PGRST201> }`. Most
// call sites in BMEDIS guard with `if (res.data) setX(...)`, which means
// the page silently renders zero rows with no toast and no other signal.
// This regression hit Settings → User Management (0 profiles for an
// authenticated BME Head), the work-order assignment dropdown, the
// notification recipient resolver, the workload service, and the
// developer-lab integrity panel — all in one shot.
//
// The fix is the FK hint: `user_roles!user_roles_user_id_fkey(...)`. This
// test pins every known consumer so a regression flips the suite red.

const ROOT = process.cwd();

function fileText(path: string): string {
  return readFileSync(join(ROOT, path), 'utf8');
}

const HINT = 'user_roles!user_roles_user_id_fkey';
const BARE_PATTERNS = [
  /\buser_roles\(/, // user_roles(...)
  /\buser_roles!inner\b/, // user_roles!inner(...) — !inner is a join modifier, not an FK hint
];

function assertNoBareUserRolesEmbed(path: string) {
  const src = fileText(path);
  for (const pattern of BARE_PATTERNS) {
    const match = src.match(pattern);
    if (!match) continue;
    const idx = match.index ?? 0;
    const around = src.slice(Math.max(0, idx - 80), Math.min(src.length, idx + 80));
    // Allow if the hint immediately follows (the match is part of the hint string)
    if (around.includes(HINT)) continue;
    assert.fail(
      `${path}: bare \`${match[0]}\` embed found near:\n---\n${around}\n---\nUse '${HINT}(...)' or '${HINT}!inner(...)' instead.`,
    );
  }
}

const GUARDED_FILES = [
  'src/services/users.service.ts',
  'src/actions/maintenance.actions.ts',
  'src/services/metrics/workload.service.ts',
  'src/services/notifications/recipient-resolver.ts',
  'src/services/developer-lab.service.ts',
  'src/app/(dashboard)/developer-lab/page.tsx',
];

for (const path of GUARDED_FILES) {
  test(`${path}: no bare user_roles embed without FK hint`, () => {
    assertNoBareUserRolesEmbed(path);
  });
}

test('users.service.ts PROFILE_SELECT carries the FK hint', () => {
  const src = fileText('src/services/users.service.ts');
  assert.match(src, /PROFILE_SELECT[\s\S]{0,400}user_roles!user_roles_user_id_fkey\(/);
});

test('users.service.ts getActiveTechnicians carries the FK hint with !inner', () => {
  const src = fileText('src/services/users.service.ts');
  assert.match(src, /getActiveTechnicians[\s\S]{0,400}user_roles!user_roles_user_id_fkey!inner\(/);
});

test('maintenance.actions.ts technician validation carries the FK hint', () => {
  const src = fileText('src/actions/maintenance.actions.ts');
  assert.match(src, /user_roles!user_roles_user_id_fkey!inner\(roles!inner\(name\)\)/);
});

// audit_logs → profiles has TWO FKs (performed_by, user_id). Embeds must
// pin to performed_by so the audit-log table shows the actor's name.
test('audit page audit_logs embed carries the FK hint', () => {
  const src = fileText('src/app/(dashboard)/audit/page.tsx');
  assert.match(src, /profiles!audit_logs_performed_by_fkey/);
});

test('reports.service.ts audit-security embed carries the FK hint', () => {
  const src = fileText('src/services/reports.service.ts');
  assert.match(src, /profiles!audit_logs_performed_by_fkey/);
});

// disposal_requests → profiles has TWO FKs (requested_by, approved_by).
test('disposal.service.ts REQUEST_SELECT carries the FK hint', () => {
  const src = fileText('src/services/disposal.service.ts');
  assert.match(src, /profiles!disposal_requests_requested_by_fkey/);
});

// pm_schedules → profiles has TWO FKs (assigned_to, completed_by).
test('qr-context.service.ts pm_schedules embed carries the FK hint', () => {
  const src = fileText('src/services/qr-context.service.ts');
  assert.match(src, /profiles!pm_schedules_assigned_to_fkey/);
});
