/**
 * Batch operations (pure): multi-page rename planning and internal link rewrite.
 *
 * A rename produces the new repo paths; `rewritePageLinks` keeps `[[…]]`
 * references pointing at the renamed page. The editor can only rewrite links
 * inside files it can read, so the UI limits the scan to the edited pages plus
 * the same game folder.
 */
import { RESERVED_PATHS, nameProblem } from './content-rules.js';

const PAGE_EXT_RE = /\.(md|mdx)$/i;
const RESERVED_LINK_RE = /^(?:File|Image|文件|Audio|Embed)\s*[/\\:：]/i;
const BAD_SEGMENT_RE = /[\\:*?"<>|\u0000-\u001f]/;
const PAGE_DEPTH = 4;

/** Page URL without the extension: `games/A/B/MAM.md` → `games/A/B/MAM`. */
function pageUrl(path) {
  return String(path || '')
    .replace(PAGE_EXT_RE, '')
    .toLowerCase();
}

/** Reuse the shared naming rules; returns a problem string or ''. */
function pathProblem(path) {
  const value = String(path || '');
  if (!value.startsWith('games/')) return '目标必须位于 games/ 下';
  if (value.startsWith('/')) return '目标不能以 / 开头';
  const segments = value.split('/');
  if (segments.length < PAGE_DEPTH) return '层级不足：应为 games/<游戏>/<分类>/…/<页面>.md';
  for (const segment of segments) {
    if (!segment || segment === '.' || segment === '..') return '目标路径包含空段或点段';
    if (BAD_SEGMENT_RE.test(segment)) return `目标路径包含非法字符：${segment}`;
    const problem = nameProblem(segment, { isFile: segment === segments[segments.length - 1] });
    if (problem) return problem;
  }
  if (RESERVED_PATHS.includes(segments[1].toLowerCase())) return `游戏目录名与保留路径冲突：${segments[1]}`;
  const ext = segments[segments.length - 1].split('.').pop();
  if (ext !== ext.toLowerCase()) return '扩展名必须小写';
  return '';
}

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
  // A rename changes the stem only; separators would silently create folders.
  if (!name || /[\\/]/.test(name)) return '';
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
  if (!target) return { ok: false, from: source, to: target, error: '目标文件名为空或包含 / \\' };
  if (!PAGE_EXT_RE.test(target)) return { ok: false, from: source, to: target, error: '目标路径不是页面' };
  if (source === target) return { ok: true, from: source, to: target, unchanged: true };
  const problem = pathProblem(target);
  if (problem) return { ok: false, from: source, to: target, error: problem };
  const lower = target.toLowerCase();
  if (repoPaths.some((path) => path !== source && path.toLowerCase() === lower)) {
    return { ok: false, from: source, to: target, error: `目标已存在：${target}` };
  }
  // `.md` and `.mdx` share one URL on the site: renaming across them still collides.
  const url = pageUrl(target);
  if (repoPaths.some((path) => path !== source && pageUrl(path) === url)) {
    return { ok: false, from: source, to: target, error: `与现有页面 URL 冲突（扩展名不同）：${target}` };
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

/** Normalize a link target the way Core does (`normalizePath` + NFC + lowercase). */
function normalizeTarget(value) {
  return String(value || '')
    .trim()
    .replace(/^\/+/, '')
    .replace(/\/+$/, '');
}

/**
 * Build a resolver that mirrors Core's `resolveWikiTarget` precedence
 * (`src/lib/wiki-index.ts`):
 *
 *   1. full page id (exact, then case / NFC-insensitive)
 *   2. game id
 *   3. category key (`<game>/<category>` or a bare category in the current game)
 *   4. unique title / file name inside the current game, then globally
 *   5. alias (not available to the editor)
 *
 * The editor only knows repository paths, so step 4 uses slugs only. Renames
 * never change frontmatter titles, so title-based links keep resolving and do
 * not need rewriting. Anything the resolver cannot pin down is reported as
 * `ambiguous` / `unknown` and left untouched.
 *
 * @param {{repoPaths?: string[]}} options
 */
export function buildLinkIndex({ repoPaths = [] } = {}) {
  const byId = new Map();
  const byIdKey = new Map();
  const bySlug = new Map();
  const games = new Map();
  const categories = new Map();

  for (const rawPath of repoPaths) {
    const id = pageIdOf(rawPath);
    if (!id) continue;
    const segments = id.split('/');
    const gameId = segments[0];
    if (!gameId || segments.length < 2) continue;
    const page = { id, gameId, slug: segments[segments.length - 1] };
    byId.set(id, page);
    byIdKey.set(linkKey(id), page);
    const slugKey = linkKey(page.slug);
    if (!bySlug.has(slugKey)) bySlug.set(slugKey, []);
    bySlug.get(slugKey).push(page);
    games.set(linkKey(gameId), gameId);
    const categoryId = segments[1];
    if (categoryId) {
      categories.set(linkKey(`${gameId}/${categoryId}`), { gameId, id: categoryId });
    }
  }

  return {
    /**
     * @param {string} rawTarget link target without anchor
     * @param {string} currentGameId game of the page containing the link
     * @returns {{kind:'page',id:string}|{kind:'game',id:string}|{kind:'category',id:string}|{kind:'ambiguous',candidates:string[]}|{kind:'unknown'}}
     */
    resolve(rawTarget, currentGameId = '') {
      const target = normalizeTarget(rawTarget);
      const key = linkKey(target);
      if (!key) return { kind: 'unknown' };

      const page = byId.get(target) || byIdKey.get(key);
      if (page) return { kind: 'page', id: page.id };

      const game = games.get(key);
      if (game) return { kind: 'game', id: game };

      const category =
        (currentGameId ? categories.get(linkKey(`${currentGameId}/${target}`)) : undefined) ?? categories.get(key);
      if (category) return { kind: 'category', id: `${category.gameId}/${category.id}` };

      const candidates = bySlug.get(key) || [];
      const sameGame = currentGameId ? candidates.filter((candidate) => candidate.gameId === currentGameId) : [];
      if (sameGame.length === 1) return { kind: 'page', id: sameGame[0].id };
      if (candidates.length === 1) return { kind: 'page', id: candidates[0].id };
      if (candidates.length > 1) return { kind: 'ambiguous', candidates: candidates.map((item) => item.id) };
      return { kind: 'unknown' };
    },
  };
}

/**
 * Rewrite `[[OldId]]`, `[[OldId|文字]]`, `[[OldSlug#锚点]]` to the new page.
 * Code fences and inline code are left untouched.
 *
 * Short links are resolved with the same precedence as Core before rewriting,
 * so a slug shared by two pages never redirects the wrong reference. Without
 * `index` only full page ids are rewritten.
 *
 * @param {string} text page body
 * @param {{fromId:string, toId:string, currentGameId?:string, index?:object}} options
 * @returns {{text:string, changed:boolean, replacements:number, unresolved:Array<{target:string,candidates:string[]}>}}
 */
export function rewritePageLinks(text, { fromId, toId, currentGameId = '', index = null }) {
  const source = String(text ?? '');
  if (!fromId || !toId || fromId === toId) {
    return { text: source, changed: false, replacements: 0, unresolved: [] };
  }
  // maskCode() blanks code spans without changing length, so match offsets in
  // the masked copy map 1:1 onto the original text.
  const masked = maskCode(source);
  const fromKey = linkKey(fromId);
  const toSlug = toId.split('/').pop();
  let replacements = 0;
  let last = 0;
  let output = '';
  const unresolved = [];

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

    let nextTarget;
    if (index) {
      const resolved = index.resolve(target, currentGameId);
      if (resolved.kind === 'page') {
        if (linkKey(resolved.id) !== fromKey) continue;
        nextTarget = target.includes('/') ? toId : toSlug;
      } else if (resolved.kind === 'ambiguous') {
        if (resolved.candidates.some((id) => linkKey(id) === fromKey)) {
          unresolved.push({ target, candidates: resolved.candidates });
        }
        continue;
      } else {
        continue;
      }
    } else {
      // No index: only an exact full id is unambiguous.
      if (!target.includes('/') || linkKey(target) !== fromKey) continue;
      nextTarget = toId;
    }

    output += source.slice(last, match.index);
    output += `[[${nextTarget}${anchor}${label}]]`;
    last = match.index + match[0].length;
    replacements += 1;
  }

  if (!replacements) return { text: source, changed: false, replacements: 0, unresolved };
  output += source.slice(last);
  return { text: output, changed: output !== source, replacements, unresolved };
}

/**
 * Files that may reference the renamed pages.
 *
 * `scope: 'game'` keeps the scan inside the affected game folders (fast but
 * cannot see cross-game references); `scope: 'all'` scans every page.
 */
export function linkScanTargets({ renamedIds = [], repoPaths = [], extra = [], scope = 'game' }) {
  const games = new Set(renamedIds.map((id) => gameOf(id)));
  const out = new Set();
  for (const path of repoPaths) {
    if (!PAGE_EXT_RE.test(path)) continue;
    if (extra.includes(path)) {
      out.add(path);
      continue;
    }
    if (scope === 'all') {
      out.add(path);
      continue;
    }
    const id = pageIdOf(path);
    if (!id) continue;
    if (games.has(gameOf(id))) out.add(path);
  }
  return [...out].sort();
}

/**
 * Describe how complete a link scan was.
 *
 * The dangerous state is a partial scan the contributor believes to be
 * complete, so every gap is listed explicitly.
 *
 * @returns {{status:'complete'|'partial', complete:boolean, problems:string[], planned:number, scanned:number}}
 */
export function scanCoverage({
  scope = 'game',
  planned = 0,
  scanned = 0,
  failed = [],
  truncated = 0,
  unresolved = [],
} = {}) {
  const problems = [];
  if (scope === 'self') problems.push('未扫描引用页面：已关闭「同时更新引用这些页面的站内链接」');
  else if (scope !== 'all') problems.push('只扫描了被重命名页面所属的游戏目录，跨游戏引用未检查');
  if (truncated > 0) problems.push(`${truncated} 个页面超出单次扫描上限，未读取`);
  if (failed.length)
    problems.push(`${failed.length} 个页面读取失败：${failed.slice(0, 5).join('、')}${failed.length > 5 ? '…' : ''}`);
  if (unresolved.length) {
    problems.push(`${unresolved.length} 处短链接无法唯一确定目标，已保留原样`);
  }
  return {
    status: problems.length ? 'partial' : 'complete',
    complete: problems.length === 0,
    problems,
    planned,
    scanned,
  };
}

export function renameSummary(plan) {
  const changed = plan.filter((item) => item.ok && !item.unchanged);
  const failed = plan.filter((item) => !item.ok);
  const parts = [];
  if (changed.length) parts.push(`${changed.length} 个页面重命名`);
  if (failed.length) parts.push(`${failed.length} 个失败`);
  return parts.join('，') || '没有可执行的修改';
}
