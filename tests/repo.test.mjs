import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { REPO, githubUrl, ownerAllowlist, releaseAssetUrl, repoInfo } from '../scripts/repo.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const config = JSON.parse(fs.readFileSync(path.join(root, 'editor-config.json'), 'utf8'));

test('repo info comes from editor-config.json', () => {
  assert.equal(REPO.contentOwner, config.content.owner);
  assert.equal(REPO.contentRepo, config.content.repo);
  assert.equal(REPO.editorOwner, config.editor.owner);
  assert.equal(REPO.editorRepo, config.editor.repo);
  assert.match(REPO.issueUrl, /^https:\/\/github\.com\//);
  assert.ok(REPO.issueUrl.startsWith(githubUrl(REPO.editorOwner, REPO.editorRepo)));
});

test('release asset URLs follow the configured editor repository', () => {
  const url = releaseAssetUrl('9.9.9', 'asset.neu');
  assert.equal(url, `https://github.com/${REPO.editorOwner}/${REPO.editorRepo}/releases/download/v9.9.9/asset.neu`);
  // A migrated config produces URLs for the new owner without code changes.
  const migrated = repoInfo({
    content: { owner: 'neworg', repo: 'New-Content' },
    editor: { owner: 'neworg', repo: 'New-Editor' },
  });
  assert.equal(
    releaseAssetUrl('1.0.0', 'x.zip', migrated),
    'https://github.com/neworg/New-Editor/releases/download/v1.0.0/x.zip',
  );
});

test('owner allowlist follows the config and accepts pre-authorised owners', () => {
  assert.deepEqual(ownerAllowlist({ content: { owner: 'a' }, editor: { owner: 'b' } }), ['a', 'b']);
  assert.deepEqual(ownerAllowlist({ content: { owner: 'a' }, editor: { owner: 'a' }, allowedOwners: ['c'] }), [
    'a',
    'c',
  ]);
  assert.equal(ownerAllowlist(config).includes(config.content.owner), true);
});

test('runtime code does not hard-code the owner', () => {
  const files = [
    'app/assets/js/config.js',
    'app/assets/js/main.js',
    'app/index.html',
    'scripts/version.mjs',
    'scripts/build-desktop.mjs',
    'scripts/sign-windows.mjs',
    'scripts/editor-config.mjs',
  ];
  for (const file of files) {
    const text = fs.readFileSync(path.join(root, file), 'utf8');
    for (const owner of [config.content.owner, config.editor.owner]) {
      assert.equal(
        text.includes(owner),
        false,
        `${file} still hard-codes ${owner}; read it from editor-config.json instead`,
      );
    }
  }
});
