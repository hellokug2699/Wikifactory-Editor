import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readRepoCache, repoCacheNote, writeRepoCache } from '../app/assets/js/repo-cache.js';
import { toolbarActions, TOOLBAR } from '../app/assets/js/toolbar.js';

function memoryStorage() {
  const map = new Map();
  return {
    getItem: (key) => (map.has(key) ? map.get(key) : null),
    setItem: (key, value) => map.set(key, String(value)),
  };
}

test('repo cache is ref-scoped and expires', () => {
  const storage = memoryStorage();
  const now = 1_700_000_000_000;
  assert.equal(readRepoCache(storage, 'HEAD', { now }), null);

  writeRepoCache(storage, { ref: 'main', paths: ['games/A/B/C.md'], at: now });
  assert.deepEqual(readRepoCache(storage, 'main', { now })?.paths, ['games/A/B/C.md']);
  assert.equal(readRepoCache(storage, 'other', { now }), null);
  assert.equal(readRepoCache(storage, 'main', { now: now + 8 * 24 * 3600 * 1000 }), null);
});

test('cache note only appears for cached indexes', () => {
  assert.equal(
    repoCacheNote({ cached: false }, () => '10:00'),
    '',
  );
  assert.match(
    repoCacheNote({ cached: true, at: 1 }, () => '10:00'),
    /本地缓存（10:00）/,
  );
});

test('toolbar actions are unique and renderable', () => {
  const actions = toolbarActions();
  const ids = actions.map((item) => item.action);
  assert.equal(new Set(ids).size, ids.length);
  assert.ok(ids.includes('preview'));
  assert.ok(ids.includes('validate'));
  for (const item of actions) {
    assert.ok(item.title, `${item.action} missing title`);
    assert.ok(item.icon || item.glyph, `${item.action} missing icon/glyph`);
  }
  assert.equal(
    TOOLBAR.reduce((sum, group) => sum + group.items.length, 0),
    actions.length,
  );
});
