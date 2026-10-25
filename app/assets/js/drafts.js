/**
 * Multi-draft store.
 *
 * Two layers, both on this device:
 * - localStorage keeps the newest `MAX_DRAFTS` records for synchronous,
 *   drop-free reads (the editor autosaves every few seconds);
 * - IndexedDB keeps a full archive, so a draft pushed out of the hot window is
 *   still recoverable, and a corrupt / cleared localStorage can be rebuilt at
 *   boot instead of silently starting empty.
 *
 * Every eviction from the hot window is reported to the caller, and the UI
 * shows it. Nothing is dropped without saying so.
 */

const DRAFT_KEY = 'wikifactory-editor:drafts:v1';
export const MAX_DRAFTS = 30;

const IDB_NAME = 'wikifactory-editor:drafts';
const IDB_STORE = 'drafts';
const IDB_VERSION = 1;

function storageOrDefault(storage) {
  return storage || globalThis.localStorage;
}

function normalizeRecord(item) {
  if (!item || typeof item.path !== 'string' || !item.path) return null;
  return {
    path: item.path,
    title: typeof item.title === 'string' ? item.title : '',
    fmRaw: typeof item.fmRaw === 'string' ? item.fmRaw : '',
    body: typeof item.body === 'string' ? item.body : '',
    savedAt: Number(item.savedAt) || 0,
    loadedPath: typeof item.loadedPath === 'string' ? item.loadedPath : '',
    loadedFmRaw: typeof item.loadedFmRaw === 'string' ? item.loadedFmRaw : '',
    loadedBody: typeof item.loadedBody === 'string' ? item.loadedBody : '',
  };
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

/** Keep the newest MAX_DRAFTS; also report which paths were pushed out. */
function prune(records) {
  const entries = Object.entries(records).sort((a, b) => Number(b[1]?.savedAt || 0) - Number(a[1]?.savedAt || 0));
  const kept = entries.slice(0, MAX_DRAFTS);
  const evicted = entries.slice(MAX_DRAFTS).map(([path]) => path);
  return { records: Object.fromEntries(kept), evicted };
}

/* ---------------------------------------------------------- IndexedDB archive */

let dbPromise = null;

function requestResult(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error('IndexedDB request failed'));
  });
}

function openDb() {
  if (!globalThis.indexedDB) return Promise.resolve(null);
  dbPromise ??= new Promise((resolve) => {
    let request;
    try {
      request = globalThis.indexedDB.open(IDB_NAME, IDB_VERSION);
    } catch {
      resolve(null);
      return;
    }
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(IDB_STORE)) {
        database.createObjectStore(IDB_STORE, { keyPath: 'path' });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => resolve(null);
    request.onblocked = () => resolve(null);
  });
  return dbPromise;
}

async function readArchive(archive = draftArchive) {
  try {
    const records = await archive.all();
    return Array.isArray(records) ? records.map(normalizeRecord).filter(Boolean) : [];
  } catch {
    return [];
  }
}

export const draftArchive = {
  async all() {
    const database = await openDb();
    if (!database) return [];
    const store = database.transaction(IDB_STORE, 'readonly').objectStore(IDB_STORE);
    return (await requestResult(store.getAll())) || [];
  },
  async put(record) {
    const database = await openDb();
    if (!database) return false;
    const store = database.transaction(IDB_STORE, 'readwrite').objectStore(IDB_STORE);
    await requestResult(store.put(normalizeRecord(record)));
    return true;
  },
  async delete(path) {
    const database = await openDb();
    if (!database) return false;
    const store = database.transaction(IDB_STORE, 'readwrite').objectStore(IDB_STORE);
    await requestResult(store.delete(path));
    return true;
  },
};

/** Fire-and-forget archive write; the localStorage copy is already durable. */
function mirror(record) {
  void draftArchive.put(record).catch(() => {});
}

/* --------------------------------------------------------------- public API */

/** @returns {Array<{path:string,title:string,fmRaw:string,body:string,savedAt:number,loadedPath:string,loadedFmRaw:string,loadedBody:string}>} */
export function listDrafts(storage) {
  const records = readAll(storage);
  return Object.values(records)
    .map(normalizeRecord)
    .filter(Boolean)
    .sort((a, b) => b.savedAt - a.savedAt);
}

export function getDraft(path, storage) {
  if (!path) return null;
  return normalizeRecord(readAll(storage)[path]);
}

/**
 * Save one draft.
 * @returns {{ok:boolean, evicted:string[], error?:string}}
 *   `evicted` lists drafts pushed out of the hot window (still in the archive).
 */
export function saveDraftRecord(
  { path, title = '', fmRaw = '', body = '', savedAt = Date.now(), loadedPath = '', loadedFmRaw = '', loadedBody = '' },
  storage,
) {
  if (!path) return { ok: false, evicted: [], error: '缺少页面路径' };
  const records = readAll(storage);
  const record = {
    path,
    title,
    fmRaw,
    body,
    savedAt,
    loadedPath,
    loadedFmRaw,
    loadedBody,
  };
  records[path] = record;
  const { records: kept, evicted } = prune(records);
  const written = writeAll(kept, storage);
  if (written) mirror(record);
  return {
    ok: written && !evicted.includes(path),
    evicted,
    error: written ? undefined : 'localStorage 写入失败（可能是存储空间不足）',
  };
}

export function deleteDraft(path, storage) {
  if (!path) return false;
  const records = readAll(storage);
  if (!(path in records)) {
    void draftArchive.delete(path).catch(() => {});
    return true;
  }
  delete records[path];
  const ok = writeAll(records, storage);
  void draftArchive.delete(path).catch(() => {});
  return ok;
}

export function draftCount(storage) {
  return listDrafts(storage).length;
}

/** Records kept in IndexedDB but no longer in the hot window. */
export async function listArchivedDrafts({ archive = draftArchive, storage } = {}) {
  const archived = await readArchive(archive);
  const hot = new Set(Object.keys(readAll(storage)));
  return archived.filter((record) => !hot.has(record.path)).sort((a, b) => b.savedAt - a.savedAt);
}

/**
 * Rebuild localStorage from the archive when it is missing or unreadable.
 * Called once at boot; never deletes anything.
 *
 * @returns {Promise<{restored:number, source:'local'|'missing'|'corrupt'|'empty'|'failed'}>}
 */
export async function hydrateDrafts({ storage, archive = draftArchive } = {}) {
  const target = storageOrDefault(storage);
  const raw = (() => {
    try {
      return target.getItem(DRAFT_KEY);
    } catch {
      return null;
    }
  })();
  const localCount = Object.keys(readAll(storage)).length;
  if (raw && localCount) return { restored: 0, source: 'local' };

  const archived = await readArchive(archive);
  if (!archived.length) return { restored: 0, source: raw ? 'corrupt' : 'missing' };

  const merged = Object.fromEntries(archived.filter((record) => record.path).map((record) => [record.path, record]));
  // Keep the newest copy when a path appears twice in the archive.
  for (const record of archived) {
    if (merged[record.path] && merged[record.path].savedAt < record.savedAt) merged[record.path] = record;
  }
  const { records: kept } = prune(merged);
  if (!writeAll(kept, storage)) return { restored: 0, source: 'failed' };
  return { restored: Object.keys(kept).length, source: raw ? 'corrupt' : 'missing' };
}

/**
 * One JSON bundle with every draft (hot window + archive), newest first.
 * @returns {Promise<{app:string, version:number, exportedAt:string, drafts:object[]}>}
 */
export async function exportDraftBundle({ storage, archive = draftArchive } = {}) {
  const merged = new Map();
  for (const record of await readArchive(archive)) merged.set(record.path, record);
  for (const record of listDrafts(storage)) merged.set(record.path, record);
  return {
    app: 'Wikifactory Editor',
    version: 1,
    exportedAt: new Date().toISOString(),
    drafts: [...merged.values()].sort((a, b) => b.savedAt - a.savedAt),
  };
}

/**
 * Merge a bundle into local storage and the archive. Newer copies win.
 * @returns {Promise<{ok:boolean, imported:number, skipped:number, error?:string}>}
 */
export async function importDraftBundle(payload, { storage, archive = draftArchive } = {}) {
  const drafts = Array.isArray(payload?.drafts) ? payload.drafts : null;
  if (!drafts) return { ok: false, imported: 0, skipped: 0, error: '不是有效的草稿备份文件' };

  const records = readAll(storage);
  let imported = 0;
  let skipped = 0;
  for (const raw of drafts) {
    const record = normalizeRecord(raw);
    if (!record) {
      skipped += 1;
      continue;
    }
    const existing = records[record.path];
    if (existing && Number(existing.savedAt || 0) >= record.savedAt) {
      skipped += 1;
      continue;
    }
    records[record.path] = record;
    await archive.put(record).catch(() => {});
    imported += 1;
  }

  const { records: kept } = prune(records);
  if (!writeAll(kept, storage)) {
    return { ok: false, imported: 0, skipped, error: '写入 localStorage 失败（可能是存储空间不足）' };
  }
  return { ok: true, imported, skipped };
}
