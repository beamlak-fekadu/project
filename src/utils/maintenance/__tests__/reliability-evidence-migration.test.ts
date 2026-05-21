import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const migrationSql = readFileSync(
  new URL('../../../../supabase/migrations/00069_fix_work_order_reliability_event_upsert.sql', import.meta.url),
  'utf8',
);

test('migration 00069 gives maintenance_events upsert a real work_order_id arbiter', () => {
  assert.match(
    migrationSql,
    /CREATE UNIQUE INDEX maintenance_events_one_per_work_order_idx\s+ON maintenance_events\(work_order_id\);/i,
  );
  assert.match(migrationSql, /ON CONFLICT \(work_order_id\) DO NOTHING/i);
});

test('migration 00069 preserves duplicate maintenance event rows before enforcing uniqueness', () => {
  assert.match(migrationSql, /WITH ranked_events AS/i);
  assert.match(migrationSql, /SET\s+work_order_id = NULL/i);
  assert.match(migrationSql, /row preserved as asset-level maintenance history/i);
});

test('migration 00069 repairs the downtime trigger ON CONFLICT arbiter', () => {
  assert.match(migrationSql, /DROP INDEX IF EXISTS idx_downtime_logs_event_id_unique/i);
  assert.match(
    migrationSql,
    /CREATE UNIQUE INDEX idx_downtime_logs_event_id_unique\s+ON downtime_logs\(event_id\);/i,
  );
  assert.match(migrationSql, /SET\s+event_id = NULL/i);
});
