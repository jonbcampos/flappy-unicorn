/**
 * Service worker: makes the installed game launch instantly and work offline.
 *
 * Two strategies, because navigations and assets want opposite things:
 *
 *  - Navigations are network-first with a cached fallback. index.html is the
 *    one file whose name never changes, so trusting the cache for it would
 *    pin you to an old build forever.
 *  - Everything else is stale-while-revalidate: serve from cache immediately
 *    (so a launch costs no network), and refresh the entry in the background.
 *    Safe because Vite content-hashes asset filenames — a changed file is a
 *    different URL, so a stale entry can never be the *wrong* content.
 *
 * Offline works from the second launch onward: the first visit populates the
 * cache. Since installing to the home screen requires visiting first, by the
 * time the icon exists the game is already fully cached.
 */

const VERSION = 'v1';
const CACHE = `flappy-unicorn-${VERSION}`;

// The shell has stable, known names, so it can be cached up front.
const SHELL = ['./', './index.html', './manifest.webmanifest', './icons/icon-192.png', './icons/icon-512.png'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      // Individually, so one failed entry doesn't abort the whole install.
      .then((cache) => Promise.allSettled(SHELL.map((url) => cache.add(url))))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((response) => {
          const copy = response.clone();
          void caches.open(CACHE).then((cache) => cache.put('./index.html', copy));
          return response;
        })
        .catch(() => caches.match('./index.html').then((hit) => hit ?? caches.match('./'))),
    );
    return;
  }

  event.respondWith(
    caches.match(request).then((cached) => {
      const network = fetch(request)
        .then((response) => {
          if (response.ok) {
            const copy = response.clone();
            void caches.open(CACHE).then((cache) => cache.put(request, copy));
          }
          return response;
        })
        // Offline with nothing cached: let the failure surface as a failure.
        .catch(() => cached);
      return cached ?? network;
    }),
  );
});
