/** Toolbar definition (data only, rendered by the app). */

export const HISTORY_GROUP = {
  label: '历史',
  items: [
    { action: 'undo', icon: 'undo', title: '撤销 (Ctrl+Z)' },
    { action: 'redo', icon: 'redo', title: '重做 (Ctrl+Shift+Z)' },
  ],
};

export const FORMAT_GROUP = {
  label: '格式',
  items: [
    { action: 'h1', glyph: 'H1', title: '一级标题' },
    { action: 'h2', glyph: 'H2', title: '二级标题' },
    { action: 'h3', glyph: 'H3', title: '三级标题' },
    { action: 'bold', glyph: 'B', className: 'is-strong', title: '粗体：插入 **** 并定位中间 (Ctrl+B)' },
    { action: 'italic', glyph: 'I', className: 'is-italic', title: '斜体：插入 ** 并定位中间 (Ctrl+I)' },
    { action: 'strike', glyph: 'S', title: '删除线' },
    { action: 'inlineCode', icon: 'code', title: '行内代码' },
    { action: 'mdLink', icon: 'external-link', title: '标准 Markdown 链接 (Ctrl+K)' },
    { action: 'quote', icon: 'quote', title: '引用' },
    { action: 'ul', icon: 'list', title: '无序列表' },
    { action: 'ol', icon: 'list-ordered', title: '有序列表' },
    { action: 'task', icon: 'check-square', title: '任务列表' },
    { action: 'hr', icon: 'minus', title: '分隔线' },
    { action: 'codeblock', icon: 'braces', title: '代码块' },
    { action: 'callout', icon: 'info', label: '横幅', hasCaret: true, title: '插入横幅 / 提示框' },
  ],
};

export const CONTENT_WIKI_GROUP = {
  label: 'Wiki',
  items: [
    { action: 'wikiLink', icon: 'link', label: '内链', title: '站内链接 [[…]] (Ctrl+Shift+K)' },
    { action: 'wikiImage', icon: 'image', label: '图片', title: '插入正文图片 [[File/…]]' },
    { action: 'icon', icon: 'grid', label: '图标', title: '插入内联图标 [icon=…]' },
    { action: 'audio', icon: 'music', label: '音频', title: '插入 OGG 音频 [[Audio/…]]' },
    { action: 'embed', icon: 'video', label: '嵌入', title: '嵌入播放器 [[Embed/provider/ID]]' },
    { action: 'table', icon: 'table', label: '表格', title: '生成表格（N 行 × M 列）' },
    { action: 'cellColor', icon: 'palette', label: '单元格色', title: '表格单元格颜色' },
  ],
};

export const CHECK_GROUP = {
  label: '检查',
  items: [
    { action: 'validate', icon: 'shield', label: '检查', title: '检查路径 / 元数据 / Wiki 语法' },
    { action: 'preview', icon: 'eye', label: '预览', title: '生成预览页面 (Ctrl+Enter)' },
  ],
};

export const TOOLBAR = [HISTORY_GROUP, FORMAT_GROUP, CONTENT_WIKI_GROUP, CHECK_GROUP];

export function toolbarActions() {
  return TOOLBAR.flatMap((group) => group.items.map((item) => ({ ...item, group: group.label })));
}
