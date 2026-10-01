// Minimal service worker: caches only the static app shell, never the API.
// - Cross-origin requests (script.google.com) and non-GET requests are never touched.
// - Navigations: network first, cached shell as the offline fallback.
// - Hashed build assets (/assets/*): cache first (their names change with every build).
// The cache name carries the build id passed as ?v=..., so every release gets a fresh cache
// and old ones are deleted on activate.
const SCOPE = self.registration.scope; // e.g. https://user.github.io/spendings-list/
const CACHE_PREFIX = 'spend-';
const CACHE = CACHE_PREFIX + (new URL(self.location.href).searchParams.get('v') || 'dev');
const SHELL = ['', 'manifest.webmanifest', 'icons/icon-192.png', 'icons/icon-512.png', 'icons/apple-touch-icon.png'].map(
  (path) => new URL(path, SCOPE).href,
);

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE);
      await cache.addAll(SHELL);
      // Also precache the hashed JS/CSS that index.html points to, so the first offline start works.
      const html = await (await fetch(SCOPE, { cache: 'reload' })).text();
      const assets = [...html.matchAll(/(?:src|href)="([^"]*\/assets\/[^"]+)"/g)].map((m) => new URL(m[1], SCOPE).href);
      await cache.addAll(assets);
      await self.skipWaiting();
    })(),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      for (const key of await caches.keys()) {
        if (key.startsWith(CACHE_PREFIX) && key !== CACHE) await caches.delete(key);
      }
      await self.clients.claim();
    })(),
  );
});

async function networkFirst(request, cacheKey) {
  const cache = await caches.open(CACHE);
  try {
    const response = await fetch(request);
    if (response.ok) await cache.put(cacheKey, response.clone());
    return response;
  } catch {
    return (await cache.match(cacheKey)) || Response.error();
  }
}

async function cacheFirst(request) {
  const cache = await caches.open(CACHE);
  const hit = await cache.match(request);
  if (hit) return hit;
  const response = await fetch(request);
  if (response.ok) await cache.put(request, response.clone());
  return response;
}

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin || !url.href.startsWith(SCOPE)) return;

  if (request.mode === 'navigate') event.respondWith(networkFirst(request, SCOPE));
  else if (url.pathname.includes('/assets/')) event.respondWith(cacheFirst(request));
  else event.respondWith(networkFirst(request, request));
});
