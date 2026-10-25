/** PR template helpers (pure, unit-tested). */
import { diffLines, diffStats, collapsedDiff } from './diff.js';
import { basename, slugify, stripExt } from './state.js';

export const PR_TYPES = [
  { id: 'new', label: '新增页面', commitPrefix: 'content: 新增' },
  { id: 'edit', label: '修改内容', commitPrefix: 'content: 更新' },
  { id: 'fix', label: '修复引用', commitPrefix: 'content: 修复引用' },
];

export function prTypeOf(id) {
  return PR_TYPES.find((type) => type.id === id) || PR_TYPES[1];
}

/** Repository label applied after the PR is created (matches the template). */
export function prLabelOf(type) {
  return prTypeOf(type).id === 'new' ? '新增' : '改进';
}

/** Line diff between the content loaded from GitHub and the current editor state. */
export function buildPrDiff({ before, after, loadedPath = '', path = '' }) {
  const ops = diffLines(before, after);
  const stats = diffStats(ops);
  const rows = collapsedDiff(ops);
  const pathNote = loadedPath && loadedPath !== path ? `路径变更：${loadedPath} → ${path}；差异仅比较文档内容。` : '';
  return { stats, rows, pathNote, empty: rows.length === 0 };
}

/** Text PR body generated on the editor side (matches PULL_REQUEST_TEMPLATE.md). */
export function buildPrBody({ type, note, path, assetPaths = [], summary = {}, diff = {} }) {
  const preset = prTypeOf(type);
  return [
    '## 变更类型',
    '',
    `- [x] ${prLabelOf(type)}`,
    '',
    `> 具体变更：${preset.label}`,
    '',
    '## 说明',
    '',
    note || '（待填写）',
    '',
    '## 变更文件',
    '',
    `- \`${path}\``,
    ...assetPaths.map((asset) => `- \`${asset}\`（新增 / 更新资源）`),
    '',
    '## 自查',
    '',
    `- [x] 编辑器检查：${summary.errors ?? 0} 错误，${summary.warnings ?? 0} 警告`,
    `- [x] 内容差异：+${diff.added ?? 0} / −${diff.removed ?? 0} 行`,
    '- [ ] 已在预览中确认排版',
    '- [ ] 引用站外内容已注明来源与许可协议',
    '',
    '## 许可声明',
    '',
    '无（如包含站外内容，请改为：来源链接 · 原许可协议 · 是否允许再用）',
    '',
    '由 Wikifactory Editor 提交。Content 仓库不要求分支与 base 保持 up-to-date。',
  ].join('\n');
}

/** Default PR title / commit message for a page + type. */
export function prHeadline(type, pageTitle) {
  return `${prTypeOf(type).commitPrefix} ${pageTitle}`;
}

/** `wfe/<page>-MMDDHHmm`, matching the previous behaviour. */
export function defaultBranchName(path, date = new Date()) {
  const stamp = date.toISOString().slice(5, 16).replace(/[-:T]/g, '');
  return `wfe/${slugify(stripExt(basename(path)))}-${stamp}`;
}

/** `page-YYYYMMDD-a1b2c3` suggestion used when a branch name is taken. */
export function uniqueBranchSuggestion(path, avoid = '', random = Math.random) {
  const stem = slugify(stripExt(basename(path)) || 'page');
  const date = new Date().toISOString().slice(0, 10).replaceAll('-', '');
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const hash = random().toString(16).slice(2, 8);
    const name = `${stem}-${date}-${hash}`;
    if (name !== avoid) return name;
  }
  return `${stem}-${date}-${Date.now().toString(16).slice(-6)}`;
}
