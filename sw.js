const CACHE_NAME = 'personal-os-v1';
const ASSETS_TO_CACHE = [
  '/',
  '/index.html',
  '/style.css',
  '/styleadditions.css',
  '/script.js',
  '/timetracker.js',
  '/workouttracker.js',
  '/manifest.json'
];

// Install event: Cache assets
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => {
      return cache.addAll(ASSETS_TO_CACHE);
    })
  );
});

// Fetch event: Serve from cache, fallback to network
self.addEventListener('fetch', event => {
  // Don't cache API calls to Netlify functions
  if (event.request.url.includes('/.netlify/functions/')) {
    return; 
  }
  
  event.respondWith(
    caches.match(event.request).then(response => {
      return response || fetch(event.request);
    })
  );
});