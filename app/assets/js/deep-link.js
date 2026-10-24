/**
 * Deep link parsing (pure): turn `wikifactory.top` page URLs, the
 * `wikifactory-editor://` scheme and plain repo paths into content paths.
 *
 * Used by the Android shell (`__WFE__.openDeepLink`) and by the web build
 * (`?path=` on startup).
 */

export const SITE_HOSTS = ['wikifactory.top', 'www.wikifactory.top'];
export const APP_SCHEME = 'wikifactory-editor';

const PAGE_EXT_RE = /\.(md|mdx)$/i;
const ASSET_EXT_RE = /\.(png|jpe?g|webp|avif|gif|svg|ogg)$/i;
const UNSAFE_SEGMENT_RE = /[\\\u0000-\u001f]/;

function decode(value) {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function cleanPath(value) {
  return decode(String(value || ''))
    .trim()
    .replace(/^\/+/, '')
    .replace(/\/{2,}/g, '/');
}

/** Dot segments would let a crafted link escape `games/` inside the repo. */
export function isSafeContentPath(path) {
  const value = String(path || '');
  if (!value || UNSAFE_SEGMENT_RE.test(value)) return false;
  return value.split('/').every((segment) => segment && segment !== '.' && segment !== '..');
}

/**
 * Add the page extension and normalise a repo path.
 * `games/A/B/Page/` → `games/A/B/Page.md`
 * Returns '' for empty or unsafe input.
 */
export function normalizeContentPath(value) {
  const path = cleanPath(value).replace(/\/+$/, '');
  if (!path || !isSafeContentPath(path)) return '';
  if (PAGE_EXT_RE.test(path) || ASSET_EXT_RE.test(path)) return path;
  return `${path}.md`;
}

function kindOf(path) {
  return ASSET_EXT_RE.test(path) ? 'asset' : 'page';
}

/**
 * @param {string} input URL, custom scheme link, repo path or `?path=` value
 * @returns {{ok: boolean, path: string, kind: 'page'|'asset', reason?: string}}
 */
export function parseDeepLink(input) {
  const raw = String(input || '').trim();
  if (!raw) return { ok: false, path: '', kind: 'page', reason: '空链接' };

  // Bare repo path (also what the site passes as ?path=).
  if (!/^[a-z][a-z0-9+.-]*:/i.test(raw)) {
    const path = normalizeContentPath(raw);
    if (!path) {
      return { ok: false, path: '', kind: 'page', reason: '路径包含不安全片段' };
    }
    if (!path.startsWith('games/')) {
      return { ok: false, path: '', kind: 'page', reason: '只支持 games/ 下的页面或资源' };
    }
    return { ok: true, path, kind: kindOf(path) };
  }

  let url;
  try {
    url = new URL(raw);
  } catch {
    return { ok: false, path: '', kind: 'page', reason: '无法解析的链接' };
  }

  if (url.protocol === `${APP_SCHEME}:`) {
    const explicit = url.searchParams.get('path') || url.hash.replace(/^#/, '');
    if (!explicit) return { ok: false, path: '', kind: 'page', reason: '链接缺少 path 参数' };
    return parseDeepLink(explicit);
  }

  if (!['https:', 'http:'].includes(url.protocol)) {
    return { ok: false, path: '', kind: 'page', reason: '不支持的协议' };
  }
  if (!SITE_HOSTS.includes(url.hostname.toLowerCase())) {
    return { ok: false, path: '', kind: 'page', reason: `不是 ${SITE_HOSTS[0]} 的链接` };
  }

  const explicit = url.searchParams.get('path');
  if (explicit) return parseDeepLink(explicit);

  const path = normalizeContentPath(url.pathname);
  if (!path) {
    return { ok: false, path: '', kind: 'page', reason: '路径包含不安全片段' };
  }
  if (!path.startsWith('games/')) {
    return { ok: false, path: '', kind: 'page', reason: '链接不是内容页面（缺少 games/ 路径）' };
  }
  return { ok: true, path, kind: kindOf(path) };
}

/** Canonical site URL for a repo path (`games/A/B/P.md` → `/games/A/B/P/`). */
export function siteUrlFor(path, { host = SITE_HOSTS[0], scheme = 'https' } = {}) {
  const clean = cleanPath(path).replace(PAGE_EXT_RE, '');
  const segments = clean.split('/');
  const last = segments.pop();
  return `${scheme}://${host}/${[...segments, last].join('/')}/`;
}

/** `wikifactory-editor://open?path=…` for docs and tests. */
export function appLinkFor(path) {
  return `${APP_SCHEME}://open?path=${encodeURIComponent(normalizeContentPath(path))}`;
}

/** Path suggested for an imported external Markdown file (Android "open with"). */
export function importedPagePath(fileName, fallbackGame = 'Example') {
  const base = String(fileName || '')
    .replace(/^.*[\\/]/, '')
    .replace(PAGE_EXT_RE, '');
  const stem = base.replace(/[^\w\u4e00-\u9fa5._-]+/g, '-').replace(/^[-_.]+|[-_.]+$/g, '') || 'Imported';
  return `games/${fallbackGame}/Imported/${stem}.md`;
}
