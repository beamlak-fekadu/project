/**
 * BMEDIS Service Worker
 *
 * Phase 1 fix (OFF-01):
 *   - Successful GET navigations are now cached so the same route can load
 *     while offline.
 *   - Network-first for navigations with stale-cache fallback, then
 *     last-resort `/offline` shell.
 *   - Auth/Supabase/API responses are explicitly not cached.
 *   - Bumped cache version to invalidate old (broken) caches.
 *   - Skips opaque/redirected responses.
 */

const CACHE_VERSION = 'v5';
const APP_SHELL_CACHE = `bmedis-app-shell-${CACHE_VERSION}`;
const STATIC_CACHE = `bmedis-static-${CACHE_VERSION}`;
const PAGES_CACHE = `bmedis-pages-${CACHE_VERSION}`;
const CURRENT_CACHES = [APP_SHELL_CACHE, STATIC_CACHE, PAGES_CACHE];
const OFFLINE_DB_NAME = 'bmedis-offline';
const OFFLINE_READ_CACHE_STORE = 'offline_read_cache';
const QR_ASSET_CACHE_PREFIX = 'qr.asset.';

const APP_SHELL_URLS = [
  '/offline',
  '/manifest.webmanifest',
  '/icons/bmedis-icon.svg',
  '/offline-health.txt',
];

// Routes that must never be cached even if their navigation succeeds.
// Auth pages return user-specific tokens/cookies — caching them across
// users is a security risk.
const NEVER_CACHE_NAV_PATHS = [
  '/login',
  '/auth',
  '/api',
];

const PENDING_QR_SCANS_KEY = 'bmedis.offline.pending_qr_scans.v1';

function escapeHtml(value) {
  return String(value ?? '').replace(/[<>&"']/g, (char) => ({
    '<': '&lt;',
    '>': '&gt;',
    '&': '&amp;',
    '"': '&quot;',
    "'": '&#39;',
  }[char]));
}

function formatLabel(value) {
  if (!value) return 'Not available';
  return String(value).replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

function formatDateTime(value) {
  if (!value) return 'Not available';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Not available';
  return date.toLocaleString();
}

function roleLabel(value) {
  if (value === 'bme_head') return 'BME Head / Admin';
  if (value === 'department_head') return 'Department Head';
  if (value === 'department_user') return 'Department User';
  if (value === 'store_user') return 'Store User';
  if (value === 'unknown') return 'Authenticated User';
  return formatLabel(value);
}

function listRows(rows, renderRow, emptyText) {
  if (!Array.isArray(rows) || rows.length === 0) {
    return `<p class="muted small">${escapeHtml(emptyText)}</p>`;
  }
  return `<div class="rows">${rows.slice(0, 6).map(renderRow).join('')}</div>`;
}

function savePendingQrScanScript(token, reason) {
  const safeTokenForScript = JSON.stringify(String(token || ''));
  return `<script>
      (function () {
        try {
          var token = ${safeTokenForScript};
          var key = ${JSON.stringify(PENDING_QR_SCANS_KEY)};
          var scans = JSON.parse(localStorage.getItem(key) || '[]');
          if (!Array.isArray(scans)) scans = [];
          scans.push({
            token: token,
            scanned_at: new Date().toISOString(),
            source_route: '/qr/a/' + token,
            reason: ${JSON.stringify(reason)},
            user_agent: navigator.userAgent || null
          });
          localStorage.setItem(key, JSON.stringify(scans.slice(-100)));
        } catch (error) {}
      })();
    </script>`;
}

function cachedRevokedQrOfflineHtml(token, record) {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>BMEDIS revoked QR cached offline</title>
    <style>
      body { margin: 0; font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; background: #111827; color: #f8fafc; }
      main { min-height: 100vh; display: grid; place-items: center; padding: 24px; }
      section { max-width: 640px; border: 1px solid rgba(251,191,36,.35); border-radius: 10px; background: rgba(251,191,36,.08); padding: 24px; }
      h1 { margin: 0 0 12px; font-size: 24px; color: #fde68a; }
      p { margin: 0 0 10px; color: #e5e7eb; line-height: 1.6; }
      code { word-break: break-all; font-size: 12px; color: #fde68a; }
    </style>
  </head>
  <body>
    <main>
      <section>
        <h1>Cached revoked QR state</h1>
        <p>This device has cached that this QR label was revoked. BMEDIS is offline, so asset details are hidden and this scan is recorded locally for security review.</p>
        <p>Last cached: ${escapeHtml(formatDateTime(record?.cached_at))}</p>
        <p><code>${escapeHtml(token)}</code></p>
      </section>
    </main>
    ${savePendingQrScanScript(token, 'revoked_cached')}
  </body>
</html>`;
}

function cachedQrOfflineHtml(token, record) {
  const data = record?.data ?? {};
  const asset = data.asset ?? {};
  const profile = data.profile ?? {};
  const context = data.context ?? {};
  const actions = Array.isArray(data.actions) ? data.actions : [];

  if (asset.qr_label_status === 'revoked') {
    return cachedRevokedQrOfflineHtml(token, record);
  }

  const assignedWork = context.workOrders?.assignedToMe ?? [];
  const openWork = context.workOrders?.open ?? [];
  const activePm = context.pm?.active ?? [];
  const overduePm = context.pm?.overdue ?? [];
  const calibrationRequests = context.calibration?.openRequests ?? [];
  const maintenanceRequests = context.requests?.open ?? [];
  const stockIssues = context.parts?.stockIssues ?? [];
  const role = context.roleCategory ?? record?.role_name ?? 'unknown';
  const displayName = profile.full_name || profile.email || 'Verified user';

  const actionCards = actions
    .filter((action) => action && action.href && typeof action.href === 'string')
    .slice(0, 8)
    .map((action) => `
      <a class="action" href="${escapeHtml(action.href)}">
        <strong>${escapeHtml(action.label)}</strong>
        ${action.description ? `<span>${escapeHtml(action.description)}</span>` : ''}
      </a>
    `)
    .join('');

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${escapeHtml(asset.asset_code || 'BMEDIS QR')} offline</title>
    <style>
      :root { color-scheme: light; }
      body { margin: 0; font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; background: #eef2f8; color: #0b1220; }
      main { min-height: 100vh; padding: 18px; }
      .wrap { max-width: 980px; margin: 0 auto; }
      .top { display: flex; flex-wrap: wrap; justify-content: space-between; gap: 10px; border-bottom: 1px solid rgba(15,23,42,.12); padding-bottom: 14px; }
      .badge { display: inline-flex; align-items: center; border: 1px solid rgba(15,23,42,.14); border-radius: 999px; padding: 6px 9px; background: white; font-size: 12px; font-weight: 700; }
      .panel { border: 1px solid rgba(15,23,42,.12); border-radius: 10px; background: white; padding: 16px; box-shadow: 0 8px 24px rgba(15,23,42,.06); }
      .notice { margin-top: 14px; border-color: rgba(245,158,11,.35); background: #fffbeb; color: #78350f; box-shadow: none; }
      h1 { margin: 4px 0 4px; font-size: clamp(26px, 6vw, 44px); line-height: 1.05; }
      h2 { margin: 0 0 10px; font-size: 14px; text-transform: uppercase; letter-spacing: .08em; color: #475569; }
      p { margin: 0; line-height: 1.55; }
      .muted { color: #64748b; }
      .small { font-size: 13px; }
      .grid { display: grid; gap: 12px; margin-top: 14px; }
      @media (min-width: 760px) { .grid.two { grid-template-columns: repeat(2, minmax(0, 1fr)); } .grid.four { grid-template-columns: repeat(4, minmax(0, 1fr)); } }
      .metric strong { display: block; font-size: 22px; margin-top: 3px; }
      .rows { display: grid; gap: 8px; }
      .row { border: 1px solid rgba(15,23,42,.1); border-radius: 8px; padding: 10px; background: #f8fafc; }
      .row strong { display: block; }
      .actions { display: grid; gap: 10px; margin-top: 12px; }
      @media (min-width: 640px) { .actions { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
      .action { display: block; min-height: 72px; border: 1px solid rgba(14,165,233,.35); border-radius: 10px; background: #f0f9ff; padding: 12px; color: #0f172a; text-decoration: none; }
      .action span { display: block; margin-top: 4px; color: #475569; font-size: 12px; line-height: 1.4; }
      .footer { margin-top: 18px; border-top: 1px solid rgba(15,23,42,.12); padding-top: 12px; font-size: 12px; color: #64748b; }
    </style>
  </head>
  <body>
    <main>
      <div class="wrap">
        <header class="top">
          <div>
            <p class="muted small">BMEDIS QR Scan</p>
            <h1>${escapeHtml(asset.asset_code || 'Cached QR asset')}</h1>
            <p>${escapeHtml(asset.name || 'Asset name unavailable')}</p>
          </div>
          <div>
            <span class="badge">Offline mode</span>
            <span class="badge">${escapeHtml(displayName)}</span>
            <span class="badge">${escapeHtml(roleLabel(role))}</span>
          </div>
        </header>

        <section class="panel notice">
          <strong>Offline mode — showing cached QR asset data.</strong>
          <p class="small">Asset ${escapeHtml(asset.asset_code)} was previously verified on this device. Last synced: ${escapeHtml(formatDateTime(record?.cached_at))}. The QR scan has been recorded locally and will sync when connection returns.</p>
        </section>

        <section class="grid four">
          <div class="panel metric"><span class="muted small">Department</span><strong>${escapeHtml(asset.department_name || 'Unknown')}</strong></div>
          <div class="panel metric"><span class="muted small">Condition</span><strong>${escapeHtml(formatLabel(asset.condition))}</strong></div>
          <div class="panel metric"><span class="muted small">Open Work</span><strong>${escapeHtml(openWork.length)}</strong></div>
          <div class="panel metric"><span class="muted small">Calibration</span><strong>${escapeHtml(formatLabel(context.calibration?.state))}</strong></div>
        </section>

        <section class="grid two">
          <div class="panel">
            <h2>Cached Assigned Work</h2>
            ${listRows(assignedWork, (row) => `
              <a class="row" href="/maintenance/work-orders/${escapeHtml(row.id)}">
                <strong>${escapeHtml(row.work_order_number || 'Assigned work order')}</strong>
                <span class="small muted">${escapeHtml(formatLabel(row.status))} · updated ${escapeHtml(formatDateTime(row.updated_at))}</span>
              </a>
            `, 'No assigned work was cached for this QR asset.')}
          </div>
          <div class="panel">
            <h2>Cached Requests & Work</h2>
            ${listRows(maintenanceRequests, (row) => `
              <a class="row" href="/maintenance/requests/${escapeHtml(row.id)}">
                <strong>${escapeHtml(row.request_number || 'Maintenance request')}</strong>
                <span class="small muted">${escapeHtml(formatLabel(row.urgency))} · ${escapeHtml(formatLabel(row.status))}</span>
              </a>
            `, 'No open maintenance requests were cached for this QR asset.')}
          </div>
          <div class="panel">
            <h2>Cached PM Context</h2>
            ${listRows([...overduePm, ...activePm], (row) => `
              <a class="row" href="/pm/schedules/${escapeHtml(row.id)}">
                <strong>PM due ${escapeHtml(formatDateTime(row.scheduled_date))}</strong>
                <span class="small muted">${escapeHtml(formatLabel(row.status))}${row.assigned_to_name ? ` · ${escapeHtml(row.assigned_to_name)}` : ''}</span>
              </a>
            `, 'No active PM task was cached for this QR asset.')}
          </div>
          <div class="panel">
            <h2>Cached Calibration Context</h2>
            ${listRows(calibrationRequests, (row) => `
              <a class="row" href="/calibration/requests/${escapeHtml(row.id)}">
                <strong>${escapeHtml(row.request_number || 'Calibration request')}</strong>
                <span class="small muted">${escapeHtml(formatLabel(row.urgency))} · ${escapeHtml(formatLabel(row.status))}</span>
              </a>
            `, 'No open calibration request was cached for this QR asset.')}
          </div>
        </section>

        <section class="panel" style="margin-top:12px">
          <h2>Role-Specific QR Actions</h2>
          ${actionCards ? `<div class="actions">${actionCards}</div>` : '<p class="muted small">No cached role actions are available for this profile and asset.</p>'}
        </section>

        ${stockIssues.length > 0 ? `
          <section class="panel" style="margin-top:12px">
            <h2>Cached Parts / Blockers</h2>
            ${listRows(stockIssues, (row) => `
              <div class="row">
                <strong>${escapeHtml(row.part_code || 'Linked part')} ${escapeHtml(row.part_name || '')}</strong>
                <span class="small muted">Qty ${escapeHtml(row.quantity ?? 'n/a')} · ${escapeHtml(formatDateTime(row.issue_date))}</span>
              </div>
            `, 'No parts blockers cached.')}
          </section>
        ` : ''}

        <p class="footer">Offline actions are local promises, not official server facts. Open cached work-order, PM, calibration, or request pages to queue supported field actions; they replay only after server validation.</p>
      </div>
    </main>
    ${savePendingQrScanScript(token, 'cached_offline')}
  </body>
</html>`;
}

async function getCachedQrOfflineRecord(token) {
  const cacheKey = `${QR_ASSET_CACHE_PREFIX}${token}`;
  if (!('indexedDB' in self)) return null;
  return new Promise((resolve) => {
    let settled = false;
    const finish = (value) => {
      if (settled) return;
      settled = true;
      resolve(value);
    };
    const request = indexedDB.open(OFFLINE_DB_NAME);
    request.onerror = () => finish(null);
    request.onsuccess = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(OFFLINE_READ_CACHE_STORE)) {
        db.close();
        finish(null);
        return;
      }
      const transaction = db.transaction(OFFLINE_READ_CACHE_STORE, 'readonly');
      const store = transaction.objectStore(OFFLINE_READ_CACHE_STORE);
      const readRequest = store.indexNames.contains('cache_key')
        ? store.index('cache_key').getAll(cacheKey)
        : store.getAll();

      readRequest.onsuccess = () => {
        const records = (Array.isArray(readRequest.result) ? readRequest.result : [])
          .filter((record) => record?.cache_key === cacheKey)
          .filter((record) => record?.data?.kind === 'qr_asset_context')
          .filter((record) => record?.data?.token === token || record?.data?.asset?.qr_token === token)
          .sort((a, b) => String(b.cached_at ?? '').localeCompare(String(a.cached_at ?? '')));
        finish(records[0] ?? null);
      };
      readRequest.onerror = () => finish(null);
      transaction.oncomplete = () => db.close();
      transaction.onerror = () => {
        db.close();
        finish(null);
      };
    };
    request.onupgradeneeded = () => {
      // The app has not created the offline DB yet. Do not create QR cache
      // stores from the service worker; just fall back to the safe unknown
      // token path.
      request.transaction?.abort();
      finish(null);
    };
  });
}

function offlineHtml() {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>BMEDIS is offline</title>
    <style>
      body { margin: 0; font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; background: #eef2f8; color: #0b1220; }
      main { min-height: 100vh; display: grid; place-items: center; padding: 24px; text-align: center; }
      section { max-width: 520px; }
      h1 { margin: 0 0 12px; font-size: 30px; }
      p { margin: 0 0 10px; color: #475569; line-height: 1.6; }
      a, button { display: inline-flex; margin-top: 14px; border: 1px solid rgba(15,23,42,.18); border-radius: 8px; padding: 10px 14px; background: white; color: #0b1220; text-decoration: none; font-weight: 600; }
    </style>
  </head>
  <body>
    <main>
      <section>
        <h1>BMEDIS is offline</h1>
        <p>Cached pages and queued actions may still be available.</p>
        <p>Reconnect to sync changes.</p>
        <a href="/offline">Open offline shell</a>
      </section>
    </main>
  </body>
</html>`;
}

function unknownQrOfflineHtml(token) {
  const safeToken = escapeHtml(token);
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>BMEDIS QR scan saved offline</title>
    <style>
      body { margin: 0; font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; background: #eef2f8; color: #0b1220; }
      main { min-height: 100vh; display: grid; place-items: center; padding: 24px; }
      section { max-width: 620px; border: 1px solid rgba(15,23,42,.14); border-radius: 10px; background: white; padding: 24px; box-shadow: 0 10px 30px rgba(15,23,42,.08); }
      h1 { margin: 0 0 12px; font-size: 24px; }
      p { margin: 0 0 10px; color: #475569; line-height: 1.6; }
      code { word-break: break-all; font-size: 12px; color: #334155; }
      a { display: inline-flex; margin-top: 14px; border: 1px solid rgba(15,23,42,.18); border-radius: 8px; padding: 10px 14px; background: #0f172a; color: white; text-decoration: none; font-weight: 600; }
    </style>
  </head>
  <body>
    <main>
      <section>
        <h1>This QR code has not been verified on this device.</h1>
        <p>You are offline, so BMEDIS cannot confirm whether this token is valid, revoked, expired, or linked to an asset.</p>
        <p>The scan attempt has been saved and will be verified when connection returns.</p>
        <p><code>${safeToken}</code></p>
        <a href="/offline">Open offline workspace</a>
      </section>
    </main>
    ${savePendingQrScanScript(token, 'unknown_offline')}
  </body>
</html>`;
}

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(APP_SHELL_CACHE)
      .then((cache) => cache.addAll(APP_SHELL_URLS))
      .catch(() => undefined),
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((key) => !CURRENT_CACHES.includes(key)).map((key) => caches.delete(key))),
      )
      .then(() => self.clients.claim()),
  );
});

function isSameOrigin(url) {
  return url.origin === self.location.origin;
}

function shouldCacheNavigation(url) {
  if (!isSameOrigin(url)) return false;
  for (const prefix of NEVER_CACHE_NAV_PATHS) {
    if (url.pathname === prefix || url.pathname.startsWith(`${prefix}/`)) {
      return false;
    }
  }
  return true;
}

function shouldCacheStatic(request, url) {
  if (!isSameOrigin(url)) return false;
  // Next.js chunks are already content-addressed and must revalidate through
  // the browser/runtime. Serving stale chunks from the offline cache can leave
  // the client with a mismatched module graph after deploys or dev rebuilds.
  if (url.pathname.startsWith('/_next/')) return false;
  if (url.pathname.startsWith('/_next/data/')) return false; // user-specific
  if (url.pathname.startsWith('/icons/')) return true;
  if (url.pathname === '/manifest.webmanifest') return true;
  if (url.pathname.startsWith('/lottie/')) return true;
  return ['style', 'script', 'font', 'image'].includes(request.destination);
}

function isCacheableResponse(response) {
  // Skip opaque (CORS), redirected, error responses, partial responses.
  if (!response) return false;
  if (!response.ok) return false;
  if (response.status !== 200) return false;
  if (response.type !== 'basic' && response.type !== 'default') return false;
  if (response.redirected) return false;
  return true;
}

async function cacheFirst(request) {
  const cached = await caches.match(request);
  if (cached) return cached;
  try {
    const response = await fetch(request);
    if (isCacheableResponse(response)) {
      const cache = await caches.open(STATIC_CACHE);
      cache.put(request, response.clone()).catch(() => undefined);
    }
    return response;
  } catch (error) {
    // Static asset offline — propagate failure (browser shows broken asset).
    throw error;
  }
}

async function networkFirstNavigation(request) {
  const url = new URL(request.url);

  try {
    const response = await fetch(request);

    if (isCacheableResponse(response) && shouldCacheNavigation(url)) {
      const cache = await caches.open(PAGES_CACHE);
      // Clone before consuming — the response stream can only be read once.
      cache.put(request, response.clone()).catch(() => undefined);
    }

    return response;
  } catch {
    // Network failed; serve from cache if we have it.
    const cachedExact = await caches.match(request);
    if (cachedExact) return cachedExact;

    // Try ignoring search (different query params for same route still serve).
    const cachedIgnoreSearch = await caches.match(request, { ignoreSearch: true });
    if (cachedIgnoreSearch) return cachedIgnoreSearch;

    if (url.pathname.startsWith('/qr/a/')) {
      let token = url.pathname.slice('/qr/a/'.length);
      try {
        token = decodeURIComponent(token);
      } catch {}
      const cachedQrRecord = await getCachedQrOfflineRecord(token);
      if (cachedQrRecord) {
        return new Response(cachedQrOfflineHtml(token, cachedQrRecord), {
          headers: { 'content-type': 'text/html; charset=utf-8' },
          status: 200,
        });
      }
      return new Response(unknownQrOfflineHtml(token), {
        headers: { 'content-type': 'text/html; charset=utf-8' },
        status: 200,
      });
    }

    // Final fallback — cached /offline shell.
    const cachedOffline = await caches.match('/offline');
    if (cachedOffline) return cachedOffline;

    return new Response(offlineHtml(), {
      headers: { 'content-type': 'text/html; charset=utf-8' },
      status: 200,
    });
  }
}

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);

  // Skip cross-origin (Supabase, Sentry, etc.) — let the network handle it.
  if (!isSameOrigin(url)) return;

  // Health probe — always hit network.
  if (url.pathname === '/offline-health.txt') {
    event.respondWith(fetch(request));
    return;
  }

  // Never intercept API routes — they need authoritative data.
  if (url.pathname.startsWith('/api/')) return;
  // Never intercept Next.js runtime/chunk/data assets. Stale cached chunks can
  // cause "module factory is not available" after a new build is loaded.
  if (url.pathname.startsWith('/_next/')) return;
  // Never intercept Server Actions / RSC payloads either.
  if (url.searchParams.has('_rsc')) return;

  // Navigation requests (HTML documents).
  if (request.mode === 'navigate' || request.destination === 'document') {
    event.respondWith(networkFirstNavigation(request));
    return;
  }

  // Static assets — cache-first.
  if (shouldCacheStatic(request, url)) {
    event.respondWith(cacheFirst(request));
  }
});

self.addEventListener('message', (event) => {
  if (!event.data) return;
  if (event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
  if (event.data.type === 'CLEAR_PAGE_CACHE') {
    caches.delete(PAGES_CACHE).catch(() => undefined);
  }
});
