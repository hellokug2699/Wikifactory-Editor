/* Wikifactory Editor service worker: offline app shell for the web build.
 *
 * The VERSION placeholder below is replaced by scripts/build-web.mjs at build
 * time, so every release gets a fresh cache bucket.
 *
 * Two guarantees drive this file:
 *   1. Install is atomic. Every critical file is cached before the new worker
 *      activates; a single failure aborts the install and keeps the old worker
 *      (and its cache) in charge. Icons are optional and never block.
 *   2. One page load sees one version. App code and CSS are served cache-first
 *      from this worker's bucket, and the worker never calls clients.claim(),
 *      so a page keeps the version it started with until it reloads.
 *
 * `tests/sw.test.mjs` enforces the file list, and `tests/sw-install.test.mjs`
 * runs the handlers against a fake Cache API.
 */
const VERSION = '__WFE_VERSION__';
const CACHE = `wfe-${VERSION}`;
const META_CACHE = 'wfe-meta';
const ACTIVE_KEY = new Request('./__wfe_active__');

/** Everything the app needs to boot offline. Any failure aborts the install. */
const CRITICAL = [
  './',
  './index.html',
  './manifest.webmanifest',
  './assets/css/app.css',
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

/** Cosmetic assets: cached when possible, never block the install. */
const OPTIONAL = ['./assets/icons/app-icon.svg', './assets/icons/app-icon.png'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE);
      try {
        // Cache.addAll is a single batch: it rejects if any request fails, and
        // we delete the half-built bucket so a broken install cannot be used.
        await cache.addAll(CRITICAL);
      } catch (error) {
        await caches.delete(CACHE);
        console.warn('[sw] 预缓存失败，保留旧版本', error);
        throw error;
      }
      await Promise.all(OPTIONAL.map((file) => cache.add(file).catch(() => {})));
      await self.skipWaiting();
    })(),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      const meta = await caches.open(META_CACHE);
      const active = await meta.match(ACTIVE_KEY);
      const previous = active ? await active.text() : '';
      // Keep this version plus the one that may still be serving open pages;
      // drop everything older. Never touch non-`wfe-` caches on this origin.
      const keep = new Set([CACHE, META_CACHE, previous].filter(Boolean));
      await Promise.all(
        keys.filter((key) => key.startsWith('wfe-') && !keep.has(key)).map((key) => caches.delete(key)),
      );
      await meta.put(ACTIVE_KEY, new Response(CACHE));
      // No clients.claim(): the new version takes over on the next reload.
    })(),
  );
});

/** App code never comes from two versions in one page load. */
async function cacheFirst(request) {
  const cached = await caches.match(request, { cacheName: CACHE });
  if (cached) return cached;
  try {
    return await fetch(request);
  } catch {
    return Response.error();
  }
}

/** Fresh HTML wins; the cached shell is only the offline fallback. */
async function networkOrShell(request) {
  try {
    return await fetch(request);
  } catch {
    return (await caches.match(request, { cacheName: CACHE })) || (await caches.match('./index.html', { cacheName: CACHE })) || Response.error();
  }
}

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  // GitHub API, oEmbed and release downloads must always hit the network.
  if (url.origin !== self.location.origin) return;

  if (request.mode === 'navigate') {
    event.respondWith(networkOrShell(request));
    return;
  }

  event.respondWith(cacheFirst(request));
});
