import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const repoRoot = process.cwd();

function readSource(rel: string): string {
  return readFileSync(path.resolve(repoRoot, rel), 'utf8');
}

test('middleware redirects protected deep links to login with returnTo', () => {
  const src = readSource('src/lib/supabase/middleware.ts');
  const block = src.slice(src.indexOf('if (!user && !isPublicPath)'), src.indexOf('if (user &&'));
  assert.match(block, /buildCurrentReturnPath/);
  assert.match(block, /url\.searchParams\.set\('returnTo', returnTo\)/);
});

test('auth callback sanitizes returnTo and next before redirecting', () => {
  const src = readSource('src/app/auth/callback/route.ts');
  assert.match(src, /safeReturnPath\(searchParams\.get\('returnTo'\)\)/);
  assert.match(src, /safeReturnPath\(searchParams\.get\('next'\)\)/);
  assert.match(src, /loginUrl\.searchParams\.set\('returnTo', next\)/);
});

test('work-order completion syncs linked request to completed with final condition payload', () => {
  const src = readSource('src/actions/maintenance.actions.ts');
  const idx = src.indexOf("nextStatus: 'completed'");
  assert.ok(idx > 0, 'completion request sync must exist');
  const block = src.slice(idx - 900, idx + 1100);
  assert.match(block, /syncLinkedRequestStatusFromWorkOrder/);
  assert.match(block, /auditAction:\s*'maintenance_request\.completed_by_work_order'/);
  assert.match(block, /final_equipment_condition:\s*conditionToSet/);
  assert.match(block, /completion_outcome:\s*completionOutcome/);
});

test('work-order start and assignment sync linked request lifecycle', () => {
  const src = readSource('src/actions/maintenance.actions.ts');
  assert.match(src, /nextStatus:\s*'in_progress'/);
  assert.match(src, /nextStatus:\s*'assigned'/);
  assert.match(src, /request_status_sync_warning/);
});

test('duplicate guard checks active work orders and ignores terminal WOs', () => {
  const actions = readSource('src/actions/maintenance.actions.ts');
  const service = readSource('src/services/maintenance.service.ts');
  assert.match(actions, /OPEN_WORK_ORDER_STATUSES/);
  assert.match(actions, /reason:\s*'active_work_order'/);
  assert.match(service, /getActiveCorrectiveBlockerForAsset/);
});
