/** Runtime editor config: fetch + hash check + whitelist, then apply. */
import { ALLOWED_OWNERS, CONFIG_SHA256, CONFIG_URL, DEFAULT_CONFIG } from './editor-config.js';
import { RESERVED_PATHS } from './content-rules.js';
import { setRepoConfig } from './state.js';

const FORBIDDEN_REPOS = ['core', 'alias', 'wikifactory-core', 'wikifactory-alias'];
const OWNER_RE = /^[A-Za-z0-9][A-Za-z0-9-]{0,38}$/;
const REPO_RE = /^[A-Za-z0-9._-]{1,100}$/;
const APPROVAL_KEY = 'wikifactory-editor:config-approval:v1';

let active = { config: DEFAULT_CONFIG, source: 'default', verified: true, problems: [] };
/** Remote config that passed the whitelist but would move the repo without a matching pin. */
let pending = null;

function normalizedList(values = []) {
  return values.map((value) => String(value).toLowerCase()).sort();
}

/**
 * Same whitelist as scripts/editor-config.mjs, so a remote config cannot widen it.
 * `rules.reservedPaths` is an assertion: the canonical list lives in
 * content-rules.js (shared byte-for-byte with Content / Core), so a config that
 * disagrees is rejected instead of silently drifting.
 */
export function configProblems(config, { allowedOwners = ALLOWED_OWNERS } = {}) {
  const problems = [];
  if (!config || typeof config !== 'object') return ['配置不是对象'];
  if (config.version !== 1) problems.push('version 必须为 1');
  const content = config.content || {};
  if (!OWNER_RE.test(String(content.owner || ''))) problems.push('content.owner 不合法');
  else if (!allowedOwners.includes(content.owner)) problems.push('content.owner 不在白名单');
  if (!REPO_RE.test(String(content.repo || ''))) problems.push('content.repo 不合法');
  else if (FORBIDDEN_REPOS.includes(String(content.repo).toLowerCase())) problems.push('Content 不能是 Core / Alias');
  if (content.branch !== undefined && typeof content.branch !== 'string') problems.push('content.branch 必须是字符串');
  const editor = config.editor || {};
  if (!OWNER_RE.test(String(editor.owner || ''))) problems.push('editor.owner 不合法');
  else if (!allowedOwners.includes(editor.owner)) problems.push('editor.owner 不在白名单');
  if (!REPO_RE.test(String(editor.repo || ''))) problems.push('editor.repo 不合法');
  if (config.rules !== undefined) {
    const rules = config.rules;
    if (!rules || typeof rules !== 'object') problems.push('rules 必须是对象');
    else {
      if (rules.reservedPaths !== undefined) {
        if (!Array.isArray(rules.reservedPaths)) {
          problems.push('rules.reservedPaths 必须是数组');
        } else if (normalizedList(rules.reservedPaths).join('|') !== normalizedList(RESERVED_PATHS).join('|')) {
          problems.push('rules.reservedPaths 与共享规则 content-rules.js 不一致（修改请走 rules:sync）');
        }
      }
      if (rules.maxUploadMb !== undefined && !(Number.isFinite(rules.maxUploadMb) && rules.maxUploadMb > 0)) {
        problems.push('rules.maxUploadMb 必须是正数');
      }
    }
  }
  for (const key of Object.keys(config)) {
    if (!['version', 'content', 'editor', 'rules'].includes(key)) problems.push(`未知字段「${key}」`);
  }
  return problems;
}

export async function sha256Hex(text, subtle = globalThis.crypto?.subtle) {
  if (!subtle) return '';
  const bytes = new TextEncoder().encode(String(text).replace(/\r\n/g, '\n'));
  const digest = await subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

/** Apply a validated config to the shared repo bindings. */
export function applyEditorConfig(config, { source = 'remote', verified = false, problems = [] } = {}) {
  const content = config.content || DEFAULT_CONFIG.content;
  const editor = config.editor || DEFAULT_CONFIG.editor;
  setRepoConfig({
    content: { owner: content.owner, repo: content.repo, branch: content.branch || '' },
    editor: { owner: editor.owner, repo: editor.repo },
  });
  active = { config, source, verified, problems };
  return active;
}

export function activeConfig() {
  return active;
}

export function defaultConfig() {
  return DEFAULT_CONFIG;
}

/** Upload ceiling from the active config (defaults to 20 MB). */
export function activeMaxUploadMb() {
  const value = Number(active.config?.rules?.maxUploadMb);
  return Number.isFinite(value) && value > 0 ? value : 20;
}

function readApproval() {
  try {
    return globalThis.localStorage?.getItem(APPROVAL_KEY) || '';
  } catch {
    return '';
  }
}

function writeApproval(hash) {
  try {
    if (hash) globalThis.localStorage?.setItem(APPROVAL_KEY, hash);
  } catch {
    // Private mode / quota: the choice lasts for this session.
  }
}

/** @returns {{config: object, hash: string, problems: string[]}|null} */
export function pendingConfig() {
  return pending;
}

/** Use the remote config after the user explicitly approved the repo change. */
export function approvePendingConfig() {
  if (!pending) return null;
  const approved = pending;
  pending = null;
  writeApproval(approved.hash);
  return applyEditorConfig(approved.config, { source: 'remote', verified: false, problems: [] });
}

/** Keep the built-in config; remember the choice so we do not nag every boot. */
export function dismissPendingConfig() {
  if (!pending) return false;
  writeApproval(pending.hash);
  pending = null;
  return true;
}

/**
 * Fetch editor-config.json, verify its pinned hash, then apply it when the
 * whitelist passes. Never throws: a failure keeps the built-in config.
 *
 * A config that is whitelisted but both unpinned and pointed at a different
 * repository is held in `pendingConfig()` instead of being applied silently.
 */
export async function loadEditorConfig({ fetchImpl = globalThis.fetch, subtle = globalThis.crypto?.subtle } = {}) {
  try {
    // Boot must not stall on a slow network; 4 s is plenty for a 300-byte file.
    const timeout = new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 4000));
    const response = await Promise.race([fetchImpl(`${CONFIG_URL}?t=${Date.now()}`, { cache: 'no-store' }), timeout]);
    if (!response?.ok) throw new Error(`HTTP ${response?.status ?? '?'}`);
    const text = await response.text();
    const config = JSON.parse(text);
    const problems = configProblems(config);
    if (problems.length) {
      console.warn('[config] 远程配置未通过白名单，继续使用内置配置', problems);
      return applyEditorConfig(DEFAULT_CONFIG, { source: 'default', verified: true, problems });
    }
    const hash = await sha256Hex(text, subtle);
    const verified = Boolean(hash) && hash === CONFIG_SHA256;
    const repoChanged =
      config.content.owner !== DEFAULT_CONFIG.content.owner ||
      config.content.repo !== DEFAULT_CONFIG.content.repo ||
      config.editor.owner !== DEFAULT_CONFIG.editor.owner ||
      config.editor.repo !== DEFAULT_CONFIG.editor.repo;

    if (!verified && repoChanged && readApproval() !== hash) {
      pending = { config, hash, problems: [] };
      console.warn('[config] 远程配置指向其他仓库且未通过哈希固定，等待用户确认');
      return { ...active, pending: true };
    }

    return applyEditorConfig(config, { source: 'remote', verified, problems: [] });
  } catch (error) {
    console.warn('[config] 读取 editor-config.json 失败，使用内置配置', error);
    return active;
  }
}
