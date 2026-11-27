const CACHE_NAME = 'radio-xiviot-v3';

function getScopeBase() {
  return self.registration ? self.registration.scope : self.location.origin + '/';
}

self.addEventListener('install', (event) => {
  const base = getScopeBase();
  const coreAssets = [
    base,
    `${base}index.html`,
    `${base}manifest.webmanifest`,
    `${base}favicon.ico`,
    `${base}favicon-32x32.png`,
    `${base}icon.svg`,
    `${base}logo.png`,
    `${base}pwa-192x192.png`,
    `${base}pwa-512x512.png`,
    `${base}apple-touch-icon.png`,
    `${base}data/stations-es.json`,
  ];

  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then((cache) =>
        Promise.allSettled(
          coreAssets.map((asset) =>
            fetch(asset, {cache: 'no-cache'}).then((res) => {
              if (res && res.ok) {
                return cache.put(asset, res);
              }
              return undefined;
            })
          )
        )
      )
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key)))
      )
      .then(() => self.clients.claim())
  );
});

function shouldBypass(request, url) {
  if (request.method !== 'GET') return true;
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return true;

  // Never intercept CartoDB map tiles (rely on native HTTP 30-day cache)
  if (url.hostname.endsWith('cartocdn.com')) return true;

  // Never intercept live radio data mirrors, workers, or local proxy
  if (url.hostname.endsWith('radio-browser.info')) return true;
  if (url.hostname.endsWith('workers.dev')) return true;
  if (url.pathname.includes('/api/radio')) return true;

  // Never intercept audio streams or playlists
  const dest = request.destination;
  if (dest === 'audio' || dest === 'video') return true;
  if (/\.(mp3|aac|ogg|opus|m3u8?|pls)(\?|$)/i.test(url.pathname)) return true;

  // Only handle same-origin requests
  if (url.origin !== self.location.origin) return true;

  return false;
}

self.addEventListener('fetch', (event) => {
  const {request} = event;
  const url = new URL(request.url);

  if (shouldBypass(request, url)) {
    return;
  }

  // Network-first for HTML navigation
  if (request.mode === 'navigate' || request.destination === 'document') {
    const base = getScopeBase();
    event.respondWith(
      fetch(request)
        .then((networkResponse) => {
          if (networkResponse && networkResponse.ok) {
            const copy = networkResponse.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
          }
          return networkResponse;
        })
        .catch(async () => {
          const cached = await caches.match(request);
          if (cached) return cached;
          const fallback = await caches.match(`${base}index.html`);
          if (fallback) return fallback;
          return caches.match(base);
        })
    );
    return;
  }

  // Stale-While-Revalidate for own static assets
  event.respondWith(
    caches.open(CACHE_NAME).then(async (cache) => {
      const cached = await cache.match(request);
      const networkPromise = fetch(request)
        .then((networkResponse) => {
          if (networkResponse && networkResponse.ok) {
            cache.put(request, networkResponse.clone());
          }
          return networkResponse;
        })
        .catch(() => undefined);

      return cached || (await networkPromise) || Response.error();
    })
  );
});
