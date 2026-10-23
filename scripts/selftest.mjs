import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  joinDocument, splitFrontmatter, setYamlField, frontmatterData,
  validateContentPath, validateWikiSyntax, validateDocument, validateWithRepo,
  validateFrontmatter, extractIconRefs, repositoryIconNames,
} from '../app/assets/js/validate.js';
import { APP_VERSION } from '../app/assets/js/state.js';
import { buildPreview } from '../app/assets/js/markdown.js';
import {
  AUDIO_DIR, PAGE_TAGS, PAGE_TAG_VALUES, RESERVED_PATHS, audioFileName, audioNameProblem,
  embedTarget, nameProblem, parseAudioMarker, parseEmbedMarker, rulesMatchConfig,
  frontmatterTypeProblems, tagProblems,
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

test('preview module resolves all exported helpers', () => {
  assert.equal(typeof buildPreview, 'function');
});

test('page categories come from the shared template', () => {
  assert.ok(PAGE_TAGS.length >= 3);
  assert.deepEqual(new Set(PAGE_TAG_VALUES).size, PAGE_TAG_VALUES.length);
  for (const tag of PAGE_TAGS) {
    assert.ok(tag.value && tag.label && tag.description);
    assert.ok(['accent', 'success', 'warning', 'danger', 'neutral'].includes(tag.tone));
  }
  assert.equal(tagProblems(['攻略', '建筑']).length, 0);
  assert.ok(tagProblems(['攻略', '自造分类']).some((message) => message.includes('未知页面分类')));
  assert.ok(tagProblems(['攻略', '攻略']).some((message) => message.includes('重复')));
  assert.deepEqual(tagProblems('攻略'), []);
});

test('validateFrontmatter rejects unknown page categories', () => {
  const issues = validateFrontmatter('title: T\ntags: [攻略, 自造分类]');
  assert.ok(issues.some((item) => item.message.includes('未知页面分类')));
});

test('audio markers only accept ogg', () => {
  assert.equal(parseAudioMarker('factory.ogg|工厂环境音').name, 'factory.ogg');
  assert.equal(parseAudioMarker('factory.ogg|工厂环境音').title, '工厂环境音');
  assert.equal(parseAudioMarker('factory').name, 'factory.ogg');
  assert.equal(audioFileName('factory'), 'factory.ogg');
  assert.match(audioNameProblem('factory.mp3') ?? '', /ogg/);
  assert.match(audioNameProblem('../secret.ogg') ?? '', /字母/);
  assert.equal(audioNameProblem('factory.ogg'), null);

  const issues = validateWikiSyntax('[[Audio/factory.ogg|工厂]]\n[[Audio/factory.mp3]]');
  assert.ok(issues.some((item) => item.severity === 'error' && item.message.includes('音频不合法')));
  assert.equal(validateWikiSyntax('[[Audio/factory.ogg|工厂]]').filter((item) => item.severity === 'error').length, 0);
});

test('embed targets are limited to supported https providers', () => {
  assert.equal(
    embedTarget('https://www.youtube.com/watch?v=dQw4w9WgXcQ').embedUrl,
    'https://www.youtube.com/embed/dQw4w9WgXcQ',
  );
  assert.equal(embedTarget('https://youtu.be/dQw4w9WgXcQ').value, 'youtube/dQw4w9WgXcQ');
  assert.equal(
    embedTarget('https://www.bilibili.com/video/BV1xx411c7mD').embedUrl,
    'https://player.bilibili.com/player.html?bvid=BV1xx411c7mD&autoplay=0',
  );
  assert.equal(embedTarget('https://vimeo.com/123456789').value, 'vimeo/123456789');
  assert.equal(embedTarget('http://www.youtube.com/watch?v=dQw4w9WgXcQ'), null);
  assert.equal(embedTarget('https://example.com/watch?v=dQw4w9WgXcQ'), null);
  assert.equal(parseEmbedMarker('youtube/dQw4w9WgXcQ|演示').embedUrl, 'https://www.youtube.com/embed/dQw4w9WgXcQ');
  assert.equal(parseEmbedMarker('https://youtu.be/dQw4w9WgXcQ').warning?.includes('youtube/ID'), true);
  assert.equal(parseEmbedMarker('https://example.com/video|演示').warning?.includes('不支持'), true);

  const issues = validateWikiSyntax('[[Embed/https://example.com/video]]');
  assert.ok(issues.some((item) => item.severity === 'error' && item.message.includes('不支持的嵌入来源')));
  assert.equal(validateWikiSyntax('[[Embed/youtube/dQw4w9WgXcQ|演示]]').filter((item) => item.severity === 'error').length, 0);
});

test('audio availability matches the repository tree', () => {
  const repoPaths = [`games/Satisfactory/${AUDIO_DIR}/factory.ogg`];
  const issues = validateWithRepo({
    path: 'games/Satisfactory/Buildings/MAM.md',
    body: '[[Audio/factory.ogg]] [[Audio/missing.ogg]]',
    repoPaths,
  });
  const missing = issues.filter((item) => item.message.includes('音频文件不存在'));
  assert.equal(missing.length, 1);
  assert.ok(missing[0].message.includes(`games/Satisfactory/${AUDIO_DIR}/missing.ogg`));
  const withPending = validateWithRepo({
    path: 'games/Satisfactory/Buildings/MAM.md',
    body: '[[Audio/missing.ogg]]',
    repoPaths,
    extraPaths: [`games/Satisfactory/${AUDIO_DIR}/missing.ogg`],
  });
  assert.equal(withPending.filter((item) => item.message.includes('音频文件不存在')).length, 0);
});

console.log(`\n${passed} tests passed.`);
