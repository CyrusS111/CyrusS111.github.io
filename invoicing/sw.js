// Offline cache so the app (and the PDF fonts) work without internet once installed.
// PDF fonts are not cached here: they live in the device's own storage (see Vault.getFonts).
const CACHE = 'elsys-invoicing-v7';
const FILES = [
  './', 'index.html', 'manifest.webmanifest', 'lib/jspdf.umd.min.js',
  'js/github.js', 'js/vault.js', 'js/data.js', 'js/invoicepdf.js', 'js/app.js',
  'assets/header.png', 'assets/logo.png', 'assets/logo-mark.svg', 'assets/icon-192.png', 'assets/icon-512.png',
];
self.addEventListener('install', e => e.waitUntil(caches.open(CACHE).then(c => c.addAll(FILES)).then(() => self.skipWaiting())));
self.addEventListener('activate', e => e.waitUntil(
  caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim())));
// Network first (so updates arrive), cache as fallback when offline.
self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET' || new URL(e.request.url).origin !== location.origin) return;
  e.respondWith(fetch(e.request).then(r => {
    const copy = r.clone(); caches.open(CACHE).then(c => c.put(e.request, copy)); return r;
  }).catch(() => caches.match(e.request, { ignoreSearch: true })));
});
