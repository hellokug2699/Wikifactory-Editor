import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  activeMaxUploadMb,
  applyEditorConfig,
  approvePendingConfig,
  configProblems,
  loadEditorConfig,
  pendingConfig,
  sha256Hex,
} from '../app/assets/js/config.js';
import { CONTENT_OWNER, CONTENT_REPO, EDITOR_OWNER, EDITOR_REPO } from '../app/assets/js/state.js';
import { DEFAULT_CONFIG } from '../app/assets/js/editor-config.js';
import { RESERVED_PATHS } from '../app/assets/js/content-rules.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
// Same owner (whitelisted), different repositories: simulates a repo migration.
const goodConfig = {
  version: 1,
  content: { owner: 'hellokug2699', repo: 'Wikifactory-Content-Next', branch: '' },
  editor: { owner: 'hellokug2699', repo: 'Wikifactory-Editor-Next' },
};
const sameRepoConfig = {
  version: 1,
  content: { ...DEFAULT_CONFIG.content },
  editor: { ...DEFAULT_CONFIG.editor },
};

function fakeFetch(text, status = 200) {
  return async () => ({ ok: status === 200, status, text: async () => text });
}

function resetConfig() {
  applyEditorConfig(DEFAULT_CONFIG, { source: 'default', verified: true });
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

test('sha256Hex hashes the canonical LF form', async () => {
  const crypto = await import('node:crypto');
  const text = fs.readFileSync(path.join(root, 'editor-config.json'), 'utf8');
  const hash = await sha256Hex(text);
  assert.match(hash, /^[0-9a-f]{64}$/);
  assert.equal(hash, crypto.createHash('sha256').update(text.replace(/\r\n/g, '\n'), 'utf8').digest('hex'));
  assert.equal(await sha256Hex('a\r\nb'), await sha256Hex('a\nb'));
});

test('a repo-moving config without a pinned hash waits for confirmation', async () => {
  resetConfig();
  const text = JSON.stringify(goodConfig, null, 2);
  const result = await loadEditorConfig({ fetchImpl: fakeFetch(text) });
  assert.equal(result.source, 'default');
  assert.equal(result.pending, true);
  assert.ok(pendingConfig());
  // Nothing is applied before the user approves it.
  assert.equal(CONTENT_OWNER, 'hellokug2699');
  assert.equal(CONTENT_REPO, 'Wikifactory-Content');
  assert.equal(EDITOR_REPO, 'Wikifactory-Editor');

  const applied = approvePendingConfig();
  assert.equal(applied.source, 'remote');
  assert.equal(pendingConfig(), null);
  assert.equal(CONTENT_REPO, 'Wikifactory-Content-Next');
  assert.equal(EDITOR_REPO, 'Wikifactory-Editor-Next');
  resetConfig();
});

test('an unpinned config that keeps the same repos is still applied', async () => {
  resetConfig();
  const result = await loadEditorConfig({ fetchImpl: fakeFetch(JSON.stringify(sameRepoConfig)) });
  assert.equal(result.source, 'remote');
  assert.equal(result.verified, false);
  assert.equal(CONTENT_REPO, DEFAULT_CONFIG.content.repo);
  resetConfig();
});

test('rules.reservedPaths must match the shared content rules', () => {
  assert.deepEqual(configProblems({ ...goodConfig, rules: { reservedPaths: RESERVED_PATHS } }), []);
  const drift = configProblems({ ...goodConfig, rules: { reservedPaths: ['search'] } });
  assert.equal(drift.length, 1);
  assert.match(drift[0], /content-rules/);
  assert.ok(configProblems({ ...goodConfig, rules: { maxUploadMb: -1 } }).length > 0);
});

test('upload ceiling comes from the active config', () => {
  applyEditorConfig({ ...DEFAULT_CONFIG, rules: { maxUploadMb: 5 } });
  assert.equal(activeMaxUploadMb(), 5);
  resetConfig();
  assert.equal(activeMaxUploadMb(), 20);
});

test('a rejected remote config keeps the built-in values', async () => {
  resetConfig();
  const text = JSON.stringify({ ...goodConfig, content: { owner: 'evil', repo: 'Wikifactory-Content-Next' } });
  const result = await loadEditorConfig({ fetchImpl: fakeFetch(text) });
  assert.equal(result.source, 'default');
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
