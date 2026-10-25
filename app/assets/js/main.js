/** Wikifactory Editor — Content-only application controller. */

import {
  APP_VERSION,
  CONTENT_OWNER,
  CONTENT_REPO,
  EDITOR_OWNER,
  EDITOR_REPO,
  basename,
  defaultState,
  downloadText,
  escapeHtml,
  formatBytes,
  formatTime,
  loadState,
  saveState,
  stripExt,
} from './state.js';
import { CodeEditor, CURSOR } from './code-editor.js';
import {
  CALLOUTS,
  COLOR_TOKENS,
  EMBED_PROVIDERS,
  GAME_AUDIO_DIR,
  GAME_ICON_DIR,
  GAME_IMAGE_DIR,
  ICON_EXTENSIONS,
  ICON_SIZES,
  ICON_NAME_RE,
  PAGE_TAG_ISSUE_URL,
  PAGE_TAG_VALUES,
  PAGE_TAGS,
  audioFileName,
  audioNameProblem,
  embedPageUrl,
  embedTarget,
  countCharacters,
  frontmatterData,
  gameOfPath,
  joinDocument,
  pageIdsFromRepository,
  repositoryAudioNames,
  repositoryIconNames,
  setYamlField,
  splitFrontmatter,
  validateContentPath,
  validateDocument,
  validateWithRepo,
} from './validate.js';
import { GitHubClient, GitHubError } from './github.js';
import { clearToken, loadToken, saveToken, tokenStorageKind } from './secure-token.js';
import { buildPreview, attachToc } from './markdown.js';
import { diffLines } from './diff.js';
import { deleteDraft, draftCount, listDrafts, saveDraftRecord } from './drafts.js';
import { h, raw } from './dom.js';
import { buildPrBody, buildPrDiff, defaultBranchName, prHeadline, PR_TYPES, uniqueBranchSuggestion } from './pr.js';
import { readRepoCache, repoCacheNote, writeRepoCache } from './repo-cache.js';
import { dedupeIssues, issueCounts, issuesForEditor, jumpTarget } from './issues.js';
import { TOOLBAR } from './toolbar.js';
import { collectFormChanges, describeChanges, fmFormHtml, formValueToYaml, toggleTag } from './frontmatter-form.js';
import { applyYamlChanges } from './frontmatter.js';
import { compareVersions, desktopManifestUrl, planUpdate, releaseAsset } from './updates.js';
import { parseDeepLink, importedPagePath } from './deep-link.js';
import { commentSummary, mergeGuidance, reviewLabel, summarizeReview } from './review.js';
import { linkScanTargets, pageIdOf, planRename, renamePagePath, rewritePageLinks } from './batch.js';
import { mapWithConcurrency } from './async-pool.js';
import { applyI18n, LANGS, setLang, t, tOr } from './i18n.js';
import {
  activeConfig,
  activeIssueUrl,
  activeMaxUploadMb,
  approvePendingConfig,
  dismissPendingConfig,
  loadEditorConfig,
  pendingConfig,
} from './config.js';
import {
  applyTheme,
  confirmDialog,
  effectiveTheme,
  escape,
  initThemeWatcher,
  nextTheme,
  openModal,
  toast,
} from './ui.js';
import { applyIcons, icon } from './icons.js';

if (window.NL_PORT && window.Neutralino?.init) {
  window.Neutralino.init();
}

/* ------------------------------------------------------------------ dom */
const $ = (selector) => document.querySelector(selector);
const els = {
  bodyHost: $('#body-editor'),
  fmHost: $('#fm-editor'),
  editorTabs: $('#editor-tabs'),
  toolbar: $('#toolbar'),
  docTitle: $('#doc-title'),
  docPath: $('#doc-path'),
  docBadge: $('#doc-mode-badge'),
  saveStatus: $('#save-status'),
  saveStatusText: $('#save-status-text'),
  statLn: $('#stat-ln'),
  statChars: $('#stat-chars'),
  statIssues: $('#stat-issues'),
  statSaved: $('#stat-saved'),
  statRepo: $('#stat-repo'),
  fmForm: $('#fm-form'),
  assetList: $('#asset-list'),
  assetCount: $('#asset-count'),
  draftCount: $('#draft-count'),
  contentPath: $('#content-path'),
  sidebar: $('#sidebar'),
  sidebarBackdrop: $('#sidebar-backdrop'),
  previewOverlay: $('#preview-overlay'),
  previewStage: $('#preview-stage'),
  previewArticle: $('#preview-article'),
  previewTitle: $('#preview-title'),
  previewToc: $('#preview-toc'),
  previewTocNav: $('#preview-toc-nav'),
  previewScroll: $('#preview-scroll'),
  connectionPill: $('#btn-connection'),
  connectionDot: $('#connection-dot'),
  connectionLabel: $('#connection-label'),
};

const state = loadState();
const assets = [];
let sessionToken = '';
let tokenReady = Promise.resolve();
let dirty = false;
let updatingForm = false;
let fmFormDirty = false;
const fmPending = new Map();
let lastIssues = [];
let issuesStale = true;
let saveTimer = 0;
let validateTimer = 0;
let formSyncTimer = 0;
let sessionBaseline = null;
let updateCheckRunning = false;
let contributingCache = null;
let connection = { ok: false, login: '', scopes: '', message: '未连接' };
/** PR created in this session (review panel target). */
let sessionPr = null;
/** Multi-page edit queue: path → { fmRaw, body, loadedPath, loadedSha }. */
const batchQueue = new Map();
let batchActive = false;
let reviewTimer = 0;

const bodyEditor = new CodeEditor(els.bodyHost, {
  value: state.content.body,
  language: 'markdown',
  label: 'Markdown 正文',
  wrap: state.settings.wrap,
  onChange: () => onEditorInput('body'),
  onSelection: updateCaret,
  onShortcut: handleEditorShortcut,
  onFiles: addImageFiles,
  completionSource: bodyCompletionSource,
});
const fmEditor = new CodeEditor(els.fmHost, {
  value: state.content.fmRaw,
  language: 'yaml',
  label: 'Frontmatter YAML',
  wrap: state.settings.wrap,
  onChange: () => onEditorInput('frontmatter'),
  onSelection: updateCaret,
  onShortcut: handleEditorShortcut,
  completionSource: frontmatterCompletionSource,
});

/* --------------------------------------------------------------- helpers */

function currentPathValue() {
  return state.content.path;
}

function activeEditor() {
  return state.content.editorTab === 'frontmatter' ? fmEditor : bodyEditor;
}

function activeText() {
  return activeEditor().value;
}

function docTitleValue() {
  const data = frontmatterData(state.content.fmRaw);
  return data.title || stripExt(basename(state.content.path)) || '未命名页面';
}

function assembleDocument() {
  return joinDocument(state.content.fmRaw, state.content.body);
}

function isSafeRepoPath(path) {
  const value = String(path || '');
  if (!value || value.startsWith('/') || value.includes('..')) return false;
  if (/[\\:*?"<>|\u0000-\u001f]/.test(value)) return false;
  return value.split('/').every((segment) => segment && segment.trim() === segment && !segment.startsWith('.'));
}

function openExternal(url) {
  if (window.AndroidEditor?.openExternal) {
    window.AndroidEditor.openExternal(url);
    return;
  }
  if (window.NL_PORT && window.Neutralino?.os?.open) {
    window.Neutralino.os.open(url).catch(() => window.open(url, '_blank', 'noopener'));
    return;
  }
  window.open(url, '_blank', 'noopener');
}

function setConnection(ok, label, message, scopes = '') {
  connection = { ok, login: label, scopes, message };
  els.connectionPill.classList.toggle('is-online', ok);
  els.connectionPill.classList.toggle('is-error', !ok && !!sessionToken);
  els.connectionLabel.textContent = label;
  els.connectionPill.title = message;
}

function markDirty() {
  dirty = true;
  issuesStale = true;
  updateSaveStatus();
  updateStats();
  scheduleSave();
  scheduleValidation();
}

function scheduleSave() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => saveDraft(false), 900);
}

function scheduleValidation() {
  clearTimeout(validateTimer);
  validateTimer = setTimeout(() => {
    validateNow({ open: false }).catch((error) => console.warn('[validate] 校验失败', error));
  }, 1100);
}

function updateSaveStatus() {
  els.saveStatus.classList.toggle('is-dirty', dirty);
  els.saveStatusText.textContent = dirty ? '有未保存修改' : '本地草稿已保存';
  const last = state.content.lastSaved;
  els.statSaved.textContent = last ? `草稿 ${formatTime(last)}` : dirty ? '未保存' : '本地草稿';
}

function updateCaret() {
  const { line, column } = activeEditor().lineColumn;
  const total = activeEditor().lineCount;
  els.statLn.textContent = `行 ${line}/${total}，列 ${column}`;
}

function updateStats() {
  const text = activeText();
  const { characters, words } = countCharacters(text);
  els.statChars.textContent = `${characters.toLocaleString('zh-CN')} 字符 / ${words.toLocaleString('zh-CN')} 词`;
  const summary = issueCounts(lastIssues);
  if (!lastIssues.length && issuesStale) {
    els.statIssues.textContent = '待检查';
    els.statIssues.className = 'stat-issues';
  } else if (summary.errors > 0) {
    els.statIssues.textContent = `${summary.errors} 错误${summary.warnings ? ` · ${summary.warnings} 警告` : ''}`;
    els.statIssues.className = 'stat-issues is-error';
  } else if (summary.warnings > 0) {
    els.statIssues.textContent = `0 错误 · ${summary.warnings} 警告`;
    els.statIssues.className = 'stat-issues is-warn';
  } else {
    els.statIssues.textContent = '检查通过';
    els.statIssues.className = 'stat-issues is-ok';
  }
  updateCaret();
  els.statRepo.textContent = `${CONTENT_OWNER}/${CONTENT_REPO}`;
}

function updateDocMeta() {
  els.docTitle.textContent = docTitleValue();
  els.docPath.textContent = currentPathValue() || '（未设置路径）';
  els.docBadge.textContent = 'CONTENT';
  els.saveStatus.classList.toggle('is-dirty', dirty);
}

function syncEditorVisibility({ focus = false } = {}) {
  const frontmatter = state.content.editorTab === 'frontmatter';
  els.bodyHost.hidden = frontmatter;
  els.fmHost.hidden = !frontmatter;
  els.toolbar.hidden = frontmatter;
  for (const tab of els.editorTabs.querySelectorAll('.editor-tab')) {
    tab.classList.toggle('is-active', tab.dataset.tab === state.content.editorTab);
  }
  const editor = frontmatter ? fmEditor : bodyEditor;
  editor.refresh();
  if (focus) editor.focus();
  updateCaret();
}

function onEditorInput(source) {
  if (source === 'frontmatter') {
    state.content.fmRaw = fmEditor.value;
    fmPending.clear();
    fmFormDirty = false;
    scheduleFormSync();
    renderApplyBar();
  } else {
    state.content.body = bodyEditor.value;
  }
  updateDocMeta();
  markDirty();
}

function scheduleFormSync() {
  clearTimeout(formSyncTimer);
  formSyncTimer = setTimeout(() => {
    updatingForm = true;
    populateFmForm();
    updatingForm = false;
  }, 240);
}

/* ------------------------------------------------------------- frontmatter */

function renderFmForm() {
  const baseIssueUrl = activeIssueUrl() || PAGE_TAG_ISSUE_URL;
  const issueUrl = `${baseIssueUrl}&title=${encodeURIComponent('新增页面分类：')}`;
  els.fmForm.innerHTML = fmFormHtml({ tags: PAGE_TAGS, issueUrl });
  els.fmForm.append(
    h`<div class="fm-apply-bar" id="fm-apply-bar" hidden>
      <span class="fm-apply-text" id="fm-apply-text"></span>
      <div class="button-row">
        <button class="btn btn-small btn-ghost" type="button" id="fm-apply-discard">放弃</button>
        <button class="btn btn-small btn-primary" type="button" id="fm-apply">应用更改</button>
      </div>
    </div>`,
  );
  // Assign (not addEventListener) so repeated renders do not stack handlers.
  els.fmForm.oninput = onFmFieldInput;
  els.fmForm.onclick = onFmTagClick;
  renderApplyBar();
}

function populateFmForm() {
  const data = frontmatterData(state.content.fmRaw);
  const set = (selector, value) => {
    const node = els.fmForm.querySelector(selector);
    if (node && document.activeElement !== node) node.value = value ?? '';
  };
  set('#fm-title', data.title);
  set('#fm-description', data.description);
  renderTagSelection(data.tags);
  set('#fm-order', data.order ?? '');
  set('#fm-updated', data.updated || '');
  const draft = els.fmForm.querySelector('#fm-draft');
  if (draft && document.activeElement !== draft) draft.checked = data.draft;
  const toc = els.fmForm.querySelector('#fm-toc');
  if (toc && document.activeElement !== toc) toc.checked = data.toc;
  fmFormDirty = false;
}

/** Reflect selected tags on the template chips; unknown tags become removable warning chips. */
function renderTagSelection(tags) {
  const picker = els.fmForm.querySelector('#fm-tags');
  if (!picker) return;
  const selected = new Set(tags);
  for (const button of picker.querySelectorAll('[data-tag]')) {
    const on = selected.has(button.dataset.tag);
    button.classList.toggle('is-active', on);
    button.setAttribute('aria-pressed', String(on));
  }
  for (const chip of picker.querySelectorAll('[data-unknown-tag]')) chip.remove();
  const known = new Set(PAGE_TAG_VALUES);
  for (const tag of tags) {
    if (known.has(tag)) continue;
    const chip = h`<button type="button" class="chip is-active is-unknown"
      data-unknown-tag="${tag}"
      title="模板中不存在该分类；点击移除，或到编辑器仓库申请新增">${tag} ×</button>`;
    picker.append(chip);
  }
}

/** Current form values mapped to YAML semantics. */
function fmFormValues() {
  const data = frontmatterData(state.content.fmRaw);
  const values = { tags: fmPending.has('tags') ? fmPending.get('tags') : data.tags };
  for (const node of els.fmForm.querySelectorAll('[data-fm]')) {
    const key = node.dataset.fm;
    if (key === 'tags') continue;
    if (node.type === 'checkbox') values[key] = node.checked;
    else values[key] = node.value;
  }
  const mapped = {};
  for (const [key, value] of Object.entries(values)) mapped[key] = formValueToYaml(key, value);
  return mapped;
}

function pendingFmChanges() {
  if (!fmFormDirty) return {};
  return collectFormChanges(frontmatterData(state.content.fmRaw), fmFormValues());
}

function renderApplyBar() {
  const bar = els.fmForm?.querySelector('#fm-apply-bar');
  if (!bar) return;
  const changes = pendingFmChanges();
  const count = Object.keys(changes).length;
  bar.hidden = count === 0;
  const text = bar.querySelector('#fm-apply-text');
  if (text) text.textContent = count ? `待应用：${describeChanges(changes)}` : '';
}

/** Diff preview before writing form edits into the raw frontmatter. */
function confirmFmDiff(before, after, changes) {
  return new Promise((resolve) => {
    const ops = diffLines(before, after);
    const rows = ops
      .map((row) => {
        const sign = row.type === 'add' ? '+' : row.type === 'del' ? '−' : ' ';
        return (
          `<div class="diff-row is-${row.type}">` +
          `<span class="diff-num">${row.oldLine ?? ''}</span>` +
          `<span class="diff-num">${row.newLine ?? ''}</span>` +
          `<span class="diff-sign">${sign}</span>` +
          `<code>${escapeHtml(row.text) || ' '}</code></div>`
        );
      })
      .join('');
    const body = h`<div class="form-grid">
      <div class="form-note is-accent">将应用：${describeChanges(changes)}。未知字段与注释会保留。</div>
      <div class="diff-view">${raw(rows)}</div>
    </div>`;
    let settled = false;
    const finish = (value) => {
      if (settled) return;
      settled = true;
      resolve(value);
      modal.close();
    };
    const modal = openModal({
      title: '应用元数据修改？',
      subtitle: '确认 frontmatter 差异',
      body,
      size: 'wide',
      footer: [
        { label: '取消', className: 'btn-ghost', onClick: () => finish(false) },
        { label: '应用', className: 'btn-primary', onClick: () => finish(true) },
      ],
      onClose: () => finish(false),
    });
  });
}

/**
 * Apply pending form edits. `confirm` shows the diff first; save/preview calls
 * flush silently so edits are never dropped.
 */
async function applyFmChanges({ confirm = true } = {}) {
  const changes = pendingFmChanges();
  if (!Object.keys(changes).length) {
    if (confirm) toast('没有待应用的修改。', 'info', 2200);
    return false;
  }
  const before = state.content.fmRaw;
  const after = applyYamlChanges(before, changes);
  if (after !== before && confirm) {
    const ok = await confirmFmDiff(before, after, changes);
    if (!ok) return false;
  }
  state.content.fmRaw = after;
  if (fmEditor.value !== after) fmEditor.setValue(after, { reset: false });
  fmPending.clear();
  populateFmForm();
  renderApplyBar();
  updateDocMeta();
  markDirty();
  if (confirm) toast('已应用表单修改。', 'success');
  return true;
}

function flushFmChanges() {
  if (!els.fmForm?.querySelector('#fm-apply-bar')) return Promise.resolve(false);
  return applyFmChanges({ confirm: false });
}

function onFmTagClick(event) {
  const chip = event.target.closest('[data-tag], [data-unknown-tag]');
  if (!chip || !els.fmForm.contains(chip)) return;
  const tag = chip.dataset.tag ?? chip.dataset.unknownTag;
  const current = fmFormValues().tags;
  fmPending.set('tags', toggleTag(current, tag));
  fmFormDirty = true;
  renderTagSelection(fmPending.get('tags'));
  renderApplyBar();
}

function onFmFieldInput(event) {
  if (updatingForm) return;
  const field = event.target.dataset.fm;
  if (!field) return;
  fmFormDirty = true;
  renderApplyBar();
}

/** Drop pending form edits without touching the raw YAML. */
function discardFmChanges() {
  fmPending.clear();
  populateFmForm();
  renderApplyBar();
}

function setEditorTab(tab, { focus = true } = {}) {
  state.content.editorTab = tab === 'frontmatter' ? 'frontmatter' : 'body';
  syncEditorVisibility({ focus });
  updateStats();
  scheduleSave();
}

/* ----------------------------------------------------------------- toolbar */

function renderToolbar() {
  els.toolbar.innerHTML = TOOLBAR.map((group) => {
    const groupLabel = tOr(group.labelKey, group.label);
    return `
    <div class="toolbar-group">
      <span class="toolbar-group-label">${escape(groupLabel)}</span>
      ${group.items
        .map((item) => {
          const title = tOr(item.titleKey, item.title);
          const label = item.labelKey ? tOr(item.labelKey, item.label) : item.label;
          const inner = item.icon
            ? `${icon(item.icon)}${label ? `<span class="tool-label">${escape(label)}</span>` : ''}`
            : `<span class="tool-glyph">${escape(item.glyph)}</span>`;
          const classes = ['tool-btn', item.className || '', item.hasCaret ? 'has-caret' : '']
            .filter(Boolean)
            .join(' ');
          return `<button type="button" class="${classes}" data-action="${item.action}" title="${escape(title)}" aria-label="${escape(title || item.action)}">${inner}</button>`;
        })
        .join('')}
    </div>
  `;
  }).join('');
  els.toolbar.hidden = state.content.editorTab === 'frontmatter';
}

/** Editor-local shortcuts (Ctrl+I / Ctrl+K / Ctrl+Shift+K). */
function handleEditorShortcut(action) {
  if (state.content.editorTab === 'frontmatter') {
    if (action === 'wikiLink') toast('站内链接只能在正文中使用。', 'info', 2600);
    return;
  }
  if (action === 'italic') {
    bodyEditor.wrap('*', '*');
    return;
  }
  if (action === 'link') {
    openLinkDialog();
    return;
  }
  if (action === 'wikiLink') {
    bodyEditor.wrap('[[', ']]');
    bodyEditor.triggerCompletion();
  }
}

function handleToolbarAction(action) {
  const editor = activeEditor();
  const requireEditor = () => {
    if (state.content.editorTab === 'frontmatter') {
      toast('元数据 YAML 不支持 Markdown 格式，请切换到正文。', 'info');
      return false;
    }
    return true;
  };

  switch (action) {
    case 'undo':
      if (editor.undo()) updateStats();
      break;
    case 'redo':
      if (editor.redo()) updateStats();
      break;
    case 'bold':
      if (requireEditor()) editor.wrap('**', '**');
      break;
    case 'italic':
      if (requireEditor()) editor.wrap('*', '*');
      break;
    case 'strike':
      if (requireEditor()) editor.wrap('~~', '~~');
      break;
    case 'inlineCode':
      if (requireEditor()) editor.wrap('`', '`');
      break;
    case 'mdLink':
      openLinkDialog();
      break;
    case 'quote':
      if (requireEditor()) editor.toggleLinePrefix('> ');
      break;
    case 'ul':
      if (requireEditor()) editor.toggleLinePrefix('- ');
      break;
    case 'ol':
      if (requireEditor()) editor.toggleLinePrefix('1. ');
      break;
    case 'task':
      if (requireEditor()) editor.toggleLinePrefix('- [ ] ');
      break;
    case 'h1':
      if (requireEditor()) editor.setHeading(1);
      break;
    case 'h2':
      if (requireEditor()) editor.setHeading(2);
      break;
    case 'h3':
      if (requireEditor()) editor.setHeading(3);
      break;
    case 'hr':
      if (requireEditor()) editor.insertBlock('---');
      break;
    case 'codeblock':
      if (requireEditor()) editor.insertBlock('```markdown\n' + CURSOR + '\n```');
      break;
    case 'wikiLink':
      if (requireEditor()) editor.wrap('[[', ']]');
      break;
    case 'callout':
      openCalloutDialog();
      break;
    case 'wikiImage':
      openImageDialog();
      break;
    case 'icon':
      openIconDialog();
      break;
    case 'audio':
      openAudioDialog();
      break;
    case 'embed':
      openEmbedDialog();
      break;
    case 'table':
      openTableDialog();
      break;
    case 'cellColor':
      openCellColorDialog();
      break;
    case 'validate':
      validateNow({ open: true }).catch((error) => toast(`检查失败：${error.message}`, 'error'));
      break;
    case 'preview':
      openPreview();
      break;
    default:
      break;
  }
}

/* ---------------------------------------------------------------- sidebar */

function openSidebar() {
  els.sidebar.classList.add('is-open');
  els.sidebarBackdrop.hidden = false;
}

function closeSidebar() {
  els.sidebar.classList.remove('is-open');
  els.sidebarBackdrop.hidden = true;
}

function renderAssets() {
  els.assetCount.textContent = String(assets.length);
  if (!assets.length) {
    els.assetList.innerHTML = '<p class="empty-mini">暂无待上传资源。插入图片 / 音频时可选择随 PR 上传。</p>';
    return;
  }
  els.assetList.innerHTML = assets
    .map((asset, index) => {
      const isAudio = /\.ogg$/i.test(asset.path);
      const thumb = isAudio
        ? `<span class="asset-thumb asset-thumb--audio">${icon('music', 18)}</span>`
        : `<img class="asset-thumb" src="${escapeHtml(asset.dataUrl)}" alt="">`;
      return `
    <div class="asset-item">
      ${thumb}
      <div class="asset-info">
        <span class="asset-name">${escapeHtml(asset.name)}（${formatBytes(asset.size)}）</span>
        <span class="asset-path" title="${escapeHtml(asset.path)}">${escapeHtml(asset.path)}</span>
      </div>
      <button class="asset-remove" type="button" data-asset-index="${index}" aria-label="移除待上传资源">${icon('x', 14)}</button>
    </div>
  `;
    })
    .join('');
  for (const button of els.assetList.querySelectorAll('[data-asset-index]')) {
    button.addEventListener('click', () => {
      assets.splice(Number(button.dataset.assetIndex), 1);
      renderAssets();
      updateStats();
    });
  }
}

function assetsForPreview() {
  const map = new Map();
  for (const asset of assets) {
    const name = basename(asset.path).toLowerCase();
    map.set(name, asset.dataUrl);
    map.set(stripExt(name), asset.dataUrl);
    map.set(asset.path.toLowerCase(), asset.dataUrl);
  }
  return map;
}

/* ------------------------------------------------- paste / drop image files */

const MAX_IMAGE_EDGE = 1600;

/** Upload ceiling from editor-config.json (default 20 MB), in bytes. */
function maxUploadBytes() {
  return Math.round(activeMaxUploadMb() * 1024 * 1024);
}

/** Reject a picked file early with a consistent message. */
function tooLarge(file) {
  if (file.size <= maxUploadBytes()) return false;
  toast(`文件 ${formatBytes(file.size)} 超过上传上限 ${activeMaxUploadMb()} MB。`, 'error', 4600);
  return true;
}

function sanitizeAssetName(name, fallback = `pasted-${Date.now()}`) {
  const cleaned = String(name || '')
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return cleaned || `${fallback}.png`;
}

function readAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error || new Error('无法读取文件'));
    reader.readAsDataURL(file);
  });
}

function dataUrlBytes(dataUrl) {
  const base64 = String(dataUrl).split(',')[1] || '';
  return Math.round((base64.length * 3) / 4);
}

/** Downscale large raster images so a few MB of PNG does not enter the repo. */
async function shrinkImage(file) {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, MAX_IMAGE_EDGE / Math.max(bitmap.width, bitmap.height));
  const width = Math.max(1, Math.round(bitmap.width * scale));
  const height = Math.max(1, Math.round(bitmap.height * scale));
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d');
  context.imageSmoothingQuality = 'high';
  context.drawImage(bitmap, 0, 0, width, height);
  bitmap.close?.();
  return { dataUrl: canvas.toDataURL('image/webp', 0.86), width, height };
}

/** @returns {Promise<{name:string,dataUrl:string,base64:string,size:number,compressed:boolean}>} */
async function prepareImageAsset(file) {
  const safeName = sanitizeAssetName(file.name);
  const limit = maxUploadBytes();
  const skippable = /^image\/(gif|svg\+xml)$/i.test(file.type);
  // Read the original lazily: a 40 MB PNG that can be re-encoded never has to
  // be held as a base64 string first.
  const originalAsset = async () => {
    const dataUrl = await readAsDataUrl(file);
    return {
      name: safeName,
      dataUrl,
      base64: dataUrl.split(',')[1] || '',
      size: file.size,
      compressed: false,
    };
  };

  if (skippable) {
    if (file.size > limit) {
      throw new Error(`文件 ${formatBytes(file.size)} 超过 ${activeMaxUploadMb()} MB，且 GIF / SVG 无法自动压缩`);
    }
    return originalAsset();
  }
  // Small rasters stay byte-identical, but never ignore a lower configured limit.
  if (file.size <= 1024 * 1024 && file.size <= limit) return originalAsset();

  try {
    const shrunk = await shrinkImage(file);
    const size = dataUrlBytes(shrunk.dataUrl);
    if (size >= file.size || size > limit) {
      if (file.size > limit) {
        throw new Error(`文件 ${formatBytes(file.size)} 超过 ${activeMaxUploadMb()} MB 且无法压缩到上限内`);
      }
      return originalAsset();
    }
    const stem = stripExt(safeName).replace(/[^a-zA-Z0-9._-]+/g, '-') || 'pasted-image';
    return {
      name: `${stem}.webp`,
      dataUrl: shrunk.dataUrl,
      base64: shrunk.dataUrl.split(',')[1] || '',
      size,
      compressed: true,
    };
  } catch (error) {
    if (error?.message?.includes('MB')) throw error;
    if (file.size > limit) {
      throw new Error(`文件 ${formatBytes(file.size)} 超过 ${activeMaxUploadMb()} MB`, { cause: error });
    }
    return originalAsset();
  }
}

/** Pasting / dropping images adds them to the pending upload list and inserts markers. */
async function addImageFiles(files) {
  const game = gameOfPath(state.content.path);
  if (!game) {
    toast('请先把页面路径设为 games/<游戏>/…，图片才能放进该游戏的 assets/images/。', 'error', 4600);
    return;
  }
  const markers = [];
  let compressed = 0;
  let failed = 0;
  let lastError = '';
  for (const file of files) {
    try {
      const prepared = await prepareImageAsset(file);
      if (prepared.compressed) compressed += 1;
      const path = `games/${game}/${GAME_IMAGE_DIR}/${prepared.name}`;
      const asset = {
        path,
        name: prepared.name,
        dataUrl: prepared.dataUrl,
        base64: prepared.base64,
        size: prepared.size,
      };
      const existing = assets.findIndex((item) => item.path === path);
      if (existing >= 0) assets.splice(existing, 1, asset);
      else assets.push(asset);
      markers.push(`[[File/${prepared.name}|md]]`);
    } catch (error) {
      failed += 1;
      lastError = error?.message || '';
    }
  }
  if (!markers.length) {
    toast(lastError || '图片读取失败，未加入待上传列表。', 'error', 5200);
    return;
  }
  renderAssets();
  updateStats();
  bodyEditor.insertBlock(markers.join('\n\n'));
  const parts = [`已加入待上传列表：${markers.length} 张图片`];
  if (compressed) parts.push(`${compressed} 张已压缩到 ${MAX_IMAGE_EDGE}px 内`);
  if (failed) parts.push(`${failed} 张失败${lastError ? `：${lastError}` : ''}`);
  toast(parts.join('；'), failed ? 'info' : 'success', 4200);
}

/* ------------------------------------------------------------- validation */

function collectIssues() {
  return validateDocument({
    path: state.content.path,
    fmRaw: state.content.fmRaw,
    body: state.content.body,
  });
}

/** Cached repository file list used for gate-parity checks (icons, URL conflicts). */
let repoIndex = null;

async function ensureRepoIndex({ force = false } = {}) {
  const ref = state.settings.branch || 'HEAD';
  const ttl = repoIndex?.error ? 60 * 1000 : 5 * 60 * 1000;
  if (repoIndex && repoIndex.ref === ref && !force && Date.now() - repoIndex.at < ttl) return repoIndex;
  try {
    const tree = await new GitHubClient(sessionToken).getTree(CONTENT_OWNER, CONTENT_REPO, ref);
    repoIndex = {
      ref,
      paths: tree.filter((item) => item.type === 'blob').map((item) => item.path),
      at: Date.now(),
      error: null,
      cached: false,
    };
    writeRepoCache(localStorage, repoIndex);
  } catch (error) {
    const cached = readRepoCache(localStorage, ref);
    repoIndex = cached ? { ...cached, error } : { ref, paths: null, at: Date.now(), error, cached: false };
  }
  return repoIndex;
}

async function collectRepoIssues({ path = state.content.path, body = state.content.body } = {}) {
  const index = await ensureRepoIndex();
  if (!index.paths) return [];
  // Pending uploads in this session will be part of the PR, so treat them as present.
  return validateWithRepo({
    path,
    body,
    repoPaths: index.paths,
    extraPaths: assets.map((asset) => asset.path),
  });
}

/** Sync rules + gate-parity repository rules (icon files, duplicate URLs). */
async function collectIssuesWithRepo() {
  const sync = collectIssues();
  const repo = await collectRepoIssues().catch(() => []);
  return [...sync, ...repo];
}

async function validateNow({ open = false } = {}) {
  // Sync rules first so the editor gets squiggles immediately, then repo checks.
  const syncIssues = collectIssues();
  lastIssues = syncIssues;
  issuesStale = false;
  updateStats();
  applyInlineDiagnostics();

  const repoIssues = await collectRepoIssues().catch(() => []);
  const issues = dedupeIssues([...syncIssues, ...repoIssues]);
  lastIssues = issues;
  issuesStale = false;
  updateStats();
  applyInlineDiagnostics();
  if (open) showIssuesDialog(issues);
  return issues;
}

/* ------------------------------------------------- completions & linting */

function bodyCompletionSource(context) {
  const before = context.matchBefore(/\[icon=[^\]\n;]*/);
  if (before) {
    const game = gameOfPath(state.content.path);
    const names = [...repositoryIconNames(repoIndex?.paths || [], game)];
    if (!names.length) return null;
    return {
      from: before.from + '[icon='.length,
      options: names.slice(0, 200).map((name) => ({
        label: name,
        type: 'variable',
        detail: `${GAME_ICON_DIR}/`,
        apply: name,
      })),
      validFor: /^[^\]\n;]*$/,
    };
  }

  const wiki = context.matchBefore(/\[\[[^[\]\n|]*/);
  if (!wiki) return null;
  const prefix = wiki.text.slice(2);
  if (/^(?:File|Image|文件|Audio|Embed)\b/i.test(prefix)) return null;
  const ids = pageIdsFromRepository(repoIndex?.paths);
  if (!ids.length) return null;
  return {
    from: wiki.from + 2,
    options: ids.map((id) => ({
      label: id,
      type: 'text',
      detail: '页面',
      apply: id,
    })),
    validFor: /^[^[\]\n|]*$/,
  };
}

function insideTagsBlock(doc, lineNumber) {
  for (let number = lineNumber; number >= 1; number -= 1) {
    const text = doc.line(number).text;
    if (/^\s*tags\s*:/.test(text)) return true;
    if (/^[A-Za-z0-9_.-]+\s*:/.test(text)) return false;
    if (number === 1) break;
  }
  return false;
}

function frontmatterCompletionSource(context) {
  const line = context.state.doc.lineAt(context.pos);
  const before = line.text.slice(0, context.pos - line.from);
  const isTagsLine =
    /^\s*tags\s*:/.test(before) || (/^\s*-\s/.test(before) && insideTagsBlock(context.state.doc, line.number));
  if (!isTagsLine) return null;
  const word = context.matchBefore(/[^,[\]\s]*/);
  if (!word) return null;
  return {
    from: word.from,
    options: PAGE_TAG_VALUES.map((tag) => ({ label: tag, type: 'keyword', detail: '分类', apply: tag })),
    validFor: /^[^,[\]\s]*$/,
  };
}

/** Push the latest issue list into the editors as inline diagnostics. */
function applyInlineDiagnostics() {
  bodyEditor.setDiagnostics(issuesForEditor(lastIssues, 'body'));
  fmEditor.setDiagnostics(issuesForEditor(lastIssues, 'frontmatter'));
}

function showIssuesDialog(issues) {
  const summary = issueCounts(issues);
  if (!issues.length) {
    toast('检查通过：没有发现错误或警告。', 'success');
    return;
  }
  const list = issues
    .map(
      (item, index) => `
    <button type="button" class="issue-item is-${item.severity}" data-issue="${index}">
      <span class="issue-badge">${item.severity === 'error' ? '错误' : '警告'}</span>
      <span style="flex:1">${escapeHtml(item.message)}</span>
      ${item.line ? `<span class="issue-line">L${item.line}</span>` : ''}
    </button>
  `,
    )
    .join('');
  const body = `
    <div class="form-note ${summary.errors ? 'is-warn' : ''}" style="margin-bottom:12px">
      共 ${issues.length} 个问题：${summary.errors} 个错误、${summary.warnings} 个警告。
      错误会阻断 PR；警告不会。
    </div>
    <div class="issue-list">${list}</div>
  `;
  const modal = openModal({
    title: summary.errors ? '检查未通过' : '检查通过（有警告）',
    subtitle: `Content · ${currentPathValue() || '未设置路径'}`,
    body,
    size: 'wide',
    footer: [
      { label: '关闭', className: 'btn-ghost', onClick: () => modal.close() },
      ...(sessionToken && summary.errors === 0
        ? [
            {
              label: '继续提交 PR',
              className: 'btn-primary',
              onClick: () => {
                modal.close();
                openPrDialog();
              },
            },
          ]
        : []),
    ],
  });
  modal.body.addEventListener('click', (event) => {
    const item = event.target.closest('[data-issue]');
    if (!item) return;
    const issue = lastIssues[Number(item.dataset.issue)];
    modal.close();
    jumpToIssue(issue);
  });
}

function jumpToIssue(issue) {
  if (!issue) return;
  const target = jumpTarget(issue);
  setEditorTab(target.editor);
  const editor = target.editor === 'frontmatter' ? fmEditor : bodyEditor;
  if (Number.isFinite(issue.line)) editor.jumpToLine(target.line);
  else editor.focus();
}

/* ------------------------------------------------------------------ files */

async function loadCurrentFile({ skipConfirm = false } = {}) {
  if (!skipConfirm) {
    const decision = await confirmBeforeDestructive('加载仓库文件会替换当前编辑内容');
    if (decision === 'cancel') return;
    if (decision === 'save' && !saveDraft(true)) return;
  }
  // Keep the outgoing page inside the batch queue before it is overwritten.
  queueCapture(state.content.path);
  const path = currentPathValue().replace(/^\/+/, '');
  if (!path) {
    toast('请先填写仓库路径。', 'error');
    return;
  }
  const client = new GitHubClient(sessionToken);
  const button = $('#btn-content-load');
  const oldLabel = button.textContent;
  button.disabled = true;
  button.textContent = '加载中…';
  try {
    const file = await client.loadFile(CONTENT_OWNER, CONTENT_REPO, path, state.settings.branch || '');
    const split = splitFrontmatter(file.text);
    state.content.path = path;
    state.content.fmRaw = split.raw;
    state.content.body = split.body.replace(/^\n+/, '');
    state.content.loadedSha = file.sha;
    state.content.loadedPath = path;
    state.content.loadedFmRaw = split.raw;
    state.content.loadedBody = split.body.replace(/^\n+/, '');
    state.content.ref = state.settings.branch || '';
    state.content.editorTab = 'body';
    els.contentPath.value = path;
    bodyEditor.setValue(state.content.body, { reset: true });
    fmEditor.setValue(state.content.fmRaw, { reset: true });
    populateFmForm();
    syncEditorVisibility();
    dirty = false;
    lastIssues = [];
    issuesStale = true;
    applyInlineDiagnostics();
    updateDocMeta();
    updateStats();
    updateSaveStatus();
    saveState(state);
    captureSessionBaseline();
    toast(`已加载 ${CONTENT_OWNER}/${CONTENT_REPO}/${path}`, 'success');
  } catch (error) {
    toast(error.message || '加载失败。', 'error');
    if (error instanceof GitHubError && error.status === 401) openSettings();
  } finally {
    button.disabled = false;
    button.textContent = oldLabel;
  }
}

/* ------------------------------------------------------------- new game */

function newGamePathFrom(body) {
  const game = body.querySelector('#new-game').value.trim();
  const category = body.querySelector('#new-category').value.trim();
  const rawPage = body.querySelector('#new-page').value.trim();
  if (!game || !category || !rawPage) return '';
  const file = /\.mdx?$/i.test(rawPage) ? rawPage : `${rawPage}.md`;
  return `games/${game}/${category}/${file}`;
}

function openNewGameDialog() {
  const body = document.createElement('div');
  body.innerHTML = `
    <div class="form-grid">
      <div class="form-note is-accent">
        新建游戏只需填写目录与首个页面。<strong>Git 不能保存空文件夹</strong>，
        提交 PR 时会随页面文件自动创建 <code>games/&lt;游戏&gt;/&lt;分类&gt;/</code>。
        创建后会清空当前编辑器内容与待上传图片。
      </div>
      ${formField('游戏目录名', '<input class="input mono" id="new-game" placeholder="Satisfactory" autocomplete="off">', '游戏目录名会成为 URL 顶层；不得包含非法字符，也不得与 search / pagefind / _astro / 404 / about 冲突。')}
      <div class="form-grid-2">
        ${formField('分类目录', '<input class="input mono" id="new-category" value="Guides" autocomplete="off">')}
        ${formField('首个页面文件名', '<input class="input mono" id="new-page" value="New-Page.md" autocomplete="off">', '未写扩展名时自动补 .md；扩展名必须是小写 .md / .mdx。')}
      </div>
      ${formField('页面标题（可选）', '<input class="input" id="new-title" placeholder="例如：游戏总览">', '填写后会写入 frontmatter 的 title 字段。')}
      <div class="form-note" id="new-game-preview"></div>
    </div>
  `;
  const preview = body.querySelector('#new-game-preview');
  const refresh = () => {
    const path = newGamePathFrom(body);
    preview.innerHTML = `将创建：<code>${escapeHtml(path || 'games/<游戏>/<分类>/<页面>.md')}</code>`;
  };
  for (const input of body.querySelectorAll('input')) input.addEventListener('input', refresh);
  refresh();

  const modal = openModal({
    title: '新建游戏 / 文件夹',
    subtitle: '路径与首个页面会在提交 PR 时创建',
    body,
    size: 'normal',
    footer: [
      { label: '取消', className: 'btn-ghost', onClick: () => modal.close() },
      {
        label: '创建页面',
        className: 'btn-primary',
        onClick: async () => {
          const path = newGamePathFrom(body);
          if (!path) {
            toast('请填写游戏目录、分类与页面文件名。', 'error');
            return;
          }
          const errors = validateContentPath(path).filter((item) => item.severity === 'error');
          if (errors.length) {
            toast(errors[0].message, 'error', 4200);
            return;
          }
          const decision = await confirmBeforeDestructive('新建页面会清空当前编辑内容与待上传资源');
          if (decision === 'cancel') {
            toast('已取消新建，当前页面未改动。', 'info', 2600);
            return;
          }
          if (decision === 'save' && !saveDraft(true)) return;
          const title = body.querySelector('#new-title').value.trim();
          state.content.path = path;
          state.content.fmRaw = title ? setYamlField('', 'title', title) : '';
          state.content.body = '';
          state.content.loadedSha = null;
          state.content.loadedPath = '';
          state.content.loadedFmRaw = '';
          state.content.loadedBody = '';
          state.content.ref = '';
          state.content.editorTab = 'body';
          state.content.lastSaved = 0;
          assets.splice(0, assets.length);
          els.contentPath.value = path;
          bodyEditor.setValue('', { reset: true });
          fmEditor.setValue(state.content.fmRaw, { reset: true });
          renderAssets();
          renderFmForm();
          populateFmForm();
          syncEditorVisibility();
          dirty = false;
          lastIssues = [];
          issuesStale = true;
          applyInlineDiagnostics();
          saveState(state);
          captureSessionBaseline();
          updateDocMeta();
          updateStats();
          updateSaveStatus();
          modal.close();
          toast(`已新建 ${path}；提交 PR 时会创建对应文件夹。`, 'success', 4200);
        },
      },
    ],
  });
}

function saveDraft(manual = false) {
  clearTimeout(saveTimer);
  if (typeof flushFmChanges === 'function') flushFmChanges();
  state.content.body = bodyEditor.value;
  state.content.fmRaw = fmEditor.value;
  state.content.lastSaved = Date.now();
  const ok = saveState(state);
  const title = frontmatterData(state.content.fmRaw).title || stripExt(basename(state.content.path)) || '';
  const saved = saveDraftRecord({
    path: state.content.path,
    title,
    fmRaw: state.content.fmRaw,
    body: state.content.body,
    savedAt: state.content.lastSaved,
    loadedPath: state.content.loadedPath,
    loadedFmRaw: state.content.loadedFmRaw,
    loadedBody: state.content.loadedBody,
  });
  if (ok && saved) dirty = false;
  updateSaveStatus();
  updateStats();
  updateDraftBadge();
  if (manual) {
    toast(
      ok && saved ? '草稿已保存到本地（可在「最近草稿」中切换）。' : '本地保存失败（可能是存储空间不足）。',
      ok && saved ? 'success' : 'error',
    );
  }
  return ok && saved;
}

function exportCurrentFile() {
  const content = assembleDocument();
  const name = basename(currentPathValue()) || 'untitled.md';
  downloadText(name, content, 'text/plain;charset=utf-8');
  toast(`已导出 ${name}`, 'success');
}

/* ------------------------------------------------------------- repo browser */

function openRepoBrowser(startDir = 'games') {
  let current = startDir;
  let list = [];

  const body = document.createElement('div');
  body.innerHTML = `
    <div class="form-grid">
      <div class="form-grid-2" style="grid-template-columns:1fr auto">
        <input class="input mono" id="browser-path" placeholder="仓库路径，例如 games/Satisfactory" autocomplete="off">
        <button class="btn" id="browser-go" type="button">打开</button>
      </div>
      <div class="form-note" id="browser-hint">读取 ${CONTENT_OWNER}/${CONTENT_REPO} · 分支 ${escapeHtml(state.settings.branch || '默认')}。目录优先，点击 Markdown 文件即可加载。</div>
      <div id="browser-list" style="min-height:160px"></div>
    </div>
  `;

  const modal = openModal({
    title: '浏览 Content 仓库',
    subtitle: `${CONTENT_OWNER}/${CONTENT_REPO}`,
    body,
    size: 'wide',
    footer: [{ label: '取消', className: 'btn-ghost', onClick: () => modal.close() }],
  });

  const pathInput = body.querySelector('#browser-path');
  const listEl = body.querySelector('#browser-list');
  const hintEl = body.querySelector('#browser-hint');
  const allowed = (name) => /\.(md|mdx)$/i.test(name);

  async function load(path) {
    current = path.replace(/^\/+|\/+$/g, '');
    pathInput.value = current;
    listEl.innerHTML = '<p class="empty-mini" style="padding:14px 4px">加载中…</p>';
    try {
      const client = new GitHubClient(sessionToken);
      list = await client.listDir(CONTENT_OWNER, CONTENT_REPO, current, state.settings.branch || '');
      const rows = [];
      if (current) {
        rows.push(
          '<button class="issue-item" type="button" data-dir=".."><span class="issue-badge">目录</span><span style="flex:1">.. 返回上级</span></button>',
        );
      }
      for (const item of list) {
        if (item.type === 'dir') {
          rows.push(
            `<button class="issue-item" type="button" data-dir="${escapeHtml(item.path)}"><span class="issue-badge" style="color:var(--accent)">目录</span><span style="flex:1">${escapeHtml(item.name)}</span></button>`,
          );
        } else if (allowed(item.name)) {
          rows.push(
            `<button class="issue-item" type="button" data-file="${escapeHtml(item.path)}"><span class="issue-badge" style="color:var(--text-faint)">页面</span><span style="flex:1">${escapeHtml(item.name)}</span><span class="issue-line">${formatBytes(item.size)}</span></button>`,
          );
        }
      }
      if (!rows.length)
        rows.push('<p class="empty-mini" style="padding:14px 4px">此目录没有可编辑的 Markdown 页面。</p>');
      listEl.innerHTML = `<div class="issue-list">${rows.join('')}</div>`;
      hintEl.textContent = `${CONTENT_OWNER}/${CONTENT_REPO}/${current} · ${list.length} 个条目`;
    } catch (error) {
      listEl.innerHTML = `<div class="form-note is-warn">${escapeHtml(error.message)}</div>`;
      if (error instanceof GitHubError && error.status === 401) hintEl.textContent = 'token 无效，请打开设置重新填写。';
    }
  }

  body.addEventListener('click', async (event) => {
    const dir = event.target.closest('[data-dir]');
    if (dir) {
      const target = dir.dataset.dir;
      if (target === '..') {
        const parts = current.split('/').filter(Boolean);
        parts.pop();
        load(parts.join('/'));
      } else {
        load(target);
      }
      return;
    }
    const file = event.target.closest('[data-file]');
    if (file) {
      const target = file.dataset.file;
      const returnDir = current;
      modal.close();
      const decision = await confirmBeforeDestructive('打开另一个页面会替换当前编辑内容');
      if (decision === 'cancel') {
        openRepoBrowser(returnDir);
        return;
      }
      if (decision === 'save' && !saveDraft(true)) {
        openRepoBrowser(returnDir);
        return;
      }
      state.content.path = target;
      els.contentPath.value = target;
      updateDocMeta();
      loadCurrentFile({ skipConfirm: true });
    }
  });

  pathInput.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      load(pathInput.value.trim());
    }
  });
  body.querySelector('#browser-go').addEventListener('click', () => load(pathInput.value.trim()));
  load(current);
}

/* -------------------------------------------------------------- preview */

function repoRawUrl(path) {
  const ref = state.content.ref || state.settings.branch || 'main';
  const encodedPath = String(path).split('/').map(encodeURIComponent).join('/');
  return `https://raw.githubusercontent.com/${CONTENT_OWNER}/${CONTENT_REPO}/${encodeURIComponent(ref)}/${encodedPath}`;
}

/** Candidate repository paths for a click-to-load preview image. */
function previewImageCandidates(el, pagePath) {
  const wikiName = el.dataset.wikiFile;
  if (wikiName) {
    const game = gameOfPath(pagePath);
    if (!game) return [];
    const dir = `games/${game}/${GAME_IMAGE_DIR}`;
    const hasExt = /\.[a-z0-9]+$/i.test(wikiName);
    const names = hasExt
      ? [wikiName]
      : ['png', 'jpg', 'jpeg', 'webp', 'avif', 'gif', 'svg'].map((ext) => `${wikiName}.${ext}`);
    return names.map((name) => {
      const path = `${dir}/${name}`;
      return { path, url: repoRawUrl(path) };
    });
  }
  const src = el.dataset.markdownSrc;
  if (!src) return [];
  const dir = pagePath.includes('/') ? pagePath.slice(0, pagePath.lastIndexOf('/') + 1) : '';
  try {
    const base = `https://github.com/${CONTENT_OWNER}/${CONTENT_REPO}/blob/HEAD/${dir}`;
    const resolved = new URL(src, base);
    const marker = '/blob/HEAD/';
    const index = resolved.pathname.indexOf(marker);
    if (index === -1) return [];
    const path = decodeURIComponent(resolved.pathname.slice(index + marker.length));
    return [{ path, url: repoRawUrl(path) }];
  } catch {
    return [];
  }
}

function loadPreviewImage(el, pagePath) {
  if (el.dataset.loading === '1') return;
  el.dataset.loading = '1';
  el.classList.add('is-loading');
  const hint = el.querySelector('.wf-image-placeholder__hint');
  if (hint) hint.textContent = '加载中…';

  const fail = () => {
    el.dataset.loading = '';
    el.classList.remove('is-loading');
    el.classList.add('is-error');
    if (hint) hint.textContent = '无法加载，请检查文件名';
    toast(`无法加载图片：${el.dataset.wikiFile || el.dataset.markdownSrc || ''}`, 'error');
  };

  const candidates = previewImageCandidates(el, pagePath);
  let index = 0;
  const attempt = () => {
    if (index >= candidates.length) {
      fail();
      return;
    }
    const candidate = candidates[index];
    index += 1;
    const img = new Image();
    img.onload = () => {
      img.className = 'wf-lazy-image';
      img.alt = el.dataset.wikiAlt || '';
      img.loading = 'lazy';
      img.decoding = 'async';
      img.dataset.wikiPath = candidate.path;
      el.replaceWith(img);
    };
    img.onerror = attempt;
    img.src = candidate.url;
  };
  attempt();
}

function attachLazyPreviewImages(article, pagePath = state.content.path) {
  for (const el of article.querySelectorAll('.wf-image-placeholder')) {
    if (!el.dataset.wikiFile && !el.dataset.markdownSrc) continue;
    el.addEventListener('click', () => loadPreviewImage(el, pagePath));
    el.addEventListener('keydown', (event) => {
      if (event.key !== 'Enter' && event.key !== ' ') return;
      event.preventDefault();
      loadPreviewImage(el, pagePath);
    });
  }
}

function loadPreviewAudio(el, pagePath) {
  if (el.dataset.loading === '1') return;
  const game = gameOfPath(pagePath);
  const file = el.dataset.audioFile || '';
  const title = el.dataset.audioTitle || '';
  const hint = el.querySelector('.wf-audio-hint');

  const asset = assets.find((item) => basename(item.path).toLowerCase() === file.toLowerCase());
  const url = asset?.dataUrl || (game ? repoRawUrl(`games/${game}/${GAME_AUDIO_DIR}/${file}`) : '');
  if (!url) {
    el.classList.add('is-error');
    if (hint) hint.textContent = '无法定位音频文件：请确认页面位于 games/<游戏>/ 下';
    return;
  }

  el.dataset.loading = '1';
  el.classList.add('is-loading');
  if (hint) hint.textContent = '加载中…';

  const audio = document.createElement('audio');
  audio.controls = true;
  audio.preload = 'metadata';
  audio.src = url;

  const wrap = document.createElement('span');
  wrap.className = 'wf-audio wf-audio--loaded is-loading';
  wrap.append(audio);
  if (title) {
    const caption = document.createElement('span');
    caption.className = 'wf-audio-title';
    caption.textContent = title;
    wrap.append(caption);
  }
  const source = document.createElement('span');
  source.className = 'wf-audio-source';
  source.textContent = asset ? `来源：本次待上传文件 · ${asset.path}` : `来源：${game}/${GAME_AUDIO_DIR}/${file} · OGG`;
  wrap.append(source);
  el.replaceWith(wrap);

  audio.addEventListener('loadedmetadata', () => wrap.classList.remove('is-loading'));
  audio.addEventListener('error', () => {
    wrap.classList.remove('is-loading');
    wrap.classList.add('is-error');
    audio.remove();
    const problem = document.createElement('span');
    problem.className = 'wf-audio-error';
    problem.textContent = asset
      ? '音频无法播放：文件可能不是有效的 OGG。'
      : `音频无法播放：文件不存在，或浏览器不支持 OGG。请确认 ${game}/${GAME_AUDIO_DIR}/${file}。`;
    wrap.append(problem);
    if (!asset) {
      const link = document.createElement('a');
      link.className = 'wf-audio-open';
      link.href = url;
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
      link.textContent = '打开原文件';
      wrap.append(link);
    }
    toast(`无法加载音频：${file}`, 'error');
  });
}

function attachLazyPreviewAudio(article, pagePath = state.content.path) {
  for (const el of article.querySelectorAll('.wf-audio[data-audio-file]')) {
    el.addEventListener('click', () => loadPreviewAudio(el, pagePath));
    el.addEventListener('keydown', (event) => {
      if (event.key !== 'Enter' && event.key !== ' ') return;
      event.preventDefault();
      loadPreviewAudio(el, pagePath);
    });
  }
}

function openPreview() {
  flushFmChanges();
  const map = assetsForPreview();
  let result;
  try {
    result = buildPreview({
      path: state.content.path,
      fmRaw: state.content.fmRaw,
      body: state.content.body,
      assets: map,
      article: els.previewArticle,
    });
  } catch (error) {
    toast(`预览渲染失败：${error.message}`, 'error');
    return;
  }
  attachLazyPreviewImages(els.previewArticle);
  attachLazyPreviewAudio(els.previewArticle);
  els.previewTitle.textContent = result.title || '页面预览';
  els.previewToc.hidden = !(result.toc && result.toc.count >= 2);
  els.previewTocNav.innerHTML = result.toc?.html || '';
  els.previewScroll.scrollTop = 0;
  els.previewOverlay.hidden = false;
  document.body.style.overflow = 'hidden';
  setTimeout(() => $('#btn-preview-close')?.focus(), 30);
  els.previewTitle.title = '按需预览：仓库图片 / 音频会显示占位块，点击后加载';
}

function closePreview() {
  els.previewOverlay.hidden = true;
  document.body.style.overflow = '';
  activeEditor().focus();
}

attachToc(els.previewArticle, els.previewTocNav);

/* -------------------------------------------------------------- dialogs */

function formField(label, inner, help = '') {
  return `<label class="field"><span class="form-label">${escape(label)}</span>${inner}${help ? `<p class="form-help">${help}</p>` : ''}</label>`;
}

function colorChips(selected, kind) {
  const entries = [['', '无'], ...Object.entries(COLOR_TOKENS).map(([key, value]) => [key, `${key} ${value}`])];
  return `<div class="chip-row">${entries
    .map(
      ([key, label]) => `
    <button type="button" class="chip ${selected === key ? 'is-active' : ''}" data-color-kind="${kind}" data-color="${key}">
      ${key ? `<span class="chip-swatch" style="background:${COLOR_TOKENS[key]}"></span>` : ''}${escape(label)}
    </button>`,
    )
    .join('')}</div>`;
}

function formatColorToken(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  if (/^[ROYGBPK]$/i.test(raw)) return `&${raw.toUpperCase()}`;
  return raw;
}

function openLinkDialog() {
  if (state.content.editorTab === 'frontmatter') {
    toast('请切换到正文。', 'info');
    return;
  }
  const editor = bodyEditor;
  const selection = editor.selection;
  const selected = editor.value.slice(selection.start, selection.end);
  const body = document.createElement('div');
  body.innerHTML = `
    <div class="form-grid">
      ${formField('显示文字', '<input class="input" id="link-text" placeholder="链接文字" autocomplete="off">')}
      ${formField('链接地址', '<input class="input mono" id="link-url" placeholder="https://example.com" autocomplete="off">', '支持 https:// 或站内相对路径；留空时使用 #。')}
      <pre class="modal-preview" id="link-preview"></pre>
    </div>
  `;
  const textInput = body.querySelector('#link-text');
  const urlInput = body.querySelector('#link-url');
  textInput.value = selected;
  const refresh = () => {
    const text = textInput.value.trim() || '链接文字';
    const url = urlInput.value.trim() || '#';
    body.querySelector('#link-preview').textContent = `[${text}](${url})`;
  };
  textInput.addEventListener('input', refresh);
  urlInput.addEventListener('input', refresh);
  refresh();

  const modal = openModal({
    title: '插入 Markdown 链接',
    subtitle: '[显示文字](链接地址)',
    body,
    footer: [
      { label: '取消', className: 'btn-ghost', onClick: () => modal.close() },
      {
        label: '插入',
        className: 'btn-primary',
        onClick: () => {
          const text = textInput.value.trim() || '链接文字';
          const url = urlInput.value.trim() || '#';
          const snippet = `[${text}](${url})`;
          editor.replaceRange(selection.start, selection.end, snippet, snippet.length, snippet.length);
          modal.close();
        },
      },
    ],
  });
}

function openCalloutDialog() {
  if (state.content.editorTab === 'frontmatter') {
    toast('请切换到正文。', 'info');
    return;
  }
  const editor = bodyEditor;
  const selected = editor.value.slice(editor.selection.start, editor.selection.end);
  let kind = 'warning';
  const body = document.createElement('div');
  body.innerHTML = `
    <div class="form-grid">
      <div>
        <span class="form-label">横幅类型</span>
        <div class="chip-row" id="callout-kinds">
          ${Object.entries(CALLOUTS)
            .map(
              ([key, preset]) =>
                `<button type="button" class="chip ${key === kind ? 'is-active' : ''}" data-kind="${key}">${escape(key)} · ${escape(preset.label)}</button>`,
            )
            .join('')}
        </div>
      </div>
      ${formField('标题（可留空）', '<input class="input" id="callout-title" value="注意" autocomplete="off">')}
      ${formField('正文内容', '<textarea class="input" id="callout-content" rows="5" placeholder="支持行内 Markdown"></textarea>')}
      <pre class="modal-preview" id="callout-preview"></pre>
    </div>
  `;
  const titleInput = body.querySelector('#callout-title');
  const contentInput = body.querySelector('#callout-content');
  contentInput.value = selected;

  const refresh = () => {
    const title = titleInput.value.trim();
    const lines = [
      `:::${kind}${title ? `[${title.replaceAll(']', '\\]')}]` : ''}`,
      contentInput.value || '内容',
      ':::',
    ];
    body.querySelector('#callout-preview').textContent = lines.join('\n');
  };
  body.addEventListener('click', (event) => {
    const chip = event.target.closest('[data-kind]');
    if (!chip) return;
    const previousLabel = CALLOUTS[kind]?.label;
    kind = chip.dataset.kind;
    for (const button of body.querySelectorAll('[data-kind]')) button.classList.toggle('is-active', button === chip);
    if (titleInput.value === previousLabel) titleInput.value = CALLOUTS[kind].label;
    refresh();
  });
  body.addEventListener('input', refresh);
  refresh();

  const modal = openModal({
    title: '插入横幅 / 提示框',
    subtitle: ':::类型[标题] … :::',
    body,
    footer: [
      { label: '取消', className: 'btn-ghost', onClick: () => modal.close() },
      {
        label: '插入',
        className: 'btn-primary',
        onClick: () => {
          const title = titleInput.value.trim();
          const text = contentInput.value.trim();
          const bodyText = text ? `${text}${CURSOR}` : CURSOR;
          const block = `:::${kind}${title ? `[${title.replaceAll(']', '\\]')}]` : ''}\n${bodyText}\n:::`;
          editor.insertBlock(block);
          modal.close();
        },
      },
    ],
  });
}

function openIconDialog() {
  if (state.content.editorTab === 'frontmatter') {
    toast('请切换到正文。', 'info');
    return;
  }
  const game = gameOfPath(state.content.path);
  let name = '';
  let size = 'sm';
  let bg = '';
  let fg = '';
  let picked = null;
  const body = document.createElement('div');
  body.innerHTML = `
    <div class="form-grid">
      <div class="form-note is-accent">
        图标属于<strong>内联小图标</strong>，放在 <code>games/&lt;游戏&gt;/${GAME_ICON_DIR}/&lt;名称&gt;.&lt;ext&gt;</code>；
        正文大图放在 <code>/${GAME_IMAGE_DIR}/</code>，请使用「插入图片」。
      </div>
      <div class="form-grid-2">
        <label class="field"><span class="form-label">图标文件（可选，svg / png / webp …）</span><input class="input" id="icon-file" type="file" accept=".svg,.png,.webp,.jpg,.jpeg,.avif,.gif"></label>
        <label class="field"><span class="form-label">上传路径</span><input class="input mono" id="icon-upload-path" autocomplete="off" placeholder="${escapeHtml(`games/<游戏>/${GAME_ICON_DIR}/<名称>.<ext>`)}"></label>
      </div>
      <label class="check-row"><input type="checkbox" id="icon-upload" checked><span>随 PR 上传到该游戏的 assets/icons/</span></label>
      ${formField('图标名称', '<input class="input mono" id="icon-name" placeholder="iron-plate（不含扩展名）" autocomplete="off">', `名称须与 <code>games/&lt;游戏&gt;/${GAME_ICON_DIR}/</code> 下的文件名主干一致，只允许字母 / 数字 / . _ -。`)}
      <p class="form-help" id="icon-status"></p>
      <div>
        <span class="form-label">尺寸</span>
        <div class="chip-row" id="icon-sizes">${ICON_SIZES.map((item) => `<button type="button" class="chip ${item === size ? 'is-active' : ''}" data-size="${item}">${item}</button>`).join('')}</div>
      </div>
      <div><span class="form-label">背景色 bg</span>${colorChips(bg, 'bg')}</div>
      <div><span class="form-label">文字色 fg</span>${colorChips(fg, 'fg')}</div>
      <pre class="modal-preview" id="icon-preview"></pre>
    </div>
  `;
  const nameInput = body.querySelector('#icon-name');
  const fileInput = body.querySelector('#icon-file');
  const uploadCheck = body.querySelector('#icon-upload');
  const uploadPathInput = body.querySelector('#icon-upload-path');
  const statusEl = body.querySelector('#icon-status');

  const defaultPath = (value, ext = ICON_EXTENSIONS[0]) =>
    game ? `games/${game}/${GAME_ICON_DIR}/${value}.${ext}` : `${GAME_ICON_DIR}/${value}.${ext}`;
  const sanitizeName = (value) =>
    String(value || '')
      .replace(/\.[^.]+$/, '')
      .replace(/[^a-zA-Z0-9._-]+/g, '-')
      .replace(/^-+|-+$/g, '');

  const refresh = () => {
    const parts = [`icon=${name || 'name'}`];
    if (size !== 'sm') parts.push(`size=${size}`);
    if (bg) parts.push(`bg=&${bg}`);
    if (fg) parts.push(`fg=&${fg}`);
    body.querySelector('#icon-preview').textContent = `[${parts.join(';')}]`;
  };

  let statusSeq = 0;
  const refreshStatus = async () => {
    const seq = ++statusSeq;
    statusEl.style.color = '';
    if (!name) {
      statusEl.textContent = '填写名称后会检查该图标是否已存在于仓库。';
      return;
    }
    if (!ICON_NAME_RE.test(name) || name.includes('..')) {
      statusEl.style.color = 'var(--danger)';
      statusEl.textContent = '名称不合法：只允许字母 / 数字 / . _ -，且不能包含 ..';
      return;
    }
    const willUpload = !!picked && uploadCheck.checked;
    if (willUpload) {
      statusEl.textContent = `将随 PR 上传：${uploadPathInput.value.trim() || defaultPath(name)}`;
      return;
    }
    if (assets.some((asset) => asset.path === defaultPath(name))) {
      statusEl.textContent = '该图标已加入本次待上传列表。';
      return;
    }
    const index = await ensureRepoIndex();
    if (seq !== statusSeq) return;
    if (!index.paths) {
      statusEl.textContent = '无法读取仓库文件列表，暂不能确认图标是否存在；提交前会再次检查。';
      return;
    }
    const exists = repositoryIconNames(index.paths, game).has(name);
    statusEl.style.color = exists ? 'var(--success)' : 'var(--danger)';
    statusEl.textContent = exists
      ? `已在仓库中找到：games/${game}/${GAME_ICON_DIR}/${name}.<ext>`
      : `仓库中不存在：${defaultPath(name)}（内容门禁会阻断，请上传或修正名称）`;
  };

  body.addEventListener('click', (event) => {
    const sizeChip = event.target.closest('[data-size]');
    if (sizeChip) {
      size = sizeChip.dataset.size;
      for (const chip of body.querySelectorAll('[data-size]')) chip.classList.toggle('is-active', chip === sizeChip);
      refresh();
      return;
    }
    const colorChip = event.target.closest('[data-color-kind]');
    if (colorChip) {
      const kind = colorChip.dataset.colorKind;
      if (kind === 'bg') bg = colorChip.dataset.color;
      else fg = colorChip.dataset.color;
      for (const chip of body.querySelectorAll(`[data-color-kind="${kind}"]`))
        chip.classList.toggle('is-active', chip === colorChip);
      refresh();
    }
  });

  fileInput.addEventListener('change', () => {
    const file = fileInput.files?.[0];
    if (!file) return;
    const ext = (file.name.split('.').pop() || '').toLowerCase();
    if (!ICON_EXTENSIONS.includes(ext)) {
      fileInput.value = '';
      toast(`图标格式 .${ext || '?'} 不受支持：${ICON_EXTENSIONS.join(' / ')}`, 'error', 4200);
      return;
    }
    if (tooLarge(file)) {
      fileInput.value = '';
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      picked = {
        file,
        dataUrl: String(reader.result),
        base64: String(reader.result).split(',')[1] || '',
        size: file.size,
        ext,
      };
      name = sanitizeName(file.name);
      nameInput.value = name;
      uploadPathInput.value = defaultPath(name, ext);
      uploadCheck.checked = true;
      refresh();
      refreshStatus();
    };
    reader.readAsDataURL(file);
  });

  let statusTimer = 0;
  nameInput.addEventListener('input', () => {
    name = nameInput.value.trim();
    if (picked) uploadPathInput.value = defaultPath(sanitizeName(name), picked.ext);
    refresh();
    clearTimeout(statusTimer);
    statusTimer = setTimeout(refreshStatus, 300);
  });
  uploadCheck.addEventListener('change', refreshStatus);
  uploadPathInput.addEventListener('input', refreshStatus);
  refresh();
  refreshStatus();

  const modal = openModal({
    title: '插入内联图标',
    subtitle: '[icon=名称;size=…;bg=…;fg=…]',
    body,
    footer: [
      { label: '取消', className: 'btn-ghost', onClick: () => modal.close() },
      {
        label: '插入',
        className: 'btn-primary',
        onClick: async () => {
          if (!name) {
            toast('请填写图标名称。', 'error');
            return;
          }
          if (!ICON_NAME_RE.test(name) || name.includes('..')) {
            toast('图标名称不合法：只允许字母 / 数字 / . _ -。', 'error');
            return;
          }
          if (!game) {
            toast('请先在「页面位置」填写 games/<游戏>/… 路径，图标必须放在该游戏的 assets/icons/ 下。', 'error', 4600);
            return;
          }
          const willUpload = !!picked && uploadCheck.checked;
          const uploadPath = (uploadPathInput.value.trim() || defaultPath(name, picked?.ext)).replace(/^\/+/, '');
          if (willUpload) {
            if (!uploadPath || uploadPath.includes('..') || uploadPath.startsWith('/')) {
              toast('上传路径不合法。', 'error');
              return;
            }
            if (!uploadPath.startsWith(`games/${game}/${GAME_ICON_DIR}/`)) {
              toast(`图标上传路径必须位于 games/${game}/${GAME_ICON_DIR}/。`, 'error', 4200);
              return;
            }
            const existing = assets.findIndex((asset) => asset.path === uploadPath);
            const asset = {
              path: uploadPath,
              name: `${name}.${picked.ext}`,
              dataUrl: picked.dataUrl,
              base64: picked.base64,
              size: picked.size,
            };
            if (existing >= 0) assets.splice(existing, 1, asset);
            else assets.push(asset);
            renderAssets();
          } else {
            const index = await ensureRepoIndex();
            if (index.paths && !repositoryIconNames(index.paths, game).has(name)) {
              statusEl.style.color = 'var(--danger)';
              statusEl.textContent = `仓库中不存在：${defaultPath(name)}`;
              toast(`图标不存在：${defaultPath(name)}。请上传图标或修正名称，否则门禁会阻断 PR。`, 'error', 5200);
              return;
            }
          }
          const parts = [`icon=${name}`];
          if (size !== 'sm') parts.push(`size=${size}`);
          if (bg) parts.push(`bg=&${bg}`);
          if (fg) parts.push(`fg=&${fg}`);
          bodyEditor.insert(`[${parts.join(';')}]`);
          modal.close();
          toast(willUpload ? `图标已加入待上传列表：${uploadPath}` : '已插入图标标记。', 'success');
        },
      },
    ],
  });
}

function openCellColorDialog() {
  if (state.content.editorTab === 'frontmatter') {
    toast('请切换到正文。', 'info');
    return;
  }
  const editor = bodyEditor;
  const selection = editor.selection;
  let bg = '';
  let fg = '';
  const body = document.createElement('div');
  body.innerHTML = `
    <div class="form-grid">
      <div class="form-note">标记会加在选中内容最前面；不选中时插入到光标处。颜色受主题影响时请同时设置 bg 与 fg。</div>
      <div><span class="form-label">背景色 bg</span>${colorChips(bg, 'bg')}</div>
      <div><span class="form-label">文字色 fg</span>${colorChips(fg, 'fg')}</div>
      <div class="form-grid-2">
        <label class="field"><span class="form-label">自定义 bg</span><input class="input mono" id="cell-bg-custom" placeholder="#ffe0b2"></label>
        <label class="field"><span class="form-label">自定义 fg</span><input class="input mono" id="cell-fg-custom" placeholder="#7a4f01"></label>
      </div>
      <pre class="modal-preview" id="cell-preview"></pre>
    </div>
  `;
  const refresh = () => {
    const parts = [];
    if (bg) parts.push(`bg=${formatColorToken(bg)}`);
    if (fg) parts.push(`fg=${formatColorToken(fg)}`);
    body.querySelector('#cell-preview').textContent = parts.length
      ? `[${parts.join(';')}]颜色内容`
      : '（尚未选择颜色）';
  };
  body.addEventListener('click', (event) => {
    const chip = event.target.closest('[data-color-kind]');
    if (!chip) return;
    if (chip.dataset.colorKind === 'bg') bg = chip.dataset.color;
    else fg = chip.dataset.color;
    for (const sibling of body.querySelectorAll(`[data-color-kind="${chip.dataset.colorKind}"]`)) {
      sibling.classList.toggle('is-active', sibling === chip);
    }
    refresh();
  });
  body.querySelector('#cell-bg-custom').addEventListener('input', (event) => {
    bg = event.target.value.trim();
    refresh();
  });
  body.querySelector('#cell-fg-custom').addEventListener('input', (event) => {
    fg = event.target.value.trim();
    refresh();
  });
  refresh();

  const modal = openModal({
    title: '表格单元格颜色',
    subtitle: '[bg=…;fg=…] 紧贴单元格内容最前面',
    body,
    footer: [
      { label: '取消', className: 'btn-ghost', onClick: () => modal.close() },
      {
        label: '插入',
        className: 'btn-primary',
        onClick: () => {
          const parts = [];
          if (bg) parts.push(`bg=${formatColorToken(bg)}`);
          if (fg) parts.push(`fg=${formatColorToken(fg)}`);
          if (!parts.length) {
            toast('请选择至少一个颜色。', 'error');
            return;
          }
          const marker = `[${parts.join(';')}]`;
          editor.setSelection(selection.start, selection.start);
          editor.insert(marker);
          editor.setSelection(selection.start + marker.length, selection.end + marker.length);
          modal.close();
        },
      },
    ],
  });
}

/* ---------------------------------------------------------- table builder */

function openTableDialog() {
  if (state.content.editorTab === 'frontmatter') {
    toast('请切换到正文。', 'info');
    return;
  }
  const editor = bodyEditor;
  const tpl = state.settings.templates;
  const body = document.createElement('div');
  body.innerHTML = `
    <div class="form-grid">
      <div class="form-grid-2">
        <label class="field"><span class="form-label">数据行数（长）</span><input class="input" id="table-rows" type="number" min="1" max="50" value="3"></label>
        <label class="field"><span class="form-label">列数（宽）</span><input class="input" id="table-cols" type="number" min="1" max="12" value="3"></label>
      </div>
      <div class="form-grid-2">
        <label class="field"><span class="form-label">对齐</span>
          <select class="input" id="table-align">
            <option value="left">左对齐</option>
            <option value="center">居中</option>
            <option value="right">右对齐</option>
          </select>
        </label>
        <label class="field"><span class="form-label">表头文字模板</span><input class="input mono" id="table-header-template" value="列 {c}"></label>
      </div>
      <label class="field"><span class="form-label">单元格填充模板（自定义格式）</span>
        <input class="input mono" id="table-cell-template" value="${escapeHtml(tpl.tableCell || '')}" placeholder="例如 [bg=&G] {r}-{c}">
        <p class="form-help">可用占位符：<code>{r}</code> 行号、<code>{c}</code> 列号、<code>{r0}</code> / <code>{c0}</code> 从 0 开始。留空则单元格空白。</p>
      </label>
      <label class="check-row"><input type="checkbox" id="table-header" checked><span>生成表头行（Markdown 表格必须有表头，未勾选时表头留空）</span></label>
      <label class="check-row"><input type="checkbox" id="table-compact"><span>紧凑格式（无多余空格）</span></label>
      <details>
        <summary style="font-size:12px;color:var(--text-soft);cursor:pointer;padding:4px 0">高级：自定义表格源码模板</summary>
        <label class="field" style="margin-top:8px">
          <span class="form-label">源码模板</span>
          <textarea class="input mono" id="table-advanced" rows="4" placeholder="留空则自动生成。可用 {header}、{separator}、{body}"></textarea>
        </label>
      </details>
      <pre class="modal-preview" id="table-preview"></pre>
    </div>
  `;

  const rowsInput = body.querySelector('#table-rows');
  const colsInput = body.querySelector('#table-cols');
  const alignInput = body.querySelector('#table-align');
  const headerTemplate = body.querySelector('#table-header-template');
  const cellTemplate = body.querySelector('#table-cell-template');
  const headerCheck = body.querySelector('#table-header');
  const compactCheck = body.querySelector('#table-compact');
  const advanced = body.querySelector('#table-advanced');

  const fill = (template, r, c) =>
    String(template)
      .replaceAll('{r}', String(r))
      .replaceAll('{c}', String(c))
      .replaceAll('{r0}', String(r - 1))
      .replaceAll('{c0}', String(c - 1))
      .replaceAll('{value}', '')
      .replaceAll('|', '\\|')
      .replaceAll('\n', '<br>');

  const build = () => {
    const rows = Math.max(1, Math.min(50, Number(rowsInput.value) || 1));
    const cols = Math.max(1, Math.min(12, Number(colsInput.value) || 1));
    const align = alignInput.value;
    const compact = compactCheck.checked;
    const headerCells = [];
    for (let c = 1; c <= cols; c += 1) {
      headerCells.push(headerCheck.checked ? fill(headerTemplate.value, 0, c) : '');
    }
    const sepCell = align === 'center' ? ':---' : align === 'right' ? '---:' : '---';
    const pad = compact ? '' : ' ';
    const rowToLine = (cells) => `|${pad}${cells.join(`${pad}|${pad}`)}${pad}|`;
    const headerLine = rowToLine(headerCells);
    const separatorLine = rowToLine(Array.from({ length: cols }, () => sepCell));
    const bodyLines = [];
    for (let r = 1; r <= rows; r += 1) {
      const cells = [];
      for (let c = 1; c <= cols; c += 1) cells.push(fill(cellTemplate.value, r, c));
      bodyLines.push(rowToLine(cells));
    }
    if (advanced.value.trim()) {
      return advanced.value
        .replaceAll('{header}', headerLine)
        .replaceAll('{separator}', separatorLine)
        .replaceAll('{body}', bodyLines.join('\n'));
    }
    return `${headerLine}\n${separatorLine}\n${bodyLines.join('\n')}`;
  };

  const refresh = () => {
    body.querySelector('#table-preview').textContent = build();
  };
  body.addEventListener('input', refresh);
  body.addEventListener('change', refresh);
  refresh();

  const modal = openModal({
    title: '生成表格',
    subtitle: '设计行数 × 列数，支持自定义单元格填充格式',
    body,
    size: 'wide',
    footer: [
      { label: '取消', className: 'btn-ghost', onClick: () => modal.close() },
      {
        label: '插入表格',
        className: 'btn-primary',
        onClick: () => {
          state.settings.templates.tableCell = cellTemplate.value;
          saveState(state);
          editor.insertBlock(build());
          modal.close();
        },
      },
    ],
  });
}

/* ---------------------------------------------------------- image builder */

function openImageDialog() {
  if (state.content.editorTab === 'frontmatter') {
    toast('请切换到正文。', 'info');
    return;
  }
  const editor = bodyEditor;
  let picked = null;
  let style = state.settings.templates.imageStyle || 'wiki';

  const currentGame = gameOfPath(state.content.path);
  const defaultPath = (name) =>
    currentGame ? `games/${currentGame}/${GAME_IMAGE_DIR}/${name}` : `${GAME_IMAGE_DIR}/${name}`;

  const body = document.createElement('div');
  body.innerHTML = `
    <div class="form-grid">
      <div class="form-grid-2">
        <label class="field"><span class="form-label">选择图片文件（任意格式）</span><input class="input" id="img-file" type="file"></label>
        <label class="field"><span class="form-label">文件名 / 引用名</span><input class="input mono" id="img-name" placeholder="iron-plate.png" autocomplete="off"></label>
      </div>
      <div class="form-note">上传是可选的。勾选「随 PR 上传」后，图片会写入 Content 仓库；不勾选则只插入标记，图片需已在仓库中。</div>
      <div class="form-note is-accent">
        资源按类型分目录：<strong>正文大图 → <code>${GAME_IMAGE_DIR}/</code></strong>（本窗口），
        <strong>内联图标 <code>[icon=…]</code> → <code>${GAME_ICON_DIR}/</code></strong>（请使用工具栏「图标」）。
      </div>
      <label class="check-row"><input type="checkbox" id="img-upload" checked><span>随 PR 上传到 Content 仓库</span></label>
      ${formField('上传路径', '<input class="input mono" id="img-upload-path" autocomplete="off">', `正文图片默认放在 <code>games/&lt;游戏&gt;/${GAME_IMAGE_DIR}/</code>；Wiki 语法要求名称只含字母 / 数字 / . _ -。`)}
      <div class="form-grid-2">
        <label class="field"><span class="form-label">尺寸预设</span>
          <select class="input" id="img-size"><option value="sm">sm · 240</option><option value="md" selected>md · 480</option><option value="lg">lg · 800</option><option value="full">full · 100%</option></select>
        </label>
        <label class="field"><span class="form-label">对齐</span>
          <select class="input" id="img-align"><option value="">默认</option><option value="left">left</option><option value="center">center</option><option value="right">right</option></select>
        </label>
      </div>
      <div class="form-grid-2">
        <label class="check-row"><input type="checkbox" id="img-frame"><span>带边框（thumb / frame）</span></label>
        <label class="field"><span class="form-label">替代文本 alt</span><input class="input" id="img-alt" placeholder="图片说明"></label>
      </div>
      ${formField('图注 caption', '<input class="input" id="img-caption" placeholder="显示在图片下方">')}
      <div class="form-grid-2">
        <label class="field"><span class="form-label">标记风格</span>
          <select class="input" id="img-style">
            <option value="wiki">Wikifactory Wiki（[[File/…]]）</option>
            <option value="markdown">标准 Markdown（![](…)）</option>
            <option value="custom">自定义模板</option>
          </select>
        </label>
        <label class="field" id="img-template-wrap" hidden><span class="form-label">自定义模板</span><input class="input mono" id="img-template" value="${escapeHtml(state.settings.templates.imageTemplate || '[[File/{name}|{opts}]]')}"></label>
      </div>
      <p class="form-help" id="img-template-help" hidden>可用占位符：<code>{name}</code>、<code>{path}</code>、<code>{size}</code>、<code>{align}</code>、<code>{frame}</code>、<code>{alt}</code>、<code>{caption}</code>、<code>{opts}</code>。</p>
      <pre class="modal-preview" id="img-preview"></pre>
    </div>
  `;

  const fileInput = body.querySelector('#img-file');
  const nameInput = body.querySelector('#img-name');
  const uploadCheck = body.querySelector('#img-upload');
  const uploadPathInput = body.querySelector('#img-upload-path');
  const sizeInput = body.querySelector('#img-size');
  const alignInput = body.querySelector('#img-align');
  const frameCheck = body.querySelector('#img-frame');
  const altInput = body.querySelector('#img-alt');
  const captionInput = body.querySelector('#img-caption');
  const styleInput = body.querySelector('#img-style');
  const templateInput = body.querySelector('#img-template');
  const templateWrap = body.querySelector('#img-template-wrap');
  const templateHelp = body.querySelector('#img-template-help');
  styleInput.value = style;

  const sanitizeName = (name) =>
    String(name || '')
      .replace(/[^a-zA-Z0-9._-]+/g, '-')
      .replace(/^-+|-+$/g, '') || `image-${Date.now()}`;

  const getName = () => nameInput.value.trim() || (picked ? picked.file.name : '');
  const getUploadPath = () => uploadPathInput.value.trim();
  const getPath = () => (uploadCheck.checked ? getUploadPath() : getName());

  const buildMarker = () => {
    const name = getName();
    const path = getPath();
    const size = sizeInput.value;
    const align = alignInput.value;
    const frame = frameCheck.checked;
    const alt = altInput.value.trim();
    const caption = captionInput.value.trim();
    const safeAlt = alt.replaceAll('|', '\\|').replaceAll(']', '\\]');
    const safeCaption = caption.replaceAll('|', '\\|').replaceAll(']', '\\]');
    const opts = [frame ? 'thumb' : '', size, align, safeAlt ? `alt=${safeAlt}` : '', safeCaption]
      .filter(Boolean)
      .join('|');
    if (style === 'markdown') {
      return `![${alt}](${path})${caption ? ` "${caption.replaceAll('"', '\\"')}"` : ''}`;
    }
    if (style === 'custom') {
      return templateInput.value
        .replaceAll('{name}', name)
        .replaceAll('{path}', path)
        .replaceAll('{size}', size)
        .replaceAll('{align}', align)
        .replaceAll('{frame}', frame ? 'thumb' : '')
        .replaceAll('{alt}', safeAlt)
        .replaceAll('{caption}', safeCaption)
        .replaceAll('{opts}', opts);
    }
    return `[[File/${name}${opts ? `|${opts}` : ''}]]`;
  };

  let insertButton = null;
  const refresh = () => {
    templateWrap.hidden = style !== 'custom';
    templateHelp.hidden = style !== 'custom';
    uploadPathInput.disabled = !uploadCheck.checked;
    const marker = buildMarker();
    body.querySelector('#img-preview').textContent = marker || '（填写文件名后生成标记）';
    body.querySelector('#img-upload-path').closest('.field').style.opacity = uploadCheck.checked ? '1' : '.55';
    if (insertButton) insertButton.textContent = picked && uploadCheck.checked ? '上传并插入' : '插入';
  };

  fileInput.addEventListener('change', () => {
    const file = fileInput.files?.[0];
    if (!file) return;
    if (tooLarge(file)) {
      fileInput.value = '';
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = String(reader.result);
      const base64 = dataUrl.split(',')[1] || '';
      picked = { file, dataUrl, base64, size: file.size };
      const name = sanitizeName(file.name);
      nameInput.value = name;
      uploadPathInput.value = defaultPath(name);
      uploadCheck.checked = true;
      refresh();
    };
    reader.readAsDataURL(file);
  });

  nameInput.addEventListener('input', () => {
    if (picked && uploadCheck.checked) uploadPathInput.value = defaultPath(sanitizeName(getName()));
    refresh();
  });
  uploadCheck.addEventListener('change', refresh);
  styleInput.addEventListener('change', () => {
    style = styleInput.value;
    refresh();
  });
  for (const node of [uploadPathInput, sizeInput, alignInput, frameCheck, altInput, captionInput, templateInput]) {
    node.addEventListener('input', refresh);
    node.addEventListener('change', refresh);
  }
  refresh();

  const modal = openModal({
    title: '插入图片',
    subtitle: '任意图片格式 · Wiki / 标准 Markdown / 自定义填充模板',
    body,
    size: 'wide',
    footer: [
      { label: '取消', className: 'btn-ghost', onClick: () => modal.close() },
      {
        label: '插入',
        className: 'btn-primary',
        id: 'img-insert',
        onClick: () => {
          const name = getName();
          if (!name) {
            toast('请填写文件名或选择图片。', 'error');
            return;
          }
          const marker = buildMarker();
          if (!marker.trim()) {
            toast('生成的标记为空，请检查自定义模板。', 'error');
            return;
          }
          const willUpload = !!picked && uploadCheck.checked;
          const uploadPath = getUploadPath().replace(/^\/+/, '');
          if (willUpload) {
            if (!uploadPath || uploadPath.includes('..') || uploadPath.startsWith('/')) {
              toast('上传路径不合法。', 'error');
              return;
            }
            const existing = assets.findIndex((asset) => asset.path === uploadPath);
            const asset = { path: uploadPath, name, dataUrl: picked.dataUrl, base64: picked.base64, size: picked.size };
            if (existing >= 0) assets.splice(existing, 1, asset);
            else assets.push(asset);
            renderAssets();
          }
          state.settings.templates.imageStyle = style;
          if (style === 'custom') state.settings.templates.imageTemplate = templateInput.value;
          saveState(state);
          editor.insertBlock(marker);
          modal.close();
          toast(willUpload ? `图片已加入待上传列表：${uploadPath}` : '已插入图片标记。', 'success');
        },
      },
    ],
  });
  insertButton = document.getElementById('img-insert');
  refresh();
}

function openAudioDialog() {
  if (state.content.editorTab === 'frontmatter') {
    toast('请切换到正文。', 'info');
    return;
  }
  const game = gameOfPath(state.content.path);
  let picked = null;
  const body = document.createElement('div');
  body.innerHTML = `
    <div class="form-grid">
      <div class="form-note is-accent">
        音频仅支持 <strong>.ogg</strong>，放在 <code>games/&lt;游戏&gt;/${GAME_AUDIO_DIR}/</code>；
        正文语法为 <code>[[Audio/名称.ogg|标题]]</code>，标题可省略。
      </div>
      <div class="form-grid-2">
        <label class="field"><span class="form-label">音频文件（.ogg）</span><input class="input" id="audio-file" type="file" accept=".ogg,audio/ogg"></label>
        <label class="field"><span class="form-label">上传路径</span><input class="input mono" id="audio-upload-path" autocomplete="off" placeholder="${escapeHtml(`games/<游戏>/${GAME_AUDIO_DIR}/<名称>.ogg`)}"></label>
      </div>
      <label class="check-row"><input type="checkbox" id="audio-upload" checked><span>随 PR 上传到该游戏的 assets/audio/</span></label>
      <div class="form-grid-2">
        <label class="field"><span class="form-label">文件名</span><input class="input mono" id="audio-name" placeholder="factory.ogg" autocomplete="off"></label>
        <label class="field"><span class="form-label">标题（可选）</span><input class="input" id="audio-title" placeholder="工厂环境音" autocomplete="off"></label>
      </div>
      <p class="form-help" id="audio-status"></p>
      <pre class="modal-preview" id="audio-preview"></pre>
    </div>
  `;
  const fileInput = body.querySelector('#audio-file');
  const nameInput = body.querySelector('#audio-name');
  const titleInput = body.querySelector('#audio-title');
  const uploadCheck = body.querySelector('#audio-upload');
  const uploadPathInput = body.querySelector('#audio-upload-path');
  const statusEl = body.querySelector('#audio-status');

  const defaultPath = (file) => (game ? `games/${game}/${GAME_AUDIO_DIR}/${file}` : `${GAME_AUDIO_DIR}/${file}`);
  const sanitize = (value) =>
    audioFileName(
      String(value || '')
        .replace(/[^a-zA-Z0-9._-]+/g, '-')
        .replace(/^-+|-+$/g, ''),
    );

  const currentName = () => audioFileName(nameInput.value.trim() || (picked ? picked.file.name : ''));
  const escapeOption = (value) => value.replaceAll('|', '\\|').replaceAll(']', '\\]');
  const marker = () => {
    const name = currentName();
    const title = titleInput.value.trim();
    return `[[Audio/${name}${title ? `|${escapeOption(title)}` : ''}]]`;
  };

  const refresh = () => {
    body.querySelector('#audio-preview').textContent = marker() || '（填写文件名后生成标记）';
    uploadPathInput.disabled = !uploadCheck.checked;
  };

  let statusSeq = 0;
  const refreshStatus = async () => {
    const seq = ++statusSeq;
    const file = currentName();
    statusEl.style.color = '';
    if (!file) {
      statusEl.textContent = '选择 .ogg 文件或填写文件名。';
      return;
    }
    const problem = audioNameProblem(file);
    if (problem) {
      statusEl.style.color = 'var(--danger)';
      statusEl.textContent = problem;
      return;
    }
    if (!game) {
      statusEl.style.color = 'var(--danger)';
      statusEl.textContent = '请先在「页面位置」填写 games/<游戏>/… 路径。';
      return;
    }
    const willUpload = !!picked && uploadCheck.checked;
    if (willUpload) {
      statusEl.textContent = `将随 PR 上传：${uploadPathInput.value.trim() || defaultPath(file)}`;
      return;
    }
    if (assets.some((asset) => asset.path === defaultPath(file))) {
      statusEl.textContent = '该音频已加入本次待上传列表。';
      return;
    }
    const index = await ensureRepoIndex();
    if (seq !== statusSeq) return;
    if (!index.paths) {
      statusEl.textContent = '无法读取仓库文件列表（可离线继续编辑，提交前会再次检查）。';
      return;
    }
    const exists = repositoryAudioNames(index.paths, game).has(file);
    const cacheNote = repoCacheNote(index, formatTime) ? `；${repoCacheNote(index, formatTime)}` : '';
    statusEl.style.color = exists ? 'var(--success)' : 'var(--danger)';
    statusEl.textContent = exists
      ? `已在仓库中找到：${defaultPath(file)}${cacheNote}`
      : `仓库中不存在：${defaultPath(file)}${cacheNote}（内容门禁会阻断，请上传或修正文件名）`;
  };

  fileInput.addEventListener('change', () => {
    const file = fileInput.files?.[0];
    if (!file) return;
    if (!/\.ogg$/i.test(file.name)) {
      fileInput.value = '';
      toast('音频仅支持 .ogg 格式。', 'error', 4200);
      return;
    }
    if (tooLarge(file)) {
      fileInput.value = '';
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      picked = {
        file,
        dataUrl: String(reader.result),
        base64: String(reader.result).split(',')[1] || '',
        size: file.size,
      };
      nameInput.value = sanitize(file.name);
      uploadPathInput.value = defaultPath(nameInput.value);
      uploadCheck.checked = true;
      refresh();
      refreshStatus();
    };
    reader.readAsDataURL(file);
  });

  for (const input of [nameInput, titleInput]) {
    input.addEventListener('input', () => {
      if (picked && input === nameInput) uploadPathInput.value = defaultPath(sanitize(nameInput.value));
      refresh();
      clearTimeout(refreshStatus.timer);
      refreshStatus.timer = setTimeout(refreshStatus, 300);
    });
  }
  uploadCheck.addEventListener('change', refreshStatus);
  uploadPathInput.addEventListener('input', refreshStatus);
  refresh();
  refreshStatus();

  const modal = openModal({
    title: '插入音频',
    subtitle: '[[Audio/名称.ogg|标题]] · 仅 .ogg',
    body,
    footer: [
      { label: '取消', className: 'btn-ghost', onClick: () => modal.close() },
      {
        label: '插入',
        className: 'btn-primary',
        onClick: async () => {
          const file = currentName();
          const problem = audioNameProblem(file);
          if (problem) {
            toast(problem, 'error');
            return;
          }
          if (!game) {
            toast('请先在「页面位置」填写 games/<游戏>/… 路径，音频必须放在该游戏的 assets/audio/ 下。', 'error', 4600);
            return;
          }
          const willUpload = !!picked && uploadCheck.checked;
          const uploadPath = (uploadPathInput.value.trim() || defaultPath(file)).replace(/^\/+/, '');
          if (willUpload) {
            if (!uploadPath.startsWith(`games/${game}/${GAME_AUDIO_DIR}/`) || uploadPath.includes('..')) {
              toast(`音频上传路径必须位于 games/${game}/${GAME_AUDIO_DIR}/。`, 'error', 4200);
              return;
            }
            const existing = assets.findIndex((asset) => asset.path === uploadPath);
            const asset = {
              path: uploadPath,
              name: file,
              dataUrl: picked.dataUrl,
              base64: picked.base64,
              size: picked.size,
            };
            if (existing >= 0) assets.splice(existing, 1, asset);
            else assets.push(asset);
            renderAssets();
          } else {
            const index = await ensureRepoIndex();
            if (index.paths && !repositoryAudioNames(index.paths, game).has(file)) {
              toast(`音频不存在：${defaultPath(file)}。请上传音频或修正文件名，否则门禁会阻断 PR。`, 'error', 5200);
              return;
            }
          }
          bodyEditor.insertBlock(marker());
          modal.close();
          toast(willUpload ? `音频已加入待上传列表：${uploadPath}` : '已插入音频标记。', 'success');
        },
      },
    ],
  });
}

const EMBED_OEMBED = {
  youtube: (id) =>
    `https://www.youtube.com/oembed?url=${encodeURIComponent(`https://www.youtube.com/watch?v=${id}`)}&format=json`,
  vimeo: (id) => `https://vimeo.com/api/oembed.json?url=${encodeURIComponent(`https://vimeo.com/${id}`)}`,
};

/** Best-effort title lookup (CORS-enabled oEmbed); failures are silent. */
async function fetchEmbedTitle(provider, id) {
  const build = EMBED_OEMBED[provider];
  if (!build) return '';
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 5000);
  try {
    const response = await fetch(build(id), {
      signal: controller.signal,
      headers: { Accept: 'application/json' },
    });
    if (!response.ok) return '';
    const data = await response.json();
    return typeof data?.title === 'string' ? data.title.trim() : '';
  } catch {
    return '';
  } finally {
    clearTimeout(timer);
  }
}

function openEmbedDialog() {
  if (state.content.editorTab === 'frontmatter') {
    toast('请切换到正文。', 'info');
    return;
  }
  const body = document.createElement('div');
  const providers = EMBED_PROVIDERS.map((provider) => provider.label).join(' / ');
  body.innerHTML = `
    <div class="form-grid">
      <div class="form-note is-accent">
        粘贴播放器的<strong>原始页面链接</strong>（https）。插入前会先显示识别结果（来源 / 视频 ID / 标题），
        确认无误后再写入短标记。目前支持 ${escapeHtml(providers)}；正文语法为 <code>[[Embed/youtube/ID|标题]]</code>。
      </div>
      <label class="field"><span class="form-label">播放器链接</span>
        <input class="input mono" id="embed-url" placeholder="https://www.youtube.com/watch?v=…" autocomplete="off"></label>
      <div class="embed-recognized" id="embed-recognized" hidden>
        <div class="embed-recognized-head">将嵌入：<strong id="embed-r-provider"></strong></div>
        <div class="embed-recognized-row"><span>视频 ID</span><code id="embed-r-id"></code></div>
        <div class="embed-recognized-row"><span>标题</span><span id="embed-r-title"></span></div>
        <a class="embed-recognized-link" id="embed-r-link" target="_blank" rel="noopener noreferrer">打开原链接</a>
      </div>
      <label class="field"><span class="form-label">标题（可选）</span>
        <input class="input" id="embed-title" placeholder="例如：官方预告片" autocomplete="off"></label>
      <p class="form-help" id="embed-status"></p>
      <pre class="modal-preview" id="embed-preview"></pre>
    </div>
  `;
  const urlInput = body.querySelector('#embed-url');
  const titleInput = body.querySelector('#embed-title');
  const statusEl = body.querySelector('#embed-status');
  const card = body.querySelector('#embed-recognized');
  const providerEl = body.querySelector('#embed-r-provider');
  const idEl = body.querySelector('#embed-r-id');
  const titleEl = body.querySelector('#embed-r-title');
  const linkEl = body.querySelector('#embed-r-link');

  const escapeOption = (value) => value.replaceAll('|', '\\|').replaceAll(']', '\\]');
  const currentTarget = () => embedTarget(urlInput.value.trim());
  const marker = () => {
    const target = currentTarget();
    const title = titleInput.value.trim();
    return target ? `[[Embed/${target.value}${title ? `|${escapeOption(title)}` : ''}]]` : '';
  };

  const titleCache = new Map();
  let autoTitle = true;
  let lookupSeq = 0;
  let lookupTimer = 0;
  let settingTitle = false;

  const titleFor = (target) => titleCache.get(`${target.provider}/${target.id}`) || '';

  const fetchTitleFor = (target) => {
    if (!target || !EMBED_OEMBED[target.provider]) return;
    const key = `${target.provider}/${target.id}`;
    if (titleCache.has(key)) return;
    clearTimeout(lookupTimer);
    lookupTimer = setTimeout(async () => {
      const seq = ++lookupSeq;
      titleEl.textContent = '正在获取…';
      const title = await fetchEmbedTitle(target.provider, target.id);
      if (seq !== lookupSeq) return;
      titleCache.set(key, title);
      const current = currentTarget();
      if (!current || `${current.provider}/${current.id}` !== key) return;
      titleEl.textContent = title || '无法自动获取，可在下方手动填写';
      if (title && autoTitle && !titleInput.value.trim()) {
        settingTitle = true;
        titleInput.value = title;
        settingTitle = false;
        refresh();
      }
    }, 350);
  };

  const refresh = () => {
    const url = urlInput.value.trim();
    const target = currentTarget();
    const provider = target ? EMBED_PROVIDERS.find((item) => item.id === target.provider)?.label : '';
    card.hidden = !target;
    if (target) {
      providerEl.textContent = provider;
      idEl.textContent = target.id;
      const cached = titleFor(target);
      titleEl.textContent = cached || (EMBED_OEMBED[target.provider] ? '正在获取…' : '无法自动获取，可在下方手动填写');
      linkEl.href = embedPageUrl(target.provider, target.id);
      statusEl.style.color = 'var(--success)';
      statusEl.textContent = `已识别：${provider} · 视频 ID ${target.id} · 将写入 ${target.value}`;
      if (!cached) fetchTitleFor(target);
    } else {
      statusEl.style.color = url ? 'var(--danger)' : '';
      statusEl.textContent = !url
        ? '粘贴链接后会显示识别结果。'
        : '暂不支持该链接；目前支持 YouTube / 哔哩哔哩 / Vimeo 的 https 页面链接。';
    }
    body.querySelector('#embed-preview').textContent = marker() || '（填写链接后生成标记）';
  };

  urlInput.addEventListener('input', () => {
    const previous = titleFor(currentTarget());
    if (!previous && autoTitle) {
      settingTitle = true;
      titleInput.value = '';
      settingTitle = false;
    }
    refresh();
  });
  titleInput.addEventListener('input', () => {
    if (!settingTitle) autoTitle = false;
    body.querySelector('#embed-preview').textContent = marker() || '（填写链接后生成标记）';
  });
  refresh();

  const modal = openModal({
    title: '嵌入播放器',
    subtitle: '[[Embed/youtube/ID|标题]]',
    body,
    size: 'wide',
    footer: [
      { label: '取消', className: 'btn-ghost', onClick: () => modal.close() },
      {
        label: '插入',
        className: 'btn-primary',
        onClick: () => {
          const url = urlInput.value.trim();
          if (!url) {
            toast('请填写播放器链接。', 'error');
            return;
          }
          if (!embedTarget(url)) {
            toast(`暂不支持该链接；目前支持 ${providers} 的 https 页面链接。`, 'error', 5200);
            return;
          }
          bodyEditor.insertBlock(marker());
          modal.close();
          toast('已插入嵌入播放器标记。', 'success');
        },
      },
    ],
  });
}

/* --------------------------------------------------------------- settings */
function openSettings() {
  const canHideStatusBar = typeof window.AndroidEditor?.setImmersive === 'function';
  const body = document.createElement('div');
  body.innerHTML = `
    <div class="form-grid">
      <div class="form-note is-accent">
        <strong>仅客户端，且仅限 Content。</strong> token 默认<strong>不保存</strong>；勾选「记住 token」后会<strong>加密</strong>保存在本机：
        Android 使用系统 Keystore（密钥不可导出），网页版与桌面版使用 AES-256-GCM 设备绑定密钥。
        关闭该选项则 token 只留在内存，重启后失效。
        输入框禁止复制 / 剪切，但<strong>允许粘贴</strong>。
        编辑器被硬编码为只能访问 <code>${CONTENT_OWNER}/${CONTENT_REPO}</code>，不会读写 Core / Alias。
      </div>

      <details class="token-guide">
        <summary>获取 GitHub token 的完整步骤（贡献者必读）</summary>
        <ol>
          <li>打开 <a href="https://github.com/settings/tokens/new" target="_blank" rel="noopener">GitHub → Settings → Developer settings → Personal access tokens (classic)</a>。</li>
          <li>Note 填 <code>Wikifactory Editor</code>，Expiration 选择合适期限。</li>
          <li>勾选 <code>public_repo</code>（公开仓库读写）。这是推荐、最省事的方式。</li>
          <li>点击 Generate token，复制一次后粘贴到下方输入框。</li>
          <li>保存设置并点击「测试连接」，确认显示你的 <code>@用户名</code>。</li>
        </ol>
        <p class="token-fork-note">
          <strong>为什么基本必定要 Fork：</strong>Wikifactory-Content 虽然是公开仓库，但公开 ≠ 可以直接推送。绝大多数贡献者没有该仓库的写权限，因此编辑器会自动把分支创建到你的 Fork，再向 <code>${CONTENT_OWNER}/${CONTENT_REPO}</code> 发起 PR。只有拥有上游写权限的维护者才会直接建分支。
        </p>
        <p>
          如果你使用 Fine-grained token（<a href="https://github.com/settings/tokens?type=beta" target="_blank" rel="noopener">创建入口</a>），需要对你 Fork 的 Content 仓库拥有 Contents / Pull requests 读写权限；若无法创建 Fork，请改用经典 token 的 <code>public_repo</code>。
        </p>
        <p>请勿把 token 粘贴到聊天、Issue、PR 描述或任何公开位置。</p>
      </details>

      <label class="field">
        <span class="form-label">GitHub Token</span>
        <input class="input mono token-secret" id="set-token" type="password"
               placeholder="ghp_… / github_pat_…" autocomplete="new-password"
               spellcheck="false" data-lpignore="true" data-1p-ignore="true">
        <p class="form-help">经典 token 至少需要 <code>public_repo</code>；细粒度 token 需要 Fork 后 Content 仓库的 Contents / Pull requests 读写权限。支持 Ctrl/⌘+V 或长按粘贴。</p>
      </label>
      <label class="check-row">
        <input type="checkbox" id="set-remember" ${state.settings.rememberToken === false ? '' : 'checked'}>
        <span>记住 token（加密保存在本机，下次启动自动恢复）</span>
      </label>
      <div class="button-row">
        <button class="btn btn-small btn-danger" type="button" id="set-token-clear">清除 token（内存与已保存）</button>
        <span class="form-help" id="token-store-kind"></span>
      </div>

      <div class="pr-summary">
        <div class="pr-summary-row"><span>目标仓库（editor-config.json）</span><span>${CONTENT_OWNER}/${CONTENT_REPO}</span></div>
        <div class="pr-summary-row"><span>Release 仓库</span><span>${EDITOR_OWNER}/${EDITOR_REPO}</span></div>
      </div>
      <label class="field"><span class="form-label">目标分支（留空 = 默认分支）</span><input class="input mono" id="set-branch" value="${escapeHtml(state.settings.branch)}" placeholder="main"></label>

      <details class="settings-group">
        <summary>${escapeHtml(tOr('set.appearance', '外观与编辑'))}</summary>
        <label class="field">
          <span class="form-label">${escapeHtml(tOr('set.lang', '界面语言'))}</span>
          <select class="input" id="set-lang">
            ${LANGS.map(
              (lang) =>
                `<option value="${lang.value}" ${state.settings.lang === lang.value ? 'selected' : ''}>${escapeHtml(lang.label)}</option>`,
            ).join('')}
          </select>
          <p class="form-help">界面控件与设置已双语化；长篇说明文字仍以中文为主，缺失条目会回退中文。</p>
        </label>
        <div class="form-grid-2">
          <label class="field"><span class="form-label">编辑器字号</span>
            <select class="input" id="set-fontsize">
              ${[13, 14, 14.5, 15, 16, 17, 18].map((size) => `<option value="${size}" ${Number(state.settings.fontSize) === size ? 'selected' : ''}>${size}px</option>`).join('')}
            </select>
          </label>
          <label class="check-row" style="align-self:end"><input type="checkbox" id="set-wrap" ${state.settings.wrap ? 'checked' : ''}><span>自动换行</span></label>
        </div>
        <label class="field">
          <span class="form-label">行号栏</span>
          <select class="input" id="set-gutter">
            <option value="auto" ${state.settings.gutter === 'auto' ? 'selected' : ''}>自动（移动端隐藏，显示当前行 / 总行数）</option>
            <option value="on" ${state.settings.gutter === 'on' ? 'selected' : ''}>始终显示</option>
            <option value="off" ${state.settings.gutter === 'off' ? 'selected' : ''}>始终隐藏</option>
          </select>
          <p class="form-help">无论是否显示行号栏，底部状态栏都会显示「行 当前/总行数」。</p>
        </label>
      </details>

      <details class="settings-group">
        <summary>启动与退出</summary>
        <label class="field">
          <span class="form-label">更新方式</span>
          <select class="input" id="set-update-mode">
            <option value="0" ${Number(state.settings.updateMode) === 0 ? 'selected' : ''}>0 · 有新版本时自动下载（Android 需允许安装未知来源）</option>
            <option value="1" ${Number(state.settings.updateMode) === 1 ? 'selected' : ''}>1 · 提示后手动下载（默认）</option>
            <option value="2" ${Number(state.settings.updateMode) === 2 ? 'selected' : ''}>2 · 不检查更新</option>
          </select>
          <p class="form-help">桌面端自动下载的是 <code>resources.neu</code> 资源包，重启后生效；Android 会打开签名 APK 的下载地址。</p>
        </label>
        <label class="field">
          <span class="form-label">退出行为</span>
          <select class="input" id="set-exit-behavior">
            <option value="ask" ${state.settings.exitBehavior === 'ask' ? 'selected' : ''}>每次询问（默认）</option>
            <option value="save" ${state.settings.exitBehavior === 'save' ? 'selected' : ''}>总是保存后退出</option>
            <option value="discard" ${state.settings.exitBehavior === 'discard' ? 'selected' : ''}>不保存直接退出</option>
          </select>
          <p class="form-help">退出时若本次会话有未保存修改，会按此设置处理；提示窗口内也会告知此入口。</p>
        </label>
        ${
          canHideStatusBar
            ? `
        <label class="check-row">
          <input type="checkbox" id="set-hide-statusbar" ${state.settings.hideStatusBar ? 'checked' : ''}>
          <span>隐藏 Android 系统状态栏（沉浸显示）</span>
        </label>`
            : ''
        }
      </details>

      <div class="button-row">
        <button class="btn btn-small" type="button" id="set-check-update">立即检查更新</button>
        <button class="btn btn-small" type="button" id="set-contributing">查看 Content 使用须知</button>
      </div>
      <div class="button-row">
        <button class="btn btn-small btn-danger" type="button" id="set-exit">退出应用</button>
        <span class="form-help">Wikifactory Editor v${escapeHtml(APP_VERSION)}</span>
      </div>

      <button class="btn" type="button" id="set-test">测试连接</button>
      <div class="connection-result" id="set-result" hidden></div>
    </div>
  `;

  const tokenInput = body.querySelector('#set-token');
  tokenInput.value = sessionToken;
  const rememberInput = body.querySelector('#set-remember');
  const kindLabel = body.querySelector('#token-store-kind');
  const kind = tokenStorageKind();
  kindLabel.textContent =
    kind === 'android-keystore'
      ? '存储：Android Keystore'
      : kind === 'webcrypto'
        ? '存储：AES-256-GCM（设备绑定）'
        : '加密存储不可用：token 仅本次运行有效';

  const blockTokenCopy = (event) => {
    event.preventDefault();
    toast('出于安全考虑，token 禁止复制或剪切；粘贴不受限制。', 'info', 1800);
  };
  // Copy / cut / drag stay blocked. The context menu stays enabled because on
  // mobile it is the only way to paste.
  for (const type of ['copy', 'cut', 'dragstart']) {
    tokenInput.addEventListener(type, blockTokenCopy);
  }
  tokenInput.addEventListener('paste', () => {
    // Trim any whitespace/newlines picked up from the clipboard.
    setTimeout(() => {
      tokenInput.value = tokenInput.value.replace(/\s+/g, '');
    }, 0);
  });

  const resultEl = body.querySelector('#set-result');
  body.querySelector('#set-token-clear').addEventListener('click', async () => {
    sessionToken = '';
    tokenInput.value = '';
    setConnection(false, '未连接', '已清除 token');
    resultEl.hidden = true;
    await clearToken();
    toast('已清除内存与本机保存的 token。', 'success');
  });

  body.querySelector('#set-test').addEventListener('click', async () => {
    const token = tokenInput.value.trim();
    if (!token) {
      toast('请先填写 token。', 'error');
      return;
    }
    resultEl.hidden = false;
    resultEl.className = 'connection-result';
    resultEl.textContent = '正在验证 token…';
    try {
      const probe = await probeToken(token);
      const scopes = probe.classic ? probe.scopes : '无（细粒度 token：权限由仓库设置决定）';
      resultEl.className = `connection-result ${probe.level === 'read-only' ? 'is-error' : 'is-ok'}`;
      resultEl.innerHTML = `已连接：<strong>@${escapeHtml(probe.user.login)}</strong><br>
        权限范围：<code>${escapeHtml(scopes)}</code><br>
        ${tokenCapabilityHtml(probe)}`;
      setConnection(true, `@${probe.user.login}`, `已连接 @${probe.user.login}`);
    } catch (error) {
      resultEl.className = 'connection-result is-error';
      resultEl.textContent = error.message;
      setConnection(false, '连接失败', error.message);
    }
  });

  body.querySelector('#set-check-update').addEventListener('click', () => {
    checkForUpdates({ manual: true });
  });
  // Persist immediately so the next exit follows the new value even if the
  // settings dialog is dismissed without pressing 保存设置.
  body.querySelector('#set-exit-behavior').addEventListener('change', (event) => {
    const value = event.currentTarget.value;
    state.settings.exitBehavior = value;
    saveState(state);
    const label = value === 'save' ? '总是保存后退出' : value === 'discard' ? '不保存直接退出' : '每次询问';
    toast(`退出行为已设为「${label}」，立即生效。`, 'success', 2200);
  });
  body.querySelector('#set-contributing').addEventListener('click', () => {
    modal.close();
    openContributing();
  });
  body.querySelector('#set-exit').addEventListener('click', () => {
    modal.close();
    requestExit();
  });

  const modal = openModal({
    title: '设置与 GitHub 连接',
    subtitle: 'token 加密保存在本机；提交时直接创建 Content 仓库 PR',
    body,
    size: 'wide',
    footer: [
      { label: '取消', className: 'btn-ghost', onClick: () => modal.close() },
      {
        label: '保存设置',
        className: 'btn-primary',
        onClick: async () => {
          sessionToken = tokenInput.value.trim();
          state.settings.branch = body.querySelector('#set-branch').value.trim();
          state.settings.fontSize = Number(body.querySelector('#set-fontsize').value) || 14.5;
          state.settings.wrap = body.querySelector('#set-wrap').checked;
          state.settings.gutter = body.querySelector('#set-gutter').value;
          state.settings.updateMode = Number(body.querySelector('#set-update-mode').value);
          state.settings.lang = body.querySelector('#set-lang').value;
          setLang(state.settings.lang);
          applyI18n();
          renderToolbar();
          renderQueueBadge();
          renderPrBadge();
          updateRepoScope();
          state.settings.exitBehavior = body.querySelector('#set-exit-behavior').value;
          const statusBarInput = body.querySelector('#set-hide-statusbar');
          if (statusBarInput) state.settings.hideStatusBar = statusBarInput.checked;
          const remember = rememberInput.checked;
          state.settings.rememberToken = remember;
          applyEditorPrefs();
          applyStatusBarPreference();
          saveState(state);

          if (!sessionToken) {
            await clearToken();
            setConnection(false, '未连接', '未设置 token');
          } else if (remember) {
            const saved = await saveToken(sessionToken, { login: connection.login });
            if (!saved.ok) {
              toast(`token 加密保存失败：${saved.reason || '未知原因'}；本次运行仍可使用。`, 'error', 4200);
            }
          } else {
            await clearToken();
          }

          if (sessionToken && !connection.ok) {
            setConnection(false, 'Token 已设置', '正在验证…');
            new GitHubClient(sessionToken)
              .getUser()
              .then((user) => setConnection(true, `@${user.login}`, `已连接 @${user.login}`))
              .catch((error) => setConnection(false, '连接失败', error.message));
          }
          modal.close();
          if (!sessionToken) toast('设置已保存；未设置 token。', 'success');
          else if (remember) toast('设置已保存；token 已加密保存在本机。', 'success');
          else toast('设置已保存；token 仅保留在内存。', 'success');
        },
      },
    ],
  });
  // Keep the security guide at the top instead of auto-scrolling to the token field.
  setTimeout(() => {
    body.querySelector('.token-guide summary')?.focus();
    modal.body.scrollTop = 0;
  }, 60);
}

function applyEditorPrefs() {
  const size = Number(state.settings.fontSize) || 14.5;
  document.documentElement.style.setProperty('--editor-font-size', `${size}px`);
  const gutter = ['auto', 'on', 'off'].includes(state.settings.gutter) ? state.settings.gutter : 'auto';
  document.documentElement.dataset.gutter = gutter;
  bodyEditor.setWrap(state.settings.wrap);
  fmEditor.setWrap(state.settings.wrap);
}

/** Android-only immersive toggle exposed by MainActivity.setImmersive(). */
function applyStatusBarPreference() {
  const bridge = window.AndroidEditor;
  if (!bridge || typeof bridge.setImmersive !== 'function') return;
  try {
    bridge.setImmersive(state.settings.hideStatusBar ? 'true' : 'false');
  } catch (error) {
    console.warn('[android] 状态栏设置失败', error);
  }
}

/* --------------------------------------------------------- token permissions */

/** Inspect a token: classic scopes plus repository push permissions. */
async function probeToken(token) {
  const client = new GitHubClient(token);
  const user = await client.getUser();
  const scopes = String(user.scopes || '').trim();
  let upstream = null;
  let fork = null;
  try {
    upstream = await client.getRepo(CONTENT_OWNER, CONTENT_REPO);
  } catch {
    /* no access */
  }
  try {
    fork = await client.getRepo(user.login, CONTENT_REPO);
  } catch {
    /* no fork */
  }
  const directPush = upstream?.permissions?.push === true;
  const forkPush = fork?.permissions?.push === true;
  const classic = scopes.length > 0;
  const classicWrite = /\b(repo|public_repo)\b/.test(scopes);
  let level = 'unknown';
  if (classic) level = classicWrite ? 'write' : 'read-only';
  else if (directPush || forkPush) level = 'write';
  else if (fork && !forkPush) level = 'read-only';
  return { user, scopes, directPush, forkPush, hasFork: Boolean(fork), classic, level };
}

function tokenCapabilityHtml(probe) {
  if (probe.level === 'read-only') {
    return '<strong>只读：</strong>该 token 无法创建分支或 PR。经典 token 请勾选 <code>public_repo</code>；细粒度 token 需要对 Fork 的 Content 仓库拥有 Contents / Pull requests 读写权限。';
  }
  if (probe.level === 'write') {
    return probe.directPush
      ? '<strong>写权限：</strong>可以直接在 Content 仓库创建分支（维护者）。'
      : '<strong>写权限：</strong>可以写入 Fork 并向上游发起 PR。';
  }
  return '<strong>写权限：无法确认。</strong>细粒度 token 需要对 Fork 的 Content 仓库拥有 Contents / Pull requests 读写权限；提交时若返回 403 会给出提示。';
}

/** First-PR scope confirmation; resolves true only when the user confirms. */
async function confirmPrPermissions() {
  let settle;
  const answer = new Promise((resolve) => {
    settle = resolve;
  });
  let probe = null;
  let accepted = false;
  const body = document.createElement('div');
  body.innerHTML = '<div class="form-note">正在检查 token 权限…</div>';

  async function renderProbe() {
    try {
      probe = await probeToken(sessionToken);
      const scopes = probe.classic ? probe.scopes : '无（细粒度 token）';
      body.innerHTML = `
        <div class="form-grid">
          <div class="pr-summary">
            <div class="pr-summary-row"><span>账号</span><span>@${escapeHtml(probe.user.login)}</span></div>
            <div class="pr-summary-row"><span>权限头</span><span><code>${escapeHtml(scopes)}</code></span></div>
            <div class="pr-summary-row"><span>上游写权限</span><span>${probe.directPush ? '有（维护者）' : '无（走 Fork）'}</span></div>
            <div class="pr-summary-row"><span>Fork</span><span>${probe.hasFork ? (probe.forkPush ? '存在，可写' : '存在，只读') : '尚未创建'}</span></div>
          </div>
          <div class="form-note ${probe.level === 'read-only' ? 'is-error' : probe.level === 'write' ? 'is-accent' : ''}">
            ${tokenCapabilityHtml(probe)}
          </div>
          <div class="form-note">
            提交只会创建分支与 PR，不会直接写入 Content 的 <code>main</code>。
            此确认只在首次提交时出现；token 默认不保存，关闭应用即失效。
          </div>
        </div>`;
    } catch (error) {
      probe = { level: 'unknown' };
      body.innerHTML = `<div class="form-grid">
        <div class="form-note is-error">无法检查 token 权限：${escapeHtml(error.message)}<br>可以继续，但提交可能因权限不足失败。</div>
      </div>`;
    }
    const button = modal.el.querySelector('#pr-ack-continue');
    if (button) {
      button.disabled = false;
      button.textContent = probe.level === 'read-only' ? '重新检查' : '确认并继续';
    }
  }

  const modal = openModal({
    title: '首次提交前确认 token 权限',
    subtitle: '避免提交到一半因 403 失败',
    body,
    size: 'normal',
    footer: [
      { label: '取消', className: 'btn-ghost', onClick: () => modal.close() },
      {
        label: '确认并继续',
        className: 'btn-primary',
        id: 'pr-ack-continue',
        disabled: true,
        onClick: async () => {
          if (!probe) return;
          if (probe.level === 'read-only') {
            await renderProbe();
            if (probe.level === 'read-only') toast('该 token 仍为只读，请补充写权限后重试。', 'error', 4200);
            return;
          }
          state.settings.prAck = true;
          saveState(state);
          accepted = true;
          modal.close();
          settle(true);
        },
      },
    ],
    onClose: () => {
      if (!accepted) settle(false);
    },
  });
  await renderProbe();
  return answer;
}

/* -------------------------------------------------------- updates / guide */

const DESKTOP_MANIFEST_URL = desktopManifestUrl(EDITOR_OWNER, EDITOR_REPO);

function updateMode() {
  return Number(state.settings.updateMode ?? 1);
}

function updatePlatform() {
  if (isDesktopRuntime()) return 'desktop';
  if (isAndroidRuntime()) return 'android';
  return 'web';
}

function isDesktopRuntime() {
  return Boolean(window.NL_PORT && window.Neutralino?.updater);
}

function isAndroidRuntime() {
  return typeof window.AndroidEditor?.exitApp === 'function';
}

/** Desktop: download resources.neu through Neutralino's updater and apply on restart. */
async function installDesktopUpdate(latest) {
  if (!isDesktopRuntime()) return false;
  try {
    const response = await fetch(DESKTOP_MANIFEST_URL, { cache: 'no-store' });
    if (!response.ok) throw new Error(`manifest HTTP ${response.status}`);
    const manifest = await response.json();
    const version = String(manifest.version || latest);
    if (compareVersions(version, APP_VERSION) <= 0) return false;
    await window.Neutralino.updater.checkForUpdates(DESKTOP_MANIFEST_URL);
    await window.Neutralino.updater.install();
    toast(`更新包 v${version} 已下载，重启应用后生效。`, 'success', 6000);
    return true;
  } catch (error) {
    console.warn('[update] 桌面自动更新失败', error);
    return false;
  }
}

/** Mode 0: download without asking. Falls back to the dialog when it cannot. */
async function autoUpdate({ latest, release }) {
  if (isDesktopRuntime()) return installDesktopUpdate(latest);
  if (isAndroidRuntime()) {
    const apk = releaseAsset(release, '-android-release.apk');
    if (!apk) return false;
    openExternal(apk.url);
    toast(`正在下载 v${latest} 签名 APK，完成后按系统提示安装。`, 'success', 5200);
    return true;
  }
  try {
    const registration = await navigator.serviceWorker?.getRegistration?.();
    if (registration) await registration.update();
  } catch {
    // Ignore service worker failures; a plain reload still picks up new files.
  }
  toast(`发现新版本 v${latest}，刷新页面即可加载。`, 'info', 5200);
  return true;
}

async function checkForUpdates({ manual = false } = {}) {
  if (updateCheckRunning) return;
  if (!manual && updateMode() === 2) return;
  // Do not replace the startup restore prompt or any dialog the user opened.
  if (!manual && document.body.classList.contains('modal-open')) return;
  updateCheckRunning = true;
  try {
    const release = await new GitHubClient('').getLatestRelease(EDITOR_OWNER, EDITOR_REPO);
    const latest = String(release.tag || '').replace(/^v/i, '');
    const action = planUpdate({
      mode: updateMode(),
      manual,
      platform: updatePlatform(),
      latest,
      current: APP_VERSION,
    });
    if (action === 'skip') return;
    if (action === 'none') {
      if (manual)
        toast(latest ? `当前版本 v${APP_VERSION} 已是最新。` : '尚未找到已发布的版本。', latest ? 'success' : 'info');
      return;
    }
    if (action === 'auto' && (await autoUpdate({ latest, release }))) return;
    openUpdateDialog({ latest, release });
  } catch (error) {
    console.warn('[update] 检查更新失败', error);
    if (manual) toast(`检查更新失败：${error.message}`, 'error', 4200);
  } finally {
    updateCheckRunning = false;
  }
}

function openUpdateDialog({ latest, release }) {
  const notes = String(release.body || '').trim();
  const published = release.publishedAt ? new Date(release.publishedAt).toLocaleDateString('zh-CN') : '未知';
  const androidApk = releaseAsset(release, '-android-release.apk');
  const desktop = isDesktopRuntime();
  const android = isAndroidRuntime() && Boolean(androidApk);
  const releaseUrl = release.url || `https://github.com/${EDITOR_OWNER}/${EDITOR_REPO}/releases`;

  const body = h`<div class="form-grid">
    <div class="form-note is-accent">
      发现新版本 <strong>v${latest}</strong>，当前版本 v${APP_VERSION}。
      ${
        desktop
          ? '桌面端可自动下载资源包，重启后生效（exe 本身有变化时仍需重新下载 ZIP）。'
          : android
            ? 'Android 会打开签名 APK 的下载地址，下载完成后按系统提示安装（需允许安装未知来源）。'
            : '网页版会更新离线缓存，刷新页面即可使用新版本。'
      }
    </div>
    <div class="pr-summary">
      <div class="pr-summary-row"><span>版本</span><span>${release.name || `v${latest}`}</span></div>
      <div class="pr-summary-row"><span>发布时间</span><span>${published}</span></div>
    </div>
    ${notes ? h`<div class="update-notes">${notes.slice(0, 1400)}</div>` : ''}
    <label class="check-row">
      <input type="checkbox" id="update-disable">
      <span>不再显示此窗口（等同于不再检查更新，可在设置中恢复）</span>
    </label>
  </div>`;

  const applyDisable = () => {
    if (!body.querySelector('#update-disable')?.checked) return;
    state.settings.updateMode = 2;
    saveState(state);
  };

  const primary = async () => {
    applyDisable();
    if (desktop && (await installDesktopUpdate(latest))) {
      modal.close();
      return;
    }
    if (android && androidApk) {
      openExternal(androidApk.url);
      toast(`正在下载 v${latest} 签名 APK。`, 'success', 4200);
      modal.close();
      return;
    }
    if (!desktop && !android) {
      try {
        const registration = await navigator.serviceWorker?.getRegistration?.();
        if (registration) await registration.update();
      } catch {
        // Ignore and fall back to a normal reload.
      }
      modal.close();
      location.reload();
      return;
    }
    openExternal(releaseUrl);
    modal.close();
  };

  const modal = openModal({
    title: `可更新到 v${latest}`,
    subtitle: desktop ? '下载资源包后重启生效' : android ? '下载签名 APK 后安装' : '刷新页面加载新版本',
    body,
    size: 'normal',
    onClose: applyDisable,
    footer: [
      { label: '稍后提醒', className: 'btn-ghost', onClick: () => modal.close() },
      {
        label: '打开发布页',
        className: 'btn',
        onClick: () => {
          applyDisable();
          openExternal(releaseUrl);
          modal.close();
        },
      },
      { label: desktop ? '下载并安装' : android ? '下载 APK' : '刷新页面', className: 'btn-primary', onClick: primary },
    ],
  });
}

function contributingUrl(path = '') {
  return path
    ? `https://github.com/${CONTENT_OWNER}/${CONTENT_REPO}/blob/HEAD/${path}`
    : `https://github.com/${CONTENT_OWNER}/${CONTENT_REPO}`;
}

async function loadContributing() {
  if (contributingCache) return contributingCache;
  const client = new GitHubClient(sessionToken || '');
  for (const path of ['CONTRIBUTING.md', 'CONTRIBUTING.MD', 'contributing.md', 'docs/CONTRIBUTING.md']) {
    try {
      const file = await client.loadFile(CONTENT_OWNER, CONTENT_REPO, path, state.settings.branch || '');
      contributingCache = { path, text: file.text };
      return contributingCache;
    } catch (error) {
      if (error instanceof GitHubError && error.status === 404) continue;
      throw error;
    }
  }
  return null;
}

async function openContributing() {
  const host = document.createElement('div');
  host.innerHTML = `
    <div class="form-note" id="contributing-status">正在从 ${CONTENT_OWNER}/${CONTENT_REPO} 读取 CONTRIBUTING.md…</div>
    <div id="contributing-body"></div>
  `;
  let remoteUrl = contributingUrl();
  const modal = openModal({
    title: 'Content 使用须知',
    subtitle: `与 ${CONTENT_OWNER}/${CONTENT_REPO} 的 CONTRIBUTING.md 联动`,
    body: host,
    size: 'wide',
    footer: [
      { label: '在 GitHub 打开', className: 'btn', onClick: () => openExternal(remoteUrl) },
      { label: '关闭', className: 'btn-primary', onClick: () => modal.close() },
    ],
  });
  const statusEl = host.querySelector('#contributing-status');
  const bodyEl = host.querySelector('#contributing-body');
  try {
    const doc = await loadContributing();
    if (!doc) {
      statusEl.className = 'form-note';
      statusEl.innerHTML = `Content 仓库暂未提供 CONTRIBUTING.md。你可以直接在 GitHub 上查看仓库说明：<a href="${contributingUrl()}" target="_blank" rel="noopener">${CONTENT_OWNER}/${CONTENT_REPO}</a>。`;
      return;
    }
    remoteUrl = contributingUrl(doc.path);
    statusEl.hidden = true;
    const article = document.createElement('article');
    article.className = 'wiki-preview contributing-article';
    bodyEl.appendChild(article);
    buildPreview({ path: doc.path, fmRaw: '', body: doc.text, article });
    article.querySelector('.preview-meta')?.remove();
    // Resolve relative links the way GitHub does: relative to the file itself.
    const baseUrl = contributingUrl(doc.path);
    for (const link of article.querySelectorAll('a[href]')) {
      const href = link.getAttribute('href') || '';
      if (!href || href.startsWith('#') || /^(https?:|mailto:)/i.test(href)) continue;
      link.setAttribute('href', new URL(href, baseUrl).href);
      link.setAttribute('target', '_blank');
      link.setAttribute('rel', 'noopener');
    }
  } catch (error) {
    statusEl.className = 'form-note is-error';
    statusEl.innerHTML = `读取 CONTRIBUTING.md 失败：${escapeHtml(error.message)}<br>
      可直接在 GitHub 查看：<a href="${contributingUrl('CONTRIBUTING.md')}" target="_blank" rel="noopener">CONTRIBUTING.md</a>
      （公开仓库可匿名读取；填写 token 可提高 API 额度）。`;
  }
}

/* ------------------------------------------------------------------ exit */

function captureSessionBaseline() {
  sessionBaseline = {
    path: state.content.path,
    body: state.content.body,
    fmRaw: state.content.fmRaw,
  };
}

function hasSessionChanges() {
  if (!sessionBaseline) return dirty;
  return (
    state.content.path !== sessionBaseline.path ||
    state.content.body !== sessionBaseline.body ||
    state.content.fmRaw !== sessionBaseline.fmRaw
  );
}

function discardSessionChanges() {
  if (!sessionBaseline) return;
  state.content.path = sessionBaseline.path;
  state.content.body = sessionBaseline.body;
  state.content.fmRaw = sessionBaseline.fmRaw;
  els.contentPath.value = sessionBaseline.path;
  bodyEditor.setValue(sessionBaseline.body, { reset: true });
  fmEditor.setValue(sessionBaseline.fmRaw, { reset: true });
  dirty = false;
  saveState(state);
  updateDocMeta();
  updateStats();
  updateSaveStatus();
}

/* ----------------------------------------------------------------- drafts */

function updateDraftBadge() {
  const count = draftCount();
  if (els.draftCount) {
    els.draftCount.textContent = String(count);
    els.draftCount.hidden = !count;
  }
}

/**
 * Guard destructive actions: switching files / new page would replace the editor.
 * @returns {Promise<'save'|'discard'|'cancel'>}
 */
function confirmBeforeDestructive(actionLabel) {
  if (!hasSessionChanges()) return Promise.resolve('discard');
  return new Promise((resolve) => {
    let settled = false;
    let modal = null;
    const finish = (value) => {
      if (settled) return;
      settled = true;
      resolve(value);
      modal?.close();
    };
    modal = openModal({
      title: '当前页面有未保存的修改',
      subtitle: actionLabel,
      body: `<div class="form-grid">
        <div class="form-note is-warn">
          继续会覆盖编辑器中的当前内容。可以先把修改保存为本地草稿（之后可在「最近草稿」中恢复），也可以放弃这些修改。
        </div>
        <div class="pr-summary">
          <div class="pr-summary-row"><span>页面</span><span>${escapeHtml(state.content.path || '（未设置路径）')}</span></div>
          <div class="pr-summary-row"><span>正文</span><span>${countCharacters(state.content.body).characters.toLocaleString('zh-CN')} 字符</span></div>
        </div>
      </div>`,
      size: 'normal',
      footer: [
        { label: '取消', className: 'btn-ghost', onClick: () => finish('cancel') },
        { label: '放弃修改', className: 'btn-danger', onClick: () => finish('discard') },
        { label: '保存草稿并继续', className: 'btn-primary', onClick: () => finish('save') },
      ],
      onClose: () => finish('cancel'),
    });
  });
}

/** Apply a stored draft to the editor (no network access). */
function restoreDraftIntoEditor(draft) {
  state.content.path = draft.path;
  state.content.fmRaw = draft.fmRaw;
  state.content.body = draft.body;
  state.content.loadedSha = null;
  state.content.loadedPath = draft.loadedPath || '';
  state.content.loadedFmRaw = draft.loadedFmRaw || '';
  state.content.loadedBody = draft.loadedBody || '';
  state.content.editorTab = 'body';
  state.content.lastSaved = draft.savedAt || Date.now();
  els.contentPath.value = draft.path;
  bodyEditor.setValue(draft.body, { reset: true });
  fmEditor.setValue(draft.fmRaw, { reset: true });
  renderFmForm();
  populateFmForm();
  syncEditorVisibility();
  dirty = false;
  lastIssues = [];
  issuesStale = true;
  applyInlineDiagnostics();
  captureSessionBaseline();
  updateDocMeta();
  updateStats();
  updateSaveStatus();
  // Keep the stored draft and the editor in sync after the switch.
  saveDraft(false);
}

function openDraftsDialog() {
  const drafts = listDrafts();
  const body = document.createElement('div');
  const rows = drafts
    .map((draft, index) => {
      const stamp = draft.savedAt ? new Date(draft.savedAt).toLocaleString('zh-CN') : '未知时间';
      const title = draft.title || stripExt(basename(draft.path)) || '未命名页面';
      return `<div class="draft-item">
      <div class="draft-info">
        <span class="draft-title">${escapeHtml(title)}</span>
        <span class="draft-path mono">${escapeHtml(draft.path)}</span>
        <span class="draft-meta">${escapeHtml(stamp)} · ${countCharacters(draft.body).characters.toLocaleString('zh-CN')} 字符</span>
      </div>
      <div class="draft-actions">
        <button class="btn btn-small" type="button" data-draft-restore="${index}">恢复</button>
        <button class="btn btn-small btn-danger" type="button" data-draft-delete="${index}">删除</button>
      </div>
    </div>`;
    })
    .join('');

  body.innerHTML = `<div class="form-grid">
    <div class="form-note is-accent">
      草稿按页面路径分别保存在本机（最多 30 份），切换页面不会互相覆盖。待上传资源不随草稿保存，需要重新选择。
    </div>
    <div class="draft-list">${rows || '<p class="empty-mini">还没有本地草稿。编辑后按 Ctrl+S 或等待自动保存。</p>'}</div>
  </div>`;

  const modal = openModal({
    title: '最近草稿',
    subtitle: `本机共 ${drafts.length} 份`,
    body,
    size: 'wide',
    footer: [{ label: '关闭', className: 'btn-ghost', onClick: () => modal.close() }],
  });

  body.addEventListener('click', async (event) => {
    const restore = event.target.closest('[data-draft-restore]');
    const remove = event.target.closest('[data-draft-delete]');
    if (restore) {
      const draft = drafts[Number(restore.dataset.draftRestore)];
      if (!draft) return;
      const decision = await confirmBeforeDestructive('恢复草稿会替换当前编辑内容');
      if (decision === 'cancel') return;
      if (decision === 'save' && !saveDraft(true)) return;
      modal.close();
      restoreDraftIntoEditor(draft);
      toast(`已恢复草稿：${draft.path}`, 'success');
      return;
    }
    if (remove) {
      const draft = drafts[Number(remove.dataset.draftDelete)];
      if (!draft) return;
      const ok = await confirmDialog({
        title: '删除草稿？',
        message: `将删除本机保存的 <code>${escapeHtml(draft.path)}</code> 草稿，无法撤销。`,
        confirmText: '删除',
        danger: true,
      });
      if (!ok) return;
      deleteDraft(draft.path);
      updateDraftBadge();
      modal.close();
      openDraftsDialog();
      toast('草稿已删除。', 'success');
    }
  });
}

function exitApplication() {
  // Android WebView also loads the Neutralino shim, so the bridge must win there.
  if (window.AndroidEditor?.exitApp) {
    window.AndroidEditor.exitApp();
    return;
  }
  if (window.NL_PORT && window.Neutralino?.app?.exit) {
    window.Neutralino.app.exit();
    return;
  }
  window.close();
  setTimeout(() => {
    if (document.hidden) return;
    const modal = openModal({
      title: '无法自动关闭窗口',
      subtitle: `Wikifactory Editor v${APP_VERSION}`,
      body: '<div class="form-note">浏览器不允许脚本关闭标签页。更改已按你的选择处理，可以手动关闭当前窗口。</div>',
      footer: [{ label: '我知道了', className: 'btn-primary', onClick: () => modal.close() }],
    });
  }, 300);
}

function openExitDialog() {
  const behavior = state.settings.exitBehavior || 'ask';
  const behaviorLabel = behavior === 'save' ? '总是保存' : behavior === 'discard' ? '不保存' : '每次询问';
  const body = document.createElement('div');
  body.innerHTML = `
    <div class="form-grid">
      <div class="form-note is-accent">当前会话有未保存的更改，退出前请确认如何处理。</div>
      <div class="form-note">
        保存后，下次启动会自动恢复本次内容；不保存则销毁本次修改，回到进入程序时的内容。
        默认选项当前为「${behaviorLabel}」，可在 <strong>设置 → 退出行为</strong> 中调整，调整后不再弹出本窗口。
      </div>
    </div>
  `;
  const modal = openModal({
    title: '退出前保存更改？',
    subtitle: `Wikifactory Editor v${APP_VERSION}`,
    body,
    size: 'narrow',
    footer: [
      { label: '取消', className: 'btn-ghost', onClick: () => modal.close() },
      {
        label: '不保存退出',
        className: 'btn-danger',
        onClick: () => {
          discardSessionChanges();
          modal.close();
          exitApplication();
        },
      },
      {
        label: '保存并退出',
        className: 'btn-primary',
        onClick: () => {
          if (!saveDraft(false)) {
            toast('本地保存失败，已取消退出。', 'error', 4200);
            return;
          }
          modal.close();
          exitApplication();
        },
      },
    ],
  });
}

function requestExit() {
  if (!hasSessionChanges()) {
    exitApplication();
    return;
  }
  const behavior = state.settings.exitBehavior || 'ask';
  if (behavior === 'save') {
    if (!saveDraft(false)) {
      toast('本地保存失败，已取消退出。', 'error', 4200);
      return;
    }
    exitApplication();
    return;
  }
  if (behavior === 'discard') {
    discardSessionChanges();
    exitApplication();
    return;
  }
  openExitDialog();
}

/* ----------------------------------------------------------------- help */

function openHelp() {
  const body = `
    <div class="form-grid" style="font-size:13px;line-height:1.75">
      <div class="form-note is-accent">
        <strong>仅编辑 Content。</strong> 目标仓库固定为 <code>${CONTENT_OWNER}/${CONTENT_REPO}</code>；程序不会读写 Core / Alias。
      </div>
      <div class="form-note is-accent">
        <strong>语法高亮。</strong> 正文使用 Markdown / GFM 高亮，并额外高亮 <code>[[File/…]]</code>、<code>[[…]]</code>、<code>[icon=…]</code>、<code>:::</code> 横幅、表格行与单元格颜色；元数据 YAML 标签使用 YAML 高亮；围栏代码块支持 JS/TS、JSON、CSS、HTML、YAML。
      </div>
      <div>
        <h3 style="font-size:13px;margin:0 0 6px">快捷键</h3>
        <p style="margin:0;color:var(--text-soft)"><kbd>Ctrl</kbd>+<kbd>S</kbd> 保存本地草稿 · <kbd>Ctrl</kbd>+<kbd>Z</kbd> 撤销 · <kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>Z</kbd> 重做 · <kbd>Ctrl</kbd>+<kbd>B</kbd> 粗体 · <kbd>Ctrl</kbd>+<kbd>Enter</kbd> 预览</p>
      </div>
      <div>
        <h3 style="font-size:13px;margin:0 0 6px">Content 页面结构</h3>
        <pre class="modal-preview" style="max-height:none">games/&lt;游戏&gt;/&lt;分类&gt;/…/&lt;页面&gt;.md

---
title: 页面标题
description: 摘要
tags: [攻略, 建筑]
order: 10
updated: 2026-10-13
toc: true
---

正文…</pre>
      </div>
      <div>
        <h3 style="font-size:13px;margin:0 0 6px">Wiki 语法</h3>
        <pre class="modal-preview" style="max-height:none">:::warning[注意]
横幅正文，支持 **加粗**。
:::

[[File/iron-plate.png|thumb|md|right|alt=铁板|物品图标]]
[[File/iron-plate.png;thumb;md]]      ← 表格内用 ; 分隔

[icon=iron-plate;size=lg;bg=&G] 铁板

[[Satisfactory/Buildings/MAM|MAM 建筑]]

| 名称 | 数量 |
| --- | --- |
| 铁锭 | [bg=&G;fg=#fff]42 |</pre>
      </div>
      <div>
        <h3 style="font-size:13px;margin:0 0 6px">表格 / 图片自定义</h3>
        <p style="margin:0;color:var(--text-soft)">表格可设置任意行数 × 列数，单元格模板支持 <code>{r}</code>、<code>{c}</code>；还可用高级源码模板组合 <code>{header}</code>、<code>{separator}</code>、<code>{body}</code>。图片可选 Wiki、标准 Markdown 或自定义模板（<code>{name}</code>、<code>{opts}</code>…）。</p>
      </div>
      <div>
        <h3 style="font-size:13px;margin:0 0 6px">PR 流程</h3>
        <p style="margin:0;color:var(--text-soft)">每次提交都从 Content 仓库最新 <code>main</code> 创建临时分支。有写权限时直接建分支；没有写权限时自动 Fork 并向上游发起 PR。Content 仓库不要求分支与 base 保持 up-to-date。</p>
      </div>
      <div class="form-note">安全提示：勾选「记住 token」后，token 以加密形式保存在本机（Android Keystore / 其他平台 AES-256-GCM），不会出现明文；在共享设备上请关闭该选项，离开前用设置中的「清除 token」。公开仓库中不要提交任何密钥。</div>
      <div class="form-note is-accent">
        版本 <strong>v${escapeHtml(APP_VERSION)}</strong>。使用前建议先阅读 Content 仓库的 CONTRIBUTING.md；编辑器不会自动下载更新，只会在启动时提示新版本。
      </div>
    </div>
  `;
  const modal = openModal({
    title: '帮助与语法速查',
    subtitle: `Wikifactory Content Contributor Editor · v${APP_VERSION}`,
    body,
    size: 'wide',
    footer: [
      {
        label: '使用须知',
        className: 'btn',
        onClick: () => {
          modal.close();
          openContributing();
        },
      },
      {
        label: '检查更新',
        className: 'btn',
        onClick: () => {
          modal.close();
          checkForUpdates({ manual: true });
        },
      },
      { label: '关闭', className: 'btn-primary', onClick: () => modal.close() },
    ],
  });
}

/* ------------------------------------------------------------------- PR */

/** Render diff rows into the PR dialog's HTML view. */
function renderPrDiff(diff) {
  const html = diff.rows.length
    ? diff.rows
        .map((row) => {
          if (row.type === 'gap') {
            return `<div class="diff-row diff-gap"><span class="diff-gutter"></span>… ${row.count} 行未显示 …</div>`;
          }
          const sign = row.type === 'add' ? '+' : row.type === 'del' ? '−' : ' ';
          return (
            `<div class="diff-row is-${row.type}">` +
            `<span class="diff-num">${row.oldLine ?? ''}</span>` +
            `<span class="diff-num">${row.newLine ?? ''}</span>` +
            `<span class="diff-sign">${sign}</span>` +
            `<code>${escapeHtml(row.text) || ' '}</code></div>`
          );
        })
        .join('')
    : '<p class="diff-empty">文档内容没有变化（可能只调整了路径或待上传资源）。</p>';
  const pathNote = diff.pathNote ? `<p class="form-help">${escapeHtml(diff.pathNote)}</p>` : '';
  return { ...diff, html, pathNote };
}

function currentPrDiff() {
  return renderPrDiff(
    buildPrDiff({
      before: joinDocument(state.content.loadedFmRaw || '', state.content.loadedBody || ''),
      after: assembleDocument(),
      loadedPath: state.content.loadedPath,
      path: state.content.path,
    }),
  );
}

async function openPrDialog({ prefill = null } = {}) {
  await tokenReady;
  await flushFmChanges();
  if (!sessionToken) {
    toast('提交 PR 需要 GitHub token，请先在设置中填写。', 'error');
    openSettings();
    return;
  }
  if (!state.settings.prAck) {
    const allowed = await confirmPrPermissions();
    if (!allowed) return;
  }
  const path = currentPathValue().replace(/^\/+/, '');
  if (!path) {
    toast('请先填写仓库路径。', 'error');
    return;
  }
  const doc = assembleDocument();
  let issues;
  try {
    // Refresh the repo tree so icon existence / URL conflicts reflect the latest main.
    await ensureRepoIndex({ force: true });
    issues = await collectIssuesWithRepo();
  } catch (error) {
    toast(`检查失败：${error.message}`, 'error');
    return;
  }
  if (!repoIndex?.paths) {
    toast(
      '无法读取 Content 仓库文件树，本次仅执行本地规则检查（图标 / 音频 / 站内链接存在性未校验）。可以先保存草稿，网络恢复后再提交。',
      'info',
      5600,
    );
  } else if (repoIndex.cached) {
    toast(`网络不可用，使用${repoCacheNote(repoIndex, formatTime)}的文件树；存在性校验仅供参考。`, 'info', 5200);
  }
  lastIssues = issues;
  issuesStale = false;
  updateStats();
  const summary = issueCounts(issues);
  if (summary.errors > 0) {
    showIssuesDialog(issues);
    toast('存在错误，修复后再提交 PR。', 'error');
    return;
  }

  const targetAssets = assets.map((asset) => asset.path);
  const queueFiles = queuedFiles();
  const diff = currentPrDiff();
  const pageTitle = frontmatterData(state.content.fmRaw).title || stripExt(basename(path));
  const typeDefault = prefill?.prType || (state.content.loadedSha ? 'edit' : 'new');
  const noteDefault = prefill?.prNote || '';
  const branchDefault = prefill?.branchName || defaultBranchName(path);
  const titleDefault = prefill?.prTitle || prHeadline(typeDefault, pageTitle);
  const commitDefault = prefill?.commitMessage || prHeadline(typeDefault, pageTitle);
  const prBodyDefault =
    prefill?.prBody ||
    buildPrBody({
      type: typeDefault,
      note: noteDefault,
      path,
      assetPaths: targetAssets,
      summary,
      diff: diff.stats,
    });
  const cacheNotice = repoIndex?.cached
    ? `<div class="form-note is-warn">离线 / 弱网：文件树来自${escapeHtml(repoCacheNote(repoIndex, formatTime))}，图标 / 音频 / 站内链接校验可能已过期。网络恢复后重新打开本窗口即可刷新。</div>`
    : !repoIndex?.paths
      ? '<div class="form-note is-warn">无法读取仓库文件树：本次仅执行本地规则检查。可以先保存草稿，网络恢复后再提交。</div>'
      : '';

  const body = document.createElement('div');
  body.innerHTML = `
    <div class="form-grid">
      <div class="pr-summary">
        <div class="pr-summary-row"><span>目标仓库</span><span>${CONTENT_OWNER}/${CONTENT_REPO}</span></div>
        <div class="pr-summary-row"><span>目标分支</span><span>${escapeHtml(state.settings.branch || '默认分支')}</span></div>
        <div class="pr-summary-row"><span>文件</span><span>${escapeHtml(path)}${targetAssets.length ? `<br>+ ${targetAssets.length} 个资源` : ''}${
          queueFiles.length
            ? `<br>+ ${queueFiles.length} 个批量页面：${queueFiles.map((file) => escapeHtml(file.path)).join('、')}`
            : ''
        }</span></div>
        <div class="pr-summary-row"><span>账号</span><span>${escapeHtml(connection.login || '待验证')}</span></div>
      </div>
      <div class="form-note is-accent">
        Content 仓库不设置必须 up-to-date：提交分支会从最新 main 创建，无需手动同步。
        所有请求仅在客户端发往 GitHub API。
      </div>
      ${cacheNotice}
      ${formField(
        '变更类型',
        `<select class="input" id="pr-type">${PR_TYPES.map(
          (type) => `
        <option value="${type.id}" ${type.id === typeDefault ? 'selected' : ''}>${escapeHtml(type.label)}</option>`,
        ).join('')}</select>`,
        '切换类型会重新生成提交信息、PR 标题与说明模板。',
      )}
      ${formField('说明（必填）', `<textarea class="input" id="pr-note" rows="3" placeholder="例如：补充 MAM 建筑的解锁条件与材料清单">${escapeHtml(noteDefault)}</textarea>`, '会写入 PR 说明的「说明」小节，减少维护者 review 时的信息缺失。')}
      <details class="diff-box" open>
        <summary>内容差异预览 · <span class="diff-added">+${diff.stats.added}</span> <span class="diff-removed">−${diff.stats.removed}</span> 行
          ${state.content.loadedPath ? '' : '（新建页面：全部为新增）'}</summary>
        ${diff.pathNote}
        <div class="diff-view">${diff.html}</div>
      </details>
      ${formField('分支设置 · 分支名', `<input class="input mono" id="pr-branch" value="${escapeHtml(branchDefault)}" autocomplete="off">`, '分支创建在 Content 仓库或你的 Fork 上；编辑器不会自动追加后缀。')}
      ${formField('提交信息', `<input class="input" id="pr-commit" value="${escapeHtml(commitDefault)}" autocomplete="off">`)}
      ${formField('PR 标题', `<input class="input" id="pr-title" value="${escapeHtml(titleDefault)}" autocomplete="off">`)}
      ${formField('PR 说明（自动模板，可修改）', `<textarea class="input" id="pr-body" rows="10">${escapeHtml(prBodyDefault)}</textarea>`, '修改变更类型或说明时会重新生成模板；之后仍可手动调整。')}
      <label class="check-row"><input type="checkbox" id="pr-draft" ${prefill?.draft ? 'checked' : ''}><span>创建为 Draft PR</span></label>
      <div class="progress-log" id="pr-log" hidden></div>
    </div>
  `;

  const typeSelect = body.querySelector('#pr-type');
  const noteInput = body.querySelector('#pr-note');
  const commitInput = body.querySelector('#pr-commit');
  const titleInput = body.querySelector('#pr-title');
  const prBodyInput = body.querySelector('#pr-body');
  const regenerate = () => {
    commitInput.value = prHeadline(typeSelect.value, pageTitle);
    titleInput.value = prHeadline(typeSelect.value, pageTitle);
    prBodyInput.value = buildPrBody({
      type: typeSelect.value,
      note: noteInput.value.trim(),
      path,
      assetPaths: targetAssets,
      summary,
      diff: diff.stats,
    });
  };
  typeSelect.addEventListener('change', regenerate);
  noteInput.addEventListener('input', () => {
    prBodyInput.value = buildPrBody({
      type: typeSelect.value,
      note: noteInput.value.trim(),
      path,
      assetPaths: targetAssets,
      summary,
      diff: diff.stats,
    });
  });

  const modal = openModal({
    title: '提交 Pull Request',
    subtitle: `Content · ${CONTENT_OWNER}/${CONTENT_REPO}`,
    body,
    size: 'wide',
    footer: [
      { label: '取消', className: 'btn-ghost', onClick: () => modal.close() },
      {
        label: '保存草稿',
        className: 'btn-ghost',
        onClick: () => {
          modal.close();
          saveDraft(true);
        },
      },
      {
        label: '创建 PR',
        className: 'btn-primary',
        onClick: async () => {
          const branchName = body.querySelector('#pr-branch').value.trim();
          const commitMessage = body.querySelector('#pr-commit').value.trim();
          const prNote = body.querySelector('#pr-note').value.trim();
          const prTitle = body.querySelector('#pr-title').value.trim();
          const prBody = body.querySelector('#pr-body').value.trim();
          const draft = body.querySelector('#pr-draft').checked;
          if (!prNote) {
            toast('请填写「说明」（必填）：简要描述本次新增 / 修改 / 修复了什么。', 'error', 4600);
            noteInput.focus();
            return;
          }
          if (!branchName || !commitMessage || !prTitle) {
            toast('请填写分支名、提交信息与 PR 标题。', 'error');
            return;
          }
          if (branchName.startsWith('/') || branchName.includes('..') || /\s/.test(branchName)) {
            toast('分支名不合法。', 'error');
            return;
          }
          const logEl = body.querySelector('#pr-log');
          logEl.hidden = false;
          logEl.innerHTML = '';
          const log = (message, kind = 'step') => {
            const line = document.createElement('div');
            line.className = kind;
            line.textContent = message;
            logEl.appendChild(line);
            logEl.scrollTop = logEl.scrollHeight;
          };
          modal.setBusy(true);
          try {
            for (const asset of assets) {
              if (!isSafeRepoPath(asset.path)) {
                throw new Error(`待上传图片路径不合法：${asset.path}`);
              }
            }
            for (const file of queueFiles) {
              if (!isSafeRepoPath(file.path)) throw new Error(`批量页面路径不合法：${file.path}`);
            }
            const files = [{ path, text: doc }, ...queueFiles];
            for (const asset of assets) files.push({ path: asset.path, base64: asset.base64 });
            const client = new GitHubClient(sessionToken);
            const result = await client.submitPullRequest({
              owner: CONTENT_OWNER,
              repo: CONTENT_REPO,
              baseBranch: state.settings.branch || '',
              branchName,
              files,
              commitMessage,
              prTitle,
              prBody,
              draft,
              onProgress: log,
            });
            log(`完成：PR #${result.number}`, 'ok');
            saveDraft(false);
            const success = document.createElement('div');
            success.className = 'pr-success';
            success.innerHTML = `
            <div class="pr-success-icon">${icon('check', 26)}</div>
            <h3>Pull Request #${result.number} 已创建</h3>
            <p>${escapeHtml(result.forkUsed ? `通过 Fork ${result.headOwner} 提交` : '直接提交到 Content 仓库')} · 分支 ${escapeHtml(result.branch)}</p>
            <a class="pr-success-link" href="${escapeHtml(result.url)}" target="_blank" rel="noopener">${escapeHtml(result.url)}</a>
          `;
            const foot = modal.el.querySelector('.modal-foot');
            foot.innerHTML = '';
            const reviewButton = document.createElement('button');
            reviewButton.type = 'button';
            reviewButton.className = 'btn';
            reviewButton.textContent = tOr('review.title', 'PR 审阅状态');
            reviewButton.addEventListener('click', () => openReviewDialog());
            const copyButton = document.createElement('button');
            copyButton.type = 'button';
            copyButton.className = 'btn';
            copyButton.textContent = '复制链接';
            copyButton.addEventListener('click', async () => {
              await navigator.clipboard.writeText(result.url).catch(() => {});
              toast('PR 链接已复制。', 'success');
            });
            const closeButton = document.createElement('button');
            closeButton.type = 'button';
            closeButton.className = 'btn btn-primary';
            closeButton.textContent = '关闭';
            closeButton.addEventListener('click', () => modal.close());
            foot.appendChild(reviewButton);
            foot.appendChild(copyButton);
            foot.appendChild(closeButton);
            modal.body.innerHTML = '';
            modal.body.appendChild(success);
            modal.body.appendChild(logEl);
            rememberSessionPr(result);
            if (batchActive) endBatchQueue();
            assets.length = 0;
            renderAssets();
            toast('PR 已创建。', 'success');
          } catch (error) {
            const branchConflict =
              error instanceof GitHubError &&
              (error.code === 'BRANCH_EXISTS' || (error.status === 422 && /已存在|exists/i.test(error.message)));
            if (branchConflict) {
              const snapshot = {
                branchName,
                commitMessage,
                prNote,
                prType: typeSelect.value,
                prTitle,
                prBody,
                draft,
              };
              modal.close();
              openBranchConflictDialog({ branchName, snapshot, message: error.message });
              return;
            }
            log(`失败：${error.message}`, 'err');
            if (error instanceof GitHubError && error.status === 0) {
              log('提示：可以先点击「保存草稿」保留本次修改，等网络恢复后再提交。', 'step');
            }
            modal.setBusy(false);
            toast(error.message || '提交失败。', 'error');
            if (error instanceof GitHubError && error.status === 401) {
              setTimeout(() => {
                modal.close();
                openSettings();
              }, 600);
            }
          }
        },
      },
    ],
  });
}

function openBranchConflictDialog({ branchName, snapshot, message }) {
  let suggestion = uniqueBranchSuggestion(state.content.path, branchName);
  const body = document.createElement('div');
  body.innerHTML = `
    <div class="form-note is-warn">
      <strong>分支名已被占用。</strong><br>
      ${escapeHtml(message || `分支名「${branchName}」已存在。`)}<br>
      其他贡献者可能已经使用该分支名。编辑器不会自动改名，请使用下方建议或自行修改。
    </div>
    ${formField('新的分支名', `<input class="input mono" id="conflict-branch" value="${escapeHtml(suggestion)}" autocomplete="off">`, '建议格式：内容页-日期-短哈希，冲突概率极低。提交信息与 PR 内容会保留。')}
    <div class="button-row">
      <button class="btn btn-small" type="button" id="conflict-suggest">换一个建议</button>
    </div>
  `;
  const input = body.querySelector('#conflict-branch');
  body.querySelector('#conflict-suggest').addEventListener('click', () => {
    suggestion = uniqueBranchSuggestion(state.content.path, input.value.trim() || branchName);
    input.value = suggestion;
    input.focus();
    input.select();
  });
  const modal = openModal({
    title: '分支名已被占用',
    subtitle: 'GitHub 422 · Reference already exists',
    body,
    size: 'normal',
    footer: [
      { label: '取消', className: 'btn-ghost', onClick: () => modal.close() },
      {
        label: '使用该名称并重试',
        className: 'btn-primary',
        onClick: () => {
          const next = input.value.trim();
          if (!next) {
            toast('请填写新的分支名。', 'error');
            input.focus();
            return;
          }
          if (next === branchName) {
            toast('请使用不同的分支名。', 'error');
            input.focus();
            input.select();
            return;
          }
          if (next.startsWith('/') || next.includes('..') || /\s/.test(next)) {
            toast('分支名不合法。', 'error');
            input.focus();
            return;
          }
          modal.close();
          openPrDialog({ prefill: { ...snapshot, branchName: next } });
        },
      },
    ],
  });
  setTimeout(() => {
    input.focus();
    input.select();
  }, 50);
}

/* ---------------------------------------------------------------- mobile */

function openMobileMenu() {
  const body = document.createElement('div');
  body.innerHTML = `
    <div class="form-grid">
      <button class="btn btn-block" type="button" data-mobile-action="preview">${icon('eye')}预览页面</button>
      <button class="btn btn-block" type="button" data-mobile-action="pr">${icon('git-pull-request')}提交 PR</button>
      <button class="btn btn-block" type="button" data-mobile-action="settings">${icon('settings')}GitHub 设置</button>
      <button class="btn btn-block" type="button" data-mobile-action="theme">${icon('contrast')}切换主题</button>
      <button class="btn btn-block" type="button" data-mobile-action="help">${icon('help')}帮助与语法</button>
      <button class="btn btn-block" type="button" data-mobile-action="contributing">${icon('file-text')}Content 使用须知</button>
      <button class="btn btn-block" type="button" data-mobile-action="save">${icon('save')}保存本地草稿</button>
      <button class="btn btn-block" type="button" data-mobile-action="export">${icon('download')}导出当前文件</button>
      <button class="btn btn-block" type="button" data-mobile-action="sidebar">${icon('panel-left')}打开文档侧栏</button>
      <button class="btn btn-block" type="button" data-mobile-action="batch">${icon('layers')}批量操作</button>
      <button class="btn btn-block" type="button" data-mobile-action="review">${icon('git-pull-request')}${t('review.title')}</button>
      <button class="btn btn-block btn-danger" type="button" data-mobile-action="exit">${icon('x')}退出应用</button>
    </div>
  `;
  const modal = openModal({
    title: '操作',
    body,
    size: 'narrow',
    footer: [{ label: '关闭', className: 'btn-ghost', onClick: () => modal.close() }],
  });
  body.addEventListener('click', (event) => {
    const action = event.target.closest('[data-mobile-action]')?.dataset.mobileAction;
    if (!action) return;
    modal.close();
    if (action === 'preview') openPreview();
    else if (action === 'pr') openPrDialog();
    else if (action === 'settings') openSettings();
    else if (action === 'theme') {
      state.theme = nextTheme(state.theme);
      applyTheme(state.theme);
      saveState(state);
    } else if (action === 'help') openHelp();
    else if (action === 'contributing') openContributing();
    else if (action === 'save') saveDraft(true);
    else if (action === 'export') exportCurrentFile();
    else if (action === 'sidebar') openSidebar();
    else if (action === 'batch') openBatchDialog();
    else if (action === 'review') openReviewDialog();
    else if (action === 'exit') requestExit();
  });
}

/* ----------------------------------------------------------- repo scope */

/** Reflect the active (possibly remote) editor-config.json in the UI. */
function updateRepoScope() {
  const config = activeConfig();
  const pending = pendingConfig();
  const trustText =
    config.trust === 'signed'
      ? t('cfg.signed')
      : config.trust === 'approved'
        ? t('cfg.approved')
        : config.trust === 'unverified'
          ? t('cfg.unsigned')
          : '';
  const scope = `${CONTENT_OWNER}/${CONTENT_REPO}`;
  const note = $('#repo-scope-note');
  if (note) {
    const pendingBlock = pending
      ? `<div class="form-note is-warn" style="margin-top:8px">
          ${t('cfg.pending', {
            repo: `<code>${escapeHtml(`${pending.config.content.owner}/${pending.config.content.repo}`)}</code>`,
          })}
          <div class="button-row" style="margin-top:6px">
            <button class="btn btn-small btn-primary" type="button" id="cfg-approve">${t('cfg.pendingApprove')}</button>
            <button class="btn btn-small" type="button" id="cfg-dismiss">${t('cfg.pendingKeep')}</button>
          </div>
        </div>`
      : '';
    note.innerHTML = `仅可读取与修改 <code>${escapeHtml(scope)}</code>。Core / Alias 仓库不在本编辑器的访问范围内。${
      config.source === 'remote' ? `<br>仓库地址来自 <code>editor-config.json</code>${escapeHtml(trustText)}。` : ''
    }${pendingBlock}`;
  }
  els.statRepo.textContent = scope;
  const scopeLabel = $('#repo-scope-label');
  if (scopeLabel) scopeLabel.textContent = scope;
  if (pending) {
    toast(t('cfg.pendingToast'), 'info', 6200);
  } else if (config.trust === 'invalid') {
    toast(t('cfg.badSignature'), 'error', 6200);
  } else if (config.source === 'remote' && config.trust === 'unverified') {
    toast(`${t('cfg.remote')}${t('cfg.unsigned')}`, 'info', 5600);
  }
  if (config.problems?.length) {
    toast(`${t('cfg.rejected')}：${config.problems[0]}`, 'error', 5600);
  }
}

/** Confirm a pending remote config after the user explicitly reviewed it. */
async function confirmPendingConfig() {
  const pending = pendingConfig();
  if (!pending) return;
  const target = `${pending.config.content.owner}/${pending.config.content.repo}`;
  const ok = await confirmDialog({
    title: t('cfg.confirmTitle'),
    messageHtml: true,
    message: t('cfg.confirmBody', {
      builtin: `<code>${escapeHtml(`${CONTENT_OWNER}/${CONTENT_REPO}`)}</code>`,
      remote: `<code>${escapeHtml(target)}</code>`,
    }),
    confirmText: t('cfg.confirmEnable'),
  });
  if (!ok) return;
  if (!approvePendingConfig()) return;
  repoIndex = null;
  updateRepoScope();
  toast(t('cfg.confirmed', { repo: target }), 'success', 5200);
}

/** Keep the built-in config and remember the decision for this config hash. */
function keepBuiltInConfig() {
  dismissPendingConfig();
  updateRepoScope();
  toast(t('cfg.kept'), 'info', 4200);
}

/* ------------------------------------------------------------ deep links */

/** Open a `wikifactory.top` page, `wikifactory-editor://` link or repo path. */
async function openDeepLink(href, { silent = false } = {}) {
  const target = parseDeepLink(href);
  if (!target.ok) {
    toast(`链接无法打开：${target.reason || '未知原因'}`, 'error', 4200);
    return false;
  }
  if (!isSafeRepoPath(target.path)) {
    toast('链接指向的仓库路径不合法，已拒绝打开。', 'error', 4200);
    return false;
  }
  if (target.kind === 'asset') {
    toast('该链接指向资源文件；正文中请用 [[File/…]] 引用。', 'info', 4200);
    return false;
  }
  if (!silent) {
    const decision = await confirmBeforeDestructive('通过链接打开页面会替换当前编辑内容');
    if (decision === 'cancel') return false;
    if (decision === 'save' && !saveDraft(true)) return false;
  }
  if (batchActive) queueCapture(state.content.path);
  state.content.path = target.path;
  els.contentPath.value = target.path;
  await loadCurrentFile({ skipConfirm: true });
  closeSidebar();
  toast(`${t('link.opened')} ${target.path}`, 'success', 3200);
  return true;
}

/** Android "open with" / share: keep an external Markdown file as a new page. */
async function importMarkdown({ name = '', text = '' } = {}) {
  if (!String(text || '').trim()) {
    toast('没有可导入的 Markdown 内容。', 'error');
    return false;
  }
  const decision = await confirmBeforeDestructive('导入外部 Markdown 会替换当前编辑内容');
  if (decision === 'cancel') return false;
  if (decision === 'save' && !saveDraft(true)) return false;
  const split = splitFrontmatter(text);
  const path = importedPagePath(name);
  state.content.path = path;
  state.content.fmRaw = split.raw;
  state.content.body = split.body.replace(/^\n+/, '');
  state.content.loadedSha = null;
  state.content.loadedPath = '';
  state.content.loadedFmRaw = '';
  state.content.loadedBody = '';
  state.content.editorTab = 'body';
  els.contentPath.value = path;
  bodyEditor.setValue(state.content.body, { reset: true });
  fmEditor.setValue(state.content.fmRaw, { reset: true });
  renderFmForm();
  populateFmForm();
  syncEditorVisibility();
  dirty = true;
  lastIssues = [];
  issuesStale = true;
  applyInlineDiagnostics();
  updateDocMeta();
  updateStats();
  updateSaveStatus();
  toast(t('link.imported'), 'info', 5200);
  return true;
}

/** Web build: `?path=games/…` or `?open=<url>` opens a page on startup. */
async function handleStartupDeepLink() {
  const params = new URLSearchParams(location.search);
  const href = params.get('open') || params.get('url') || params.get('path') || '';
  if (!href) return false;
  const target = parseDeepLink(href);
  if (!target.ok) return false;
  history.replaceState(null, '', location.pathname + location.hash);
  // Never silently replace a restored draft.
  if (hasSessionChanges()) return false;
  state.content.path = target.path;
  els.contentPath.value = target.path;
  await loadCurrentFile({ skipConfirm: true });
  return true;
}

/* ------------------------------------------------------------- review loop */

function rememberSessionPr(result) {
  sessionPr = {
    owner: CONTENT_OWNER,
    repo: CONTENT_REPO,
    number: result.number,
    url: result.url,
    branch: result.branch,
    forkUsed: result.forkUsed,
    headOwner: result.headOwner,
  };
  renderPrBadge();
}

function renderPrBadge() {
  const button = $('#btn-pr');
  if (!button) return;
  const label = button.querySelector('.btn-label');
  if (!label) return;
  label.textContent = sessionPr ? `PR #${sessionPr.number}` : tOr('nav.pr', '提交 PR');
}

function reviewCardHtml(summary) {
  const mergeable = summary.mergeable;
  const mergeableText =
    mergeable === true
      ? t('review.mergeableYes')
      : mergeable === false
        ? t('review.mergeableNo')
        : t('review.mergeableUnknown');
  const counts = summary.counts;
  return `
    <div class="pr-summary">
      <div class="pr-summary-row"><span>${t('review.state')}</span><span>${escapeHtml(summary.headline)}</span></div>
      <div class="pr-summary-row"><span>${t('review.review')}</span><span>${escapeHtml(reviewLabel(summary.reviewState))}</span></div>
      <div class="pr-summary-row"><span>${t('review.mergeable')}</span><span>${escapeHtml(mergeableText)}</span></div>
      <div class="pr-summary-row"><span>${t('review.approved')}</span><span>${counts.approved}</span></div>
      <div class="pr-summary-row"><span>${t('review.changes')}</span><span>${counts.changesRequested}</span></div>
      <div class="pr-summary-row"><span>${t('review.commented')}</span><span>${counts.commented}</span></div>
      <div class="pr-summary-row"><span>${t('review.pending')}</span><span>${counts.pending}</span></div>
      <div class="pr-summary-row"><span>${escapeHtml(commentSummary(summary))}</span><span>+${summary.additions} / −${summary.deletions}</span></div>
    </div>`;
}

function guidanceHtml(guidance) {
  return `
    <details class="diff-box" open>
      <summary>${escapeHtml(guidance.title)}</summary>
      <p class="form-help">${escapeHtml(guidance.summary)}</p>
      <ol class="form-help">
        ${guidance.steps.map((step) => `<li><code>${escapeHtml(step)}</code></li>`).join('')}
      </ol>
      <p class="form-help">rebase 方式（历史更整洁，需要 force-push）：</p>
      <ol class="form-help">
        ${guidance.rebaseAlternative.map((step) => `<li><code>${escapeHtml(step)}</code></li>`).join('')}
      </ol>
      <p class="form-help">${escapeHtml(guidance.webAlternative)}</p>
    </details>`;
}

async function openReviewDialog() {
  if (!sessionPr) {
    toast(t('review.noPr'), 'info', 3600);
    return;
  }
  await tokenReady;
  const pr = sessionPr;
  const body = h`<div class="form-grid">
    <div class="form-note" id="review-loading">正在读取 PR #${pr.number} 的状态…</div>
    <div id="review-card"></div>
  </div>`;
  const refresh = async () => {
    const loading = body.querySelector('#review-loading');
    const card = body.querySelector('#review-card');
    try {
      const client = new GitHubClient(sessionToken);
      const pull = await client.getPull(pr.owner, pr.repo, pr.number);
      const reviews = await client.listPullReviews(pr.owner, pr.repo, pr.number).catch(() => []);
      const summary = summarizeReview({ pull, reviews });
      if (loading) loading.hidden = true;
      card.innerHTML = reviewCardHtml(summary);
      if (pull.mergeable === false) {
        const guidance = mergeGuidance({
          headRef: pull.head?.ref || pr.branch,
          baseRef: pull.base?.ref || 'main',
          forkOwner: pull.head?.repo?.owner?.login || '',
          upstream: pr.owner,
        });
        card.insertAdjacentHTML('beforeend', guidanceHtml(guidance));
      }
      return summary;
    } catch (error) {
      if (loading) {
        loading.hidden = false;
        loading.textContent = `读取失败：${error.message}`;
      }
      return null;
    }
  };

  const modal = openModal({
    title: t('review.title'),
    subtitle: `#${pr.number} · ${pr.branch}`,
    body,
    size: 'wide',
    footer: [
      { label: t('review.refresh'), className: 'btn', onClick: () => refresh() },
      {
        label: t('review.open'),
        className: 'btn-primary',
        onClick: () => {
          openExternal(pr.url);
          modal.close();
        },
      },
      { label: t('set.cancel'), className: 'btn-ghost', onClick: () => modal.close() },
    ],
    onClose: () => {
      clearInterval(reviewTimer);
      reviewTimer = 0;
    },
  });
  await refresh();
  clearInterval(reviewTimer);
  reviewTimer = setInterval(refresh, 30000);
}

/* --------------------------------------------------------- batch operations */

function queueCapture(path) {
  if (!batchActive || !path || path !== state.content.path) return;
  if (!batchQueue.has(path)) return;
  batchQueue.set(path, {
    fmRaw: state.content.fmRaw,
    body: state.content.body,
    loadedFmRaw: state.content.loadedFmRaw,
    loadedBody: state.content.loadedBody,
    loadedPath: state.content.loadedPath,
    loadedSha: state.content.loadedSha,
    captured: true,
  });
}

function renderQueueBadge() {
  const button = $('#btn-batch');
  if (!button) return;
  const label = tOr('side.batch', '批量操作');
  button.textContent = batchActive ? `${t('batch.progress')} ${batchQueue.size}` : label;
}

/** Content of queued pages that differs from what was loaded from GitHub. */
function queuedFiles() {
  const files = [];
  for (const [path, entry] of batchQueue) {
    if (!entry?.captured || path === state.content.path) continue;
    const unchanged =
      entry.loadedPath === path && entry.body === (entry.loadedBody || '') && entry.fmRaw === (entry.loadedFmRaw || '');
    if (unchanged) continue;
    files.push({ path, text: joinDocument(entry.fmRaw || '', entry.body || '') });
  }
  return files;
}

async function loadQueuedPage(path, { skipConfirm = false } = {}) {
  if (!skipConfirm) {
    const decision = await confirmBeforeDestructive('切换到队列中的另一个页面');
    if (decision === 'cancel') return false;
    if (decision === 'save' && !saveDraft(true)) return false;
  }
  queueCapture(state.content.path);
  state.content.path = path;
  els.contentPath.value = path;
  await loadCurrentFile({ skipConfirm: true });
  return true;
}

async function nextQueuedPage() {
  const paths = [...batchQueue.keys()];
  const current = state.content.path;
  const index = paths.indexOf(current);
  const next = paths[(index + 1) % paths.length] || paths[0];
  if (!next) return;
  if (next === current) {
    toast('队列只有当前页面。', 'info', 2600);
    return;
  }
  await loadQueuedPage(next);
  renderQueueBadge();
}

function endBatchQueue() {
  batchQueue.clear();
  batchActive = false;
  renderQueueBadge();
  toast('批量队列已结束。', 'success', 2600);
}

function batchRowHtml(path, mode) {
  const stem = stripExt(basename(path));
  return `
    <label class="batch-row" data-path="${escapeHtml(path)}">
      <input type="checkbox" value="${escapeHtml(path)}">
      <span class="batch-path mono">${escapeHtml(path)}</span>
      <input class="input mono batch-name" value="${escapeHtml(stem)}" data-name-for="${escapeHtml(path)}" ${
        mode === 'rename' ? '' : 'hidden'
      } autocomplete="off">
    </label>`;
}

async function openBatchDialog() {
  let index;
  try {
    index = await ensureRepoIndex();
  } catch (error) {
    toast(`无法读取仓库文件树：${error.message}`, 'error');
    return;
  }
  if (!index?.paths) {
    toast('批量操作需要仓库文件树（联网或使用本地缓存）。', 'error');
    return;
  }
  const pages = index.paths.filter((path) => pageIdOf(path)).sort();
  if (!pages.length) {
    toast('仓库中没有可用页面。', 'error');
    return;
  }

  const body = h`<div class="form-grid">
    <div class="form-note is-accent">
      批量操作只修改所选页面：批量编辑会把多个页面的改动汇总到同一个 PR；
      批量重命名会同时改写指向这些页面的站内链接（可选）。
    </div>
    <div id="batch-queue"></div>
    <div class="segmented" id="batch-mode">
      <button type="button" class="is-active" data-batch-mode="edit">${t('batch.edit')}</button>
      <button type="button" data-batch-mode="rename">${t('batch.rename')}</button>
    </div>
    <label class="field">
      <span class="form-label">${t('batch.filter')}</span>
      <input class="input" id="batch-filter" placeholder="games/…" autocomplete="off">
    </label>
    <div class="button-row">
      <button class="btn btn-small" type="button" id="batch-select-all">${t('batch.selectAll')}</button>
      <button class="btn btn-small" type="button" id="batch-clear">${t('batch.clear')}</button>
      <span class="form-help" id="batch-count"></span>
    </div>
    <label class="check-row"><input type="checkbox" id="batch-scan-links" checked><span>${t('batch.scanLinks')}</span></label>
    <div class="batch-list" id="batch-list"></div>
    <div class="progress-log" id="batch-log" hidden></div>
  </div>`;

  let mode = 'edit';
  const list = body.querySelector('#batch-list');
  const countEl = body.querySelector('#batch-count');
  const filterInput = body.querySelector('#batch-filter');
  const queueHost = body.querySelector('#batch-queue');

  const renderQueue = () => {
    if (!batchActive || !batchQueue.size) {
      queueHost.innerHTML = '';
      return;
    }
    queueHost.innerHTML = `
      <div class="form-note is-warn">
        ${t('batch.queueTitle')}：${[...batchQueue.keys()].map((path) => `<code>${escapeHtml(path)}</code>`).join('、')}
      </div>
      <div class="button-row">
        <button class="btn btn-small" type="button" id="batch-next">${t('batch.next')}</button>
        <button class="btn btn-small" type="button" id="batch-finish">${t('batch.finish')}</button>
      </div>`;
    queueHost.querySelector('#batch-next')?.addEventListener('click', () => {
      modal.close();
      nextQueuedPage();
    });
    queueHost.querySelector('#batch-finish')?.addEventListener('click', () => {
      endBatchQueue();
      renderQueue();
    });
  };

  const renderList = () => {
    const query = filterInput.value.trim().toLowerCase();
    const rows = pages.filter((path) => !query || path.toLowerCase().includes(query));
    list.innerHTML = rows.map((path) => batchRowHtml(path, mode)).join('');
    updateCount();
  };

  const selected = () => [...list.querySelectorAll('input[type="checkbox"]:checked')].map((input) => input.value);
  const updateCount = () => {
    countEl.textContent = `${t('batch.selected')} ${selected().length} / ${list.querySelectorAll('input[type="checkbox"]').length}`;
  };

  list.addEventListener('change', updateCount);
  filterInput.addEventListener('input', renderList);
  body.querySelector('#batch-select-all').addEventListener('click', () => {
    for (const input of list.querySelectorAll('input[type="checkbox"]')) input.checked = true;
    updateCount();
  });
  body.querySelector('#batch-clear').addEventListener('click', () => {
    for (const input of list.querySelectorAll('input[type="checkbox"]')) input.checked = false;
    updateCount();
  });
  body.querySelector('#batch-mode').addEventListener('click', (event) => {
    const button = event.target.closest('[data-batch-mode]');
    if (!button) return;
    mode = button.dataset.batchMode;
    for (const item of body.querySelectorAll('[data-batch-mode]')) item.classList.toggle('is-active', item === button);
    for (const input of list.querySelectorAll('.batch-name')) input.hidden = mode !== 'rename';
  });

  const modal = openModal({
    title: t('batch.title'),
    subtitle: `Content · ${CONTENT_OWNER}/${CONTENT_REPO}`,
    body,
    size: 'wide',
    footer: [
      { label: t('set.cancel'), className: 'btn-ghost', onClick: () => modal.close() },
      {
        label: t('batch.queue'),
        className: 'btn',
        onClick: async () => {
          const paths = selected();
          if (!paths.length) {
            toast('请先选择页面。', 'error');
            return;
          }
          const decision = await confirmBeforeDestructive('批量编辑会切换当前页面');
          if (decision === 'cancel') return;
          if (decision === 'save' && !saveDraft(true)) return;
          batchActive = true;
          for (const path of paths) {
            if (!batchQueue.has(path)) batchQueue.set(path, { captured: false });
          }
          renderQueueBadge();
          modal.close();
          await loadQueuedPage(paths[0], { skipConfirm: true });
          renderQueueBadge();
          toast(`已加入队列：${paths.length} 个页面。`, 'success', 3600);
        },
      },
      {
        label: t('batch.renameRun'),
        className: 'btn-primary',
        onClick: async () => {
          if (mode !== 'rename') {
            toast('请先切换到「批量重命名」。', 'info', 2800);
            return;
          }
          const paths = selected();
          if (!paths.length) {
            toast('请先选择页面。', 'error');
            return;
          }
          await runBatchRename({
            paths,
            list,
            scanLinks: body.querySelector('#batch-scan-links').checked,
            repoPaths: index.paths,
            modal,
            logEl: body.querySelector('#batch-log'),
          });
        },
      },
    ],
  });

  renderQueue();
  renderList();
}

/** Rename the selected pages, rewrite links and open one PR with every change. */
async function runBatchRename({ paths, list, scanLinks, repoPaths, modal, logEl }) {
  if (!sessionToken) {
    toast('批量重命名需要 GitHub token，请先在设置中填写。', 'error');
    openSettings();
    return;
  }
  const plans = paths.map((path) => {
    const input = list.querySelector(`[data-name-for="${CSS.escape(path)}"]`);
    const name = input?.value?.trim() || stripExt(basename(path));
    return planRename({ from: path, to: renamePagePath(path, name), repoPaths });
  });
  const invalid = plans.filter((plan) => !plan.ok);
  const valid = plans.filter((plan) => plan.ok && !plan.unchanged);
  if (invalid.length) {
    toast(`有 ${invalid.length} 个重命名不合法：${invalid[0].error}`, 'error', 5200);
    return;
  }
  if (!valid.length) {
    toast('没有需要重命名的页面。', 'info', 2800);
    return;
  }
  const confirmed = await confirmDialog({
    title: '确认批量重命名',
    messageHtml: true,
    message: `${valid
      .map((plan) => `${escapeHtml(plan.from)} → ${escapeHtml(plan.to)}`)
      .join(
        '<br>',
      )}<br>${scanLinks ? '<br>同时会扫描同游戏目录下的页面并改写站内链接。' : ''}<br><br>这会创建一个 PR。`,
    confirmText: '创建 PR',
  });
  if (!confirmed) return;

  logEl.hidden = false;
  logEl.innerHTML = '';
  const log = (message, kind = 'step') => {
    const line = document.createElement('div');
    line.className = kind;
    line.textContent = message;
    logEl.appendChild(line);
    logEl.scrollTop = logEl.scrollHeight;
  };
  modal.setBusy(true);

  const renamedIds = valid.map((plan) => ({ fromId: pageIdOf(plan.from), toId: pageIdOf(plan.to) }));
  const targets = scanLinks
    ? linkScanTargets({ renamedIds: renamedIds.map((item) => item.fromId), repoPaths, extra: valid.map((p) => p.from) })
    : valid.map((plan) => plan.from);
  const client = new GitHubClient(sessionToken);
  const bodies = new Map();
  // Bounded concurrency: a 200-page game folder would otherwise fire hundreds of
  // sequential requests and can hit GitHub's secondary rate limit.
  const MAX_LINK_SCAN = 200;
  const scanTargets = targets.slice(0, MAX_LINK_SCAN);
  if (targets.length > scanTargets.length) {
    log(`待扫描 ${targets.length} 个页面，仅处理前 ${scanTargets.length} 个；其余页面的链接未改写`, 'err');
  }
  const loaded = await mapWithConcurrency(scanTargets, 4, async (path) => {
    try {
      const file = await client.loadFile(CONTENT_OWNER, CONTENT_REPO, path, state.settings.branch || '');
      return { path, text: file.text };
    } catch (error) {
      log(`跳过 ${path}：${error.message}`, 'err');
      return null;
    }
  });
  for (const item of loaded) {
    if (item) bodies.set(item.path, item.text);
  }
  log(`读取 ${bodies.size} 个页面`, 'ok');

  const files = [];
  let linkHits = 0;
  for (const [path, text] of bodies) {
    let next = text;
    let hits = 0;
    for (const item of renamedIds) {
      const result = rewritePageLinks(next, { fromId: item.fromId, toId: item.toId });
      next = result.text;
      hits += result.replacements;
    }
    const plan = valid.find((item) => item.from === path);
    if (plan) {
      files.push({ path: plan.to, text: next, deleted: false });
      files.push({ path: plan.from, text: null, deleted: true });
      linkHits += hits;
      log(`重命名 ${plan.from} → ${plan.to}（改写 ${hits} 处链接）`, 'step');
    } else if (hits > 0) {
      files.push({ path, text: next });
      linkHits += hits;
      log(`更新链接 ${path}（${hits} 处）`, 'step');
    }
  }
  if (!files.some((file) => file.deleted)) {
    log('未读取到待重命名页面的内容，已中止。', 'err');
    modal.setBusy(false);
    return;
  }

  const stamp = new Date().toISOString().slice(0, 10).replaceAll('-', '');
  try {
    const result = await client.submitPullRequest({
      owner: CONTENT_OWNER,
      repo: CONTENT_REPO,
      baseBranch: state.settings.branch || '',
      branchName: defaultBranchName('batch-rename.md'),
      files,
      commitMessage: `content: 批量重命名 ${valid.length} 个页面`,
      prTitle: `content: 批量重命名 ${valid.length} 个页面`,
      prBody: [
        '## 变更类型',
        '',
        '- [x] 批量重命名 / 结构调整',
        '',
        '## 说明',
        '',
        `由编辑器批量重命名 ${valid.length} 个页面，并改写 ${linkHits} 处站内链接。`,
        '',
        '## 变更文件',
        '',
        ...valid.map((plan) => `- \`${plan.from}\` → \`${plan.to}\``),
        ...files
          .filter((file) => !valid.some((plan) => plan.from === file.path || plan.to === file.path))
          .map((file) => `- \`${file.path}\`（链接更新）`),
        '',
        `由 Wikifactory Editor 批量操作提交（${stamp}）。`,
      ].join('\n'),
      onProgress: log,
    });
    log(`完成：PR #${result.number}`, 'ok');
    rememberSessionPr(result);
    modal.setBusy(false);
    toast(`批量重命名已提交：PR #${result.number}`, 'success', 4600);
    modal.close();
    openReviewDialog();
  } catch (error) {
    log(`失败：${error.message}`, 'err');
    modal.setBusy(false);
    toast(error.message || '批量重命名失败。', 'error');
  }
}

/* ------------------------------------------------------------------- init */

function bindEvents() {
  els.toolbar.addEventListener('click', (event) => {
    const button = event.target.closest('[data-action]');
    if (button) handleToolbarAction(button.dataset.action);
  });

  // Remote config approval lives in the sidebar note and can be re-rendered.
  document.addEventListener('click', (event) => {
    if (event.target.closest?.('#cfg-approve')) {
      event.preventDefault();
      confirmPendingConfig();
    } else if (event.target.closest?.('#cfg-dismiss')) {
      event.preventDefault();
      keepBuiltInConfig();
    }
  });

  els.editorTabs.addEventListener('click', (event) => {
    const tab = event.target.closest('.editor-tab');
    if (tab) setEditorTab(tab.dataset.tab);
  });

  $('#btn-raw-frontmatter').addEventListener('click', () => {
    setEditorTab(state.content.editorTab === 'frontmatter' ? 'body' : 'frontmatter');
  });

  els.contentPath.addEventListener('input', () => {
    state.content.path = els.contentPath.value;
    updateDocMeta();
    markDirty();
  });

  $('#btn-content-load').addEventListener('click', () => loadCurrentFile());
  $('#btn-content-browse').addEventListener('click', openRepoBrowser);
  $('#btn-content-new-game').addEventListener('click', openNewGameDialog);
  $('#btn-content-drafts').addEventListener('click', openDraftsDialog);
  $('#btn-batch').addEventListener('click', openBatchDialog);

  $('#btn-save').addEventListener('click', () => saveDraft(true));
  els.fmForm.addEventListener('click', (event) => {
    if (event.target.closest('#fm-apply')) applyFmChanges({ confirm: true });
    else if (event.target.closest('#fm-apply-discard')) discardFmChanges();
  });
  $('#btn-export').addEventListener('click', exportCurrentFile);
  $('#btn-preview').addEventListener('click', openPreview);
  $('#btn-pr').addEventListener('click', () => openPrDialog());
  $('#btn-settings').addEventListener('click', openSettings);
  $('#btn-connection').addEventListener('click', openSettings);
  $('#btn-help').addEventListener('click', openHelp);
  $('#btn-theme').addEventListener('click', () => {
    state.theme = nextTheme(state.theme);
    applyTheme(state.theme);
    saveState(state);
  });
  $('#btn-sidebar').addEventListener('click', openSidebar);
  $('#sidebar-backdrop').addEventListener('click', closeSidebar);
  $('#btn-mobile-menu').addEventListener('click', openMobileMenu);

  $('#btn-preview-close').addEventListener('click', closePreview);
  $('#btn-preview-refresh').addEventListener('click', openPreview);
  $('#btn-preview-theme').addEventListener('click', () => {
    state.theme = effectiveTheme(state.theme) === 'dark' ? 'light' : 'dark';
    applyTheme(state.theme);
    saveState(state);
  });
  $('#preview-device-toggle').addEventListener('click', (event) => {
    const button = event.target.closest('[data-device]');
    if (!button) return;
    const mobile = button.dataset.device === 'mobile';
    els.previewStage.classList.toggle('is-mobile', mobile);
    for (const item of event.currentTarget.querySelectorAll('button')) {
      item.classList.toggle('is-active', item === button);
    }
    els.previewScroll.scrollTop = 0;
  });

  document.addEventListener('keydown', onKeyDown);
  document.addEventListener('click', (event) => {
    // Preview `[[页面]]` links open the page inside the editor instead of doing nothing.
    const wikiLink = event.target.closest?.('a.wf-link-preview[data-target]');
    if (wikiLink) {
      const rawTarget = wikiLink.dataset.target || '';
      const pageId = rawTarget.split('#')[0].trim();
      const game = gameOfPath(state.content.path);
      const repoPath = pageId.includes('/') ? `games/${pageId}.md` : game && pageId ? `games/${game}/${pageId}.md` : '';
      if (repoPath) {
        event.preventDefault();
        openDeepLink(repoPath);
        return;
      }
    }
    const link = event.target.closest?.('a[href]');
    if (!link) return;
    const href = link.getAttribute('href') || '';
    if (!/^https?:\/\//i.test(href)) return;
    event.preventDefault();
    // Site pages are handled in-app (avoids an Android intent round-trip).
    const deep = parseDeepLink(href);
    if (deep.ok && deep.kind === 'page') openDeepLink(href);
    else openExternal(link.href);
  });
  window.addEventListener('beforeunload', (event) => {
    if (!hasSessionChanges()) {
      saveState(state);
      return;
    }
    const behavior = state.settings.exitBehavior || 'ask';
    if (behavior === 'save') {
      saveDraft(false);
      return;
    }
    if (behavior === 'discard') {
      discardSessionChanges();
      return;
    }
    event.preventDefault();
    event.returnValue = '';
  });
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) saveState(state);
  });
}

function onKeyDown(event) {
  if (event.defaultPrevented) return;
  const mod = event.ctrlKey || event.metaKey;

  if (mod && event.key.toLowerCase() === 's') {
    event.preventDefault();
    saveDraft(true);
    return;
  }

  if (!els.previewOverlay.hidden) {
    if (event.key === 'Escape') {
      event.preventDefault();
      closePreview();
    }
    return;
  }
  const inModal = !!event.target.closest?.('.modal');
  if (inModal) return;
  const inCodeEditor = !!event.target.closest?.('.cm-editor');
  const targetIsField =
    inCodeEditor ||
    event.target instanceof HTMLInputElement ||
    event.target instanceof HTMLTextAreaElement ||
    event.target instanceof HTMLSelectElement;

  if (mod && event.key === 'Enter') {
    event.preventDefault();
    openPreview();
    return;
  }
  if (!targetIsField) return;

  if (mod && event.key.toLowerCase() === 'z') {
    const editor = activeEditor();
    event.preventDefault();
    if (event.shiftKey) {
      if (editor.redo()) updateStats();
    } else if (editor.undo()) updateStats();
    return;
  }
  if (mod && event.key.toLowerCase() === 'y') {
    event.preventDefault();
    if (activeEditor().redo()) updateStats();
    return;
  }
  if (mod && event.key.toLowerCase() === 'b') {
    event.preventDefault();
    if (state.content.editorTab !== 'frontmatter') activeEditor().wrap('**', '**');
  }
  if (event.key === 'Escape' && window.innerWidth <= 880) closeSidebar();
}

/** Restores the encrypted token saved on this device, then verifies it. */
async function restoreSavedToken() {
  if (state.settings.rememberToken === false) return;
  let saved;
  try {
    saved = await loadToken();
  } catch (error) {
    console.warn('[token] 恢复失败', error);
    return;
  }
  if (!saved?.token) return;
  sessionToken = saved.token;
  setConnection(false, saved.login ? `@${saved.login}` : '已恢复 token', '已从本机加密存储恢复 token，正在验证…');
  try {
    const user = await new GitHubClient(sessionToken).getUser();
    setConnection(true, `@${user.login}`, `已连接 @${user.login}（token 由本机加密存储恢复）`);
  } catch (error) {
    if (error instanceof GitHubError && error.status === 401) {
      sessionToken = '';
      await clearToken();
      setConnection(false, 'Token 已失效', '本机保存的 token 已失效，请在设置中重新填写');
      toast('本机保存的 token 已失效，已自动清除。', 'error', 4200);
      return;
    }
    setConnection(false, '已恢复 token', error.message);
  }
}

/** Reset the editor to a clean default page (used by the restore prompt). */
function startBlankPage() {
  const previousPath = state.content.path;
  const defaults = defaultState().content;
  state.content.path = defaults.path;
  state.content.fmRaw = '';
  state.content.body = '';
  state.content.loadedSha = null;
  state.content.loadedPath = '';
  state.content.loadedFmRaw = '';
  state.content.loadedBody = '';
  state.content.ref = '';
  state.content.editorTab = 'body';
  state.content.lastSaved = 0;
  assets.splice(0, assets.length);
  els.contentPath.value = state.content.path;
  bodyEditor.setValue('', { reset: true });
  fmEditor.setValue('', { reset: true });
  renderAssets();
  renderFmForm();
  populateFmForm();
  syncEditorVisibility();
  dirty = false;
  lastIssues = [];
  issuesStale = true;
  applyInlineDiagnostics();
  saveState(state);
  captureSessionBaseline();
  updateDocMeta();
  updateStats();
  updateSaveStatus();
  if (previousPath) deleteDraft(previousPath);
  updateDraftBadge();
  toast('已新建空白页。', 'success', 2400);
}

/** Ask whether to restore the previous session instead of silently reopening it. */
function maybePromptRestoreDraft() {
  const hasDraft = Boolean(state.content.body.trim() || state.content.fmRaw.trim());
  if (!hasDraft) return Promise.resolve(false);
  const title = frontmatterData(state.content.fmRaw).title || stripExt(basename(state.content.path)) || '未命名页面';
  const savedAt = state.content.lastSaved ? new Date(state.content.lastSaved).toLocaleString('zh-CN') : '未知';
  const body = document.createElement('div');
  body.innerHTML = `
    <div class="form-grid">
      <div class="form-note is-accent">
        检测到上次退出时打开的页面。编辑器<strong>不会自动恢复</strong>，请选择如何开始本次编辑。
      </div>
      <div class="pr-summary">
        <div class="pr-summary-row"><span>页面</span><span>${escapeHtml(state.content.path || '（未设置路径）')}</span></div>
        <div class="pr-summary-row"><span>标题</span><span>${escapeHtml(title)}</span></div>
        <div class="pr-summary-row"><span>草稿时间</span><span>${escapeHtml(savedAt)}</span></div>
        <div class="pr-summary-row"><span>正文</span><span>${countCharacters(state.content.body).characters.toLocaleString('zh-CN')} 字符</span></div>
      </div>
      <div class="form-note">
        「新建空白页」会清空当前草稿并回到默认新建路径（无法撤销）；
        选择「恢复草稿」则继续上次的内容。
      </div>
    </div>
  `;
  return new Promise((resolve) => {
    const modal = openModal({
      title: '恢复上次编辑的页面？',
      subtitle: '启动时由你决定，不再自动指向旧页面',
      body,
      size: 'normal',
      footer: [
        {
          label: '新建空白页',
          className: 'btn-ghost',
          onClick: () => {
            startBlankPage();
            modal.close();
          },
        },
        {
          label: '恢复草稿',
          className: 'btn-primary',
          onClick: () => {
            modal.close();
            saveDraft(false);
          },
        },
      ],
      onClose: () => resolve(true),
    });
  });
}

function restoreInitialUi() {
  els.contentPath.value = state.content.path;
  renderFmForm();
  populateFmForm();
  renderAssets();
  updateDraftBadge();

  applyTheme(state.theme);
  initThemeWatcher(() => state.theme);
  applyEditorPrefs();
  applyStatusBarPreference();
  applyIcons(document);
  renderToolbar();
  syncEditorVisibility();
  updateSaveStatus();
  updateDocMeta();
  updateStats();

  if (state.settings.rememberToken === false) {
    setConnection(false, '未连接', 'token 仅保留在内存；公开 Content 仓库可匿名读取，PR 需要 token');
  } else {
    setConnection(false, '正在恢复 token', '正在检查本机加密保存的 token…');
    tokenReady = restoreSavedToken();
  }

  if (state.content.body.trim() || state.content.fmRaw.trim()) {
    toast('检测到上次编辑的草稿，请选择恢复或新建空白页。', 'info', 2600);
  }

  captureSessionBaseline();
  maybePromptRestoreDraft().finally(() => {
    if (Number(state.settings.updateMode) !== 2) {
      setTimeout(() => checkForUpdates(), 900);
    }
  });
}

/** Web build only: register the offline app shell (PWA). */
function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return;
  if (window.NL_PORT || isAndroidRuntime()) return;
  if (!/^https?:$/.test(location.protocol)) return;
  window.addEventListener('load', () => {
    navigator.serviceWorker
      .register(new URL('sw.js', document.baseURI))
      .then((registration) => {
        registration.addEventListener('updatefound', () => {
          const worker = registration.installing;
          if (!worker) return;
          worker.addEventListener('statechange', () => {
            // Only notify when an older worker is already controlling the page.
            if (worker.state === 'installed' && navigator.serviceWorker.controller) {
              toast('新版本已下载，刷新页面后生效。', 'info', 6200);
            }
          });
        });
      })
      .catch((error) => console.warn('[pwa] Service Worker 注册失败', error));
  });
}

/**
 * Boot: bind the UI immediately (so clicks work even on a slow network), then
 * load editor-config.json — owner/repo may change, so repo-dependent labels are
 * refreshed afterwards. A failed / rejected config keeps the built-in values.
 */
async function boot() {
  setLang(state.settings.lang || 'zh');
  applyI18n();
  bindEvents();
  restoreInitialUi();
  registerServiceWorker();
  renderQueueBadge();
  renderPrBadge();
  await loadEditorConfig();
  if (activeConfig().source === 'remote') repoIndex = null;
  updateRepoScope();
  await handleStartupDeepLink();
}

boot();

window.__WFE__ = {
  version: APP_VERSION,
  state,
  get issues() {
    return lastIssues;
  },
  get tokenSet() {
    return Boolean(sessionToken);
  },
  get config() {
    return activeConfig();
  },
  validateNow,
  openPreview,
  openBranchConflictDialog,
  openContributing,
  checkForUpdates,
  requestExit,
  hasSessionChanges,
  setEditorTab,
  openDeepLink,
  importMarkdown,
  openBatchDialog,
  openReviewDialog,
  editors: { body: bodyEditor, frontmatter: fmEditor },
};
