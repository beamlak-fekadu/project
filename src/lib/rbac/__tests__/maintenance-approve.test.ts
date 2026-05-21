import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { hasCapability } from '@/lib/rbac';

// Migration 00067: maintenance approval RLS must match the capability matrix.
// If this test starts failing after a capability-matrix edit, migration 00067
// (or a follow-up) must be updated in lock-step.

test('maintenance.request.approve is granted to developer / admin / bme_head', () => {
  for (const role of ['developer', 'admin', 'bme_head']) {
    assert.equal(
      hasCapability([role], 'maintenance.request.approve'),
      true,
      `${role} must have maintenance.request.approve`,
    );
  }
});

test('maintenance.request.approve is denied to non-approver roles', () => {
  for (const role of [
    'technician',
    'store_user',
    'department_head',
    'department_user',
    'viewer',
  ]) {
    assert.equal(
      hasCapability([role], 'maintenance.request.approve'),
      false,
      `${role} must NOT have maintenance.request.approve`,
    );
  }
});

test('work_order.create is granted to developer / admin / bme_head', () => {
  for (const role of ['developer', 'admin', 'bme_head']) {
    assert.equal(hasCapability([role], 'work_order.create'), true);
  }
  for (const role of ['technician', 'store_user', 'department_head', 'department_user', 'viewer']) {
    assert.equal(hasCapability([role], 'work_order.create'), false);
  }
});

// Migration 00067 text guards — protect against a future edit silently
// removing bme_head from the operational RLS allowlists.

const MIGRATION_PATH = join(
  process.cwd(),
  'supabase/migrations/00067_maintenance_workflow_rls_bme_head.sql',
);

test('00067 grants bme_head UPDATE on maintenance_requests', () => {
  const sql = readFileSync(MIGRATION_PATH, 'utf8');
  const policyBlock = sql.match(
    /CREATE POLICY manage_maintenance_requests[\s\S]*?WITH CHECK[\s\S]*?\);/,
  );
  assert.ok(policyBlock, 'manage_maintenance_requests policy must be present');
  assert.match(policyBlock![0], /auth_user_has_role\('bme_head'\)/);
  assert.match(policyBlock![0], /auth_user_has_role\('developer'\)/);
  assert.match(policyBlock![0], /auth_user_has_role\('admin'\)/);
});

test('00067 grants bme_head FOR ALL on work_orders', () => {
  const sql = readFileSync(MIGRATION_PATH, 'utf8');
  const policyBlock = sql.match(
    /CREATE POLICY manage_work_orders[\s\S]*?WITH CHECK[\s\S]*?\);/,
  );
  assert.ok(policyBlock, 'manage_work_orders policy must be present');
  assert.match(policyBlock![0], /auth_user_has_role\('bme_head'\)/);
  assert.match(policyBlock![0], /FOR ALL/);
});
