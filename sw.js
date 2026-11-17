// Cache-first service worker: after first visit the app works fully offline.
const VERSION = 'icao-v1.0.0';
const CACHE = VERSION;

const PRECACHE = [
  './',
  './index.html',
  './css/style.css',
  './manifest.webmanifest',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './js/config.js',
  './js/state.js',
  './js/faceGeometry.js',
  './js/metrics.js',
  './js/autocrop.js',
  './js/analyzer.js',
  './js/face.js',
  './js/renderer.js',
  './js/cropper.js',
  './js/scores-ui.js',
  './js/download.js',
  './js/main.js',
  './vendor/tasks-vision/vision_bundle.mjs',
  './vendor/tasks-vision/vision_wasm_internal.js',
  './vendor/tasks-vision/vision_wasm_internal.wasm',
  './vendor/tasks-vision/face_landmarker.task',
];

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    await Promise.allSettled(PRECACHE.map((url) => cache.add(url)));
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const names = await caches.keys();
    await Promise.all(names.filter((n) => n !== CACHE).map((n) => caches.delete(n)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== location.origin) return;

  event.respondWith((async () => {
    const cache = await caches.open(CACHE);
    const hit = await cache.match(req, { ignoreSearch: true });
    if (hit) return hit;
    try {
      const res = await fetch(req);
      if (res.ok) cache.put(req, res.clone());
      return res;
    } catch {
      const fallback = await cache.match('./index.html');
      if (fallback) return fallback;
      throw new Error('offline and not cached');
    }
  })());
});
