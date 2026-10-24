import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkEditorConfig, configHash, generatedSource, validateConfig } from '../scripts/editor-config.mjs';
import { RESERVED_PATHS } from '../app/assets/js/content-rules.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const configText = fs.readFileSync(path.join(root, 'editor-config.json'), 'utf8');
const config = JSON.parse(configText);
const generated = fs.readFileSync(path.join(root, 'app/assets/js/editor-config.js'), 'utf8').replace(/\r\n/g, '\n');

test('generated editor-config module matches the JSON and its hash', () => {
  assert.deepEqual(checkEditorConfig(), []);
  assert.ok(generated.includes(configHash(configText)));
  assert.ok(generated.includes('export const ALLOWED_OWNERS'));
  assert.ok(generated.includes('export const DEFAULT_CONFIG'));
  assert.equal(
    generated,
    generatedSource({
      config,
      hash: configHash(configText),
      url: `https://raw.githubusercontent.com/${config.editor.owner}/${config.editor.repo}/main/editor-config.json`,
    }),
  );
});

test('the committed config stays inside the security boundary', () => {
  assert.deepEqual(validateConfig(config), []);
  assert.equal(config.content.repo, 'Wikifactory-Content');
  assert.ok(!/core|alias/i.test(config.content.repo));
  assert.deepEqual(validateConfig({ ...config, content: { ...config.content, repo: 'Wikifactory-Core' } }).length, 1);
});

test('reservedPaths must match the shared rules', () => {
  assert.ok(
    validateConfig({ ...config, rules: { reservedPaths: ['search'] } }).some((item) => /content-rules/.test(item)),
  );
  assert.deepEqual(validateConfig({ ...config, rules: { reservedPaths: [...RESERVED_PATHS] } }), []);
});
