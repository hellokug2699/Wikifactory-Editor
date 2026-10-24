/** Toolbar definition (data only, rendered by the app). `*Key` entries feed i18n. */

export const HISTORY_GROUP = {
  label: '历史',
  labelKey: 'tb.history',
  items: [
    { action: 'undo', icon: 'undo', title: '撤销 (Ctrl+Z)', titleKey: 'tb.undo' },
    { action: 'redo', icon: 'redo', title: '重做 (Ctrl+Shift+Z)', titleKey: 'tb.redo' },
  ],
};

export const FORMAT_GROUP = {
  label: '格式',
  labelKey: 'tb.format',
  items: [
    { action: 'h1', glyph: 'H1', title: '一级标题', titleKey: 'tb.h1' },
    { action: 'h2', glyph: 'H2', title: '二级标题', titleKey: 'tb.h2' },
    { action: 'h3', glyph: 'H3', title: '三级标题', titleKey: 'tb.h3' },
    {
      action: 'bold',
      glyph: 'B',
      className: 'is-strong',
      title: '粗体：插入 **** 并定位中间 (Ctrl+B)',
      titleKey: 'tb.bold',
    },
    { action: 'italic', glyph: 'I', className: 'is-italic', title: '斜体 (Ctrl+I)', titleKey: 'tb.italic' },
    { action: 'strike', glyph: 'S', title: '删除线', titleKey: 'tb.strike' },
    { action: 'inlineCode', icon: 'code', title: '行内代码', titleKey: 'tb.inlineCode' },
    { action: 'mdLink', icon: 'external-link', title: '标准 Markdown 链接 (Ctrl+K)', titleKey: 'tb.mdLink' },
    { action: 'quote', icon: 'quote', title: '引用', titleKey: 'tb.quote' },
    { action: 'ul', icon: 'list', title: '无序列表', titleKey: 'tb.ul' },
    { action: 'ol', icon: 'list-ordered', title: '有序列表', titleKey: 'tb.ol' },
    { action: 'task', icon: 'check-square', title: '任务列表', titleKey: 'tb.task' },
    { action: 'hr', icon: 'minus', title: '分隔线', titleKey: 'tb.hr' },
    { action: 'codeblock', icon: 'braces', title: '代码块', titleKey: 'tb.codeblock' },
    {
      action: 'callout',
      icon: 'info',
      label: '横幅',
      labelKey: 'tb.callout',
      hasCaret: true,
      title: '插入横幅 / 提示框',
      titleKey: 'tb.calloutTitle',
    },
  ],
};

export const CONTENT_WIKI_GROUP = {
  label: 'Wiki',
  labelKey: 'tb.wiki',
  items: [
    {
      action: 'wikiLink',
      icon: 'link',
      label: '内链',
      labelKey: 'tb.wikiLink',
      title: '站内链接 [[…]] (Ctrl+Shift+K)',
      titleKey: 'tb.wikiLinkTitle',
    },
    {
      action: 'wikiImage',
      icon: 'image',
      label: '图片',
      labelKey: 'tb.wikiImage',
      title: '插入正文图片 [[File/…]]',
      titleKey: 'tb.wikiImageTitle',
    },
    {
      action: 'icon',
      icon: 'grid',
      label: '图标',
      labelKey: 'tb.icon',
      title: '插入内联图标 [icon=…]',
      titleKey: 'tb.iconTitle',
    },
    {
      action: 'audio',
      icon: 'music',
      label: '音频',
      labelKey: 'tb.audio',
      title: '插入 OGG 音频 [[Audio/…]]',
      titleKey: 'tb.audioTitle',
    },
    {
      action: 'embed',
      icon: 'video',
      label: '嵌入',
      labelKey: 'tb.embed',
      title: '嵌入播放器 [[Embed/provider/ID]]',
      titleKey: 'tb.embedTitle',
    },
    {
      action: 'table',
      icon: 'table',
      label: '表格',
      labelKey: 'tb.table',
      title: '生成表格（N 行 × M 列）',
      titleKey: 'tb.tableTitle',
    },
    {
      action: 'cellColor',
      icon: 'palette',
      label: '单元格色',
      labelKey: 'tb.cellColor',
      title: '表格单元格颜色',
      titleKey: 'tb.cellColorTitle',
    },
  ],
};

export const CHECK_GROUP = {
  label: '检查',
  labelKey: 'tb.check',
  items: [
    {
      action: 'validate',
      icon: 'shield',
      label: '检查',
      labelKey: 'tb.validate',
      title: '检查路径 / 元数据 / Wiki 语法',
      titleKey: 'tb.validateTitle',
    },
    {
      action: 'preview',
      icon: 'eye',
      label: '预览',
      labelKey: 'tb.preview',
      title: '生成预览页面 (Ctrl+Enter)',
      titleKey: 'tb.previewTitle',
    },
  ],
};

export const TOOLBAR = [HISTORY_GROUP, FORMAT_GROUP, CONTENT_WIKI_GROUP, CHECK_GROUP];

export function toolbarActions() {
  return TOOLBAR.flatMap((group) => group.items.map((item) => ({ ...item, group: group.label })));
}
