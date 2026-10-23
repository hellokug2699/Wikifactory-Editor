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

export const RULES_VERSION = '1.2.0';

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

/** Asset layout (config/thumbnails.json / config/wiki.json). */
export const ICON_DIR = 'assets/icons';
export const IMAGE_DIR = 'assets/images';
export const AUDIO_DIR = 'assets/audio';
export const ICON_EXTENSIONS = ['svg', 'png', 'webp', 'jpg', 'jpeg', 'avif', 'gif'];
export const IMAGE_EXTENSIONS = ['png', 'jpg', 'jpeg', 'webp', 'avif', 'gif', 'svg'];
export const AUDIO_EXTENSIONS = ['ogg'];
export const ICON_NAME_RE = /^[a-z0-9][a-z0-9._-]*$/i;

/** Audio markers only accept .ogg; names without an extension get `.ogg` appended. */
export function audioFileName(name) {
  const value = String(name || '').trim();
  if (!value) return '';
  if (/\.[a-z0-9]+$/i.test(value)) return value;
  return `${value}.ogg`;
}

/** Validate a normalized audio file name (must end in .ogg, safe characters). */
export function audioNameProblem(name) {
  const file = audioFileName(name);
  if (!file) return '音频名称为空';
  if (!/\.ogg$/i.test(file)) return '音频仅支持 .ogg 格式';
  if (!ICON_NAME_RE.test(file) || file.includes('..')) {
    return '音频名称只允许字母 / 数字 / . _ -';
  }
  return null;
}

export function audioPathFor(game, name) {
  return `games/${game}/${AUDIO_DIR}/${audioFileName(name)}`;
}

/** Parse `[[Audio/name.ogg|标题]]` (tail = everything after `Audio/`). */
export function parseAudioMarker(tail) {
  const pipe = tail.indexOf('|');
  const rawName = (pipe === -1 ? tail : tail.slice(0, pipe)).trim();
  const title = (pipe === -1 ? '' : tail.slice(pipe + 1).trim());
  if (!rawName) return null;
  const name = audioFileName(rawName);
  const problem = audioNameProblem(rawName);
  return { name, title, rawName, warning: problem || undefined };
}

/** Video/audio embed providers. Only these origins may be framed. */
export const EMBED_PROVIDERS = [
  { id: 'youtube', label: 'YouTube', origin: 'https://www.youtube.com' },
  { id: 'bilibili', label: '哔哩哔哩', origin: 'https://player.bilibili.com' },
  { id: 'vimeo', label: 'Vimeo', origin: 'https://player.vimeo.com' },
];

export const EMBED_ORIGINS = EMBED_PROVIDERS.map((provider) => provider.origin);

function httpsUrl(value) {
  try {
    const url = new URL(String(value || '').trim());
    return url.protocol === 'https:' ? url : null;
  } catch {
    return null;
  }
}

function youtubeEmbed(id) {
  return /^[A-Za-z0-9_-]{6,20}$/.test(id) ? `https://www.youtube.com/embed/${id}` : '';
}

function bilibiliEmbed(id) {
  if (!/^(?:BV[0-9A-Za-z]{8,14}|av\d+)$/i.test(id)) return '';
  const query = id.toLowerCase().startsWith('bv') ? `bvid=${id}` : `aid=${id.slice(2)}`;
  return `https://player.bilibili.com/player.html?${query}&autoplay=0`;
}

function vimeoEmbed(id) {
  return /^\d+$/.test(id) ? `https://player.vimeo.com/video/${id}` : '';
}

function youtubeIdFromUrl(url) {
  const host = url.hostname.replace(/^www\./i, '').toLowerCase();
  if (host === 'youtu.be') return url.pathname.split('/').filter(Boolean)[0] || '';
  if (host !== 'youtube.com' && host !== 'm.youtube.com') return '';
  if (url.pathname === '/watch') return url.searchParams.get('v') || '';
  const match = /^\/(?:shorts|embed|live)\/([A-Za-z0-9_-]+)/.exec(url.pathname);
  return match ? match[1] : '';
}

function bilibiliIdFromUrl(url) {
  if (!/(^|\.)bilibili\.com$/i.test(url.hostname)) return '';
  return /^\/video\/(BV[0-9A-Za-z]{8,14}|av\d+)/i.exec(url.pathname)?.[1] || '';
}

function vimeoIdFromUrl(url) {
  if (!/(^|\.)vimeo\.com$/i.test(url.hostname)) return '';
  const segment = url.pathname.split('/').filter(Boolean)[0] || '';
  return /^\d+$/.test(segment) ? segment : '';
}

/**
 * Resolve an author link (or `provider/id`) to an embed target.
 * @returns {{provider: string, id: string, value: string, embedUrl: string}|null}
 */
export function embedTarget(value) {
  const raw = String(value || '').trim();
  if (!raw) return null;

  const direct = /^(youtube|bilibili|vimeo)\/([A-Za-z0-9_-]+)$/i.exec(raw);
  if (direct) {
    const provider = direct[1].toLowerCase();
    const id = direct[2];
    const embedUrl = provider === 'youtube'
      ? youtubeEmbed(id)
      : provider === 'bilibili'
        ? bilibiliEmbed(id)
        : vimeoEmbed(id);
    return embedUrl ? { provider, id, value: `${provider}/${id}`, embedUrl } : null;
  }

  const url = httpsUrl(raw);
  if (!url) return null;
  const youtube = youtubeIdFromUrl(url);
  if (youtube && youtubeEmbed(youtube)) {
    return { provider: 'youtube', id: youtube, value: `youtube/${youtube}`, embedUrl: youtubeEmbed(youtube) };
  }
  const bilibili = bilibiliIdFromUrl(url);
  if (bilibili && bilibiliEmbed(bilibili)) {
    return { provider: 'bilibili', id: bilibili, value: `bilibili/${bilibili}`, embedUrl: bilibiliEmbed(bilibili) };
  }
  const vimeo = vimeoIdFromUrl(url);
  if (vimeo && vimeoEmbed(vimeo)) {
    return { provider: 'vimeo', id: vimeo, value: `vimeo/${vimeo}`, embedUrl: vimeoEmbed(vimeo) };
  }
  return null;
}

/** Parse `[[Embed/youtube/ID|标题]]` (tail = everything after `Embed/`). */
export function parseEmbedMarker(tail) {
  const pipe = tail.indexOf('|');
  const target = (pipe === -1 ? tail : tail.slice(0, pipe)).trim();
  const title = (pipe === -1 ? '' : tail.slice(pipe + 1).trim());
  if (!target) return null;
  const resolved = embedTarget(target);
  const isUrl = /^https?:\/\//i.test(target);
  return {
    target,
    title,
    provider: resolved?.provider,
    embedUrl: resolved?.embedUrl,
    value: resolved?.value,
    warning: !resolved
      ? '不支持的嵌入来源；请使用 youtube/ID、bilibili/BV号 或 vimeo/ID'
      : isUrl
        ? '请使用 youtube/ID、bilibili/BV号 或 vimeo/ID 形式（避免链接被自动识别为普通链接）'
        : undefined,
  };
}

/** True when a URL may be used as an iframe src (defensive post-sanitize check). */
export function isAllowedEmbedUrl(value) {
  try {
    const url = new URL(String(value || ''));
    return EMBED_ORIGINS.includes(url.origin);
  } catch {
    return false;
  }
}

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
