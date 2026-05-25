var CACHE_NAME = 'minpaku-v1';
var STATIC_ASSETS = [
  './',
  './index.html',
  './css/style.css',
  './js/config.js',
  './js/auth.js',
  './js/api.js',
  './js/store.js',
  './js/ui.js',
  './js/app.js',
  './manifest.json',
  './icons/icon-192.png',
  './icons/icon-512.png'
];

self.addEventListener('install', function(event) {
  event.waitUntil(
    caches.open(CACHE_NAME).then(function(cache) {
      return cache.addAll(STATIC_ASSETS);
    })
  );
  self.skipWaiting();
});

self.addEventListener('activate', function(event) {
  event.waitUntil(
    caches.keys().then(function(keys) {
      return Promise.all(
        keys.filter(function(k) { return k !== CACHE_NAME; })
            .map(function(k) { return caches.delete(k); })
      );
    })
  );
  self.clients.claim();
});

self.addEventListener('fetch', function(event) {
  var url = new URL(event.request.url);

  if (event.request.method === 'POST') return;

  if (url.origin === location.origin) {
    event.respondWith(
      caches.match(event.request).then(function(cached) {
        var fetchPromise = fetch(event.request).then(function(response) {
          if (response.ok) {
            var clone = response.clone();
            caches.open(CACHE_NAME).then(function(cache) { cache.put(event.request, clone); });
          }
          return response;
        }).catch(function() { return cached; });

        return cached || fetchPromise;
      })
    );
  } else {
    event.respondWith(
      fetch(event.request).catch(function() {
        return caches.match(event.request);
      })
    );
  }
});
