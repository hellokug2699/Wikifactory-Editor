import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  linkScanTargets,
  pageIdOf,
  planRename,
  renamePagePath,
  renameSummary,
  rewritePageLinks,
} from '../app/assets/js/batch.js';

test('page ids and rename targets', () => {
  assert.equal(pageIdOf('games/Example/Guides/New-Page.md'), 'Example/Guides/New-Page');
  assert.equal(pageIdOf('games/A/B/C.mdx'), 'A/B/C');
  assert.equal(pageIdOf('games/A/assets/x.png'), '');
  assert.equal(renamePagePath('games/A/B/Old.md', 'New'), 'games/A/B/New.md');
  assert.equal(renamePagePath('games/A/B/Old.md', 'New.md'), 'games/A/B/New.md');
  assert.equal(renamePagePath('games/A/B/Old.md', '  '), '');
});

test('rename plans reject conflicts and no-ops', () => {
  const repoPaths = ['games/A/B/Old.md', 'games/A/B/Taken.md'];
  assert.equal(planRename({ from: 'games/A/B/Old.md', to: 'games/A/B/New.md', repoPaths }).ok, true);
  const same = planRename({ from: 'games/A/B/Old.md', to: 'games/A/B/Old.md', repoPaths });
  assert.equal(same.ok, true);
  assert.equal(same.unchanged, true);
  const conflict = planRename({ from: 'games/A/B/Old.md', to: 'games/A/B/Taken.md', repoPaths });
  assert.equal(conflict.ok, false);
  assert.match(conflict.error, /已存在/);
  assert.equal(planRename({ from: 'games/A/B/Old.md', to: 'games/A/B/New.md' }).ok, true);
  assert.equal(renameSummary([conflict, same]), '1 个失败');
});

test('rename plans apply the shared path rules', () => {
  const base = { from: 'games/A/B/Old.md', repoPaths: ['games/A/B/Old.md'] };
  assert.match(planRename({ ...base, to: 'games/A/B/Bad:Name.md' }).error, /非法字符/);
  assert.match(planRename({ ...base, to: 'games/../B/New.md' }).error, /点段/);
  assert.match(planRename({ ...base, to: 'games/search/B/New.md' }).error, /保留路径/);
  assert.match(planRename({ ...base, to: 'games/A/Old.md' }).error, /层级不足/);
  assert.match(planRename({ ...base, to: 'games/A/B/New.MD' }).error, /扩展名/);
  assert.match(planRename({ ...base, to: 'games/A/B/' }).error, /目标路径不是页面/);
  assert.equal(renamePagePath('games/A/B/Old.md', 'sub/New'), '');
});

test('rename plans catch .md / .mdx URL collisions', () => {
  const plan = planRename({
    from: 'games/A/B/Old.md',
    to: 'games/A/B/MAM.md',
    repoPaths: ['games/A/B/MAM.mdx'],
  });
  assert.equal(plan.ok, false);
  assert.match(plan.error, /URL 冲突/);
});

test('internal links are rewritten in every supported form', () => {
  const body = [
    '见 [[Example/Guides/Old-Page]] 与 [[Example/Guides/Old-Page|旧页面]]。',
    '相对写法 [[Old-Page#材料]]，锚点要保留。',
    '图片不算页面链接：[[File/cover.png]]、[[Audio/sound.ogg]]。',
    '`[[Example/Guides/Old-Page]]` 在行内代码里不改。',
    '```',
    '[[Example/Guides/Old-Page]]',
    '```',
  ].join('\n');
  const result = rewritePageLinks(body, {
    fromId: 'Example/Guides/Old-Page',
    toId: 'Example/Guides/New-Page',
  });
  assert.equal(result.replacements, 3);
  assert.ok(result.text.includes('[[Example/Guides/New-Page]]'));
  assert.ok(result.text.includes('[[Example/Guides/New-Page|旧页面]]'));
  assert.ok(result.text.includes('[[New-Page#材料]]'));
  assert.ok(result.text.includes('[[File/cover.png]]'));
  // Code spans and fences keep the old name verbatim.
  assert.equal(result.text.split('Old-Page').length - 1, 2);
});

test('rewrite is a no-op when nothing matches', () => {
  const body = '只有 [[Other/Page]] 与 [[File/x.png]]。';
  const result = rewritePageLinks(body, { fromId: 'Example/Guides/Old-Page', toId: 'Example/Guides/New-Page' });
  assert.equal(result.changed, false);
  assert.equal(result.replacements, 0);
  assert.equal(result.text, body);
});

test('rewrite keeps unknown fields and is idempotent', () => {
  const body = '[[A/B/C]]';
  const once = rewritePageLinks(body, { fromId: 'A/B/C', toId: 'A/B/D' });
  const twice = rewritePageLinks(once.text, { fromId: 'A/B/C', toId: 'A/B/D' });
  assert.equal(once.text, '[[A/B/D]]');
  assert.equal(twice.replacements, 0);
});

test('link scan targets stay inside the affected game folders', () => {
  const repoPaths = [
    'games/A/B/one.md',
    'games/A/C/two.md',
    'games/A/B/three.md',
    'games/Z/Y/other.md',
    'games/A/assets/images/cover.png',
  ];
  const targets = linkScanTargets({ renamedIds: ['A/B/one'], repoPaths });
  assert.deepEqual(targets, ['games/A/B/one.md', 'games/A/B/three.md', 'games/A/C/two.md']);
  assert.deepEqual(linkScanTargets({ renamedIds: ['A/B/one'], repoPaths, extra: ['games/Z/Y/other.md'] }), [
    'games/A/B/one.md',
    'games/A/B/three.md',
    'games/A/C/two.md',
    'games/Z/Y/other.md',
  ]);
});
