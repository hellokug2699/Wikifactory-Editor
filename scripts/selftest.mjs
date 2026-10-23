import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  joinDocument, splitFrontmatter, setYamlField, frontmatterData,
  validateContentPath, validateWikiSyntax, validateDocument, validateWithRepo,
  validateFrontmatter, extractIconRefs, repositoryIconNames,
} from '../app/assets/js/validate.js';
import { APP_VERSION } from '../app/assets/js/state.js';
import {
  RESERVED_PATHS, nameProblem, rulesMatchConfig, frontmatterTypeProblems,
} from '../app/assets/js/content-rules.js';

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

test('APP_VERSION matches package.json', () => {
  const pkg = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
  assert.equal(APP_VERSION, pkg.version);
});

test('frontmatter types follow the content gate', () => {
  assert.equal(validateFrontmatter('title: null').filter((i) => i.severity === 'error').length, 0);
  assert.ok(validateFrontmatter('order: "5"').some((i) => i.severity === 'error'));
  assert.ok(validateFrontmatter('tags: [1, 2]').some((i) => i.severity === 'error'));
  assert.equal(validateFrontmatter('updated: 2026-10-13T08:30:00Z').filter((i) => i.severity === 'error').length, 0);
  assert.ok(validateFrontmatter('updated: 2026-02-30').some((i) => i.severity === 'error'));
});

test('icon refs are extracted outside code blocks', () => {
  const refs = extractIconRefs('[icon=iron-plate] [icon=screw;size=lg]\n```\n[icon=ignored]\n```');
  assert.deepEqual(refs.map((ref) => ref.name), ['iron-plate', 'screw']);
});

test('icon availability matches games/<game>/assets/icons', () => {
  const repoPaths = [
    'games/Satisfactory/assets/icons/iron-plate.svg',
    'games/Satisfactory/assets/icons/screw.png',
    'games/Satisfactory/assets/images/factory.png',
    'games/Factorio/assets/icons/gear.svg',
  ];
  assert.deepEqual([...repositoryIconNames(repoPaths, 'Satisfactory')].sort(), ['iron-plate', 'screw']);
  const body = '[icon=iron-plate] [icon=gear] [icon=missing]';
  const issues = validateWithRepo({ path: 'games/Satisfactory/Buildings/MAM.md', body, repoPaths });
  const missing = issues.filter((i) => i.message.includes('图标不存在'));
  assert.equal(missing.length, 2);
  assert.ok(missing.some((i) => i.message.includes('games/Satisfactory/assets/icons/gear.svg')));
  assert.ok(missing.some((i) => i.message.includes('games/Satisfactory/assets/icons/missing.svg')));
  const withPending = validateWithRepo({
    path: 'games/Satisfactory/Buildings/MAM.md',
    body: '[icon=missing]',
    repoPaths,
    extraPaths: ['games/Satisfactory/assets/icons/missing.svg'],
  });
  assert.equal(withPending.filter((i) => i.message.includes('图标不存在')).length, 0);
});

test('duplicate URL and case conflicts are reported', () => {
  const repoPaths = ['games/Satisfactory/Buildings/MAM.md', 'games/Satisfactory/Buildings/MAM.mdx'];
  const issues = validateWithRepo({
    path: 'games/Satisfactory/Buildings/MAM.md',
    body: '',
    repoPaths,
  });
  assert.ok(issues.some((i) => i.message.includes('重复 URL')));
  const caseIssues = validateWithRepo({
    path: 'games/Satisfactory/Buildings/mam.md',
    body: '',
    repoPaths: ['games/Satisfactory/Buildings/MAM.md'],
  });
  assert.ok(caseIssues.some((i) => i.message.includes('大小写冲突')));
});

test('shared rules are the single source for names and types', () => {
  assert.deepEqual(RESERVED_PATHS, ['search', 'pagefind', '_astro', '404', 'about']);
  assert.equal(nameProblem('Page.md', { isFile: true }), null);
  assert.match(nameProblem('bad:name'), /非法字符/);
  assert.match(nameProblem(' Page'), /空白/);
  assert.ok(frontmatterTypeProblems({ order: '5' }).length > 0);
  assert.equal(frontmatterTypeProblems({ title: null, tags: ['a'] }).length, 0);
});

test('shared rules detect config drift', () => {
  const reserved = RESERVED_PATHS.map((item) => ({ path: item, reason: '' }));
  const thumbnails = { icon: { dir: 'assets/icons', extensions: ['svg', 'png', 'webp', 'jpg', 'jpeg', 'avif', 'gif'] } };
  assert.deepEqual(rulesMatchConfig({ reserved, thumbnails }), []);
  assert.ok(rulesMatchConfig({ reserved: reserved.slice(0, 2), thumbnails }).length > 0);
  assert.ok(rulesMatchConfig({ reserved, thumbnails: { icon: { dir: 'assets/images', extensions: [] } } }).length > 0);
});

console.log(`\n${passed} tests passed.`);
