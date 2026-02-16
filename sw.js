/* Offline-first service worker (tiny on purpose). */
const CACHE = 'sloth-dither-studio-v1';
const ASSETS = [
  './',
  './index.html',
  './styles.css',
  './app.js',
  './manifest.json',
  './favicon.svg'
];

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const c = await caches.open(CACHE);
    await c.addAll(ASSETS);
    self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.map(k => (k === CACHE ? null : caches.delete(k))));
    self.clients.claim();
  })());
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  event.respondWith((async () => {
    const cached = await caches.match(req, { ignoreSearch: true });
    if (cached) return cached;

    try {
      const res = await fetch(req);
      const c = await caches.open(CACHE);
      c.put(req, res.clone());
      return res;
    } catch (e) {
      // If totally offline, fall back to the app shell.
      const shell = await caches.match('./index.html');
      return shell || new Response('Offline', { status: 503 });
    }
  })());
});
