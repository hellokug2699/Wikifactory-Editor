import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  collectFormChanges,
  describeChanges,
  fmFormHtml,
  formValueToYaml,
  toggleTag,
} from '../app/assets/js/frontmatter-form.js';
import { Window } from 'happy-dom';

const tags = [
  { value: '攻略', label: '攻略', description: '玩法与流程' },
  { value: '建筑', label: '建筑', description: '建筑与布局' },
];

test('form markup contains every field and tag chip', () => {
  const window = new Window();
  const host = window.document.createElement('div');
  host.innerHTML = fmFormHtml({ tags, issueUrl: 'https://example.com/issue' });
  for (const field of ['title', 'description', 'order', 'updated', 'draft', 'toc']) {
    assert.ok(host.querySelector(`[data-fm="${field}"]`), `missing ${field}`);
  }
  assert.equal(host.querySelectorAll('[data-tag]').length, 2);
  assert.ok(host.innerHTML.includes('https://example.com/issue'));
});

test('formValueToYaml maps defaults and deletions', () => {
  assert.equal(formValueToYaml('order', '5'), 5);
  assert.equal(formValueToYaml('order', ''), '');
  assert.equal(formValueToYaml('draft', true), true);
  assert.equal(formValueToYaml('draft', false), '');
  assert.equal(formValueToYaml('toc', true), '');
  assert.equal(formValueToYaml('toc', false), false);
  assert.equal(formValueToYaml('title', ' T '), ' T ');
});

test('collectFormChanges only reports real changes', () => {
  const data = { title: 'A', description: '', tags: ['攻略'], order: 3, updated: '', draft: false, toc: true };
  assert.deepEqual(
    collectFormChanges(data, {
      title: 'A',
      description: '',
      tags: ['攻略'],
      order: 3,
      updated: '',
      draft: false,
      toc: true,
    }),
    {},
  );
  const changes = collectFormChanges(data, {
    title: 'B',
    description: '',
    tags: ['攻略', '建筑'],
    order: '',
    updated: '',
    draft: true,
    toc: false,
  });
  assert.deepEqual(changes, { title: 'B', tags: ['攻略', '建筑'], order: '', draft: true, toc: false });
  assert.equal(describeChanges(changes), '标题 / 分类 / 排序 / 草稿 / 目录');
});

test('toggleTag adds and removes without duplicates', () => {
  assert.deepEqual(toggleTag(['攻略'], '建筑'), ['攻略', '建筑']);
  assert.deepEqual(toggleTag(['攻略', '建筑'], '攻略'), ['建筑']);
  assert.deepEqual(toggleTag([], '攻略'), ['攻略']);
});
