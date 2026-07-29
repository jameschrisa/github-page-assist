// PagePilot service worker: precaches the app shell so the app opens
// instantly and works offline (deploys still need the network, of course).
// Bump VERSION on every release to invalidate old caches.
const VERSION = 'pagepilot-v3'; // v3: root favicon + SEO/meta files

const SHELL = [
  './',
  './index.html',
  './manifest.webmanifest',
  './css/style.css',
  './js/app.js',
  './js/ui.js',
  './js/store.js',
  './js/github.js',
  './js/files.js',
  './js/analyze.js',
  './js/deploy.js',
  './favicon.svg',
  './404.html',
  './icons/favicon.svg',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/maskable-192.png',
  './icons/maskable-512.png',
  './icons/apple-touch-icon.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(VERSION)
      .then((cache) => cache.addAll(SHELL))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  // Never intercept the GitHub API (or anything cross-origin).
  if (url.origin !== self.location.origin || event.request.method !== 'GET') return;

  // Stale-while-revalidate: serve from cache instantly, refresh in the
  // background so the next open picks up new versions.
  event.respondWith(
    caches.open(VERSION).then(async (cache) => {
      const cached = await cache.match(event.request, { ignoreSearch: true });
      const refresh = fetch(event.request)
        .then((res) => {
          if (res.ok) cache.put(event.request, res.clone());
          return res;
        })
        .catch(() => cached);
      return cached || refresh;
    })
  );
});
