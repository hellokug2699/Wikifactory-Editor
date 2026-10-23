/** Wikifactory Editor — Content-only application controller. */

import {
  CONTENT_OWNER, CONTENT_REPO, basename, downloadText, escapeHtml, formatBytes, formatTime,
  loadState, saveState, slugify, stripExt,
} from './state.js';
import { CodeEditor, CURSOR } from './code-editor.js';
import {
  CALLOUTS, COLOR_TOKENS, ICON_SIZES, countCharacters, frontmatterData, joinDocument,
  setYamlField, splitFrontmatter, summarizeIssues, validateDocument,
} from './validate.js';
import { GitHubClient, GitHubError } from './github.js';
import { buildPreview, attachToc } from './markdown.js';
import {
  applyTheme, effectiveTheme, escape, initThemeWatcher,
  nextTheme, openModal, toast,
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
let dirty = false;
let updatingForm = false;
let lastIssues = [];
let issuesStale = true;
let saveTimer = 0;
let validateTimer = 0;
let formSyncTimer = 0;
let connection = { ok: false, login: '', scopes: '', message: '未连接' };

const bodyEditor = new CodeEditor(els.bodyHost, {
  value: state.content.body,
  language: 'markdown',
  label: 'Markdown 正文',
  wrap: state.settings.wrap,
  onChange: () => onEditorInput('body'),
  onSelection: updateCaret,
});
const fmEditor = new CodeEditor(els.fmHost, {
  value: state.content.fmRaw,
  language: 'yaml',
  label: 'Frontmatter YAML',
  wrap: state.settings.wrap,
  onChange: () => onEditorInput('frontmatter'),
  onSelection: updateCaret,
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
  validateTimer = setTimeout(() => validateNow({ open: false }), 1100);
}

function updateSaveStatus() {
  els.saveStatus.classList.toggle('is-dirty', dirty);
  els.saveStatusText.textContent = dirty ? '有未保存修改' : '本地草稿已保存';
  const last = state.content.lastSaved;
  els.statSaved.textContent = last ? `草稿 ${formatTime(last)}` : dirty ? '未保存' : '本地草稿';
}

function updateCaret() {
  const { line, column } = activeEditor().lineColumn;
  els.statLn.textContent = `行 ${line}，列 ${column}`;
}

function updateStats() {
  const text = activeText();
  const { characters, words } = countCharacters(text);
  els.statChars.textContent = `${characters.toLocaleString('zh-CN')} 字符 / ${words.toLocaleString('zh-CN')} 词`;
  const summary = summarizeIssues(lastIssues);
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
    scheduleFormSync();
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
  els.fmForm.innerHTML = `
    <label class="field">
      <span class="field-label">标题 title</span>
      <input class="input" data-fm="title" id="fm-title" placeholder="页面标题（缺省用文件名）" autocomplete="off">
    </label>
    <label class="field">
      <span class="field-label">摘要 description</span>
      <textarea class="input" data-fm="description" id="fm-description" rows="2" placeholder="用于列表卡片与 SEO"></textarea>
    </label>
    <div class="fm-grid-2">
      <label class="field">
        <span class="field-label">标签 tags</span>
        <input class="input" data-fm="tags" id="fm-tags" placeholder="攻略, 建筑" autocomplete="off">
      </label>
      <label class="field">
        <span class="field-label">排序 order</span>
        <input class="input" data-fm="order" id="fm-order" type="number" placeholder="10">
      </label>
    </div>
    <label class="field">
      <span class="field-label">更新日期 updated</span>
      <input class="input" data-fm="updated" id="fm-updated" type="date">
    </label>
    <label class="check-row"><input type="checkbox" data-fm="draft" id="fm-draft"><span>草稿（draft：仅开发环境可见）</span></label>
    <label class="check-row"><input type="checkbox" data-fm="toc" id="fm-toc" checked><span>显示页内目录（toc）</span></label>
    <p class="form-help">修改表单会同步到 frontmatter，未知字段与注释保持不变。需要完整控制时打开「元数据 YAML」标签（带 YAML 语法高亮）。</p>
  `;
  els.fmForm.addEventListener('input', onFmFieldInput);
}

function populateFmForm() {
  const data = frontmatterData(state.content.fmRaw);
  const set = (selector, value) => {
    const node = els.fmForm.querySelector(selector);
    if (node && document.activeElement !== node) node.value = value ?? '';
  };
  set('#fm-title', data.title);
  set('#fm-description', data.description);
  set('#fm-tags', data.tags.join(', '));
  set('#fm-order', data.order ?? '');
  set('#fm-updated', data.updated || '');
  const draft = els.fmForm.querySelector('#fm-draft');
  if (draft && document.activeElement !== draft) draft.checked = data.draft;
  const toc = els.fmForm.querySelector('#fm-toc');
  if (toc && document.activeElement !== toc) toc.checked = data.toc;
}

function onFmFieldInput(event) {
  if (updatingForm) return;
  const field = event.target.dataset.fm;
  if (!field) return;
  let value;
  if (field === 'tags') {
    value = event.target.value.split(/[,，]/).map((tag) => tag.trim()).filter(Boolean);
  } else if (field === 'order') {
    value = event.target.value === '' ? '' : Number(event.target.value);
  } else if (field === 'draft' || field === 'toc') {
    const checked = event.target.checked;
    if (field === 'draft') value = checked ? true : '';
    else value = checked ? '' : false;
  } else {
    value = event.target.value;
  }

  state.content.fmRaw = setYamlField(state.content.fmRaw, field, value);
  if (fmEditor.value !== state.content.fmRaw) {
    fmEditor.setValue(state.content.fmRaw, { reset: false });
  }
  updateDocMeta();
  markDirty();
}

function setEditorTab(tab, { focus = true } = {}) {
  state.content.editorTab = tab === 'frontmatter' ? 'frontmatter' : 'body';
  syncEditorVisibility({ focus });
  updateStats();
  scheduleSave();
}

/* ----------------------------------------------------------------- toolbar */

const HISTORY_GROUP = {
  label: '历史',
  items: [
    { action: 'undo', icon: 'undo', title: '撤销 (Ctrl+Z)' },
    { action: 'redo', icon: 'redo', title: '重做 (Ctrl+Shift+Z)' },
  ],
};

const MARKDOWN_TEXT_GROUP = {
  label: '文本',
  items: [
    { action: 'h1', glyph: 'H1', title: '一级标题' },
    { action: 'h2', glyph: 'H2', title: '二级标题' },
    { action: 'h3', glyph: 'H3', title: '三级标题' },
    { action: 'bold', glyph: 'B', className: 'is-strong', title: '粗体：插入 **** 并定位中间 (Ctrl+B)' },
    { action: 'italic', glyph: 'I', className: 'is-italic', title: '斜体：插入 ** 并定位中间' },
    { action: 'strike', glyph: 'S', title: '删除线' },
    { action: 'inlineCode', icon: 'code', title: '行内代码' },
    { action: 'mdLink', icon: 'external-link', title: '标准 Markdown 链接' },
    { action: 'quote', icon: 'quote', title: '引用' },
  ],
};

const MARKDOWN_BLOCK_GROUP = {
  label: '块',
  items: [
    { action: 'ul', icon: 'list', title: '无序列表' },
    { action: 'ol', icon: 'list-ordered', title: '有序列表' },
    { action: 'task', icon: 'check-square', title: '任务列表' },
    { action: 'hr', icon: 'minus', title: '分隔线' },
    { action: 'codeblock', icon: 'braces', title: '代码块' },
    { action: 'callout', icon: 'info', label: '横幅', hasCaret: true, title: '插入横幅 / 提示框' },
  ],
};

const CONTENT_WIKI_GROUP = {
  label: 'Wiki',
  items: [
    { action: 'wikiLink', icon: 'link', label: '内链', title: '站内链接 [[…]]' },
    { action: 'wikiImage', icon: 'image', label: '图片', title: '插入正文图片 [[File/…]]' },
    { action: 'icon', icon: 'grid', label: '图标', title: '插入内联图标 [icon=…]' },
    { action: 'table', icon: 'table', label: '表格', title: '生成表格（N 行 × M 列）' },
    { action: 'cellColor', icon: 'palette', label: '单元格色', title: '表格单元格颜色' },
  ],
};

const CHECK_GROUP = {
  label: '检查',
  items: [
    { action: 'validate', icon: 'shield', label: '检查', title: '检查路径 / 元数据 / Wiki 语法' },
    { action: 'preview', icon: 'eye', label: '预览', title: '生成预览页面 (Ctrl+Enter)' },
  ],
};

const TOOLBAR = [HISTORY_GROUP, MARKDOWN_TEXT_GROUP, MARKDOWN_BLOCK_GROUP, CONTENT_WIKI_GROUP, CHECK_GROUP];

function renderToolbar() {
  els.toolbar.innerHTML = TOOLBAR.map((group) => `
    <div class="toolbar-group">
      <span class="toolbar-group-label">${escape(group.label)}</span>
      ${group.items.map((item) => {
        const inner = item.icon
          ? `${icon(item.icon)}${item.label ? `<span class="tool-label">${escape(item.label)}</span>` : ''}`
          : `<span class="tool-glyph">${escape(item.glyph)}</span>`;
        const classes = ['tool-btn', item.className || '', item.hasCaret ? 'has-caret' : ''].filter(Boolean).join(' ');
        return `<button type="button" class="${classes}" data-action="${item.action}" title="${escape(item.title || '')}" aria-label="${escape(item.title || item.action)}">${inner}</button>`;
      }).join('')}
    </div>
  `).join('');
  els.toolbar.hidden = state.content.editorTab === 'frontmatter';
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
    case 'bold': if (requireEditor()) editor.wrap('**', '**'); break;
    case 'italic': if (requireEditor()) editor.wrap('*', '*'); break;
    case 'strike': if (requireEditor()) editor.wrap('~~', '~~'); break;
    case 'inlineCode': if (requireEditor()) editor.wrap('`', '`'); break;
    case 'mdLink': openLinkDialog(); break;
    case 'quote': if (requireEditor()) editor.toggleLinePrefix('> '); break;
    case 'ul': if (requireEditor()) editor.toggleLinePrefix('- '); break;
    case 'ol': if (requireEditor()) editor.toggleLinePrefix('1. '); break;
    case 'task': if (requireEditor()) editor.toggleLinePrefix('- [ ] '); break;
    case 'h1': if (requireEditor()) editor.setHeading(1); break;
    case 'h2': if (requireEditor()) editor.setHeading(2); break;
    case 'h3': if (requireEditor()) editor.setHeading(3); break;
    case 'hr': if (requireEditor()) editor.insertBlock('---'); break;
    case 'codeblock': if (requireEditor()) editor.insertBlock('```markdown\n' + CURSOR + '\n```'); break;
    case 'wikiLink': if (requireEditor()) editor.wrap('[[', ']]'); break;
    case 'callout': openCalloutDialog(); break;
    case 'wikiImage': openImageDialog(); break;
    case 'icon': openIconDialog(); break;
    case 'table': openTableDialog(); break;
    case 'cellColor': openCellColorDialog(); break;
    case 'validate': validateNow({ open: true }); break;
    case 'preview': openPreview(); break;
    default: break;
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
    els.assetList.innerHTML = '<p class="empty-mini">暂无待上传图片。插入图片时可选择随 PR 上传。</p>';
    return;
  }
  els.assetList.innerHTML = assets.map((asset, index) => `
    <div class="asset-item">
      <img class="asset-thumb" src="${escapeHtml(asset.dataUrl)}" alt="">
      <div class="asset-info">
        <span class="asset-name">${escapeHtml(asset.name)}（${formatBytes(asset.size)}）</span>
        <span class="asset-path" title="${escapeHtml(asset.path)}">${escapeHtml(asset.path)}</span>
      </div>
      <button class="asset-remove" type="button" data-asset-index="${index}" aria-label="移除待上传图片">${icon('x', 14)}</button>
    </div>
  `).join('');
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

/* ------------------------------------------------------------- validation */

function collectIssues() {
  return validateDocument({
    path: state.content.path,
    fmRaw: state.content.fmRaw,
    body: state.content.body,
  });
}

function validateNow({ open = false } = {}) {
  const issues = collectIssues();
  lastIssues = issues;
  issuesStale = false;
  updateStats();
  if (open) showIssuesDialog(issues);
  return issues;
}

function showIssuesDialog(issues) {
  const summary = summarizeIssues(issues);
  if (!issues.length) {
    toast('检查通过：没有发现错误或警告。', 'success');
    return;
  }
  const list = issues.map((item, index) => `
    <button type="button" class="issue-item is-${item.severity}" data-issue="${index}">
      <span class="issue-badge">${item.severity === 'error' ? '错误' : '警告'}</span>
      <span style="flex:1">${escapeHtml(item.message)}</span>
      ${item.line ? `<span class="issue-line">L${item.line}</span>` : ''}
    </button>
  `).join('');
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
        ? [{ label: '继续提交 PR', className: 'btn-primary', onClick: () => { modal.close(); openPrDialog(); } }]
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
  setEditorTab(issue.source === 'frontmatter' ? 'frontmatter' : 'body');
  const editor = issue.source === 'frontmatter' ? fmEditor : bodyEditor;
  if (issue.line) editor.jumpToLine(issue.line);
  else editor.focus();
}

/* ------------------------------------------------------------------ files */

async function loadCurrentFile() {
  const path = currentPathValue().replace(/^\/+/, '');
  if (!path) { toast('请先填写仓库路径。', 'error'); return; }
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
    updateDocMeta();
    updateStats();
    updateSaveStatus();
    saveState(state);
    toast(`已加载 ${CONTENT_OWNER}/${CONTENT_REPO}/${path}`, 'success');
  } catch (error) {
    toast(error.message || '加载失败。', 'error');
    if (error instanceof GitHubError && error.status === 401) openSettings();
  } finally {
    button.disabled = false;
    button.textContent = oldLabel;
  }
}

function saveDraft(manual = false) {
  clearTimeout(saveTimer);
  state.content.body = bodyEditor.value;
  state.content.fmRaw = fmEditor.value;
  state.content.lastSaved = Date.now();
  const ok = saveState(state);
  if (ok) dirty = false;
  updateSaveStatus();
  updateStats();
  if (manual) toast(ok ? '草稿已保存到本地。' : '本地保存失败（可能是存储空间不足）。', ok ? 'success' : 'error');
}

function exportCurrentFile() {
  const content = assembleDocument();
  const name = basename(currentPathValue()) || 'untitled.md';
  downloadText(name, content, 'text/plain;charset=utf-8');
  toast(`已导出 ${name}`, 'success');
}

/* ------------------------------------------------------------- repo browser */

function openRepoBrowser() {
  let current = 'games';
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
        rows.push('<button class="issue-item" type="button" data-dir=".."><span class="issue-badge">目录</span><span style="flex:1">.. 返回上级</span></button>');
      }
      for (const item of list) {
        if (item.type === 'dir') {
          rows.push(`<button class="issue-item" type="button" data-dir="${escapeHtml(item.path)}"><span class="issue-badge" style="color:var(--accent)">目录</span><span style="flex:1">${escapeHtml(item.name)}</span></button>`);
        } else if (allowed(item.name)) {
          rows.push(`<button class="issue-item" type="button" data-file="${escapeHtml(item.path)}"><span class="issue-badge" style="color:var(--text-faint)">页面</span><span style="flex:1">${escapeHtml(item.name)}</span><span class="issue-line">${formatBytes(item.size)}</span></button>`);
        }
      }
      if (!rows.length) rows.push('<p class="empty-mini" style="padding:14px 4px">此目录没有可编辑的 Markdown 页面。</p>');
      listEl.innerHTML = `<div class="issue-list">${rows.join('')}</div>`;
      hintEl.textContent = `${CONTENT_OWNER}/${CONTENT_REPO}/${current} · ${list.length} 个条目`;
    } catch (error) {
      listEl.innerHTML = `<div class="form-note is-warn">${escapeHtml(error.message)}</div>`;
      if (error instanceof GitHubError && error.status === 401) hintEl.textContent = 'token 无效，请打开设置重新填写。';
    }
  }

  body.addEventListener('click', (event) => {
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
      state.content.path = file.dataset.file;
      els.contentPath.value = state.content.path;
      updateDocMeta();
      markDirty();
      modal.close();
      loadCurrentFile();
    }
  });

  pathInput.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') { event.preventDefault(); load(pathInput.value.trim()); }
  });
  body.querySelector('#browser-go').addEventListener('click', () => load(pathInput.value.trim()));
  load(current);
}

/* -------------------------------------------------------------- preview */

function openPreview() {
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
  els.previewTitle.textContent = result.title || '页面预览';
  els.previewToc.hidden = !(result.toc && result.toc.count >= 2);
  els.previewTocNav.innerHTML = result.toc?.html || '';
  els.previewScroll.scrollTop = 0;
  els.previewOverlay.hidden = false;
  document.body.style.overflow = 'hidden';
  setTimeout(() => $('#btn-preview-close')?.focus(), 30);
  if (!map.size) els.previewTitle.title = '本地快照预览：仓库中已有的图片会显示为占位块';
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
  const entries = [
    ['', '无'],
    ...Object.entries(COLOR_TOKENS).map(([key, value]) => [key, `${key} ${value}`]),
  ];
  return `<div class="chip-row">${entries.map(([key, label]) => `
    <button type="button" class="chip ${selected === key ? 'is-active' : ''}" data-color-kind="${kind}" data-color="${key}">
      ${key ? `<span class="chip-swatch" style="background:${COLOR_TOKENS[key]}"></span>` : ''}${escape(label)}
    </button>`).join('')}</div>`;
}

function formatColorToken(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  if (/^[ROYGBPK]$/i.test(raw)) return `&${raw.toUpperCase()}`;
  return raw;
}

function openLinkDialog() {
  if (state.content.editorTab === 'frontmatter') { toast('请切换到正文。', 'info'); return; }
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
      { label: '插入', className: 'btn-primary', onClick: () => {
        const text = textInput.value.trim() || '链接文字';
        const url = urlInput.value.trim() || '#';
        const snippet = `[${text}](${url})`;
        editor.replaceRange(selection.start, selection.end, snippet, snippet.length, snippet.length);
        modal.close();
      } },
    ],
  });
}

function openCalloutDialog() {
  if (state.content.editorTab === 'frontmatter') { toast('请切换到正文。', 'info'); return; }
  const editor = bodyEditor;
  const selected = editor.value.slice(editor.selection.start, editor.selection.end);
  let kind = 'warning';
  const body = document.createElement('div');
  body.innerHTML = `
    <div class="form-grid">
      <div>
        <span class="form-label">横幅类型</span>
        <div class="chip-row" id="callout-kinds">
          ${Object.entries(CALLOUTS).map(([key, preset]) => `<button type="button" class="chip ${key === kind ? 'is-active' : ''}" data-kind="${key}">${escape(key)} · ${escape(preset.label)}</button>`).join('')}
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
    const lines = [`:::${kind}${title ? `[${title.replaceAll(']', '\\]')}]` : ''}`, contentInput.value || '内容', ':::'];
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
      { label: '插入', className: 'btn-primary', onClick: () => {
        const title = titleInput.value.trim();
        const text = contentInput.value.trim();
        const bodyText = text ? `${text}${CURSOR}` : CURSOR;
        const block = `:::${kind}${title ? `[${title.replaceAll(']', '\\]')}]` : ''}\n${bodyText}\n:::`;
        editor.insertBlock(block);
        modal.close();
      } },
    ],
  });
}

function openIconDialog() {
  if (state.content.editorTab === 'frontmatter') { toast('请切换到正文。', 'info'); return; }
  let name = '';
  let size = 'sm';
  let bg = '';
  let fg = '';
  const body = document.createElement('div');
  body.innerHTML = `
    <div class="form-grid">
      ${formField('图标名称', '<input class="input mono" id="icon-name" placeholder="iron-plate（不含扩展名）" autocomplete="off">', '图标须位于 <code>games/&lt;游戏&gt;/assets/icons/&lt;名称&gt;.&lt;ext&gt;</code>。')}
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
  const refresh = () => {
    const parts = [`icon=${name || 'name'}`];
    if (size !== 'sm') parts.push(`size=${size}`);
    if (bg) parts.push(`bg=&${bg}`);
    if (fg) parts.push(`fg=&${fg}`);
    body.querySelector('#icon-preview').textContent = `[${parts.join(';')}]`;
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
      for (const chip of body.querySelectorAll(`[data-color-kind="${kind}"]`)) chip.classList.toggle('is-active', chip === colorChip);
      refresh();
    }
  });
  nameInput.addEventListener('input', () => { name = nameInput.value.trim(); refresh(); });
  refresh();

  const modal = openModal({
    title: '插入内联图标',
    subtitle: '[icon=名称;size=…;bg=…;fg=…]',
    body,
    footer: [
      { label: '取消', className: 'btn-ghost', onClick: () => modal.close() },
      { label: '插入', className: 'btn-primary', onClick: () => {
        if (!name) { toast('请填写图标名称。', 'error'); return; }
        const parts = [`icon=${name}`];
        if (size !== 'sm') parts.push(`size=${size}`);
        if (bg) parts.push(`bg=&${bg}`);
        if (fg) parts.push(`fg=&${fg}`);
        bodyEditor.insert(`[${parts.join(';')}]`);
        modal.close();
      } },
    ],
  });
}

function openCellColorDialog() {
  if (state.content.editorTab === 'frontmatter') { toast('请切换到正文。', 'info'); return; }
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
    body.querySelector('#cell-preview').textContent = parts.length ? `[${parts.join(';')}]颜色内容` : '（尚未选择颜色）';
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
  body.querySelector('#cell-bg-custom').addEventListener('input', (event) => { bg = event.target.value.trim(); refresh(); });
  body.querySelector('#cell-fg-custom').addEventListener('input', (event) => { fg = event.target.value.trim(); refresh(); });
  refresh();

  const modal = openModal({
    title: '表格单元格颜色',
    subtitle: '[bg=…;fg=…] 紧贴单元格内容最前面',
    body,
    footer: [
      { label: '取消', className: 'btn-ghost', onClick: () => modal.close() },
      { label: '插入', className: 'btn-primary', onClick: () => {
        const parts = [];
        if (bg) parts.push(`bg=${formatColorToken(bg)}`);
        if (fg) parts.push(`fg=${formatColorToken(fg)}`);
        if (!parts.length) { toast('请选择至少一个颜色。', 'error'); return; }
        const marker = `[${parts.join(';')}]`;
        editor.setSelection(selection.start, selection.start);
        editor.insert(marker);
        editor.setSelection(selection.start + marker.length, selection.end + marker.length);
        modal.close();
      } },
    ],
  });
}

/* ---------------------------------------------------------- table builder */

function openTableDialog() {
  if (state.content.editorTab === 'frontmatter') { toast('请切换到正文。', 'info'); return; }
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

  const fill = (template, r, c) => String(template)
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
      { label: '插入表格', className: 'btn-primary', onClick: () => {
        state.settings.templates.tableCell = cellTemplate.value;
        saveState(state);
        editor.insertBlock(build());
        modal.close();
      } },
    ],
  });
}

/* ---------------------------------------------------------- image builder */

function openImageDialog() {
  if (state.content.editorTab === 'frontmatter') { toast('请切换到正文。', 'info'); return; }
  const editor = bodyEditor;
  let picked = null;
  let style = state.settings.templates.imageStyle || 'wiki';

  const currentGame = /^games\/([^/]+)\//.exec(state.content.path || '')?.[1] || '';
  const defaultPath = (name) => currentGame
    ? `games/${currentGame}/assets/images/${name}`
    : `assets/images/${name}`;

  const body = document.createElement('div');
  body.innerHTML = `
    <div class="form-grid">
      <div class="form-grid-2">
        <label class="field"><span class="form-label">选择图片文件（任意格式）</span><input class="input" id="img-file" type="file"></label>
        <label class="field"><span class="form-label">文件名 / 引用名</span><input class="input mono" id="img-name" placeholder="iron-plate.png" autocomplete="off"></label>
      </div>
      <div class="form-note">上传是可选的。勾选「随 PR 上传」后，图片会写入 Content 仓库；不勾选则只插入标记，图片需已在仓库中。</div>
      <label class="check-row"><input type="checkbox" id="img-upload" checked><span>随 PR 上传到 Content 仓库</span></label>
      ${formField('上传路径', '<input class="input mono" id="img-upload-path" autocomplete="off">', 'Content 图片建议放在 <code>games/&lt;游戏&gt;/assets/images/</code>；Wiki 语法要求名称只含字母 / 数字 / . _ -。')}
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

  const sanitizeName = (name) => String(name || '')
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
    const opts = [frame ? 'thumb' : '', size, align, safeAlt ? `alt=${safeAlt}` : '', safeCaption].filter(Boolean).join('|');
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
  styleInput.addEventListener('change', () => { style = styleInput.value; refresh(); });
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
      { label: '插入', className: 'btn-primary', id: 'img-insert', onClick: () => {
        const name = getName();
        if (!name) { toast('请填写文件名或选择图片。', 'error'); return; }
        const marker = buildMarker();
        if (!marker.trim()) { toast('生成的标记为空，请检查自定义模板。', 'error'); return; }
        const willUpload = !!picked && uploadCheck.checked;
        const uploadPath = getUploadPath().replace(/^\/+/, '');
        if (willUpload) {
          if (!uploadPath || uploadPath.includes('..') || uploadPath.startsWith('/')) {
            toast('上传路径不合法。', 'error'); return;
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
      } },
    ],
  });
  insertButton = document.getElementById('img-insert');
  refresh();
}

/* --------------------------------------------------------------- settings */

function openSettings() {
  const body = document.createElement('div');
  body.innerHTML = `
    <div class="form-grid">
      <div class="form-note is-accent">
        <strong>仅客户端，且仅限 Content。</strong> token 只保存在当前运行内存中，不写入 localStorage、文件或任何持久存储；关闭应用即失效。输入框禁止复制。
        编辑器被硬编码为只能访问 <code>${CONTENT_OWNER}/${CONTENT_REPO}</code>，不会读写 Core / Alias。
      </div>

      <details class="token-guide" open>
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
        <span class="form-label">GitHub Token（仅本次运行）</span>
        <input class="input mono token-secret" id="set-token" type="password"
               placeholder="ghp_… / github_pat_…" autocomplete="new-password"
               spellcheck="false" data-lpignore="true" data-1p-ignore="true">
        <p class="form-help">经典 token 至少需要 <code>public_repo</code>；细粒度 token 需要 Fork 后 Content 仓库的 Contents / Pull requests 读写权限。</p>
      </label>
      <div class="button-row">
        <button class="btn btn-small btn-danger" type="button" id="set-token-clear">清除当前 token</button>
      </div>

      <div class="pr-summary">
        <div class="pr-summary-row"><span>目标仓库（固定）</span><span>${CONTENT_OWNER}/${CONTENT_REPO}</span></div>
      </div>
      <label class="field"><span class="form-label">目标分支（留空 = 默认分支）</span><input class="input mono" id="set-branch" value="${escapeHtml(state.settings.branch)}" placeholder="main"></label>
      <div class="form-grid-2">
        <label class="field"><span class="form-label">编辑器字号</span>
          <select class="input" id="set-fontsize">
            ${[13, 14, 14.5, 15, 16, 17, 18].map((size) => `<option value="${size}" ${Number(state.settings.fontSize) === size ? 'selected' : ''}>${size}px</option>`).join('')}
          </select>
        </label>
        <label class="check-row" style="align-self:end"><input type="checkbox" id="set-wrap" ${state.settings.wrap ? 'checked' : ''}><span>自动换行</span></label>
      </div>
      <button class="btn" type="button" id="set-test">测试连接</button>
      <div class="connection-result" id="set-result" hidden></div>
    </div>
  `;

  const tokenInput = body.querySelector('#set-token');
  tokenInput.value = sessionToken;
  const blockTokenCopy = (event) => {
    event.preventDefault();
    toast('出于安全考虑，token 输入框禁止复制。', 'info', 1800);
  };
  for (const type of ['copy', 'cut', 'contextmenu', 'dragstart']) {
    tokenInput.addEventListener(type, blockTokenCopy);
  }

  const resultEl = body.querySelector('#set-result');
  body.querySelector('#set-token-clear').addEventListener('click', () => {
    sessionToken = '';
    tokenInput.value = '';
    tokenInput.type = 'password';
    setConnection(false, '未连接', '已清除 token');
    resultEl.hidden = true;
    toast('已清除内存中的 token。', 'success');
  });

  body.querySelector('#set-test').addEventListener('click', async () => {
    const token = tokenInput.value.trim();
    if (!token) { toast('请先填写 token。', 'error'); return; }
    resultEl.hidden = false;
    resultEl.className = 'connection-result';
    resultEl.textContent = '正在验证 token…';
    try {
      const user = await new GitHubClient(token).getUser();
      const scopes = user.scopes || '（细粒度 token：权限由仓库设置决定）';
      resultEl.className = 'connection-result is-ok';
      resultEl.innerHTML = `已连接：<strong>@${escapeHtml(user.login)}</strong><br>权限范围：<code>${escapeHtml(scopes)}</code>`;
      setConnection(true, `@${user.login}`, `已连接 @${user.login}`);
    } catch (error) {
      resultEl.className = 'connection-result is-error';
      resultEl.textContent = error.message;
      setConnection(false, '连接失败', error.message);
    }
  });

  const modal = openModal({
    title: '设置与 GitHub 连接',
    subtitle: 'token 仅保存在内存；提交时直接创建 Content 仓库 PR',
    body,
    size: 'wide',
    footer: [
      { label: '取消', className: 'btn-ghost', onClick: () => modal.close() },
      { label: '保存设置', className: 'btn-primary', onClick: () => {
        sessionToken = tokenInput.value.trim();
        state.settings.branch = body.querySelector('#set-branch').value.trim();
        state.settings.fontSize = Number(body.querySelector('#set-fontsize').value) || 14.5;
        state.settings.wrap = body.querySelector('#set-wrap').checked;
        applyEditorPrefs();
        saveState(state);
        if (!sessionToken) setConnection(false, '未连接', '未设置 token');
        else if (!connection.ok) {
          setConnection(false, 'Token 已设置', '已保存在内存，正在验证…');
          new GitHubClient(sessionToken).getUser()
            .then((user) => setConnection(true, `@${user.login}`, `已连接 @${user.login}`))
            .catch((error) => setConnection(false, '连接失败', error.message));
        }
        modal.close();
        toast('设置已保存；token 不会写入本地存储。', 'success');
      } },
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
  bodyEditor.setWrap(state.settings.wrap);
  fmEditor.setWrap(state.settings.wrap);
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
      <div class="form-note">安全提示：token 只保存在本机；公开仓库中不要提交任何密钥。若在共享设备使用，请关闭「记住 token」或在结束时清除。</div>
    </div>
  `;
  const modal = openModal({
    title: '帮助与语法速查',
    subtitle: 'Wikifactory Content Contributor Editor',
    body,
    size: 'wide',
    footer: [{ label: '关闭', className: 'btn-primary', onClick: () => modal.close() }],
  });
}

/* ------------------------------------------------------------------- PR */

async function openPrDialog({ prefill = null } = {}) {
  if (!sessionToken) {
    toast('提交 PR 需要 GitHub token，请先在设置中填写。', 'error');
    openSettings();
    return;
  }
  const path = currentPathValue().replace(/^\/+/, '');
  if (!path) {
    toast('请先填写仓库路径。', 'error');
    return;
  }
  const doc = assembleDocument();
  let issues = [];
  try {
    issues = collectIssues();
  } catch (error) {
    toast(`检查失败：${error.message}`, 'error');
    return;
  }
  lastIssues = issues;
  issuesStale = false;
  updateStats();
  const summary = summarizeIssues(issues);
  if (summary.errors > 0) {
    showIssuesDialog(issues);
    toast('存在错误，修复后再提交 PR。', 'error');
    return;
  }

  const targetAssets = assets.map((asset) => asset.path);
  const branchDefault = prefill?.branchName || `wfe/${slugify(stripExt(basename(path)))}-${new Date().toISOString().slice(5, 16).replace(/[-:T]/g, '')}`;
  const data = frontmatterData(state.content.fmRaw);
  const titleDefault = prefill?.prTitle || `content: ${data.title || stripExt(basename(path))}`;
  const commitDefault = prefill?.commitMessage || `content: 更新 ${path}`;
  const prBodyDefault = prefill?.prBody || [
    '由 Wikifactory Editor 提交。',
    '',
    '变更文件：',
    `- \`${path}\``,
    ...targetAssets.map((asset) => `- \`${asset}\`（新增 / 更新图片）`),
    '',
    `校验：${summary.errors} 错误，${summary.warnings} 警告。`,
    'Content 仓库不要求分支与 base 保持 up-to-date。',
  ].join('\n');

  const body = document.createElement('div');
  body.innerHTML = `
    <div class="form-grid">
      <div class="pr-summary">
        <div class="pr-summary-row"><span>目标仓库</span><span>${CONTENT_OWNER}/${CONTENT_REPO}</span></div>
        <div class="pr-summary-row"><span>目标分支</span><span>${escapeHtml(state.settings.branch || '默认分支')}</span></div>
        <div class="pr-summary-row"><span>文件</span><span>${escapeHtml(path)}${targetAssets.length ? `<br>+ ${targetAssets.length} 个图片` : ''}</span></div>
        <div class="pr-summary-row"><span>账号</span><span>${escapeHtml(connection.login || '待验证')}</span></div>
      </div>
      <div class="form-note is-accent">
        Content 仓库不设置必须 up-to-date：提交分支会从最新 main 创建，无需手动同步。
        所有请求仅在客户端发往 GitHub API。
      </div>
      <div class="form-note">
        分支名完全由你决定，编辑器不会自动改名。若分支名已被其他贡献者占用，会弹出错误窗口要求你更换。
      </div>
      ${formField('分支设置 · 分支名', `<input class="input mono" id="pr-branch" value="${escapeHtml(branchDefault)}" autocomplete="off">`, '分支创建在 Content 仓库或你的 Fork 上；编辑器不会自动追加后缀。')}
      ${formField('提交信息', `<input class="input" id="pr-commit" value="${escapeHtml(commitDefault)}" autocomplete="off">`)}
      ${formField('PR 标题', `<input class="input" id="pr-title" value="${escapeHtml(titleDefault)}" autocomplete="off">`)}
      ${formField('PR 说明', `<textarea class="input" id="pr-body" rows="6">${escapeHtml(prBodyDefault)}</textarea>`)}
      <label class="check-row"><input type="checkbox" id="pr-draft" ${prefill?.draft ? 'checked' : ''}><span>创建为 Draft PR</span></label>
      <div class="progress-log" id="pr-log" hidden></div>
    </div>
  `;

  const modal = openModal({
    title: '提交 Pull Request',
    subtitle: `Content · ${CONTENT_OWNER}/${CONTENT_REPO}`,
    body,
    size: 'wide',
    footer: [
      { label: '取消', className: 'btn-ghost', onClick: () => modal.close() },
      { label: '创建 PR', className: 'btn-primary', onClick: async () => {
        const branchName = body.querySelector('#pr-branch').value.trim();
        const commitMessage = body.querySelector('#pr-commit').value.trim();
        const prTitle = body.querySelector('#pr-title').value.trim();
        const prBody = body.querySelector('#pr-body').value.trim();
        const draft = body.querySelector('#pr-draft').checked;
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
          const files = [{ path, text: doc }];
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
          foot.appendChild(copyButton);
          foot.appendChild(closeButton);
          modal.body.innerHTML = '';
          modal.body.appendChild(success);
          modal.body.appendChild(logEl);
          assets.length = 0;
          renderAssets();
          toast('PR 已创建。', 'success');
        } catch (error) {
          const branchConflict = error instanceof GitHubError
            && (error.code === 'BRANCH_EXISTS' || (error.status === 422 && /已存在|exists/i.test(error.message)));
          if (branchConflict) {
            const snapshot = { branchName, commitMessage, prTitle, prBody, draft };
            modal.close();
            openBranchConflictDialog({ branchName, snapshot, message: error.message });
            return;
          }
          log(`失败：${error.message}`, 'err');
          modal.setBusy(false);
          toast(error.message || '提交失败。', 'error');
          if (error instanceof GitHubError && error.status === 401) {
            setTimeout(() => { modal.close(); openSettings(); }, 600);
          }
        }
      } },
    ],
  });
}

function openBranchConflictDialog({ branchName, snapshot, message }) {
  const body = document.createElement('div');
  body.innerHTML = `
    <div class="form-note is-warn">
      <strong>分支名已被占用。</strong><br>
      ${escapeHtml(message || `分支名「${branchName}」已存在。`)}<br>
      其他贡献者可能已经使用该分支名。编辑器不会自动改名，请设置一个新的分支名。
    </div>
    ${formField('新的分支名', `<input class="input mono" id="conflict-branch" value="${escapeHtml(branchName)}" autocomplete="off">`, '必须与已占用的分支名不同；提交信息与 PR 内容会保留。')}
  `;
  const input = body.querySelector('#conflict-branch');
  const modal = openModal({
    title: '分支名已被占用',
    subtitle: 'GitHub 422 · Reference already exists',
    body,
    size: 'normal',
    footer: [
      { label: '取消', className: 'btn-ghost', onClick: () => modal.close() },
      { label: '返回修改并重试', className: 'btn-primary', onClick: () => {
        const next = input.value.trim();
        if (!next) { toast('请填写新的分支名。', 'error'); input.focus(); return; }
        if (next === branchName) { toast('请使用不同的分支名。', 'error'); input.focus(); input.select(); return; }
        if (next.startsWith('/') || next.includes('..') || /\s/.test(next)) {
          toast('分支名不合法。', 'error'); input.focus(); return;
        }
        modal.close();
        openPrDialog({ prefill: { ...snapshot, branchName: next } });
      } },
    ],
  });
  setTimeout(() => { input.focus(); input.select(); }, 50);
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
      <button class="btn btn-block" type="button" data-mobile-action="save">${icon('save')}保存本地草稿</button>
      <button class="btn btn-block" type="button" data-mobile-action="export">${icon('download')}导出当前文件</button>
      <button class="btn btn-block" type="button" data-mobile-action="sidebar">${icon('panel-left')}打开文档侧栏</button>
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
    else if (action === 'save') saveDraft(true);
    else if (action === 'export') exportCurrentFile();
    else if (action === 'sidebar') openSidebar();
  });
}

/* ------------------------------------------------------------------- init */

function bindEvents() {
  els.toolbar.addEventListener('click', (event) => {
    const button = event.target.closest('[data-action]');
    if (button) handleToolbarAction(button.dataset.action);
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

  $('#btn-content-load').addEventListener('click', loadCurrentFile);
  $('#btn-content-browse').addEventListener('click', openRepoBrowser);

  $('#btn-save').addEventListener('click', () => saveDraft(true));
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
    const link = event.target.closest?.('a[href]');
    if (!link) return;
    const href = link.getAttribute('href') || '';
    if (!/^https?:\/\//i.test(href)) return;
    event.preventDefault();
    openExternal(link.href);
  });
  window.addEventListener('beforeunload', () => saveState(state));
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
    if (event.key === 'Escape') { event.preventDefault(); closePreview(); }
    return;
  }
  const inModal = !!event.target.closest?.('.modal');
  if (inModal) return;
  const inCodeEditor = !!event.target.closest?.('.cm-editor');
  const targetIsField = inCodeEditor
    || event.target instanceof HTMLInputElement
    || event.target instanceof HTMLTextAreaElement
    || event.target instanceof HTMLSelectElement;

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

function restoreInitialUi() {
  els.contentPath.value = state.content.path;
  renderFmForm();
  populateFmForm();
  renderAssets();

  applyTheme(state.theme);
  initThemeWatcher(() => state.theme);
  applyEditorPrefs();
  applyIcons(document);
  renderToolbar();
  syncEditorVisibility();
  updateSaveStatus();
  updateDocMeta();
  updateStats();

  setConnection(false, '未连接', 'token 仅保存在内存；每次启动都需要重新填写。公开 Content 仓库可匿名读取，PR 需要 token');

  if (state.content.body.trim() || state.content.fmRaw.trim()) {
    toast('已恢复上次编辑的本地草稿。', 'info', 2400);
  }
}

bindEvents();
restoreInitialUi();

window.__WFE__ = {
  state,
  get issues() { return lastIssues; },
  get tokenSet() { return Boolean(sessionToken); },
  validateNow,
  openPreview,
  openBranchConflictDialog,
  setEditorTab,
  editors: { body: bodyEditor, frontmatter: fmEditor },
};
