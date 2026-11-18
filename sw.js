const CACHE_NAME = 'agroconecta-agricultor-v1.0.0';
const ASSETS_TO_CACHE = [
  './',
  'index.html',
  'manifest.json',
  'version.json',
  'icon-192.png',
  'icon-512.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(ASSETS_TO_CACHE).catch(() => {});
    }).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.map((key) => {
          if (key !== CACHE_NAME) {
            return caches.delete(key);
          }
        })
      );
    }).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;
  const url = event.request.url;
  if (url.includes('api.github.com') || url.includes('raw.githubusercontent.com')) {
    event.respondWith(fetch(event.request).catch(() => new Response(JSON.stringify({ offline: true }))));
    return;
  }
  event.respondWith(
    caches.match(event.request).then((cached) => {
      if (cached) {
        fetch(event.request).then((netRes) => {
          if (netRes && netRes.status === 200) {
            caches.open(CACHE_NAME).then((cache) => cache.put(event.request, netRes));
          }
        }).catch(() => {});
        return cached;
      }
      return fetch(event.request).catch(() => caches.match('index.html'));
    })
  );
});

self.addEventListener('message', (event) => {
  if (event.data && event.data.action === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});
