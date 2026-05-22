import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { hasCapability } from '@/lib/rbac';

// PART 9 regression: Department Head and Department User MUST be able to
// create calibration requests for assets in their own department. This was
// reported broken during smoke-out; migrations 00071/00072 fixed the RLS
// layer; this test locks the capability + UI gate + migration files.

const repoRoot = process.cwd();
function readSource(rel: string): string {
  return readFileSync(path.resolve(repoRoot, rel), 'utf8');
}

test('PART 9: department_head has calibration.request.create capability', () => {
  assert.equal(hasCapability(['department_head'], 'calibration.request.create'), true);
});

test('PART 9: department_user has calibration.request.create capability', () => {
  assert.equal(hasCapability(['department_user'], 'calibration.request.create'), true);
});

test('PART 9: store_user CANNOT create calibration requests', () => {
  // Calibration is not a store/logistics workflow; store_user must be denied.
  assert.equal(hasCapability(['store_user'], 'calibration.request.create'), false);
});

test('PART 9: viewer CANNOT create calibration requests', () => {
  assert.equal(hasCapability(['viewer'], 'calibration.request.create'), false);
});

test('PART 9: bme_head can create calibration requests for any department', () => {
  assert.equal(hasCapability(['bme_head'], 'calibration.request.create'), true);
});

test('PART 9: technician can record calibration result', () => {
  // Technician executes calibration (records the result); BME Head /
  // admin schedules.
  assert.equal(hasCapability(['technician'], 'calibration.record_result'), true);
});

test('PART 9: UI gate uses can(calibration.request.create), not a role-list check', () => {
  // The page must derive the "New Request" button visibility from the
  // capability — not a hardcoded role list. This keeps the UI in sync with
  // any future capability matrix change.
  const src = readSource('src/app/(dashboard)/calibration/page.tsx');
  assert.match(src, /can\('calibration\.request\.create'\)/);
  assert.match(src, /canRequestCalibration/);
});

test('PART 9: overdue/upcoming action column uses canRequestCalibration for "Create Calibration Request" label', () => {
  // Root-cause regression: the overdue/upcoming table action column was gating
  // the "Create Calibration Request" button on canManageMaintenance instead of
  // canRequestCalibration. Department Head/User have canRequestCalibration=true
  // but canManageMaintenance=false, so they never saw the button.
  // This test ensures the fix is preserved: the "Create Calibration Request"
  // branch must use canRequestCalibration, NOT canManageMaintenance.
  const src = readSource('src/app/(dashboard)/calibration/page.tsx');
  // The label-based branch for request creation uses the request capability.
  assert.match(src, /canRequestCalibration && label === 'Create Calibration Request'/);
  // The execution branches (Record Result / Prepare Calibration) still use
  // canManageMaintenance — department roles should not trigger BME execution.
  assert.match(src, /canManageMaintenance && label !== 'Create Calibration Request'/);
});

test('PART 9: createCalibrationRequestAction validates department scope server-side', () => {
  const src = readSource('src/actions/calibration.actions.ts');
  // Must verify profile.departmentScope.kind for dept roles.
  assert.match(src, /profile\.departmentScope/);
  assert.match(src, /asset\.department_id !== profile\.departmentScope\.departmentId/);
});

test('PART 9: migration 00071 enables department INSERT on calibration_requests', () => {
  const src = readSource('supabase/migrations/00071_calibration_request_department_rls.sql');
  assert.match(src, /insert_calibration_requests/);
  // department_head/department_user paths are EXPLICITLY referenced or via helper.
  assert.match(src, /is_dept_scoped_role\(\)/);
  assert.match(src, /auth_profile_department_id\(\)/);
});

test('PART 9: migration 00072 has SECURITY DEFINER helper for INSERT policy', () => {
  const src = readSource('supabase/migrations/00072_calibration_request_insert_policy_helper.sql');
  assert.match(src, /can_create_calibration_request_for_asset/);
  assert.match(src, /SECURITY DEFINER/);
});

test('PART 9: offline replay validates dept scope for calibration_request.create', () => {
  const src = readSource('src/actions/offline-sync.actions.ts');
  // Offline replay must apply the same dept-scope check as the online action.
  assert.match(src, /'calibration_request\.create'/);
  // departmentScopedActions set must include calibration_request.create.
  assert.match(src, /departmentScopedActions[\s\S]{0,500}'calibration_request\.create'/);
});

test('PART 9: error message helps user recover from RLS denial', () => {
  // The action distinguishes RLS denial from other errors so the UI can
  // direct the user to apply migration 00071/00072.
  const src = readSource('src/actions/calibration.actions.ts');
  assert.match(src, /00071/);
  assert.match(src, /00072/);
});
