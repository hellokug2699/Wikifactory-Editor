/**
 * Canonical content rules for Wikifactory.
 *
 * Source of truth: Wikifactory-Editor/app/assets/js/content-rules.js
 * Vendored byte-for-byte to Wikifactory-Content/scripts/content-rules.mjs so
 * the editor's pre-flight checks and the content gate cannot drift.
 *
 * No Node APIs and no dependencies: importable by the browser app, the content
 * validation script, and (via vendoring) the Core gate.
 *
 * Update flow:
 *   node scripts/rules-sync.mjs --write <Wikifactory-Content checkout>
 * The sync script also writes a checksum used by the content CI.
 */

export const RULES_VERSION = '1.1.0';

/** Top-level site paths that game directories must not shadow. */
export const RESERVED_PATHS = ['search', 'pagefind', '_astro', '404', 'about'];

/**
 * Canonical page categories (frontmatter `tags`).
 *
 * Distributed by the editor template; Content pages only store the value.
 * Adding a category requires an issue in the editor repository, after which
 * this list is updated and synced to Content / Core. `tone` is a design token
 * name used by Core and the editor preview (`accent | success | warning |
 * danger | neutral`).
 */
export const PAGE_TAGS = [
  { value: '攻略', label: '攻略', tone: 'accent', description: '玩法、流程与技巧' },
  { value: '建筑', label: '建筑', tone: 'warning', description: '建筑、设施与布局' },
  { value: '物品', label: '物品', tone: 'success', description: '物品、材料与道具' },
  { value: '制造', label: '制造', tone: 'success', description: '配方、生产线与自动化' },
  { value: '研究', label: '研究', tone: 'accent', description: '科技树、解锁与实验' },
  { value: '资源', label: '资源', tone: 'success', description: '矿产、采集与分布' },
  { value: '机制', label: '机制', tone: 'neutral', description: '系统规则与数值' },
  { value: '探索', label: '探索', tone: 'accent', description: '地图、区域与收集' },
  { value: '剧情', label: '剧情', tone: 'danger', description: '世界观、任务与背景' },
  { value: '更新', label: '更新', tone: 'warning', description: '版本变更与公告' },
];

export const PAGE_TAG_VALUES = PAGE_TAGS.map((tag) => tag.value);
const PAGE_TAG_SET = new Set(PAGE_TAG_VALUES);

/** Where contributors request a new page category. */
export const PAGE_TAG_ISSUE_URL =
  'https://github.com/hellokug2699/Wikifactory-Editor/issues/new?template=new-page-tag.yml';

export const PAGE_EXTENSIONS = ['.md', '.mdx'];
export const PAGE_EXT_RE = /\.(md|mdx)$/i;

/** Characters that break URLs or the filesystem. */
export const ILLEGAL_SEGMENT_CHARS = ['/', '\\', ':', '*', '?', '"', '<', '>', '|'];
export const CONTROL_RE = /[\u0000-\u001f\u007f]/;

/** Asset layout (config/thumbnails.json). */
export const ICON_DIR = 'assets/icons';
export const IMAGE_DIR = 'assets/images';
export const ICON_EXTENSIONS = ['svg', 'png', 'webp', 'jpg', 'jpeg', 'avif', 'gif'];
export const IMAGE_EXTENSIONS = ['png', 'jpg', 'jpeg', 'webp', 'avif', 'gif', 'svg'];
export const ICON_NAME_RE = /^[a-z0-9][a-z0-9._-]*$/i;

/** Date or ISO timestamp, matching the content gate. */
export const GATE_DATE_RE =
  /^\d{4}-\d{2}-\d{2}(?:[T ]\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})?)?$/;

/**
 * @param {string} name
 * @param {{isFile?: boolean}} [options]
 * @returns {string|null} problem description or null
 */
export function nameProblem(name, { isFile = false } = {}) {
  if (name.length === 0) return '名称为空';
  const bad = ILLEGAL_SEGMENT_CHARS.find((char) => name.includes(char));
  if (bad) return `包含非法字符 “${bad}”`;
  if (CONTROL_RE.test(name)) return '包含控制字符';
  if (name !== name.trim()) return '首尾含空白';
  if (name.startsWith('.')) return '以点开头';
  if (isFile) {
    const base = name.replace(PAGE_EXT_RE, '');
    if (base.length === 0) return '文件名为空';
    if (base.endsWith('.')) return '主文件名以点结尾';
  }
  return null;
}

/**
 * @param {string} value
 * @returns {boolean} true when the value is a real calendar date / ISO time
 */
export function isValidGateDate(value) {
  if (typeof value !== 'string' || !GATE_DATE_RE.test(value)) return false;
  if (Number.isNaN(Date.parse(value))) return false;
  const [year, month, day] = value.slice(0, 10).split('-').map(Number);
  if (month < 1 || month > 12) return false;
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return day >= 1 && day <= lastDay;
}

function typeOf(value) {
  return Array.isArray(value) ? 'array' : value === null ? 'null' : typeof value;
}

/**
 * Frontmatter field type checks shared by the editor and the gate.
 * `null` counts as "unset"; quoted values remain strings.
 *
 * @param {Record<string, unknown>} data flat frontmatter object
 * @returns {string[]} problems
 */
export function frontmatterTypeProblems(data) {
  const problems = [];
  if ('title' in data && data.title !== null && typeof data.title !== 'string') {
    problems.push(`"title" 必须是字符串（当前为 ${typeOf(data.title)}）`);
  }
  if ('description' in data && data.description !== null && typeof data.description !== 'string') {
    problems.push(`"description" 必须是字符串（当前为 ${typeOf(data.description)}）`);
  }
  if ('tags' in data && data.tags !== null) {
    if (!Array.isArray(data.tags)) {
      problems.push(`"tags" 必须是数组（当前为 ${typeOf(data.tags)}）`);
    } else if (data.tags.some((tag) => typeof tag !== 'string')) {
      problems.push('"tags" 的数组元素必须全部是字符串');
    }
  }
  if ('order' in data && data.order !== null && typeof data.order !== 'number') {
    problems.push(`"order" 必须是数字（当前为 ${typeOf(data.order)}）`);
  }
  if ('draft' in data && data.draft !== null && typeof data.draft !== 'boolean') {
    problems.push(`"draft" 必须是布尔值（当前为 ${typeOf(data.draft)}）`);
  }
  if ('toc' in data && data.toc !== null && typeof data.toc !== 'boolean') {
    problems.push(`"toc" 必须是布尔值（当前为 ${typeOf(data.toc)}）`);
  }
  if ('updated' in data && data.updated !== null && !isValidGateDate(data.updated)) {
    problems.push(`"updated" 必须是合法日期（YYYY-MM-DD 或 ISO 时间，当前为 ${JSON.stringify(data.updated)}）`);
  }
  return problems;
}

/**
 * Validate frontmatter `tags` against the canonical page-category template.
 * Type errors are reported separately by frontmatterTypeProblems.
 *
 * @param {unknown} tags
 * @returns {string[]} problems
 */
export function tagProblems(tags) {
  if (!Array.isArray(tags)) return [];
  const problems = [];
  const seen = new Set();
  for (const tag of tags) {
    if (typeof tag !== 'string') continue;
    if (!PAGE_TAG_SET.has(tag)) {
      problems.push(`未知页面分类 “${tag}”；新增分类请在 Wikifactory-Editor 提交 issue（${PAGE_TAG_ISSUE_URL}）`);
      continue;
    }
    if (seen.has(tag)) problems.push(`页面分类重复：“${tag}”`);
    seen.add(tag);
  }
  return problems;
}

/** Icon references may only contain letters / digits / . _ - and no "..". */
export function iconNameProblem(name) {
  if (!ICON_NAME_RE.test(name) || name.includes('..')) {
    return '图标名称不合法：只允许字母 / 数字 / . _ -';
  }
  return null;
}

export function iconPathFor(game, name, ext = ICON_EXTENSIONS[0]) {
  return `games/${game}/${ICON_DIR}/${name}.${ext}`;
}

/** Normalise a page id so "space vs %20" duplicates are detected. */
export function urlKeyOf(id) {
  try {
    return decodeURIComponent(encodeURI(id));
  } catch {
    return id;
  }
}

/**
 * Compare repository config files with this module. Used by the content gate
 * so config edits that drift from the shared rules fail CI instead of silently
 * diverging between Core, Content and Editor.
 */
export function rulesMatchConfig({ reserved = [], thumbnails = null } = {}) {
  const problems = [];
  const configured = (Array.isArray(reserved) ? reserved : [])
    .map((item) => (item && typeof item.path === 'string' ? item.path.trim().toLowerCase() : ''))
    .filter(Boolean)
    .sort();
  const expected = [...RESERVED_PATHS].map((path) => path.toLowerCase()).sort();
  if (configured.join('|') !== expected.join('|')) {
    problems.push(`config/reserved-paths.json 与共享规则不一致（期望 ${expected.join(' / ')}，实际 ${configured.join(' / ')}）`);
  }
  if (thumbnails && typeof thumbnails === 'object') {
    const icon = thumbnails.icon || {};
    if (icon.dir !== ICON_DIR) {
      problems.push(`config/thumbnails.json 的 icon.dir 应为 ${ICON_DIR}（当前 ${icon.dir}）`);
    }
    const extensions = Array.isArray(icon.extensions) ? icon.extensions : [];
    if (extensions.join(',') !== ICON_EXTENSIONS.join(',')) {
      problems.push(`config/thumbnails.json 的 icon.extensions 与共享规则不一致`);
    }
  }
  return problems;
}
