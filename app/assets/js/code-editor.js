/**
 * CodeMirror 6 adapter.
 *
 * Exposes the small editing surface used by the app (selection-aware insert,
 * wrap, line prefixes, undo/redo) while providing real syntax highlighting for
 * Markdown, YAML frontmatter and fenced code blocks. Wiki-specific tokens
 * (`[[File/…]]`, `[[…]]`, `[icon=…]`, `:::` callouts, table rows) receive
 * dedicated decorations on top of the Markdown grammar.
 */

import {
  EditorState,
  EditorView,
  Compartment,
  RangeSetBuilder,
  keymap,
  lineNumbers,
  highlightActiveLineGutter,
  highlightSpecialChars,
  drawSelection,
  dropCursor,
  rectangularSelection,
  crosshairCursor,
  highlightActiveLine,
  MatchDecorator,
  Decoration,
  ViewPlugin,
  history,
  defaultKeymap,
  historyKeymap,
  indentWithTab,
  undo,
  redo,
  search,
  searchKeymap,
  highlightSelectionMatches,
  openSearchPanel,
  autocompletion,
  closeBrackets,
  closeBracketsKeymap,
  completionKeymap,
  startCompletion,
  setDiagnostics,
  lintGutter,
  markdown,
  markdownLanguage,
  yaml,
  javascript,
  json,
  css,
  html,
  syntaxHighlighting,
  HighlightStyle,
  bracketMatching,
  indentOnInput,
  tags,
} from '../vendor/codemirror.bundle.js';

export const CURSOR = '\u0000WFCURSOR\u0000';

function codeLanguage(info) {
  const name = String(info || '')
    .trim()
    .toLowerCase()
    .split(/\s+/)[0];
  if (['js', 'jsx', 'ts', 'tsx', 'javascript', 'typescript'].includes(name)) {
    return javascript({ typescript: true, jsx: true }).language;
  }
  if (['json', 'jsonc'].includes(name)) return json().language;
  if (['css', 'scss'].includes(name)) return css().language;
  if (['html', 'xml', 'svg'].includes(name)) return html().language;
  if (['yaml', 'yml'].includes(name)) return yaml().language;
  return null;
}

const highlightStyle = HighlightStyle.define([
  { tag: tags.heading1, color: 'var(--cm-heading)', fontWeight: '750' },
  {
    tag: [tags.heading2, tags.heading3, tags.heading4, tags.heading5, tags.heading6],
    color: 'var(--cm-heading)',
    fontWeight: '680',
  },
  { tag: tags.strong, color: 'var(--text)', fontWeight: '700' },
  { tag: tags.emphasis, fontStyle: 'italic' },
  { tag: tags.strikethrough, textDecoration: 'line-through', color: 'var(--text-faint)' },
  { tag: tags.link, color: 'var(--cm-link)', textDecoration: 'underline' },
  { tag: tags.url, color: 'var(--cm-link)' },
  { tag: tags.monospace, color: 'var(--cm-code)' },
  { tag: tags.keyword, color: 'var(--cm-keyword)' },
  { tag: [tags.string, tags.special(tags.string)], color: 'var(--cm-string)' },
  { tag: [tags.comment, tags.lineComment, tags.blockComment], color: 'var(--cm-comment)', fontStyle: 'italic' },
  { tag: [tags.number, tags.bool, tags.null], color: 'var(--cm-number)' },
  { tag: [tags.atom, tags.unit], color: 'var(--cm-number)' },
  { tag: [tags.meta, tags.annotation], color: 'var(--cm-meta)' },
  { tag: [tags.propertyName, tags.attributeName], color: 'var(--cm-property)' },
  { tag: [tags.tagName, tags.typeName, tags.className], color: 'var(--cm-keyword)' },
  { tag: [tags.operator, tags.punctuation], color: 'var(--text-soft)' },
  { tag: tags.contentSeparator, color: 'var(--text-faint)' },
  { tag: tags.quote, color: 'var(--text-soft)', fontStyle: 'italic' },
]);

const editorTheme = EditorView.theme(
  {
    '&': {
      height: '100%',
      backgroundColor: 'transparent',
      color: 'var(--text)',
      outline: 'none',
    },
    '&.cm-focused': { outline: 'none' },
    '.cm-scroller': {
      fontFamily: 'var(--font-mono)',
      fontSize: 'var(--editor-font-size, 14.5px)',
      lineHeight: '1.8',
      overflow: 'auto',
    },
    '.cm-content': {
      padding: '22px clamp(18px, 4vw, 46px) 96px',
      caretColor: 'var(--accent)',
    },
    '.cm-line': { padding: '0' },
    '.cm-gutters': {
      backgroundColor: 'var(--editor-bg)',
      color: 'var(--text-faint)',
      borderRight: '1px solid var(--border)',
      paddingLeft: '6px',
      fontSize: '11px',
      userSelect: 'none',
    },
    '.cm-activeLine': { backgroundColor: 'rgba(79, 124, 255, .055)' },
    '.cm-activeLineGutter': { backgroundColor: 'rgba(79, 124, 255, .08)', color: 'var(--text-soft)' },
    '.cm-selectionBackground, .cm-content ::selection': { backgroundColor: 'rgba(79, 124, 255, .22) !important' },
    '.cm-cursor, .cm-dropCursor': { borderLeftColor: 'var(--accent)', borderLeftWidth: '2px' },
    '.cm-matchingBracket': { backgroundColor: 'rgba(79, 124, 255, .18)', outline: '1px solid var(--accent)' },
    '.cm-wf-image': { color: 'var(--cm-wiki-image)', fontWeight: '650' },
    '.cm-wf-link': {
      color: 'var(--cm-wiki-link)',
      textDecoration: 'underline',
      textDecorationColor: 'rgba(79, 124, 255, .45)',
    },
    '.cm-wf-icon': { color: 'var(--cm-wiki-icon)', fontWeight: '600' },
    '.cm-wf-cell-color': { color: 'var(--cm-wiki-color)', fontWeight: '600' },
    '.cm-wf-callout': {
      backgroundColor: 'var(--cm-callout-bg)',
      boxShadow: 'inset 3px 0 0 var(--cm-callout-border)',
    },
    '.cm-wf-table': { backgroundColor: 'rgba(79, 124, 255, .045)' },
    '.cm-searchMatch': { backgroundColor: 'rgba(249, 168, 37, .28)', outline: '1px solid rgba(249, 168, 37, .6)' },
    '.cm-searchMatch.cm-searchMatch-selected': { backgroundColor: 'rgba(249, 168, 37, .55)' },
    '.cm-selectionMatch': { backgroundColor: 'rgba(79, 124, 255, .14)' },
    '.cm-tooltip-autocomplete': {
      border: '1px solid var(--border)',
      borderRadius: '8px',
      backgroundColor: 'var(--surface-2)',
    },
    '.cm-tooltip-autocomplete > ul > li[aria-selected]': {
      backgroundColor: 'var(--accent-soft)',
      color: 'var(--text)',
    },
    '.cm-panels': { backgroundColor: 'var(--surface-2)', color: 'var(--text)' },
    '.cm-panels.cm-panels-top': { borderBottom: '1px solid var(--border)' },
    '.cm-panel.cm-search input, .cm-panel.cm-search button': {
      backgroundColor: 'var(--surface)',
      color: 'var(--text)',
      border: '1px solid var(--border)',
      borderRadius: '6px',
    },
    '.cm-lint-marker-error': { content: 'none' },
  },
  { dark: false },
);

function matcher(regexp, className) {
  const decorator = new MatchDecorator({
    regexp,
    decoration: Decoration.mark({ class: className }),
  });
  return ViewPlugin.fromClass(
    class {
      constructor(view) {
        this.decorations = decorator.createDeco(view);
      }
      update(update) {
        this.decorations = decorator.updateDeco(update, this.decorations);
      }
    },
    {
      decorations: (plugin) => plugin.decorations,
    },
  );
}

const wikiImageHighlighter = matcher(/\[\[(?:File|Image|文件)\s*[/\\:：][^\]\n]*\]\]/gi, 'cm-wf-image');
const wikiLinkHighlighter = matcher(/\[\[(?!\s*(?:File|Image|文件)\s*[/\\:：])[^\]\n]+\]\]/gi, 'cm-wf-link');
const wikiIconHighlighter = matcher(/\[icon=[^\]\n]+\]/gi, 'cm-wf-icon');
const cellColorHighlighter = matcher(/\[(?:bg|fg)=[^\]\n]+\]/gi, 'cm-wf-cell-color');

function lineDecoration(view) {
  const builder = new RangeSetBuilder();
  for (const { from, to } of view.visibleRanges) {
    let pos = from;
    while (pos <= to) {
      const line = view.state.doc.lineAt(pos);
      if (/^\s*:::/.test(line.text)) {
        builder.add(line.from, line.from, Decoration.line({ class: 'cm-wf-callout' }));
      } else if (/^\s*\|/.test(line.text)) {
        builder.add(line.from, line.from, Decoration.line({ class: 'cm-wf-table' }));
      }
      if (line.to >= view.state.doc.length) break;
      pos = line.to + 1;
    }
  }
  return builder.finish();
}

const wikiLineHighlighter = ViewPlugin.fromClass(
  class {
    constructor(view) {
      this.decorations = lineDecoration(view);
    }
    update(update) {
      if (update.docChanged || update.viewportChanged) {
        this.decorations = lineDecoration(update.view);
      }
    }
  },
  {
    decorations: (plugin) => plugin.decorations,
  },
);

function languageExtension(language) {
  if (language === 'yaml') return yaml();
  return markdown({
    base: markdownLanguage,
    codeLanguages: codeLanguage,
  });
}

export class CodeEditor {
  constructor(
    container,
    {
      value = '',
      language = 'markdown',
      label = '编辑器',
      wrap = true,
      onChange = () => {},
      onSelection = () => {},
      onShortcut = () => false,
      onFiles = null,
      completionSource = null,
    } = {},
  ) {
    this.container = container;
    this.language = language;
    this.label = label;
    this.wrapEnabled = wrap;
    this.onChange = onChange;
    this.onSelection = onSelection;
    this.onShortcut = onShortcut;
    this.onFiles = onFiles;
    this.completionSource = completionSource;
    this.lastSelection = 0;
    this.silent = false;
    this.wrapCompartment = new Compartment();
    this.completionCompartment = new Compartment();

    this.extensions = this.buildExtensions(label);
    this.view = new EditorView({
      state: EditorState.create({ doc: value, extensions: this.extensions }),
      parent: container,
    });
  }

  /** Editor-local shortcuts; returning true consumes the key. */
  shortcutKeymap() {
    const bind = (key, action) => ({
      key,
      run: () => {
        this.onShortcut(action);
        return true;
      },
    });
    return [
      bind('Mod-i', 'italic'),
      bind('Mod-k', 'link'),
      bind('Mod-Shift-k', 'wikiLink'),
      { key: 'Mod-h', run: openSearchPanel },
    ];
  }

  completionExtension() {
    if (!this.completionSource) return [];
    return autocompletion({
      override: [this.completionSource],
      activateOnTyping: true,
      closeOnBlur: true,
      aboveCursor: false,
    });
  }

  buildExtensions(label) {
    return [
      lineNumbers(),
      highlightActiveLineGutter(),
      highlightSpecialChars(),
      history(),
      drawSelection(),
      dropCursor(),
      rectangularSelection(),
      crosshairCursor(),
      highlightActiveLine(),
      indentOnInput(),
      bracketMatching(),
      closeBrackets(),
      search({ top: true }),
      highlightSelectionMatches(),
      lintGutter(),
      EditorState.tabSize.of(2),
      EditorState.allowMultipleSelections.of(false),
      keymap.of([
        ...this.shortcutKeymap(),
        ...closeBracketsKeymap,
        ...searchKeymap,
        ...completionKeymap,
        ...defaultKeymap,
        ...historyKeymap,
        indentWithTab,
      ]),
      this.completionCompartment.of(this.completionExtension()),
      languageExtension(this.language),
      syntaxHighlighting(highlightStyle),
      editorTheme,
      wikiImageHighlighter,
      wikiLinkHighlighter,
      wikiIconHighlighter,
      cellColorHighlighter,
      wikiLineHighlighter,
      EditorView.domEventHandlers({
        paste: (event, view) => this.handleFileTransfer(event, view),
        drop: (event, view) => this.handleFileTransfer(event, view),
      }),
      EditorView.contentAttributes.of({ 'aria-label': label, spellcheck: 'false' }),
      this.wrapCompartment.of(this.wrapEnabled ? EditorView.lineWrapping : []),
      EditorView.updateListener.of((update) => {
        this.lastSelection = update.state.selection.main.to;
        if (this.silent) return;
        if (update.docChanged) this.onChange();
        if (update.selectionSet) this.onSelection();
      }),
    ];
  }

  /** Paste / drop of image files is handed to the app; returns true when consumed. */
  handleFileTransfer(event, view) {
    if (!this.onFiles) return false;
    const transfer = event.dataTransfer || event.clipboardData;
    const files = [...(transfer?.files || [])].filter((file) => /^image\//i.test(file.type));
    if (!files.length) return false;
    event.preventDefault();
    if (event.type === 'drop' && typeof event.clientX === 'number') {
      const pos = view.posAtCoords({ x: event.clientX, y: event.clientY });
      if (pos != null) view.dispatch({ selection: { anchor: pos } });
    }
    this.onFiles(files);
    return true;
  }

  get value() {
    return this.view.state.doc.toString();
  }

  get selection() {
    const range = this.view.state.selection.main;
    return { start: range.from, end: range.to };
  }

  get lineColumn() {
    const head = this.view.state.selection.main.head;
    const line = this.view.state.doc.lineAt(head);
    return { line: line.number, column: head - line.from + 1 };
  }

  get lineCount() {
    return this.view.state.doc.lines;
  }

  focus() {
    this.view.focus();
    this.view.requestMeasure();
  }

  refresh() {
    this.view.requestMeasure();
  }

  setSelection(start, end = start) {
    const length = this.view.state.doc.length;
    const from = Math.max(0, Math.min(start, length));
    const to = Math.max(0, Math.min(end, length));
    this.view.dispatch({ selection: { anchor: from, head: to } });
    this.lastSelection = to;
  }

  setValue(value, { reset = true } = {}) {
    this.silent = true;
    if (reset) {
      const scrollTop = this.view.scrollDOM.scrollTop;
      this.view.setState(EditorState.create({ doc: value, extensions: this.buildExtensions(this.label) }));
      this.lastSelection = 0;
      this.view.scrollDOM.scrollTop = scrollTop;
    } else {
      const length = this.view.state.doc.length;
      this.view.dispatch({
        changes: { from: 0, to: length, insert: value },
        selection: { anchor: Math.min(this.lastSelection, value.length) },
      });
    }
    this.silent = false;
    this.view.requestMeasure();
  }

  setWrap(enabled) {
    this.wrapEnabled = enabled;
    this.view.dispatch({
      effects: this.wrapCompartment.reconfigure(enabled ? EditorView.lineWrapping : []),
    });
  }

  replaceRange(start, end, text, selectStart, selectEnd) {
    const length = this.view.state.doc.length;
    const from = Math.max(0, Math.min(start, length));
    const to = Math.max(0, Math.min(end, length));
    const anchor = from + (selectStart ?? text.length);
    const head = from + (selectEnd ?? text.length);
    this.view.dispatch({
      changes: { from, to, insert: text },
      selection: { anchor, head },
      scrollIntoView: true,
    });
    this.view.focus();
  }

  insert(text, { block = false } = {}) {
    if (block) return this.insertBlock(text);
    const { start, end } = this.selection;
    const marker = text.indexOf(CURSOR);
    const clean = text.replaceAll(CURSOR, '');
    const caret = marker === -1 ? clean.length : marker;
    this.replaceRange(start, end, clean, caret, caret);
  }

  insertBlock(text) {
    const { start, end } = this.selection;
    const value = this.value;
    const lineStart = value.lastIndexOf('\n', start - 1) + 1;
    const beforeLine = value.slice(lineStart, start);
    const atLineStart = beforeLine.trim() === '';

    let prefix = '';
    if (!atLineStart) prefix = '\n\n';
    else if (lineStart > 0) {
      const before = value.slice(0, lineStart);
      if (!before.endsWith('\n\n')) prefix = '\n';
    }

    let suffix = '';
    const rest = value.slice(end);
    if (rest && !rest.startsWith('\n')) suffix = '\n\n';
    else if (rest && !rest.startsWith('\n\n')) suffix = '\n';

    const marker = text.indexOf(CURSOR);
    const clean = text.replaceAll(CURSOR, '');
    const raw = prefix + clean + suffix;
    const caret = marker === -1 ? raw.length : prefix.length + marker;
    this.replaceRange(start, end, raw, caret, caret);
  }

  wrap(before, after, placeholder = '') {
    const { start, end } = this.selection;
    const selected = this.value.slice(start, end);
    const inner = selected || placeholder;
    const text = before + inner + after;
    this.replaceRange(start, end, text, before.length, before.length + inner.length);
  }

  toggleLinePrefix(prefix) {
    const value = this.value;
    const { start, end } = this.selection;
    const doc = this.view.state.doc;
    const firstLine = doc.lineAt(start);
    const lastLine = doc.lineAt(end > start ? Math.min(end - 1, doc.length) : end);
    const lineStart = firstLine.from;
    const lineEnd = lastLine.to;
    const lines = value.slice(lineStart, lineEnd).split('\n');
    const allHave = lines.every((line) => line.trim() === '' || line.startsWith(prefix));
    const next = lines
      .map((line) => {
        if (!line.trim()) return line;
        return allHave ? line.slice(prefix.length) : prefix + line;
      })
      .join('\n');
    this.replaceRange(lineStart, lineEnd, next, 0, next.length);
  }

  setHeading(level) {
    const value = this.value;
    const { start, end } = this.selection;
    const doc = this.view.state.doc;
    const firstLine = doc.lineAt(start);
    const lastLine = doc.lineAt(end > start ? Math.min(end - 1, doc.length) : end);
    const lineStart = firstLine.from;
    const lineEnd = lastLine.to;
    const blocks = value.slice(lineStart, lineEnd).split('\n');
    const prefix = level > 0 ? `${'#'.repeat(level)} ` : '';
    const already = level > 0 && blocks.every((line) => line.startsWith(prefix));
    const next = blocks
      .map((line) => {
        const stripped = line.replace(/^#{1,6}\s+/, '');
        if (!stripped.trim()) return line;
        return already ? stripped : prefix + stripped;
      })
      .join('\n');
    this.replaceRange(lineStart, lineEnd, next, 0, next.length);
  }

  jumpToLine(lineNumber) {
    const doc = this.view.state.doc;
    const line = doc.line(Math.max(1, Math.min(lineNumber, doc.lines)));
    this.view.dispatch({
      selection: { anchor: line.from },
      effects: EditorView.scrollIntoView(line.from, { y: 'start' }),
    });
    this.view.focus();
  }

  /** Replace inline diagnostics (wave underline + gutter marker + hover text). */
  setDiagnostics(issues = []) {
    const doc = this.view.state.doc;
    const diagnostics = [];
    for (const item of issues) {
      if (!item?.message || !Number.isFinite(item.line)) continue;
      const number = Math.max(1, Math.min(Math.round(item.line), doc.lines));
      const line = doc.line(number);
      diagnostics.push({
        from: line.from,
        to: line.to,
        severity: item.severity === 'error' ? 'error' : 'warning',
        message: item.message,
        source: 'wikifactory',
      });
    }
    this.view.dispatch(setDiagnostics(this.view.state, diagnostics));
  }

  setCompletionSource(source) {
    this.completionSource = source;
    this.view.dispatch({
      effects: this.completionCompartment.reconfigure(this.completionExtension()),
    });
  }

  /** Open the completion popup manually (used after inserting `[[`). */
  triggerCompletion() {
    if (this.completionSource) startCompletion(this.view);
  }

  undo() {
    return undo(this.view);
  }

  redo() {
    return redo(this.view);
  }

  destroy() {
    this.view.destroy();
  }
}
