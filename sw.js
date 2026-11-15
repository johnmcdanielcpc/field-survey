/* Offline: keep the whole app on the device. Bump VERSION when files change. */
const VERSION = 'field-survey-1.0.0';
const ASSETS = [
  './', './index.html', './manifest.webmanifest', './icon-192.png', './icon-512.png', './apple-touch-icon.png',
  './form.js', './js/db.js', './js/core.js', './js/photos.js', './js/ui.js', './js/pdf.js', './js/excel.js', './js/sync.js', './js/app.js',
  './lib/jspdf.umd.min.js', './lib/exceljs.min.js',
];
self.addEventListener('install', e => {
  e.waitUntil(caches.open(VERSION).then(c => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== VERSION).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== location.origin) return;   // uploads go straight to the network
  e.respondWith(
    caches.match(req, { ignoreSearch: true }).then(hit => {
      if (hit) return hit;
      if (req.mode === 'navigate') return caches.match('./index.html');
      return fetch(req);
    })
  );
});
