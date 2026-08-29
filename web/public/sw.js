/* Velaji service worker.
 *
 * Hand-rolled rather than generated, to keep the project's zero-extra-deps
 * posture and because the one rule that matters here is easier to see in
 * twenty lines than in a plugin's configuration:
 *
 *   THIS WORKER NEVER CACHES /api.
 *
 * That is a safety property, not an optimisation. A cached API response means
 * a health worker could open a child's record and be shown an immunisation
 * status from yesterday: a dose recorded elsewhere would be invisible, and the
 * child could be given it twice or refused one they are owed. The app already
 * has a deliberate offline story (the §9 sync layer, /api/sync/pull and
 * /api/sync/push, which reconciles explicitly and flags conflicts GREY). This
 * worker exists only so the SHELL loads without a network. Data stays the
 * sync layer's job.
 *
 * Bump CACHE when the shell changes; the activate handler drops older ones.
 */

const CACHE = 'velaji-shell-v1';

// The minimum needed to render something useful with no network. Hashed build
// assets are not listed: their names change every build, so they are cached at
// runtime on first use instead.
const SHELL = [
  '/',
  '/manifest.webmanifest',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
  '/icons/maskable-512.png',
  '/favicon.png'
];

// Anything the server must answer freshly, every time.
const NEVER_CACHE = [/^\/api\//, /^\/webhooks\//, /^\/health$/, /^\/ready$/];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      // addAll rejects the whole install if any single entry 404s, which would
      // leave the app with no worker at all. Failing soft is the safer trade.
      .then((cache) => Promise.allSettled(SHELL.map((url) => cache.add(url))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  const sameOrigin = url.origin === self.location.origin;

  // Never intercept the API. Letting these fall through to the network means an
  // offline request fails loudly, which is what the app's own error handling
  // and sync layer are built to deal with.
  if (sameOrigin && NEVER_CACHE.some((re) => re.test(url.pathname))) return;

  // Page loads: try the network so a returning user gets the current build,
  // and fall back to the cached shell so the app still opens with no signal.
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((res) => {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put('/', copy));
          return res;
        })
        .catch(() => caches.match('/').then((hit) => hit || Response.error()))
    );
    return;
  }

  // Build assets carry a content hash, so a cached copy can never be stale:
  // a changed file arrives under a new name.
  if (sameOrigin && url.pathname.startsWith('/assets/')) {
    event.respondWith(
      caches.match(request).then(
        (hit) =>
          hit ||
          fetch(request).then((res) => {
            const copy = res.clone();
            caches.open(CACHE).then((c) => c.put(request, copy));
            return res;
          })
      )
    );
    return;
  }

  // Icons, manifest, and the fonts. Serve from cache when present, refresh in
  // the background so an update lands on the next load.
  const cacheable = sameOrigin || /fonts\.(googleapis|gstatic)\.com$/.test(url.hostname);
  if (!cacheable) return;

  event.respondWith(
    caches.match(request).then((hit) => {
      const network = fetch(request)
        .then((res) => {
          if (res && (res.ok || res.type === 'opaque')) {
            const copy = res.clone();
            caches.open(CACHE).then((c) => c.put(request, copy));
          }
          return res;
        })
        .catch(() => hit);
      return hit || network;
    })
  );
});
