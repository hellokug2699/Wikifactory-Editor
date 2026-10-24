import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  appLinkFor,
  importedPagePath,
  isSafeContentPath,
  normalizeContentPath,
  parseDeepLink,
  siteUrlFor,
} from '../app/assets/js/deep-link.js';

test('site page URLs map to content paths', () => {
  assert.deepEqual(parseDeepLink('https://wikifactory.top/games/Example/Guides/New-Page/'), {
    ok: true,
    path: 'games/Example/Guides/New-Page.md',
    kind: 'page',
  });
  assert.equal(parseDeepLink('https://www.wikifactory.top/games/A/B/C.md').path, 'games/A/B/C.md');
  // Query parameter wins (site "edit" button may pass the repo path).
  assert.equal(parseDeepLink('https://wikifactory.top/anything?path=games/A/B/P%20one.md').path, 'games/A/B/P one.md');
});

test('custom scheme and bare paths are accepted', () => {
  assert.equal(parseDeepLink(appLinkFor('games/A/B/P.md')).path, 'games/A/B/P.md');
  assert.equal(parseDeepLink('games/A/B/P').path, 'games/A/B/P.md');
  assert.equal(parseDeepLink('wikifactory-editor://open?path=games/A/B/P/').path, 'games/A/B/P.md');
});

test('unrelated links are rejected with a reason', () => {
  for (const href of [
    'https://example.com/games/A/B/P/',
    'https://wikifactory.top/about/',
    'https://wikifactory.top/',
    'javascript:alert(1)',
    '',
  ]) {
    const result = parseDeepLink(href);
    assert.equal(result.ok, false, href);
    assert.ok(result.reason, `${href} missing reason`);
  }
});

test('dot segments and unsafe characters are rejected', () => {
  for (const href of [
    'games/../../etc/passwd',
    'games/A/B/../../secret',
    'wikifactory-editor://open?path=games/../secret',
    'games/A/B/%2e%2e/secret',
    'games/A\\B\\C',
  ]) {
    const result = parseDeepLink(href);
    assert.equal(result.ok, false, href);
  }
  assert.equal(isSafeContentPath('games/A/B/C.md'), true);
  assert.equal(isSafeContentPath('games/A/./C.md'), false);
});

test('assets are recognised, not treated as pages', () => {
  const result = parseDeepLink('https://wikifactory.top/games/A/assets/images/cover.png');
  assert.equal(result.ok, true);
  assert.equal(result.kind, 'asset');
  assert.equal(parseDeepLink('games/A/B/P/').kind, 'page');
});

test('normalization is idempotent and URL generation round-trips', () => {
  assert.equal(normalizeContentPath('/games//A/B/P/'), 'games/A/B/P.md');
  assert.equal(normalizeContentPath('games/A/B/P.md'), 'games/A/B/P.md');
  const url = siteUrlFor('games/A/B/P.md');
  assert.equal(url, 'https://wikifactory.top/games/A/B/P/');
  assert.equal(parseDeepLink(url).path, 'games/A/B/P.md');
});

test('imported Markdown gets a safe page path', () => {
  assert.equal(importedPagePath('Notes/我的 笔记.md'), 'games/Example/Imported/我的-笔记.md');
  assert.equal(importedPagePath(''), 'games/Example/Imported/Imported.md');
  assert.ok(importedPagePath('a/b/c.md').startsWith('games/Example/Imported/'));
});
