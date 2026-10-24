import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyYamlChanges, frontmatterData, parseYaml, setYamlField } from '../app/assets/js/frontmatter.js';

test('real YAML parser keeps types and rejects broken documents', () => {
  const data = frontmatterData('title: T\ntags: [攻略, 建筑]\norder: 3\ndraft: true\ntoc: false');
  assert.equal(data.title, 'T');
  assert.deepEqual(data.tags, ['攻略', '建筑']);
  assert.equal(data.order, 3);
  assert.equal(data.draft, true);
  assert.equal(data.toc, false);

  const { issues } = parseYaml('a: 1\na: 2');
  assert.ok(issues.length > 0);
});

test('comments, block scalars and unknown keys survive edits', () => {
  const raw = [
    '# 顶部注释',
    'title: 旧标题  # 行尾注释',
    'description: |',
    '  第一行',
    '  第二行',
    'custom_key: keep-me',
    'nested:',
    '  a: 1',
  ].join('\n');
  const next = setYamlField(raw, 'title', '新标题');
  assert.ok(next.includes('# 顶部注释'));
  assert.ok(next.includes('# 行尾注释'));
  assert.ok(next.includes('custom_key: keep-me'));
  assert.ok(next.includes('nested:'));
  assert.ok(next.includes('  第一行'));
  assert.ok(next.includes('新标题'));
  assert.equal(frontmatterData(next).title, '新标题');
});

test('deleting a field keeps the rest of the document', () => {
  const raw = 'title: T\ndraft: true\nkeep: 1';
  const next = setYamlField(raw, 'draft', '');
  assert.ok(!next.includes('draft:'));
  assert.ok(next.includes('keep: 1'));
});

test('applyYamlChanges batches several fields in one pass', () => {
  const raw = '# c\ntitle: A\norder: 1\nkeep: yes';
  const next = applyYamlChanges(raw, { title: 'B', order: '', tags: ['攻略'], toc: false });
  assert.ok(next.includes('# c'));
  assert.ok(next.includes('title: B'));
  assert.ok(!next.includes('order:'));
  assert.ok(next.includes('keep: yes'));
  const data = frontmatterData(next);
  assert.deepEqual(data.tags, ['攻略']);
  assert.equal(data.toc, false);
});

/* ---------------------------------------------------- property-based roundtrip */

function lcg(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

function pick(random, list) {
  return list[Math.floor(random() * list.length) % list.length];
}

test('setYamlField roundtrip never loses unknown fields (property-based)', () => {
  const random = lcg(20261024);
  const stringPool = ['alpha', 'beta', '中文标题', '页面-1', 'x y z'];
  for (let round = 0; round < 60; round += 1) {
    const unknownKey = `unknown_${round}`;
    const unknownValue = pick(random, stringPool);
    const raw = [
      `# round ${round}`,
      `title: ${pick(random, stringPool)}`,
      `order: ${Math.floor(random() * 100)}`,
      `${unknownKey}: ${unknownValue}`,
      'note: |',
      `  block ${round}`,
    ].join('\n');
    const before = frontmatterData(raw);
    const value = round % 3 === 0 ? '' : pick(random, stringPool);
    const next = setYamlField(raw, 'title', value);
    const after = frontmatterData(next);

    assert.equal(after.map[unknownKey], unknownValue, `round ${round}: unknown field lost`);
    assert.equal(after.order, before.order);
    assert.ok(next.includes(`block ${round}`), `round ${round}: block scalar lost`);
    // Deleting a field also deletes its attached comment; edits must keep it.
    if (value !== '') assert.ok(next.includes(`# round ${round}`), `round ${round}: comment lost`);
    assert.equal(after.title, value);
  }
});
