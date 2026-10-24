/** Multi-draft store: one record per repository path (localStorage-backed). */

const DRAFT_KEY = 'wikifactory-editor:drafts:v1';
const MAX_DRAFTS = 30;

function storageOrDefault(storage) {
  return storage || globalThis.localStorage;
}

function readAll(storage) {
  try {
    const raw = storageOrDefault(storage).getItem(DRAFT_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function writeAll(records, storage) {
  try {
    storageOrDefault(storage).setItem(DRAFT_KEY, JSON.stringify(records));
    return true;
  } catch {
    return false;
  }
}

function prune(records) {
  const entries = Object.entries(records).sort((a, b) => Number(b[1]?.savedAt || 0) - Number(a[1]?.savedAt || 0));
  const kept = entries.slice(0, MAX_DRAFTS);
  return Object.fromEntries(kept);
}

/** @returns {Array<{path:string,title:string,fmRaw:string,body:string,savedAt:number,loadedPath:string,loadedFmRaw:string,loadedBody:string}>} */
export function listDrafts(storage) {
  const records = readAll(storage);
  return Object.values(records)
    .filter((item) => item && typeof item.path === 'string' && item.path)
    .map((item) => ({
      path: item.path,
      title: typeof item.title === 'string' ? item.title : '',
      fmRaw: typeof item.fmRaw === 'string' ? item.fmRaw : '',
      body: typeof item.body === 'string' ? item.body : '',
      savedAt: Number(item.savedAt) || 0,
      loadedPath: typeof item.loadedPath === 'string' ? item.loadedPath : '',
      loadedFmRaw: typeof item.loadedFmRaw === 'string' ? item.loadedFmRaw : '',
      loadedBody: typeof item.loadedBody === 'string' ? item.loadedBody : '',
    }))
    .sort((a, b) => b.savedAt - a.savedAt);
}

export function getDraft(path, storage) {
  if (!path) return null;
  const record = readAll(storage)[path];
  if (!record) return null;
  return {
    path: record.path,
    title: typeof record.title === 'string' ? record.title : '',
    fmRaw: typeof record.fmRaw === 'string' ? record.fmRaw : '',
    body: typeof record.body === 'string' ? record.body : '',
    savedAt: Number(record.savedAt) || 0,
    loadedPath: typeof record.loadedPath === 'string' ? record.loadedPath : '',
    loadedFmRaw: typeof record.loadedFmRaw === 'string' ? record.loadedFmRaw : '',
    loadedBody: typeof record.loadedBody === 'string' ? record.loadedBody : '',
  };
}

export function saveDraftRecord(
  { path, title = '', fmRaw = '', body = '', savedAt = Date.now(), loadedPath = '', loadedFmRaw = '', loadedBody = '' },
  storage,
) {
  if (!path) return false;
  const records = readAll(storage);
  records[path] = {
    path,
    title,
    fmRaw,
    body,
    savedAt,
    loadedPath,
    loadedFmRaw,
    loadedBody,
  };
  return writeAll(prune(records), storage);
}

export function deleteDraft(path, storage) {
  if (!path) return false;
  const records = readAll(storage);
  if (!(path in records)) return true;
  delete records[path];
  return writeAll(records, storage);
}

export function draftCount(storage) {
  return listDrafts(storage).length;
}
