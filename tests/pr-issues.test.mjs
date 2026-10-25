import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dedupeIssues, issueCounts, issuesForEditor, jumpTarget, toDiagnostics } from '../app/assets/js/issues.js';
import {
  buildPrBody,
  buildPrDiff,
  defaultBranchName,
  prHeadline,
  prLabelOf,
  prTypeOf,
  PR_TYPES,
  uniqueBranchSuggestion,
} from '../app/assets/js/pr.js';

test('PR template includes required sections and the note', () => {
  const body = buildPrBody({
    type: 'fix',
    note: '修正 MAM 链接',
    path: 'games/Satisfactory/Buildings/MAM.md',
    assetPaths: ['games/Satisfactory/assets/images/mam.png'],
    summary: { errors: 0, warnings: 2 },
    diff: { added: 3, removed: 1 },
  });
  assert.ok(body.includes('## 变更类型'));
  assert.ok(body.includes('- [x] 改进'));
  assert.ok(body.includes('具体变更：修复引用'));
  assert.ok(body.includes('修正 MAM 链接'));
  assert.ok(body.includes('`games/Satisfactory/Buildings/MAM.md`'));
  assert.ok(body.includes('mam.png'));
  assert.ok(body.includes('0 错误，2 警告'));
  assert.ok(body.includes('+3 / −1 行'));
  assert.ok(body.includes('## 许可声明'));
  assert.ok(body.includes('引用站外内容已注明来源与许可协议'));
  assert.ok(!body.includes('（待填写）'));
});

test('PR type + headline helpers', () => {
  assert.equal(PR_TYPES.length, 3);
  assert.equal(prTypeOf('nope').id, 'edit');
  assert.equal(prHeadline('new', 'MAM'), 'content: 新增 MAM');
  assert.equal(prHeadline('fix', 'MAM'), 'content: 修复引用 MAM');
});

test('repository labels match the template', () => {
  assert.equal(prLabelOf('new'), '新增');
  assert.equal(prLabelOf('edit'), '改进');
  assert.equal(prLabelOf('fix'), '改进');
  assert.equal(prLabelOf('unknown'), '改进');
});

test('branch names are deterministic for a given date', () => {
  const date = new Date('2026-10-24T03:04:05Z');
  assert.equal(defaultBranchName('games/A/B/My-Page.md', date), 'wfe/My-Page-10240304');
  let call = 0;
  const random = () => {
    call += 1;
    return 0.123456 + call / 1000;
  };
  const suggestion = uniqueBranchSuggestion('games/A/B/My-Page.md', 'taken', random);
  assert.match(suggestion, /^My-Page-\d{8}-[0-9a-f]{6}$/);
  assert.notEqual(suggestion, 'taken');
});

test('diff stats and rows are computed from loaded vs current text', () => {
  const diff = buildPrDiff({
    before: 'a\nb\n',
    after: 'a\nB\nc\n',
    loadedPath: 'games/A/B/Old.md',
    path: 'games/A/B/New.md',
  });
  assert.deepEqual(diff.stats, { added: 2, removed: 1 });
  assert.ok(diff.pathNote.includes('Old.md'));
  assert.ok(diff.rows.some((row) => row.type === 'add' && row.text === 'c'));
  assert.equal(diff.empty, false);
});

test('issue grouping and diagnostics mapping', () => {
  const issues = [
    { severity: 'error', message: 'e1', line: 2, source: 'body' },
    { severity: 'warn', message: 'w1', line: 4, source: 'repo' },
    { severity: 'error', message: 'f1', line: 1, source: 'frontmatter' },
    { severity: 'warn', message: 'p1', source: 'path' },
    { severity: 'warn', message: 'w1', line: 4, source: 'repo' },
  ];
  assert.equal(issuesForEditor(issues, 'body').length, 4);
  assert.equal(issuesForEditor(issues, 'frontmatter').length, 1);
  assert.deepEqual(issueCounts(issues), { errors: 2, warnings: 3, total: 5 });
  assert.equal(dedupeIssues(issues).length, 4);

  const diagnostics = toDiagnostics(issuesForEditor(issues, 'body'), (line) => ({
    from: line * 10,
    to: line * 10 + 5,
  }));
  assert.equal(diagnostics.length, 2);
  assert.deepEqual(diagnostics[0], {
    from: 20,
    to: 25,
    severity: 'error',
    message: 'e1',
    source: 'wikifactory',
  });
  assert.deepEqual(jumpTarget({ source: 'frontmatter', line: 3 }), { editor: 'frontmatter', line: 3 });
  assert.deepEqual(jumpTarget(null), { editor: 'body', line: 1 });
});
