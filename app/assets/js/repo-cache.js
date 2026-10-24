/** Pure repository-tree cache helpers (storage is injected for testability). */

export const REPO_CACHE_KEY = 'wikifactory-editor:repo-tree:v1';
export const REPO_CACHE_TTL = 7 * 24 * 60 * 60 * 1000;

export function readRepoCache(storage, ref, { now = Date.now(), ttl = REPO_CACHE_TTL } = {}) {
  try {
    const raw = storage?.getItem(REPO_CACHE_KEY);
    if (!raw) return null;
    const data = JSON.parse(raw);
    if (!data || !Array.isArray(data.paths) || data.ref !== ref) return null;
    const at = Number(data.at) || 0;
    if (now - at > ttl) return null;
    return { ref: data.ref, paths: data.paths, at, error: null, cached: true };
  } catch {
    return null;
  }
}

export function writeRepoCache(storage, index) {
  try {
    storage?.setItem(REPO_CACHE_KEY, JSON.stringify({ ref: index.ref, paths: index.paths, at: index.at }));
    return true;
  } catch {
    return false;
  }
}

/** Human note for checks that used the offline cache. */
export function repoCacheNote(index, formatTime = (value) => new Date(value).toLocaleTimeString('zh-CN')) {
  if (!index?.cached) return '';
  return `本地缓存（${formatTime(index.at)}），可能过期`;
}
