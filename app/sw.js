/* Wikifactory Editor service worker: offline app shell for the web build.
 *
 * __WFE_VERSION__ is replaced by scripts/build-web.mjs at build time so every
 * release gets a fresh cache bucket. The precache list must cover every file
 * the app needs on a cold, offline start; `tests/sw.test.mjs` enforces that.
 */
const VERSION = '__WFE_VERSION__';
const CACHE = `wfe-${VERSION}`;

const PRECACHE = [
  './',
  './index.html',
  './manifest.webmanifest',
  './assets/css/app.css',
  './assets/icons/app-icon.svg',
  './assets/icons/app-icon.png',
  './assets/vendor/codemirror.bundle.js',
  './assets/vendor/marked.esm.js',
  './assets/vendor/neutralino.js',
  './assets/vendor/purify.es.mjs',
  './assets/vendor/yaml.bundle.js',
  './assets/js/async-pool.js',
  './assets/js/batch.js',
  './assets/js/code-editor.js',
  './assets/js/config.js',
  './assets/js/content-rules.js',
  './assets/js/deep-link.js',
  './assets/js/diff.js',
  './assets/js/dom.js',
  './assets/js/drafts.js',
  './assets/js/editor-config.js',
  './assets/js/frontmatter-form.js',
  './assets/js/frontmatter.js',
  './assets/js/github.js',
  './assets/js/i18n.js',
  './assets/js/icons.js',
  './assets/js/issues.js',
  './assets/js/main.js',
  './assets/js/markdown.js',
  './assets/js/pr.js',
  './assets/js/repo-cache.js',
  './assets/js/review.js',
  './assets/js/secure-token.js',
  './assets/js/state.js',
  './assets/js/toolbar.js',
  './assets/js/ui.js',
  './assets/js/updates.js',
  './assets/js/validate.js',
  './assets/js/version.js',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      // One missing file must not abort the whole install.
      .then((cache) => Promise.all(PRECACHE.map((file) => cache.add(file).catch(() => {}))))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

async function put(request, response) {
  if (!response || !response.ok) return response;
  const cache = await caches.open(CACHE);
  await cache.put(request, response.clone());
  return response;
}

/** Fresh code wins; the cache is only the offline fallback. */
async function networkFirst(request, fallback = '') {
  try {
    return await put(request, await fetch(request));
  } catch {
    return (await caches.match(request)) || (fallback && (await caches.match(fallback))) || Response.error();
  }
}

/** Large, rarely changing assets: serve from cache, refresh in the background. */
async function staleWhileRevalidate(request) {
  const cached = await caches.match(request);
  const network = fetch(request)
    .then((response) => put(request, response))
    .catch(() => cached);
  return cached || network;
}

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  // GitHub API, oEmbed and release downloads must always hit the network.
  if (url.origin !== self.location.origin) return;

  if (request.mode === 'navigate') {
    event.respondWith(networkFirst(request, './index.html'));
    return;
  }

  // App code changes every release: never serve a stale module.
  if (url.pathname.endsWith('.js') || url.pathname.endsWith('.css')) {
    event.respondWith(networkFirst(request));
    return;
  }

  event.respondWith(staleWhileRevalidate(request));
});
