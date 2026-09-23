// Service Worker for D-Connect PWA - Neon PostgreSQL Edition (NO Firebase)
const CACHE_NAME = 'd-connect-v4-neon';
const STATIC_ASSETS = [
  '/',
  '/manifest.json',
  '/icon.svg',
  '/pwa-192x192.png',
  '/pwa-512x512.png',
  '/pwa-maskable-512x512.png'
];

self.addEventListener('install', (event) => {
  // Force immediate activation of new service worker
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(STATIC_ASSETS).catch(() => {});
    })
  );
});

self.addEventListener('activate', (event) => {
  // Delete all old caches completely so no stale JS runs
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.map((key) => caches.delete(key))
      );
    }).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  // 1. Only process GET requests
  if (event.request.method !== 'GET') {
    return;
  }

  // 2. Ignore non-http/https schemes
  if (!event.request.url.startsWith('http://') && !event.request.url.startsWith('https://')) {
    return;
  }

  let url;
  try {
    url = new URL(event.request.url);
  } catch (_) {
    return;
  }

  // 3. NEVER cache API, SSE, or well-known federation calls
  if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/.well-known/')) {
    return;
  }

  // 4. Network-first for everything to ensure users never get stuck on stale bundles
  event.respondWith(
    fetch(event.request)
      .then((networkResponse) => {
        if (networkResponse && networkResponse.status === 200 && networkResponse.type === 'basic') {
          // Cache image/icon assets only
          if (
            url.pathname.endsWith('.png') ||
            url.pathname.endsWith('.svg') ||
            url.pathname.endsWith('.ico') ||
            url.pathname.endsWith('.json')
          ) {
            const clone = networkResponse.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone)).catch(() => {});
          }
        }
        return networkResponse;
      })
      .catch(() => {
        // Fallback to cache only when truly offline
        return caches.match(event.request).then((cached) => {
          if (cached) return cached;
          if (event.request.mode === 'navigate') {
            return caches.match('/');
          }
          return new Response('Offline', { status: 503, statusText: 'Service Unavailable' });
        });
      })
  );
});
