/* Breathing Timer service worker: cache-first, fully offline after first load.
   Bump CACHE_VERSION whenever any precached file changes. */
const CACHE_VERSION = 'v1';
const CACHE_NAME = 'breathing-timer-' + CACHE_VERSION;
const PRECACHE = [
  './',
  './index.html',
  './style.css',
  './app.js',
  './manifest.webmanifest',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-192.png',
  './icons/icon-maskable-512.png',
  './icons/apple-touch-icon.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(PRECACHE.map((u) => new Request(u, { cache: 'reload' }))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys
        .filter((k) => k.startsWith('breathing-timer-') && k !== CACHE_NAME)
        .map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return; // app makes no cross-origin requests anyway

  if (req.mode === 'navigate') {
    // Any navigation inside scope (incl. ?query) gets the cached app shell.
    event.respondWith(
      caches.match(req, { ignoreSearch: true })
        .then((r) => r || caches.match('./index.html'))
        .then((r) => r || fetch(req))
    );
    return;
  }

  event.respondWith(
    caches.match(req, { ignoreSearch: true }).then((cached) => {
      if (cached) return cached;
      return fetch(req).then((res) => {
        if (res && res.ok && res.type === 'basic') {
          const copy = res.clone();
          caches.open(CACHE_NAME).then((c) => c.put(req, copy));
        }
        return res;
      });
    })
  );
});
