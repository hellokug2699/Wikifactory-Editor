/** Persistent application state and small utilities. Content-only editor. */

const STORAGE_KEY = 'wikifactory-editor:v2';

/** The editor is deliberately hard-wired to the public Content repository. */
export const CONTENT_OWNER = 'hellokug2699';
export const CONTENT_REPO = 'Wikifactory-Content';

export function defaultState() {
  return {
    version: 3,
    theme: 'auto',
    settings: {
      branch: '',
      fontSize: 14.5,
      wrap: true,
      rememberToken: true,
      templates: {
        tableCell: '',
        imageStyle: 'wiki',
        imageTemplate: '[[File/{name}|{opts}]]',
      },
    },
    content: {
      path: 'games/Example/Guides/New-Page.md',
      fmRaw: '',
      body: '',
      loadedSha: null,
      loadedPath: '',
      ref: '',
      lastSaved: 0,
      editorTab: 'body',
    },
  };
}

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function mergeDeep(base, patch) {
  if (!isObject(base) || !isObject(patch)) return patch === undefined ? base : patch;
  const out = { ...base };
  for (const [key, value] of Object.entries(patch)) {
    if (isObject(value) && isObject(base[key])) out[key] = mergeDeep(base[key], value);
    else if (value !== undefined) out[key] = value;
  }
  return out;
}

/** Migrate the 1.0.0 state shape (which also had Core/Alias drafts) to v2. */
function migrate(parsed) {
  const base = defaultState();
  const merged = mergeDeep(base, parsed);
  delete merged.core;
  delete merged.alias;
  delete merged.lastMode;
  delete merged.recent;
  if (merged.settings) {
    delete merged.settings.repos;
    delete merged.settings.owner;
    // Legacy plaintext tokens are always dropped; the encrypted store replaces them.
    delete merged.settings.token;
    if (typeof merged.settings.rememberToken !== 'boolean') merged.settings.rememberToken = true;
  }
  merged.version = 3;
  if (!['body', 'frontmatter'].includes(merged.content?.editorTab)) merged.content.editorTab = 'body';
  if (!['light', 'dark', 'auto'].includes(merged.theme)) merged.theme = 'auto';
  return merged;
}

export function loadState() {
  try {
    let raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      // One-time import from the 1.0.0 key, limited to the Content draft.
      const legacy = localStorage.getItem('wikifactory-editor:v1');
      if (legacy) raw = legacy;
    }
    if (!raw) return defaultState();
    const migrated = migrate(JSON.parse(raw));
    // Scrub any token left by older versions immediately; tokens are session-only now.
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(storageSafe(migrated)));
      localStorage.removeItem('wikifactory-editor:v1');
    } catch {
      // Ignore storage errors; the in-memory state still has no token.
    }
    return migrated;
  } catch (error) {
    console.warn('[state] 无法读取本地草稿', error);
    return defaultState();
  }
}

function storageSafe(state) {
  const serializable = {
    ...state,
    settings: { ...state.settings },
  };
  delete serializable.settings.token;
  return serializable;
}

export function saveState(state) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(storageSafe(state)));
    localStorage.removeItem('wikifactory-editor:v1');
    return true;
  } catch (error) {
    console.warn('[state] 本地保存失败', error);
    return false;
  }
}

export function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

export function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function formatTime(ts) {
  if (!ts) return '';
  return new Date(ts).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
}

export function formatBytes(bytes) {
  if (!bytes) return '0 B';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}

export function basename(path) {
  return String(path || '').split('/').filter(Boolean).pop() || '';
}

export function dirname(path) {
  const parts = String(path || '').split('/').filter(Boolean);
  parts.pop();
  return parts.join('/');
}

export function stripExt(path) {
  const name = basename(path);
  const index = name.lastIndexOf('.');
  return index > 0 ? name.slice(0, index) : name;
}

export function slugify(value, fallback = 'page') {
  const slug = String(value || '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9\u4e00-\u9fa5._-]+/g, '-')
    .replace(/^[-_.]+|[-_.]+$/g, '')
    .replace(/-{2,}/g, '-')
    .slice(0, 64);
  return slug || fallback;
}

export function downloadText(filename, text, mime = 'text/plain;charset=utf-8') {
  const blob = new Blob([text], { type: mime });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

export function base64FromBytes(bytes) {
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

export function utf8ToBase64(text) {
  return base64FromBytes(new TextEncoder().encode(text));
}

export function base64ToUtf8(base64) {
  const binary = atob(String(base64).replace(/\s/g, ''));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return new TextDecoder('utf-8').decode(bytes);
}
