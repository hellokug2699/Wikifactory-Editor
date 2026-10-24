import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { configProblems, loadEditorConfig, sha256Hex } from '../app/assets/js/config.js';
import { CONTENT_OWNER, CONTENT_REPO, EDITOR_OWNER, EDITOR_REPO } from '../app/assets/js/state.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
// Same owner (whitelisted), different repositories: simulates a repo migration.
const goodConfig = {
  version: 1,
  content: { owner: 'hellokug2699', repo: 'Wikifactory-Content-Next', branch: '' },
  editor: { owner: 'hellokug2699', repo: 'Wikifactory-Editor-Next' },
};

function fakeFetch(text, status = 200) {
  return async () => ({ ok: status === 200, status, text: async () => text });
}

test('the committed editor-config.json passes the whitelist', () => {
  const text = fs.readFileSync(path.join(root, 'editor-config.json'), 'utf8');
  const config = JSON.parse(text);
  assert.deepEqual(configProblems(config), []);
  assert.equal(config.content.owner, CONTENT_OWNER);
  assert.equal(config.content.repo, CONTENT_REPO);
  assert.equal(config.editor.owner, EDITOR_OWNER);
  assert.equal(config.editor.repo, EDITOR_REPO);
});

test('whitelist rejects foreign owners, Core/Alias repos and unknown fields', () => {
  assert.ok(configProblems({ ...goodConfig, content: { owner: 'evil', repo: 'Wikifactory-Content' } }).length > 0);
  assert.ok(configProblems({ ...goodConfig, content: { owner: 'hellokug2699', repo: 'Wikifactory-Core' } }).length > 0);
  assert.ok(configProblems({ ...goodConfig, content: { owner: 'hellokug2699', repo: 'alias' } }).length > 0);
  assert.deepEqual(configProblems({ ...goodConfig, extra: true }), ['未知字段「extra」']);
  assert.ok(configProblems({ ...goodConfig, version: 2 }).length > 0);
  assert.ok(configProblems(null).length > 0);
});

test('sha256Hex matches the node crypto hash', async () => {
  const crypto = await import('node:crypto');
  const text = fs.readFileSync(path.join(root, 'editor-config.json'), 'utf8');
  const hash = await sha256Hex(text);
  assert.match(hash, /^[0-9a-f]{64}$/);
  assert.equal(hash, crypto.createHash('sha256').update(text, 'utf8').digest('hex'));
});

test('loadEditorConfig applies a verified remote config without a new release', async () => {
  const text = JSON.stringify(goodConfig, null, 2);
  const result = await loadEditorConfig({ fetchImpl: fakeFetch(text) });
  assert.equal(result.source, 'remote');
  // Unknown hash: applied but flagged unverified (whitelist still passed).
  assert.equal(result.verified, false);
  assert.equal(CONTENT_OWNER, 'hellokug2699');
  assert.equal(CONTENT_REPO, 'Wikifactory-Content-Next');
  assert.equal(EDITOR_REPO, 'Wikifactory-Editor-Next');
});

test('a rejected remote config keeps the built-in values', async () => {
  const text = JSON.stringify({ ...goodConfig, content: { owner: 'evil', repo: 'Wikifactory-Content-Next' } });
  const result = await loadEditorConfig({ fetchImpl: fakeFetch(text) });
  assert.equal(result.source, 'default');
  // Falls back to the built-in repository, not the rejected one.
  assert.equal(CONTENT_REPO, 'Wikifactory-Content');
});

test('network failures never throw', async () => {
  const result = await loadEditorConfig({
    fetchImpl: async () => {
      throw new Error('offline');
    },
  });
  assert.equal(result.source, 'default');
});
