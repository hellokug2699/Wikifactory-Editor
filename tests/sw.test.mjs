import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const appDir = path.join(root, 'app');
const swSource = fs.readFileSync(path.join(appDir, 'sw.js'), 'utf8');
const sw = swSource;
/** Comments mention the APIs we forbid; only check executable code. */
const code = swSource.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');

function listOf(name) {
  const match = new RegExp(`const ${name} = \\[([\\s\\S]*?)\\];`).exec(sw);
  assert.ok(match, `sw.js must declare ${name}`);
  return [...match[1].matchAll(/'([^']+)'/g)].map((item) => item[1]);
}

function appFiles(dir = appDir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      appFiles(full, out);
      continue;
    }
    out.push(`./${path.relative(appDir, full).split(path.sep).join('/')}`);
  }
  return out;
}

test('critical + optional precache cover every runtime asset', () => {
  const list = new Set([...listOf('CRITICAL'), ...listOf('OPTIONAL')]);
  // The worker itself and host-only metadata are not part of the app cache.
  const ignored = new Set(['./sw.js', './_headers']);
  const missing = appFiles().filter((file) => !ignored.has(file) && !list.has(file));
  assert.deepEqual(missing, [], `missing from precache: ${missing.join(', ')}`);
});

test('every executable asset is part of the atomic install', () => {
  const critical = new Set(listOf('CRITICAL'));
  const scripts = appFiles().filter((file) => /\.(js|mjs|css|html|webmanifest)$/.test(file));
  const missing = scripts.filter((file) => file !== './sw.js' && !critical.has(file));
  assert.deepEqual(missing, [], `not atomic: ${missing.join(', ')}`);
  // Icons are the only optional entries.
  for (const file of listOf('OPTIONAL')) {
    assert.ok(file.includes('/assets/icons/'), `${file} should not be optional`);
  }
});

test('install is atomic and never activates a partial cache', () => {
  assert.match(sw, /await cache\.addAll\(CRITICAL\);/);
  assert.match(sw, /catch \(error\) \{\s*await caches\.delete\(CACHE\);/);
  assert.match(sw, /throw error;/);
  // skipWaiting must follow the successful batch only.
  const installBlock = sw.slice(sw.indexOf("addEventListener('install'"), sw.indexOf("addEventListener('activate'"));
  assert.ok(installBlock.indexOf('await cache.addAll(CRITICAL)') < installBlock.indexOf('self.skipWaiting()'));
});

test('one page load keeps one version', () => {
  // App code is cache-first from this worker's bucket…
  assert.match(sw, /caches\.match\(request, \{ cacheName: CACHE \}\)/);
  assert.match(sw, /event\.respondWith\(cacheFirst\(request\)\)/);
  // …and the worker never takes over a page mid-load.
  assert.equal(/clients\s*\.\s*claim\s*\(/.test(code), false, 'claiming clients breaks version consistency');
});

test('activation keeps the previous bucket and ignores foreign caches', () => {
  assert.match(sw, /const META_CACHE = 'wfe-meta';/);
  assert.match(sw, /const keep = new Set\(\[CACHE, META_CACHE, previous\]/);
  assert.match(sw, /key\.startsWith\('wfe-'\)/);
});

test('cache bucket is release-scoped', () => {
  assert.match(sw, /const VERSION = '__WFE_VERSION__';/);
  assert.match(sw, /const CACHE = `wfe-\$\{VERSION\}`;/);
});

test('never intercepts cross-origin API traffic', () => {
  assert.match(sw, /url\.origin !== self\.location\.origin\) return;/);
  assert.match(sw, /request\.method !== 'GET'\) return;/);
});
