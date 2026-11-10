// FieldHub service worker v2 — lets the portal OPEN with no internet.
// It saves the app files (and the CDN libraries the portal needs) on the device.
// Data (requests, circulars, expiry ...) is saved separately by offline.js, never here.
// Network first: online you always get the newest files; offline you get the saved ones.
const CACHE_NAME = 'fieldhub-shell-v2';
const SHELL_FILES = ['./', './index.html', './style.css', './app.js', './assistant.js', './offline.js', './biometric.js', './config.js', './manifest.json', './logo.png', './logo.jpg', './favicon-192.png', './favicon-32.png', './sidebar-bg.webp', './banner-riders.jpg', './banner-blooddraw.jpg'];
const CDN_HOSTS = ['cdn.jsdelivr.net', 'cdnjs.cloudflare.com', 'unpkg.com', 'fonts.googleapis.com', 'fonts.gstatic.com', 'cdn.plot.ly'];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => Promise.all(SHELL_FILES.map((f) => cache.add(f).catch(() => {})))));
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(caches.keys().then((names) => Promise.all(names.filter((n) => n !== CACHE_NAME).map((n) => caches.delete(n)))));
  self.clients.claim();
});

function networkFirst(request, ms) {
  return new Promise((resolve) => {
    let settled = false;
    const fallback = () => caches.match(request, { ignoreSearch: true }).then((c) => c || caches.match('./index.html', { ignoreSearch: true }));
    const timer = ms ? setTimeout(() => { fallback().then((c) => { if (c && !settled) { settled = true; resolve(c); } }); }, ms) : null;
    fetch(request).then((res) => {
      if (timer) clearTimeout(timer);
      if (res && res.ok && !settled) { const copy = res.clone(); caches.open(CACHE_NAME).then((c) => c.put(request, copy)).catch(() => {}); }
      if (!settled) { settled = true; resolve(res); }
    }).catch(() => { if (timer) clearTimeout(timer); fallback().then((c) => { if (!settled) { settled = true; resolve(c || Response.error()); } }); });
  });
}

function cdnCacheFirst(request) {
  return caches.match(request).then((hit) => {
    const net = fetch(request).then((res) => { if (res && (res.ok || res.type === 'opaque')) { const copy = res.clone(); caches.open(CACHE_NAME).then((c) => c.put(request, copy)).catch(() => {}); } return res; });
    return hit || net;
  }).catch(() => fetch(request));
}

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.hostname.endsWith('.supabase.co') || url.hostname.endsWith('.supabase.in')) return;   // database / login: never touched here
  if (url.origin === self.location.origin) {
    event.respondWith(networkFirst(req, req.mode === 'navigate' || /\.(js|css)$/.test(url.pathname) ? 6000 : 0));
  } else if (CDN_HOSTS.includes(url.hostname)) {
    event.respondWith(cdnCacheFirst(req));
  }
});
