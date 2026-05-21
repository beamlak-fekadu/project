import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { hasCapability } from '@/lib/rbac';

const MIGRATION_PATH = join(
  process.cwd(),
  'supabase/migrations/00071_calibration_request_department_rls.sql',
);

test('calibration.request.create is granted to request-capable roles', () => {
  for (const role of ['developer', 'admin', 'bme_head', 'technician', 'department_head', 'department_user']) {
    assert.equal(
      hasCapability([role], 'calibration.request.create'),
      true,
      `${role} must have calibration.request.create`,
    );
  }
});

test('calibration.request.create is denied to store_user and viewer', () => {
  for (const role of ['store_user', 'viewer']) {
    assert.equal(
      hasCapability([role], 'calibration.request.create'),
      false,
      `${role} must NOT have calibration.request.create`,
    );
  }
});

test('00071 grants department-scoped INSERT on calibration_requests', () => {
  const sql = readFileSync(MIGRATION_PATH, 'utf8');
  const policyBlock = sql.match(
    /CREATE POLICY insert_calibration_requests[\s\S]*?WITH CHECK[\s\S]*?\);/,
  );
  assert.ok(policyBlock, 'insert_calibration_requests policy must be present');
  assert.match(policyBlock![0], /auth_user_has_role\('bme_head'\)/);
  assert.match(policyBlock![0], /auth_user_has_role\('technician'\)/);
  assert.match(policyBlock![0], /is_dept_scoped_role\(\)/);
  assert.match(policyBlock![0], /ea\.department_id = auth_profile_department_id\(\)/);
  assert.doesNotMatch(policyBlock![0], /auth_user_has_role\('store_user'\)/);
  assert.doesNotMatch(policyBlock![0], /auth_user_has_role\('viewer'\)/);
});

test('createCalibrationRequestAction enforces app-layer department scope', () => {
  const src = readFileSync(join(process.cwd(), 'src/actions/calibration.actions.ts'), 'utf8');
  const action = src.match(/export async function createCalibrationRequestAction[\s\S]*?export async function createCalibrationRecordAction/)?.[0] ?? '';
  assert.ok(action, 'createCalibrationRequestAction block should be present');
  assert.match(action, /profile\.departmentScope\.kind === 'denied'/);
  assert.match(action, /asset\.department_id !== profile\.departmentScope\.departmentId/);
  assert.match(action, /status: 'pending'/);
});
