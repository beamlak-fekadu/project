import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';

// OFF-01 regression: ensure the service worker actually caches successful
// navigations so previously visited routes load offline. Before this fix,
// `navigationFallback` did `fetch(request)` then `caches.match(request)` in
// the catch branch — but successful navigations were never put into a cache,
// so the catch branch always fell through to the generic offline shell.

const swPath = path.resolve(process.cwd(), 'public/sw.js');
const swSource = readFileSync(swPath, 'utf8');

test('OFF-01: navigation handler caches successful responses', () => {
  // Must have a network-first navigation handler.
  assert.match(swSource, /networkFirstNavigation/);
  // Must put a successful navigation response into a pages cache.
  assert.match(swSource, /PAGES_CACHE/);
  assert.match(swSource, /cache\.put\(request,\s*response\.clone\(\)\)/);
});

test('OFF-01: navigation handler matches cache on offline failure', () => {
  // Catch branch must look up the cached request.
  assert.match(swSource, /caches\.match\(request\)/);
  // Plus a tolerant lookup that ignores search params.
  assert.match(swSource, /ignoreSearch:\s*true/);
});

test('OFF-01: never caches auth / API navigation responses', () => {
  // Auth and API pages must be on the never-cache list.
  // Normalise whitespace to avoid needing the `s` regex flag.
  const flat = swSource.replace(/\s+/g, ' ');
  assert.match(flat, /NEVER_CACHE_NAV_PATHS\s*=\s*\[[^\]]*'\/login'[^\]]*'\/auth'[^\]]*'\/api'[^\]]*\]/);
});

test('OFF-01: cache version bumped so old broken caches are evicted', () => {
  // Version constant exists and v2+ (the old cache was v1 with no nav caching).
  const match = swSource.match(/CACHE_VERSION\s*=\s*'v(\d+)'/);
  assert.ok(match, 'CACHE_VERSION constant must exist');
  const version = Number(match![1]);
  assert.ok(version >= 2, `CACHE_VERSION must be >= 2 (was v${version})`);
});

test('OFF-QR: unknown QR navigations save a pending scan instead of revealing asset data', () => {
  assert.match(swSource, /unknownQrOfflineHtml/);
  assert.match(swSource, /This QR code has not been verified on this device/);
  assert.match(swSource, /cannot confirm whether this token is valid, revoked, expired, or linked to an asset/);
  assert.match(swSource, /bmedis\.offline\.pending_qr_scans\.v1/);
  assert.match(swSource, /url\.pathname\.startsWith\('\/qr\/a\/'\)/);
});

test('OFF-QR: cached verified QR navigations render rich offline context before unknown fallback', () => {
  assert.match(swSource, /QR_ASSET_CACHE_PREFIX\s*=\s*'qr\.asset\.'/);
  assert.match(swSource, /getCachedQrOfflineRecord/);
  assert.match(swSource, /cachedQrOfflineHtml/);
  assert.match(swSource, /Offline mode — showing cached QR asset data/);
  assert.match(swSource, /Cached Assigned Work/);
  assert.match(swSource, /Cached PM Context/);
  assert.match(swSource, /Cached Calibration Context/);
  assert.match(swSource, /Role-Specific QR Actions/);
  assert.match(swSource, /cachedQrRecord/);
  assert.match(swSource, /unknownQrOfflineHtml\(token\)/);
});

test('OFF-01: skips opaque / redirected / error responses', () => {
  assert.match(swSource, /isCacheableResponse/);
  // Must check response.ok and response.type.
  assert.match(swSource, /response\.ok/);
  assert.match(swSource, /response\.type/);
  // Must reject redirected responses (which would otherwise leak login redirects).
  assert.match(swSource, /response\.redirected/);
});

test('OFF-01: does not intercept Server Action / RSC traffic', () => {
  assert.match(swSource, /_rsc/);
});

test('OFF-01: does not intercept or cache Next.js runtime chunks', () => {
  assert.match(swSource, /url\.pathname\.startsWith\('\/_next\/'\)/);
  assert.match(swSource, /module factory is not available/);
});

test('OFF-01: GETs only — never caches POST / mutation traffic', () => {
  assert.match(swSource, /request\.method\s*!==\s*'GET'/);
});

test('OFF-01: falls back to /offline shell when no cache available', () => {
  assert.match(swSource, /caches\.match\('\/offline'\)/);
});

test('OFF-01: activate event purges stale cache versions', () => {
  assert.match(swSource, /CURRENT_CACHES\.includes\(key\)/);
  assert.match(swSource, /caches\.delete\(key\)/);
});
