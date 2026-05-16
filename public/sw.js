const APP_SHELL_CACHE = 'bmerms-app-shell-v1';
const STATIC_CACHE = 'bmerms-static-v1';
const CURRENT_CACHES = [APP_SHELL_CACHE, STATIC_CACHE];

const APP_SHELL_URLS = [
  '/offline',
  '/manifest.webmanifest',
  '/icons/bmerms-icon.svg',
  '/offline-health.txt',
];

function offlineHtml() {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>BMERMS is offline</title>
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
        <h1>BMERMS is offline</h1>
        <p>Cached pages and queued actions may still be available.</p>
        <p>Reconnect to sync changes.</p>
        <a href="/offline">Open offline shell</a>
      </section>
    </main>
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
      .then((keys) => Promise.all(keys.filter((key) => !CURRENT_CACHES.includes(key)).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

function isSameOrigin(url) {
  return url.origin === self.location.origin;
}

function shouldCacheStatic(request, url) {
  if (!isSameOrigin(url)) return false;
  if (url.pathname.startsWith('/_next/static/')) return true;
  if (url.pathname.startsWith('/icons/')) return true;
  if (url.pathname === '/manifest.webmanifest') return true;
  return ['style', 'script', 'font', 'image'].includes(request.destination);
}

async function cacheFirst(request) {
  const cached = await caches.match(request);
  if (cached) return cached;
  const response = await fetch(request);
  if (response && response.ok && response.type === 'basic') {
    const cache = await caches.open(STATIC_CACHE);
    cache.put(request, response.clone());
  }
  return response;
}

async function navigationFallback(request) {
  try {
    return await fetch(request);
  } catch {
    const cachedRequest = await caches.match(request);
    if (cachedRequest) return cachedRequest;
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

  if (url.pathname === '/offline-health.txt') {
    event.respondWith(fetch(request));
    return;
  }

  if (request.mode === 'navigate' || request.destination === 'document') {
    event.respondWith(navigationFallback(request));
    return;
  }

  if (shouldCacheStatic(request, url)) {
    event.respondWith(cacheFirst(request));
  }
});
