import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createSubmitJournal, resumableEntry } from '../app/assets/js/submit-journal.js';

function memoryStorage() {
  const map = new Map();
  return {
    getItem: (key) => (map.has(key) ? map.get(key) : null),
    setItem: (key, value) => map.set(key, String(value)),
    removeItem: (key) => map.delete(key),
  };
}

test('journal round-trips and clears', () => {
  const journal = createSubmitJournal({ storage: memoryStorage() });
  assert.equal(journal.read(), null);

  journal.write({ owner: 'o', repo: 'r', branch: 'b', stage: 'branch' });
  const entry = journal.read();
  assert.equal(entry.branch, 'b');
  assert.equal(entry.stage, 'branch');
  assert.ok(entry.updatedAt > 0);

  journal.clear();
  assert.equal(journal.read(), null);
});

test('journal survives corrupt storage without throwing', () => {
  const storage = memoryStorage();
  storage.setItem('wikifactory-editor:submit-journal:v1', '{broken');
  const journal = createSubmitJournal({ storage });
  assert.equal(journal.read(), null);
  assert.equal(journal.write({ branch: 'b', stage: 'branch' }), true);
});

test('only unfinished branches for the same repository are resumable', () => {
  const base = { owner: 'o', repo: 'r', branch: 'b', stage: 'branch' };
  assert.ok(resumableEntry(base, { owner: 'o', repo: 'r', branch: 'b' }));
  assert.ok(resumableEntry({ ...base, stage: 'committed' }, { owner: 'o', repo: 'r', branch: 'b' }));
  assert.ok(resumableEntry({ ...base, stage: 'pr-pending' }, { owner: 'o', repo: 'r', branch: 'b' }));

  assert.equal(resumableEntry(base, { owner: 'o', repo: 'other', branch: 'b' }), null);
  assert.equal(resumableEntry(base, { owner: 'o', repo: 'r', branch: 'other' }), null);
  assert.equal(resumableEntry({ ...base, stage: 'start' }, { owner: 'o', repo: 'r', branch: 'b' }), null);
  assert.equal(resumableEntry(null, { owner: 'o', repo: 'r', branch: 'b' }), null);
});
