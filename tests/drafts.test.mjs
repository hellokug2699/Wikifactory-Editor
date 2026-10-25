import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  MAX_DRAFTS,
  deleteDraft,
  draftCount,
  exportDraftBundle,
  hydrateDrafts,
  importDraftBundle,
  listArchivedDrafts,
  listDrafts,
  saveDraftRecord,
} from '../app/assets/js/drafts.js';

const KEY = 'wikifactory-editor:drafts:v1';

function memoryStorage(initial = {}) {
  const map = new Map(Object.entries(initial));
  return {
    failWrites: false,
    raw: map,
    getItem(key) {
      return map.has(key) ? map.get(key) : null;
    },
    setItem(key, value) {
      if (this.failWrites) throw new Error('QuotaExceededError');
      map.set(key, String(value));
    },
    removeItem(key) {
      map.delete(key);
    },
  };
}

function memoryArchive(records = []) {
  const map = new Map(records.map((record) => [record.path, record]));
  return {
    map,
    async all() {
      return [...map.values()];
    },
    async put(record) {
      map.set(record.path, record);
      return true;
    },
    async delete(path) {
      map.delete(path);
      return true;
    },
  };
}

function record(path, savedAt, body = path) {
  return { path, title: path, fmRaw: '', body, savedAt };
}

test('drafts are stored per path and sorted by time', () => {
  const storage = memoryStorage();
  const first = saveDraftRecord(record('games/A/B/one.md', 1000), storage);
  assert.equal(first.ok, true);
  assert.deepEqual(first.evicted, []);
  saveDraftRecord(record('games/A/B/two.md', 2000), storage);

  assert.deepEqual(
    listDrafts(storage).map((item) => item.path),
    ['games/A/B/two.md', 'games/A/B/one.md'],
  );
  assert.equal(draftCount(storage), 2);
});

test('the hot window keeps the newest MAX_DRAFTS and reports evictions', () => {
  const storage = memoryStorage();
  for (let index = 0; index < MAX_DRAFTS; index += 1) {
    saveDraftRecord(record(`games/A/B/p${index}.md`, 1000 + index), storage);
  }
  const result = saveDraftRecord(record('games/A/B/overflow.md', 9999), storage);
  assert.equal(result.ok, true);
  assert.deepEqual(result.evicted, ['games/A/B/p0.md']);
  assert.equal(draftCount(storage), MAX_DRAFTS);
  assert.ok(!listDrafts(storage).some((item) => item.path === 'games/A/B/p0.md'));
});

test('a failed write is reported instead of silently dropping the draft', () => {
  const storage = memoryStorage();
  storage.failWrites = true;
  const result = saveDraftRecord(record('games/A/B/one.md', 1000), storage);
  assert.equal(result.ok, false);
  assert.match(result.error, /存储空间/);
});

test('deleteDraft removes the record from both layers', async () => {
  const storage = memoryStorage();
  const archive = memoryArchive([record('games/A/B/one.md', 1000)]);
  saveDraftRecord(record('games/A/B/one.md', 1000), storage);
  deleteDraft('games/A/B/one.md', storage);
  assert.equal(draftCount(storage), 0);
});

test('archived drafts are listed when they leave the hot window', async () => {
  const archive = memoryArchive([record('games/A/B/old.md', 500), record('games/A/B/hot.md', 900)]);
  const storage = memoryStorage({
    [KEY]: JSON.stringify({ 'games/A/B/hot.md': record('games/A/B/hot.md', 900) }),
  });
  const archived = await listArchivedDrafts({ archive, storage });
  assert.deepEqual(
    archived.map((item) => item.path),
    ['games/A/B/old.md'],
  );
});

test('hydrateDrafts rebuilds a corrupt localStorage from the archive', async () => {
  const archive = memoryArchive([record('games/A/B/one.md', 1000), record('games/A/B/two.md', 2000)]);
  const corrupt = memoryStorage({ [KEY]: '{not json' });
  const restored = await hydrateDrafts({ storage: corrupt, archive });
  assert.equal(restored.restored, 2);
  assert.equal(restored.source, 'corrupt');
  assert.equal(draftCount(corrupt), 2);

  const missing = memoryStorage();
  const fresh = await hydrateDrafts({ storage: missing, archive });
  assert.equal(fresh.restored, 2);
  assert.equal(fresh.source, 'missing');
});

test('hydrateDrafts keeps a healthy localStorage untouched', async () => {
  const local = { 'games/A/B/local.md': record('games/A/B/local.md', 1000) };
  const storage = memoryStorage({ [KEY]: JSON.stringify(local) });
  const result = await hydrateDrafts({ storage, archive: memoryArchive([record('games/A/B/old.md', 500)]) });
  assert.equal(result.restored, 0);
  assert.equal(result.source, 'local');
  assert.deepEqual(
    listDrafts(storage).map((item) => item.path),
    ['games/A/B/local.md'],
  );
});

test('export merges the hot window and the archive', async () => {
  const storage = memoryStorage({
    [KEY]: JSON.stringify({ 'games/A/B/hot.md': record('games/A/B/hot.md', 900) }),
  });
  const archive = memoryArchive([record('games/A/B/old.md', 500)]);
  const bundle = await exportDraftBundle({ storage, archive });
  assert.equal(bundle.app, 'Wikifactory Editor');
  assert.deepEqual(
    bundle.drafts.map((item) => item.path),
    ['games/A/B/hot.md', 'games/A/B/old.md'],
  );
});

test('import merges backups and keeps the newest copy', async () => {
  const storage = memoryStorage({
    [KEY]: JSON.stringify({ 'games/A/B/one.md': record('games/A/B/one.md', 3000, 'newer') }),
  });
  const archive = memoryArchive();
  const result = await importDraftBundle(
    {
      drafts: [record('games/A/B/one.md', 1000, 'older'), record('games/A/B/two.md', 2000, 'imported'), { nope: true }],
    },
    { storage, archive },
  );
  assert.equal(result.ok, true);
  assert.equal(result.imported, 1);
  assert.equal(result.skipped, 2);
  assert.equal(listDrafts(storage).find((item) => item.path === 'games/A/B/one.md').body, 'newer');
  assert.equal(listDrafts(storage).find((item) => item.path === 'games/A/B/two.md').body, 'imported');
  assert.equal(archive.map.get('games/A/B/two.md').body, 'imported');
});

test('import rejects payloads that are not draft bundles', async () => {
  const result = await importDraftBundle({ foo: 'bar' }, { storage: memoryStorage(), archive: memoryArchive() });
  assert.equal(result.ok, false);
  assert.match(result.error, /备份/);
});
