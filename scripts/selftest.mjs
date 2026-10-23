import assert from 'node:assert/strict';
import {
  joinDocument, splitFrontmatter, setYamlField, frontmatterData,
  validateContentPath, validateWikiSyntax, validateDocument,
} from '../app/assets/js/validate.js';

let passed = 0;
function test(name, fn) {
  try {
    fn();
    passed += 1;
    console.log(`  ok  ${name}`);
  } catch (error) {
    console.error(`  FAIL ${name}`);
    throw error;
  }
}

console.log('Wikifactory Editor self-test (Content only)');

test('frontmatter split / join roundtrip', () => {
  const doc = '---\ntitle: 页面\nunknown: keep\n---\n\n正文\n';
  const split = splitFrontmatter(doc);
  assert.equal(split.raw, 'title: 页面\nunknown: keep');
  assert.equal(split.body, '\n正文\n');
  assert.match(joinDocument(split.raw, split.body), /unknown: keep/);
});

test('setYamlField preserves unknown fields and comments', () => {
  const raw = '# 注释\ntitle: 旧标题\nunknown: keep\ntags:\n  - 攻略';
  const next = setYamlField(raw, 'title', '新标题');
  assert.match(next, /^# 注释/);
  assert.match(next, /title: 新标题/);
  assert.match(next, /unknown: keep/);
  const tags = setYamlField(next, 'tags', ['攻略', '建筑']);
  assert.match(tags, /tags: \[攻略, 建筑\]/);
});

test('frontmatterData types', () => {
  const data = frontmatterData('title: T\ntags: [a, b]\norder: 3\ndraft: true\nupdated: 2026-10-13\ntoc: false');
  assert.equal(data.title, 'T');
  assert.deepEqual(data.tags, ['a', 'b']);
  assert.equal(data.order, 3);
  assert.equal(data.draft, true);
  assert.equal(data.toc, false);
});

test('content path validation', () => {
  assert.equal(validateContentPath('games/Game/Category/Page.md').filter((i) => i.severity === 'error').length, 0);
  assert.ok(validateContentPath('games/search/Category/Page.md').some((i) => i.severity === 'error'));
  assert.ok(validateContentPath('games/Game/Page.md').some((i) => i.severity === 'error'));
  assert.ok(validateContentPath('games/Game/Category/Page.MD').some((i) => i.severity === 'error'));
  assert.ok(validateContentPath('games/Game/Category/Page.txt').some((i) => i.severity === 'error'));
  assert.ok(validateContentPath('CONTRIBUTING.md').some((i) => i.severity === 'error'));
});

test('wiki syntax: valid images and links', () => {
  const text = [
    '[[File/iron-plate.png|thumb|md|right|alt=铁板|物品图标]]',
    '[[File/plate.png;sm]]',
    '[[Satisfactory/Buildings/MAM|MAM]]',
    '[icon=iron-plate;size=lg;bg=&G;fg=#fff]',
    '| a | b |',
    '| --- | --- |',
    '| 铁锭 | [bg=&G;fg=#fff]42 |',
  ].join('\n');
  assert.equal(validateWikiSyntax(text).filter((i) => i.severity === 'error').length, 0);
});

test('wiki syntax: catches File: and bad images', () => {
  const issues = validateWikiSyntax('[[File:bad.png]]\n[[File/../secret.png]]\n[[File/x.png|300px]]');
  assert.ok(issues.some((i) => i.severity === 'error' && i.message.includes('File/')));
  assert.ok(issues.some((i) => i.severity === 'error' && i.message.includes('图片名称')));
  assert.ok(issues.some((i) => i.severity === 'warn' && i.message.includes('像素')));
});

test('wiki syntax: code blocks are ignored', () => {
  const text = '```md\n[[File:demo.svg]]\n[icon=bad name]\n```\n\n`[[File:inline.svg]]`';
  assert.equal(validateWikiSyntax(text).length, 0);
});

test('aggregate validation sources', () => {
  const issues = validateDocument({
    path: 'games/Game/Category/Page.md',
    fmRaw: 'title: T\norder: nope',
    body: '[[File:bad.png]]',
  });
  assert.ok(issues.some((i) => i.source === 'frontmatter'));
  assert.ok(issues.some((i) => i.source === 'body'));
});

console.log(`\n${passed} tests passed.`);
