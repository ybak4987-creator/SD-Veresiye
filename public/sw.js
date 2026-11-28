// SD Veresiye — service worker
// Amaç: uygulama kabuğunu önbelleğe alıp açılışı hızlandırmak.
// Kural: API yanıtları ASLA önbelleğe alınmaz.
const CACHE_NAME = 'sd-veresiye-v10';
const APP_SHELL = [
  '/',
  '/manifest.webmanifest',
  '/silopi-dijital-logo.png',
  '/icon-192.png',
  '/icon-512.png',
  '/apple-touch-icon.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(APP_SHELL))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        keys.filter((key) => key.startsWith('sd-veresiye-') && key !== CACHE_NAME).map((key) => caches.delete(key)),
      ))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  // API ve oturum yolları her zaman ağdan okunur.
  if (url.pathname.startsWith('/api/')) return;

  // Sayfa gezinmesi: önce ağ, düşerse önbellekten kabuk.
  if (request.mode === 'navigate') {
    event.respondWith((async () => {
      try {
        const response = await fetch(request);
        if (response.ok) {
          const cache = await caches.open(CACHE_NAME);
          await cache.put('/', response.clone());
        }
        return response;
      } catch {
        const cached = await caches.match('/');
        return cached || new Response('Çevrimdışısınız. İnternet bağlantınızı kontrol edin.', {
          status: 503,
          headers: { 'Content-Type': 'text/plain; charset=utf-8' },
        });
      }
    })());
    return;
  }

  // Statik varlıklar (hash'li dosya adları): önce önbellek, yoksa ağ.
  if (url.pathname.startsWith('/assets/') || /\.(png|svg|webp|ico|woff2?)$/.test(url.pathname)) {
    event.respondWith((async () => {
      const cache = await caches.open(CACHE_NAME);
      const cached = await cache.match(request);
      if (cached) return cached;
      const response = await fetch(request);
      if (response.ok) await cache.put(request, response.clone());
      return response;
    })());
  }
});


self.addEventListener('push', (event) => {
  let payload = {};
  try { payload = event.data ? event.data.json() : {}; }
  catch { payload = { body: event.data ? event.data.text() : '' }; }

  const title = typeof payload.title === 'string' ? payload.title : 'SD Veresiye';
  const body = typeof payload.body === 'string' ? payload.body : 'Hesabınızda yeni bir hareket var.';
  const tag = typeof payload.tag === 'string' ? payload.tag : 'sd-veresiye-update';
  const target = typeof payload.url === 'string' ? payload.url : '/';

  event.waitUntil(self.registration.showNotification(title, {
    body, tag, icon: '/icon-192.png', badge: '/icon-192.png',
    renotify: false, data: { url: target },
  }));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const requested = event.notification && event.notification.data && event.notification.data.url;
  let target = self.location.origin + '/';
  try {
    const parsed = new URL(typeof requested === 'string' ? requested : '/', self.location.origin);
    target = parsed.origin === self.location.origin ? parsed.href : self.location.origin + '/';
  } catch { target = self.location.origin + '/'; }

  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const client of windows) {
      if ('focus' in client && client.url.startsWith(self.location.origin)) { await client.focus(); return; }
    }
    if (self.clients.openWindow) await self.clients.openWindow(target);
  })());
});
