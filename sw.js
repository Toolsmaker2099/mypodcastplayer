const CACHE = 'dodo-v4'; // cache = secours hors-ligne uniquement ; le réseau passe toujours en premier, sans cache HTTP
const SHELL = ['./', 'index.html', 'app.js', 'sync.js', 'extra.js', 'share.js', 'style.css', 'manifest.webmanifest', 'icons/icon.svg', 'icons/icon-192.png', 'icons/icon-512.png', 'icons/radio/franceinter.png', 'icons/radio/franceinfo.png', 'icons/radio/franceculture.png', 'icons/radio/francemusique.png', 'icons/radio/fip.png', 'icons/radio/mouv.png'];
self.addEventListener('install', e => { e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL))); self.skipWaiting(); });
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  const u = new URL(e.request.url);
  // Uniquement le shell de l'app, jamais l'audio ni les API (évite de cacher les flux/épisodes).
  if (e.request.method !== 'GET' || u.origin !== location.origin) return;
  e.respondWith(fetch(e.request, { cache: 'no-store' }).then(r => { const cp = r.clone(); caches.open(CACHE).then(c => c.put(e.request, cp)); return r; }).catch(() => caches.match(e.request)));
});
