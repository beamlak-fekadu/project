import test from 'node:test';
import assert from 'node:assert/strict';
import { buildCurrentReturnPath, buildLoginHref, safeReturnPath } from '@/lib/auth/return-to';

test('safeReturnPath accepts local paths and preserves query/hash', () => {
  assert.equal(safeReturnPath('/qr/a/qra_demo?source=scan#top'), '/qr/a/qra_demo?source=scan#top');
  assert.equal(safeReturnPath('/equipment/asset-1?tab=history'), '/equipment/asset-1?tab=history');
});

test('safeReturnPath rejects external and malformed destinations', () => {
  for (const value of [
    null,
    '',
    'https://evil.example/qr/a/demo',
    '//evil.example/qr/a/demo',
    '/\\evil.example',
    'equipment/asset-1',
  ]) {
    assert.equal(safeReturnPath(value), null);
  }
});

test('buildLoginHref encodes safe returnTo only', () => {
  assert.equal(
    buildLoginHref('/equipment/a0000001-0000-0000-0000-000000000001?tab=qr'),
    '/login?returnTo=%2Fequipment%2Fa0000001-0000-0000-0000-000000000001%3Ftab%3Dqr',
  );
  assert.equal(buildLoginHref('https://evil.example'), '/login');
});

test('buildCurrentReturnPath combines path and query safely', () => {
  assert.equal(buildCurrentReturnPath('/maintenance/requests/new', '?assetId=1'), '/maintenance/requests/new?assetId=1');
});
