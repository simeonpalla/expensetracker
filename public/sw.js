// Bump CACHE_NAME on every release that changes any cached asset —
// activate deletes all other caches, which is how updates reach users.
const CACHE_NAME = 'personal-os-v2';
const ASSETS_TO_CACHE = [
  '/',
  '/index.html',
  '/style.css',
  '/styleadditions.css',
  '/script.js?v=6',
  '/timetracker.js?v=2',
  '/workouttracker.js?v=2',
  '/manifest.json'
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(ASSETS_TO_CACHE))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(
        keys.filter(key => key !== CACHE_NAME).map(key => caches.delete(key))
      ))
      .then(() => clients.claim())
  );
});

// Cache-first for same-origin static assets; the network handles everything
// else (API calls, the Chart.js CDN). Never cache non-GET or function calls.
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'GET') return;
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith('/.netlify/')) return;

  event.respondWith(
    caches.match(event.request).then(response => {
      return response || fetch(event.request);
    })
  );
});
