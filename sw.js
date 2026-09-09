// FieldHub service worker — minimal version, just enough to satisfy
// PWA installability requirements and allow the app shell to open
// even on a flaky connection. It does NOT cache your data (requests,
// circulars, etc.) — that always comes fresh from Supabase, live.
const CACHE_NAME = 'fieldhub-shell-v1';
const SHELL_FILES = ['./', './index.html', './style.css', './app.js', './config.js'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(SHELL_FILES)).catch(()=>{})
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((names) =>
      Promise.all(names.filter((n) => n !== CACHE_NAME).map((n) => caches.delete(n)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  // Network-first: always try to get the latest file; only fall back
  // to the cached shell if the device is genuinely offline.
  event.respondWith(
    fetch(event.request).catch(() => caches.match(event.request))
  );
});
