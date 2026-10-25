/**
 * Small i18n helper (zh / en).
 *
 * Only UI chrome is translated: shell labels, toolbar, settings and the
 * v1.2.5 dialogs (batch / review / deep link / config). Long-form explanatory
 * paragraphs stay in Chinese; missing keys fall back to zh, then to the key.
 */

export const LANGS = [
  { value: 'zh', label: '中文' },
  { value: 'en', label: 'English' },
];

const ZH = {
  'app.connection': '未连接',
  'nav.sidebar': '打开侧栏',
  'nav.sidebarTitle': '侧栏',
  'nav.theme': '切换主题',
  'nav.settings': 'GitHub 设置',
  'nav.help': '帮助与语法速查',
  'nav.helpTitle': '帮助',
  'nav.preview': '预览',
  'nav.previewTitle': '预览页面 (Ctrl+Enter)',
  'nav.pr': '提交 PR',
  'nav.prTitle': '提交 Pull Request',
  'nav.more': '更多操作',
  'side.title': '文档设置',
  'side.position': '页面位置',
  'side.path': '仓库路径',
  'side.browse': '浏览',
  'side.load': '加载',
  'side.newGame': '新建游戏',
  'side.drafts': '最近草稿',
  'side.meta': '页面元数据',
  'side.rawYaml': '原始 YAML',
  'side.assets': '待上传资源',
  'side.batch': '批量操作',
  'side.search': '全站搜索',
  'side.save': '保存草稿',
  'side.export': '导出',
  'side.saveTitle': '保存本地草稿 (Ctrl+S)',
  'side.exportTitle': '导出当前文件',
  'tab.body': '正文',
  'tab.frontmatter': '元数据 YAML',
  'stat.ready': '草稿已就绪',
  'stat.untitled': '未命名页面',
  'preview.title': '页面预览',
  'preview.kicker': 'PREVIEW',
  'preview.close': '关闭预览',
  'preview.desktop': '桌面',
  'preview.mobile': '手机',
  'preview.refresh': '重新渲染',
  'preview.theme': '切换预览主题',
  'preview.toc': '本页目录',

  'tb.history': '历史',
  'tb.format': '格式',
  'tb.wiki': 'Wiki',
  'tb.check': '检查',
  'tb.undo': '撤销 (Ctrl+Z)',
  'tb.redo': '重做 (Ctrl+Shift+Z)',
  'tb.h1': '一级标题',
  'tb.h2': '二级标题',
  'tb.h3': '三级标题',
  'tb.bold': '粗体 (Ctrl+B)',
  'tb.italic': '斜体 (Ctrl+I)',
  'tb.strike': '删除线',
  'tb.inlineCode': '行内代码',
  'tb.mdLink': 'Markdown 链接 (Ctrl+K)',
  'tb.quote': '引用',
  'tb.ul': '无序列表',
  'tb.ol': '有序列表',
  'tb.task': '任务列表',
  'tb.hr': '分隔线',
  'tb.codeblock': '代码块',
  'tb.callout': '横幅',
  'tb.wikiLink': '内链',
  'tb.wikiImage': '图片',
  'tb.icon': '图标',
  'tb.audio': '音频',
  'tb.embed': '嵌入',
  'tb.table': '表格',
  'tb.cellColor': '单元格色',
  'tb.validate': '检查',
  'tb.preview': '预览',
  'tb.calloutTitle': '插入横幅 / 提示框',
  'tb.wikiLinkTitle': '站内链接 [[…]] (Ctrl+Shift+K)',
  'tb.wikiImageTitle': '插入正文图片 [[File/…]]',
  'tb.iconTitle': '插入内联图标 [icon=…]',
  'tb.audioTitle': '插入 OGG 音频 [[Audio/…]]',
  'tb.embedTitle': '嵌入播放器 [[Embed/provider/ID]]',
  'tb.tableTitle': '生成表格（N 行 × M 列）',
  'tb.cellColorTitle': '表格单元格颜色',
  'tb.validateTitle': '检查路径 / 元数据 / Wiki 语法',
  'tb.previewTitle': '生成预览页面 (Ctrl+Enter)',

  'set.title': '设置与 GitHub 连接',
  'set.subtitle': 'token 加密保存在本机；提交时直接创建 Content 仓库 PR',
  'set.token': 'GitHub Token',
  'set.remember': '记住 token（加密保存在本机，下次启动自动恢复）',
  'set.clearToken': '清除 token（内存与已保存）',
  'set.targetRepo': '目标仓库',
  'set.branch': '目标分支（留空 = 默认分支）',
  'set.lang': '界面语言',
  'set.appearance': '外观与编辑',
  'set.fontSize': '编辑器字号',
  'set.wrap': '自动换行',
  'set.gutter': '行号栏',
  'set.gutterAuto': '自动（移动端隐藏）',
  'set.gutterOn': '始终显示',
  'set.gutterOff': '始终隐藏',
  'set.updateMode': '更新方式',
  'set.updateAuto': '0 · 有新版本时自动下载',
  'set.updatePrompt': '1 · 提示后手动下载（默认）',
  'set.updateOff': '2 · 不检查更新',
  'set.exitBehavior': '退出行为',
  'set.exitAsk': '每次询问（默认）',
  'set.exitSave': '总是保存后退出',
  'set.exitDiscard': '不保存直接退出',
  'set.hideStatusBar': '隐藏 Android 系统状态栏（沉浸显示）',
  'set.checkUpdate': '立即检查更新',
  'set.contributing': '查看 Content 使用须知',
  'set.exit': '退出应用',
  'set.test': '测试连接',
  'set.save': '保存设置',
  'set.cancel': '取消',
  'set.startup': '启动与退出',
  'set.config': '仓库配置（editor-config.json）',

  'review.title': 'PR 审阅状态',
  'review.refresh': '刷新状态',
  'review.open': '在 GitHub 打开',
  'review.state': '状态',
  'review.review': '审阅',
  'review.mergeable': '可合并性',
  'review.mergeableYes': '可以合并',
  'review.mergeableNo': '存在冲突，需要同步目标分支',
  'review.mergeableUnknown': 'GitHub 正在计算',
  'review.approved': '已批准',
  'review.changes': '要求修改',
  'review.commented': '评论',
  'review.pending': '待审阅',
  'review.noPr': '还没有在本会话中创建 PR。',
  'review.guidance': '处理指引',

  'batch.title': '批量操作',
  'batch.edit': '批量编辑',
  'batch.rename': '批量重命名',
  'batch.filter': '筛选页面…',
  'batch.selectAll': '全选',
  'batch.clear': '清空',
  'batch.selected': '已选',
  'batch.scanLinks': '同时更新引用这些页面的站内链接（按游戏目录扫描）',
  'batch.queue': '加入编辑队列',
  'batch.renameRun': '执行重命名',
  'batch.queueTitle': '编辑队列',
  'batch.queueEmpty': '队列为空。在「批量操作」中选择多个页面即可加入。',
  'batch.next': '下一个',
  'batch.finish': '结束队列',
  'batch.progress': '队列',
  'batch.renamed': '已重命名',
  'batch.failed': '失败',

  'link.imported': '已从外部导入 Markdown，保存前请确认仓库路径。',
  'link.opened': '已通过深链打开',

  'cfg.remote': '已加载 editor-config.json',
  'cfg.signed': '（签名有效，来自配置发布者）',
  'cfg.unsigned': '（未签名，仅通过哈希与白名单校验）',
  'cfg.approved': '（未签名，已由你手动确认）',
  'cfg.badSignature': '配置签名无效，已回退内置配置',
  'cfg.verified': '（哈希校验通过）',
  'cfg.unverified': '（配置已更新，哈希与当前版本不同，已按白名单校验后应用）',
  'cfg.rejected': 'editor-config.json 未通过白名单校验，已回退到内置配置',
  'cfg.pending': '远程配置要求把 Content 仓库切换为 {repo}，但该配置与内置哈希不一致。出于安全考虑，暂未启用。',
  'cfg.pendingApprove': '查看并启用',
  'cfg.pendingKeep': '继续使用内置配置',
  'cfg.confirmTitle': '启用远程仓库配置？',
  'cfg.confirmBody':
    '远程 editor-config.json 未通过哈希固定，且要切换 Content 仓库：<br><br>内置：{builtin}<br>远程：{remote}<br><br>只有在你确认这次迁移可信时才继续。之后提交的 PR 会指向远程仓库。',
  'cfg.confirmEnable': '启用',
  'cfg.confirmed': '已启用远程仓库配置：{repo}',
  'cfg.kept': '已继续使用内置仓库配置。',
  'cfg.pendingToast': '检测到远程仓库配置变更，请在侧栏「编辑范围」中确认。',
};

const EN = {
  'app.connection': 'Not connected',
  'nav.sidebar': 'Open sidebar',
  'nav.sidebarTitle': 'Sidebar',
  'nav.theme': 'Toggle theme',
  'nav.settings': 'GitHub settings',
  'nav.help': 'Help and syntax cheat sheet',
  'nav.helpTitle': 'Help',
  'nav.preview': 'Preview',
  'nav.previewTitle': 'Preview page (Ctrl+Enter)',
  'nav.pr': 'Submit PR',
  'nav.prTitle': 'Submit pull request',
  'nav.more': 'More actions',
  'side.title': 'Document settings',
  'side.position': 'Page location',
  'side.path': 'Repository path',
  'side.browse': 'Browse',
  'side.load': 'Load',
  'side.newGame': 'New game',
  'side.drafts': 'Recent drafts',
  'side.meta': 'Page metadata',
  'side.rawYaml': 'Raw YAML',
  'side.assets': 'Pending assets',
  'side.batch': 'Batch actions',
  'side.search': 'Site search',
  'side.save': 'Save draft',
  'side.export': 'Export',
  'side.saveTitle': 'Save local draft (Ctrl+S)',
  'side.exportTitle': 'Export current file',
  'tab.body': 'Body',
  'tab.frontmatter': 'Metadata YAML',
  'stat.ready': 'Draft ready',
  'stat.untitled': 'Untitled page',
  'preview.title': 'Page preview',
  'preview.kicker': 'PREVIEW',
  'preview.close': 'Close preview',
  'preview.desktop': 'Desktop',
  'preview.mobile': 'Mobile',
  'preview.refresh': 'Re-render',
  'preview.theme': 'Toggle preview theme',
  'preview.toc': 'On this page',

  'tb.history': 'History',
  'tb.format': 'Format',
  'tb.wiki': 'Wiki',
  'tb.check': 'Check',
  'tb.undo': 'Undo (Ctrl+Z)',
  'tb.redo': 'Redo (Ctrl+Shift+Z)',
  'tb.h1': 'Heading 1',
  'tb.h2': 'Heading 2',
  'tb.h3': 'Heading 3',
  'tb.bold': 'Bold (Ctrl+B)',
  'tb.italic': 'Italic (Ctrl+I)',
  'tb.strike': 'Strikethrough',
  'tb.inlineCode': 'Inline code',
  'tb.mdLink': 'Markdown link (Ctrl+K)',
  'tb.quote': 'Quote',
  'tb.ul': 'Bulleted list',
  'tb.ol': 'Numbered list',
  'tb.task': 'Task list',
  'tb.hr': 'Divider',
  'tb.codeblock': 'Code block',
  'tb.callout': 'Callout',
  'tb.wikiLink': 'Wiki link',
  'tb.wikiImage': 'Image',
  'tb.icon': 'Icon',
  'tb.audio': 'Audio',
  'tb.embed': 'Embed',
  'tb.table': 'Table',
  'tb.cellColor': 'Cell color',
  'tb.validate': 'Check',
  'tb.preview': 'Preview',
  'tb.calloutTitle': 'Insert callout / notice',
  'tb.wikiLinkTitle': 'Internal link [[…]] (Ctrl+Shift+K)',
  'tb.wikiImageTitle': 'Insert inline image [[File/…]]',
  'tb.iconTitle': 'Insert inline icon [icon=…]',
  'tb.audioTitle': 'Insert OGG audio [[Audio/…]]',
  'tb.embedTitle': 'Insert embed player [[Embed/provider/ID]]',
  'tb.tableTitle': 'Generate table (N rows × M columns)',
  'tb.cellColorTitle': 'Table cell color',
  'tb.validateTitle': 'Check path / metadata / wiki syntax',
  'tb.previewTitle': 'Render preview (Ctrl+Enter)',

  'set.title': 'Settings and GitHub connection',
  'set.subtitle': 'The token is encrypted on this device; PRs go straight to the Content repo',
  'set.token': 'GitHub token',
  'set.remember': 'Remember token (encrypted on this device, restored on launch)',
  'set.clearToken': 'Clear token (memory and saved copy)',
  'set.targetRepo': 'Target repository',
  'set.branch': 'Target branch (empty = default branch)',
  'set.lang': 'Interface language',
  'set.appearance': 'Appearance and editing',
  'set.fontSize': 'Editor font size',
  'set.wrap': 'Wrap lines',
  'set.gutter': 'Line numbers',
  'set.gutterAuto': 'Auto (hidden on mobile)',
  'set.gutterOn': 'Always show',
  'set.gutterOff': 'Always hide',
  'set.updateMode': 'Update policy',
  'set.updateAuto': '0 · Download automatically',
  'set.updatePrompt': '1 · Ask before downloading (default)',
  'set.updateOff': '2 · Never check',
  'set.exitBehavior': 'On exit',
  'set.exitAsk': 'Ask every time (default)',
  'set.exitSave': 'Always save then exit',
  'set.exitDiscard': 'Exit without saving',
  'set.hideStatusBar': 'Hide the Android status bar (immersive)',
  'set.checkUpdate': 'Check for updates now',
  'set.contributing': 'Content contribution guide',
  'set.exit': 'Quit app',
  'set.test': 'Test connection',
  'set.save': 'Save settings',
  'set.cancel': 'Cancel',
  'set.startup': 'Startup and exit',
  'set.config': 'Repository config (editor-config.json)',

  'review.title': 'PR review status',
  'review.refresh': 'Refresh',
  'review.open': 'Open on GitHub',
  'review.state': 'State',
  'review.review': 'Reviews',
  'review.mergeable': 'Mergeable',
  'review.mergeableYes': 'Ready to merge',
  'review.mergeableNo': 'Conflicts: update the target branch first',
  'review.mergeableUnknown': 'GitHub is computing',
  'review.approved': 'Approved',
  'review.changes': 'Changes requested',
  'review.commented': 'Comments',
  'review.pending': 'Awaiting review',
  'review.noPr': 'No pull request has been created in this session.',
  'review.guidance': 'How to fix it',

  'batch.title': 'Batch actions',
  'batch.edit': 'Batch edit',
  'batch.rename': 'Batch rename',
  'batch.filter': 'Filter pages…',
  'batch.selectAll': 'Select all',
  'batch.clear': 'Clear',
  'batch.selected': 'selected',
  'batch.scanLinks': 'Also rewrite internal links that point at these pages (same game folder)',
  'batch.queue': 'Add to edit queue',
  'batch.renameRun': 'Rename',
  'batch.queueTitle': 'Edit queue',
  'batch.queueEmpty': 'The queue is empty. Pick pages in Batch actions to fill it.',
  'batch.next': 'Next',
  'batch.finish': 'End queue',
  'batch.progress': 'Queue',
  'batch.renamed': 'Renamed',
  'batch.failed': 'Failed',

  'link.imported': 'Imported external Markdown; confirm the repository path before saving.',
  'link.opened': 'Opened via deep link',

  'cfg.remote': 'Loaded editor-config.json',
  'cfg.signed': ' (signature valid, published by the config signer)',
  'cfg.unsigned': ' (unsigned; hash and whitelist checks only)',
  'cfg.approved': ' (unsigned; approved manually)',
  'cfg.badSignature': 'Config signature is invalid; built-in config kept',
  'cfg.verified': ' (hash verified)',
  'cfg.unverified': ' (config changed since release; applied after whitelist checks)',
  'cfg.rejected': 'editor-config.json failed whitelist checks; built-in config kept',
  'cfg.pending':
    'The remote config wants to switch the Content repository to {repo}, but its hash does not match this build. It is not applied until you confirm.',
  'cfg.pendingApprove': 'Review and enable',
  'cfg.pendingKeep': 'Keep built-in config',
  'cfg.confirmTitle': 'Enable the remote repository config?',
  'cfg.confirmBody':
    'The remote editor-config.json is not hash-pinned and would move the Content repository:<br><br>Built-in: {builtin}<br>Remote: {remote}<br><br>Continue only if you trust this migration. Pull requests will target the remote repository.',
  'cfg.confirmEnable': 'Enable',
  'cfg.confirmed': 'Remote repository config enabled: {repo}',
  'cfg.kept': 'Continuing with the built-in repository config.',
  'cfg.pendingToast': 'Remote repository config changed; confirm it in the sidebar.',
};

export const DICTIONARIES = { zh: ZH, en: EN };

let activeLang = 'zh';

export function setLang(lang) {
  activeLang = DICTIONARIES[lang] ? lang : 'zh';
  return activeLang;
}

export function currentLang() {
  return activeLang;
}

/**
 * @param {string} key dictionary key
 * @param {Record<string, string|number>} [vars] `{name}` placeholders
 */
export function t(key, vars) {
  const dict = DICTIONARIES[activeLang] || ZH;
  let text = dict[key];
  if (text === undefined) text = ZH[key];
  if (text === undefined) return '';
  if (!vars) return text;
  return text.replace(/\{(\w+)\}/g, (_, name) => String(vars[name] ?? ''));
}

/** Translated text or the provided fallback. */
export function tOr(key, fallback) {
  return t(key) || fallback || '';
}

const ATTR_PREFIX = 'data-i18n-';

/**
 * Fill `[data-i18n]` text and `[data-i18n-<attr>]` attributes (title,
 * aria-label, placeholder …).
 * @param {ParentNode} [root]
 */
export function applyI18n(root = globalThis.document) {
  if (!root?.querySelectorAll) return;
  for (const node of root.querySelectorAll('[data-i18n]')) {
    const text = t(node.dataset.i18n);
    if (text) node.textContent = text;
  }
  for (const node of root.querySelectorAll(
    `[${ATTR_PREFIX}title], [${ATTR_PREFIX}aria-label], [${ATTR_PREFIX}placeholder]`,
  )) {
    for (const attr of [...node.attributes]) {
      if (!attr.name.startsWith(ATTR_PREFIX)) continue;
      const target = attr.name.slice(ATTR_PREFIX.length);
      const text = t(attr.value);
      if (text) node.setAttribute(target, text);
    }
  }
  root.documentElement?.setAttribute('lang', activeLang === 'zh' ? 'zh-CN' : 'en');
}
