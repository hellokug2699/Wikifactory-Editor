import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const appDir = path.join(root, 'app');
const sw = fs.readFileSync(path.join(appDir, 'sw.js'), 'utf8');

function precacheList() {
  const match = /const PRECACHE = \[([\s\S]*?)\];/.exec(sw);
  assert.ok(match, 'sw.js must declare a PRECACHE array');
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

test('precache covers every runtime asset', () => {
  const list = new Set(precacheList());
  // The worker itself and host-only metadata are not part of the app cache.
  const ignored = new Set(['./sw.js', './_headers']);
  const missing = appFiles().filter((file) => !ignored.has(file) && !list.has(file));
  assert.deepEqual(missing, [], `missing from PRECACHE: ${missing.join(', ')}`);
});

test('cache bucket is release-scoped', () => {
  assert.match(sw, /const VERSION = '__WFE_VERSION__';/);
  assert.match(sw, /const CACHE = `wfe-\$\{VERSION\}`;/);
});

test('never intercepts cross-origin API traffic', () => {
  assert.match(sw, /url\.origin !== self\.location\.origin\) return;/);
  assert.match(sw, /request\.method !== 'GET'\) return;/);
});
