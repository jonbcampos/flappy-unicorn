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

const VERSION = 'v5';
const CACHE = `flappy-unicorn-${VERSION}`;

// The shell has stable, known names, so it can be cached up front.
const SHELL = ['./', './index.html', './manifest.webmanifest', './icons/icon-192.png', './icons/icon-512.png'];

// Installing fetches with `cache: 'reload'`, past the browser's own HTTP cache:
// GitHub Pages lets a file sit there for ten minutes, so a new version
// installed soon after a deploy could otherwise save the OLD sounds and
// pictures (which keep their names) into its fresh cache. That happened with
// Trick or Treat's new music.
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      // Individually, so one failed entry doesn't abort the whole install.
      .then((cache) => Promise.allSettled(SHELL.map((url) => cache.add(new Request(url, { cache: 'reload' })))))
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

  // Only the game's own page is kept as the offline copy of index.html.
  // Opening a sound or picture straight from its link is a navigation too, and
  // used to be saved as index.html, so the next offline launch got a music file.
  const isPage = request.mode === 'navigate' && (url.pathname.endsWith('/') || url.pathname.endsWith('/index.html'));
  if (request.mode === 'navigate' && !isPage) return;
  if (isPage) {
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
