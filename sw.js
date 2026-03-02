/* ========================
   LUMINAE — Service Worker
======================== */

const CACHE_NAME = 'luminae-v1';

const ASSETS = [
  '/luminae/',
  '/luminae/index.html',
  '/luminae/style.css',
  '/luminae/app.js',
  '/luminae/manifest.json',
  '/luminae/epub.min.js',
  '/luminae/jszip.min.js',
  'https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@400;500;600;700&family=Archivo+Black&display=swap',
  'https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css'
];

// Install — cache all assets
self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE_NAME).then(cache => {
      return cache.addAll(ASSETS);
    })
  );
  self.skipWaiting();
});

// Activate — clear old caches
self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys
          .filter(key => key !== CACHE_NAME)
          .map(key => caches.delete(key))
      )
    )
  );
  self.clients.claim();
});

// Fetch — serve from cache, fallback to network
self.addEventListener('fetch', (e) => {
  e.respondWith(
    caches.match(e.request).then(cached => {
      return cached || fetch(e.request).catch(() => {
        if (e.request.mode === 'navigate') {
          return caches.match('/luminae/index.html');
        }
      });
    })
  );
});
