const CACHE_NAME = 'little-feet-shell-v18';
const SHELL_ASSETS = [
  '/',
  '/manifest.webmanifest',
  '/logo.png',
  '/logo-transparent.png',
  '/assets/4k/little-feet-aurora-stars-4k.svg',
  '/assets/4k/little-feet-star-glow-mask-4k.svg',
  '/assets/images/little-feet-cinematic-paused-school.avif',
  '/backup.js?v=20260926-layout-v2',
  '/assets/mobile-pwa.js?v=20260925-pwa-v1',
  '/assets/education-stages.js?v=20260925-stages-v2',
  '/assets/curriculum-frameworks.js?v=20260925-curriculum-v1',
  '/assets/preferences-enhancements.js?v=20260925-preferences-v2',
  '/assets/legal-notices.js?v=20260926-legal-v3',
  '/assets/finance-automation.js?v=20260925-finance-v1'
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(SHELL_ASSETS))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(key => key.startsWith('little-feet-shell-') && key !== CACHE_NAME).map(key => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

const isPrivateRequest = url =>
  url.pathname.startsWith('/api/')
  || url.pathname.startsWith('/auth/')
  || url.pathname.includes('littlefeet.db')
  || url.pathname.includes('littlefeet-replica')
  || url.pathname.endsWith('/server.js')
  || url.pathname.endsWith('/auth-crypto.js');

self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET') return;
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin || isPrivateRequest(url)) return;

  if (event.request.mode === 'navigate') {
    event.respondWith(
      fetch(event.request)
        .then(response => {
          const copy = response.clone();
          if (response.ok) caches.open(CACHE_NAME).then(cache => cache.put('/', copy));
          return response;
        })
        .catch(() => caches.match('/'))
    );
    return;
  }

  if (/\.(?:js|css|png|jpe?g|webp|avif|gif|svg|ico|woff2?)$/i.test(url.pathname)) {
    event.respondWith(
      caches.match(event.request).then(cached => cached || fetch(event.request).then(response => {
        if (!response.ok) return response;
        const copy = response.clone();
        caches.open(CACHE_NAME).then(cache => cache.put(event.request, copy));
        return response;
      }))
    );
  }
});
