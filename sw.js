const CACHE = 'pitch-pipe-v1.2';
const FILES = ['./','./index.html','./styles.css','./app.js','./pitch.js','./tone.js','./pitch-worker.js','./manifest.webmanifest','./icon.svg','./icon-192.png','./icon-512.png','./apple-touch-icon.png'];
self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    for (const path of FILES) {
      const request = new Request(new URL(path, self.registration.scope), {cache:'reload',credentials:'same-origin'});
      const response = await fetch(request);
      if (!response.ok || response.redirected) throw new Error('Could not cache app files.');
      await cache.put(request, response);
    }
    await self.skipWaiting();
  })());
});
self.addEventListener('activate', event => event.waitUntil((async () => {
  for (const key of await caches.keys()) if (key.startsWith('pitch-pipe-') && key !== CACHE) await caches.delete(key);
  await self.clients.claim();
})()));
self.addEventListener('message', event => {
  if (event.data === 'offline-status') event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    if ((await cache.keys()).length === FILES.length) event.source?.postMessage('offline-ready');
  })());
});
self.addEventListener('fetch', event => {
  const request = event.request, url = new URL(request.url);
  if (request.method !== 'GET' || url.origin !== self.location.origin || !url.href.startsWith(self.registration.scope)) return;
  if (request.mode === 'navigate') {
    event.respondWith(fetch(request).catch(async () => (await caches.open(CACHE)).match(new URL('./index.html', self.registration.scope))));
    return;
  }
  const allowed = FILES.some(path => new URL(path, self.registration.scope).href === url.href);
  if (allowed) event.respondWith((async () => (await caches.open(CACHE)).match(request) || fetch(request))());
});
