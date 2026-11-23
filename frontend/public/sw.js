// Versioned cache name — bump to evict any previously poisoned caches
const CACHE_NAME = 'bodycreamgh-shell-v2';
const SHELL_URLS = ['/manifest.webmanifest', '/favicon.svg'];
const NO_CACHE_PREFIXES = ['/api/', '/assets/', '/checkout', '/login', '/register', '/account', '/orders', '/order', '/payment', '/rider-handoff', '/rider-manifest'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(SHELL_URLS)).catch(() => {})
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  // Never intercept API calls, dynamic/auth routes, or hashed Vite /assets/ bundles
  // (Vercel CDN already caches immutable /assets/* safely and intercepting them can
  // cache SPA fallback HTML after a new deployment).
  if (NO_CACHE_PREFIXES.some((prefix) => url.pathname.startsWith(prefix))) {
    return;
  }

  // Always prefer network for HTML navigations so users get the latest index.html chunk manifest
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request).catch(() => caches.match('/index.html'))
    );
  }
});
