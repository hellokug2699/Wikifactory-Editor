/**
 * Batch operations (pure): multi-page rename planning and internal link rewrite.
 *
 * A rename produces the new repo paths; `rewritePageLinks` keeps `[[…]]`
 * references pointing at the renamed page. The editor can only rewrite links
 * inside files it can read, so the UI limits the scan to the edited pages plus
 * the same game folder.
 */

const PAGE_EXT_RE = /\.(md|mdx)$/i;
const RESERVED_LINK_RE = /^(?:File|Image|文件|Audio|Embed)\s*[/\\:：]/i;

export function pageIdOf(path) {
  const value = String(path || '').replace(/^\/+/, '');
  if (!value.startsWith('games/') || !PAGE_EXT_RE.test(value)) return '';
  return value.slice('games/'.length).replace(PAGE_EXT_RE, '');
}

export function gameOf(pageId) {
  return String(pageId || '').split('/')[0] || '';
}

/** Keep the folder, replace the file stem: `games/A/B/Old.md` + `New` → `games/A/B/New.md`. */
export function renamePagePath(path, newName) {
  const value = String(path || '').replace(/^\/+/, '');
  if (!PAGE_EXT_RE.test(value)) return '';
  const dir = value.slice(0, value.lastIndexOf('/'));
  const ext = value.slice(value.lastIndexOf('.'));
  const name = String(newName || '')
    .trim()
    .replace(PAGE_EXT_RE, '');
  if (!name) return '';
  return `${dir}/${name}${ext}`;
}

/**
 * @param {object} options
 * @param {string} options.from current repo path
 * @param {string} options.to new repo path
 * @param {string[]} [options.repoPaths] existing tree (for conflict checks)
 * @returns {{ok:boolean, from:string, to:string, error?:string, unchanged?:boolean}}
 */
export function planRename({ from, to, repoPaths = [] }) {
  const source = String(from || '').replace(/^\/+/, '');
  const target = String(to || '').replace(/^\/+/, '');
  if (!source || !PAGE_EXT_RE.test(source)) return { ok: false, from: source, to: target, error: '源路径不是页面' };
  if (!target || !PAGE_EXT_RE.test(target)) return { ok: false, from: source, to: target, error: '目标路径不是页面' };
  if (source === target) return { ok: true, from: source, to: target, unchanged: true };
  if (target.includes('..') || target.startsWith('/')) {
    return { ok: false, from: source, to: target, error: '目标路径不合法' };
  }
  const lower = target.toLowerCase();
  if (repoPaths.some((path) => path !== source && path.toLowerCase() === lower)) {
    return { ok: false, from: source, to: target, error: `目标已存在：${target}` };
  }
  return { ok: true, from: source, to: target };
}

function maskCode(text) {
  return String(text || '')
    .replace(/```[\s\S]*?```/g, (block) => block.replace(/[^\n]/g, ' '))
    .replace(/~~~[\s\S]*?~~~/g, (block) => block.replace(/[^\n]/g, ' '))
    .replace(/(`+)[\s\S]*?\1/g, (span) => span.replace(/[^\n]/g, ' '));
}

function linkKey(value) {
  return String(value || '')
    .normalize('NFC')
    .toLowerCase();
}

/**
 * Rewrite `[[OldId]]`, `[[OldId|文字]]`, `[[OldSlug#锚点]]` to the new page.
 * Code fences and inline code are left untouched.
 *
 * @param {string} text page body
 * @param {{fromId:string, toId:string}} options
 * @returns {{text:string, changed:boolean, replacements:number}}
 */
export function rewritePageLinks(text, { fromId, toId }) {
  const source = String(text ?? '');
  if (!fromId || !toId || fromId === toId) return { text: source, changed: false, replacements: 0 };
  // maskCode() blanks code spans without changing length, so match offsets in
  // the masked copy map 1:1 onto the original text.
  const masked = maskCode(source);
  const fromKey = linkKey(fromId);
  const fromSlug = linkKey(fromId.split('/').pop());
  const toSlug = toId.split('/').pop();
  let replacements = 0;
  let last = 0;
  let output = '';

  for (const match of masked.matchAll(/\[\[([^[\]\n]+)\]\]/g)) {
    const inner = match[1];
    if (RESERVED_LINK_RE.test(inner)) continue;
    const pipe = inner.indexOf('|');
    const head = (pipe === -1 ? inner : inner.slice(0, pipe)).trim();
    const label = pipe === -1 ? '' : inner.slice(pipe);
    const hash = head.indexOf('#');
    const target = (hash === -1 ? head : head.slice(0, hash)).trim();
    const anchor = hash === -1 ? '' : head.slice(hash);
    if (!target) continue;
    const key = linkKey(target);
    const isFull = key === fromKey;
    const isSlug = !target.includes('/') && key === fromSlug;
    if (!isFull && !isSlug) continue;
    output += source.slice(last, match.index);
    output += `[[${isFull ? toId : toSlug}${anchor}${label}]]`;
    last = match.index + match[0].length;
    replacements += 1;
  }

  if (!replacements) return { text: source, changed: false, replacements: 0 };
  output += source.slice(last);
  return { text: output, changed: output !== source, replacements };
}

/** Files that plausibly reference the renamed page: the page itself + its game folder. */
export function linkScanTargets({ renamedIds = [], repoPaths = [], extra = [] }) {
  const games = new Set(renamedIds.map((id) => gameOf(id)));
  const out = new Set();
  for (const path of repoPaths) {
    if (!PAGE_EXT_RE.test(path)) continue;
    if (extra.includes(path)) out.add(path);
    const id = pageIdOf(path);
    if (!id) continue;
    if (games.has(gameOf(id))) out.add(path);
  }
  return [...out].sort();
}

export function renameSummary(plan) {
  const changed = plan.filter((item) => item.ok && !item.unchanged);
  const failed = plan.filter((item) => !item.ok);
  const parts = [];
  if (changed.length) parts.push(`${changed.length} 个页面重命名`);
  if (failed.length) parts.push(`${failed.length} 个失败`);
  return parts.join('，') || '没有可执行的修改';
}
