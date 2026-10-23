/** Textarea editing engine: undo/redo history, selection-aware inserts, line helpers. */

const CURSOR = '\u0000WFCURSOR\u0000';
export { CURSOR };

export class TextareaEditor {
  constructor(textarea, options = {}) {
    this.el = textarea;
    this.onChange = options.onChange || (() => {});
    this.history = [{ value: textarea.value, start: 0, end: 0 }];
    this.index = 0;
    this.pendingBase = null;
    this.pendingTimer = 0;
    this.lastSelection = 0;

    textarea.addEventListener('input', () => {
      this.scheduleCommit();
      this.onChange();
    });
    const selectionHandler = () => {
      this.lastSelection = textarea.selectionStart;
      if (this.onSelection) this.onSelection();
    };
    textarea.addEventListener('keyup', selectionHandler);
    textarea.addEventListener('click', selectionHandler);
    textarea.addEventListener('select', selectionHandler);
  }

  get value() {
    return this.el.value;
  }

  set value(next) {
    this.el.value = next;
  }

  get selection() {
    return { start: this.el.selectionStart ?? 0, end: this.el.selectionEnd ?? 0 };
  }

  focus() {
    this.el.focus({ preventScroll: true });
  }

  setSelection(start, end = start) {
    const max = this.el.value.length;
    const safeStart = Math.max(0, Math.min(start, max));
    const safeEnd = Math.max(0, Math.min(end, max));
    this.el.setSelectionRange(safeStart, safeEnd);
    this.lastSelection = safeEnd;
  }

  setValue(value, { reset = true } = {}) {
    this.el.value = value;
    if (reset) {
      this.clearPending();
      const snapshot = this.snapshot();
      this.history = [snapshot];
      this.index = 0;
    } else {
      this.commit();
    }
    this.onChange();
  }

  snapshot() {
    return {
      value: this.el.value,
      start: this.el.selectionStart ?? 0,
      end: this.el.selectionEnd ?? 0,
    };
  }

  clearPending() {
    clearTimeout(this.pendingTimer);
    this.pendingTimer = 0;
    this.pendingBase = null;
  }

  scheduleCommit() {
    if (this.pendingBase === null) {
      this.pendingBase = this.history[this.index];
    }
    clearTimeout(this.pendingTimer);
    this.pendingTimer = setTimeout(() => this.commit(), 650);
  }

  commit() {
    this.clearPending();
    const snapshot = this.snapshot();
    const current = this.history[this.index];
    if (current && current.value === snapshot.value) return;
    this.history = this.history.slice(0, this.index + 1);
    this.history.push(snapshot);
    if (this.history.length > 220) this.history.shift();
    this.index = this.history.length - 1;
  }

  undo() {
    if (this.pendingBase !== null) {
      const base = this.pendingBase;
      this.clearPending();
      this.applySnapshot(base);
      return true;
    }
    if (this.index <= 0) return false;
    this.index -= 1;
    this.applySnapshot(this.history[this.index]);
    return true;
  }

  redo() {
    if (this.pendingBase !== null) this.commit();
    if (this.index >= this.history.length - 1) return false;
    this.index += 1;
    this.applySnapshot(this.history[this.index]);
    return true;
  }

  applySnapshot(snapshot) {
    this.el.value = snapshot.value;
    this.setSelection(snapshot.start, snapshot.end);
    this.onChange();
    this.el.focus({ preventScroll: true });
  }

  replaceRange(start, end, text, selectStart, selectEnd) {
    this.commit();
    const value = this.el.value;
    const before = value.slice(0, start);
    const after = value.slice(end);
    this.el.value = before + text + after;
    const cursorStart = start + (selectStart ?? text.length);
    const cursorEnd = start + (selectEnd ?? text.length);
    this.setSelection(cursorStart, cursorEnd);
    this.onChange();
    this.el.focus({ preventScroll: true });
    this.commit();
  }

  /** Insert text at the cursor; the exported CURSOR marker decides the caret position. */
  insert(text, { block = false } = {}) {
    if (block) return this.insertBlock(text);
    const { start, end } = this.selection;
    const marker = text.indexOf(CURSOR);
    if (marker !== -1) {
      const clean = text.replaceAll(CURSOR, '');
      this.replaceRange(start, end, clean, marker, marker);
    } else {
      this.replaceRange(start, end, text, text.length, text.length);
    }
  }

  insertBlock(text) {
    const { start, end } = this.selection;
    const value = this.el.value;
    const lineStart = value.lastIndexOf('\n', start - 1) + 1;
    const beforeLine = value.slice(lineStart, start);
    const atLineStart = beforeLine.trim() === '';

    let prefix = '';
    if (!atLineStart) prefix = '\n\n';
    else if (lineStart > 0) {
      const prev = value.slice(0, lineStart).replace(/\n+$/, '');
      if (prev && !value.slice(0, lineStart).endsWith('\n\n')) prefix = '\n';
    }

    let suffix = '';
    const rest = value.slice(end);
    if (rest && !rest.startsWith('\n')) suffix = '\n\n';
    else if (rest && !rest.startsWith('\n\n')) suffix = '\n';

    const marker = text.indexOf(CURSOR);
    const raw = prefix + text.replaceAll(CURSOR, '') + suffix;
    const caret = marker === -1 ? raw.length : prefix.length + marker;
    this.replaceRange(start, end, raw, caret, caret);
  }

  /** Wrap the selection (or insert a pair and place the caret in the middle). */
  wrap(before, after, placeholder = '') {
    const { start, end } = this.selection;
    const selected = this.el.value.slice(start, end);
    const inner = selected || placeholder;
    const text = before + inner + after;
    const cursorStart = before.length;
    this.replaceRange(start, end, text, cursorStart, cursorStart + inner.length);
  }

  /** Toggle a line prefix on every line touched by the selection. */
  toggleLinePrefix(prefix) {
    const value = this.el.value;
    const { start, end } = this.selection;
    const lineStart = value.lastIndexOf('\n', start - 1) + 1;
    let lineEnd = value.indexOf('\n', end);
    if (lineEnd === -1) lineEnd = value.length;

    const lines = value.slice(lineStart, lineEnd).split('\n');
    const allHave = lines.every((line) => line.trim() === '' || line.startsWith(prefix));
    const next = lines.map((line) => {
      if (!line.trim()) return line;
      if (allHave) return line.slice(prefix.length);
      return prefix + line;
    });
    const text = next.join('\n');

    this.commit();
    this.el.value = value.slice(0, lineStart) + text + value.slice(lineEnd);
    this.setSelection(lineStart, lineStart + text.length);
    this.onChange();
    this.el.focus({ preventScroll: true });
    this.commit();
  }

  /** Set heading level for the current line(s); level 0 removes headings. */
  setHeading(level) {
    const value = this.el.value;
    const { start, end } = this.selection;
    const lineStart = value.lastIndexOf('\n', start - 1) + 1;
    let lineEnd = value.indexOf('\n', end);
    if (lineEnd === -1) lineEnd = value.length;

    const blocks = value.slice(lineStart, lineEnd).split('\n');
    const prefix = level > 0 ? `${'#'.repeat(level)} ` : '';
    const already = level > 0 && blocks.every((line) => line.startsWith(prefix));
    const next = blocks.map((line) => {
      const stripped = line.replace(/^#{1,6}\s+/, '');
      if (!stripped.trim()) return line;
      return already ? stripped : prefix + stripped;
    });
    const text = next.join('\n');

    this.commit();
    this.el.value = value.slice(0, lineStart) + text + value.slice(lineEnd);
    this.setSelection(lineStart, lineStart + text.length);
    this.onChange();
    this.el.focus({ preventScroll: true });
    this.commit();
  }

  jumpToLine(lineNumber) {
    const value = this.el.value;
    let offset = 0;
    let line = 1;
    while (line < lineNumber) {
      const next = value.indexOf('\n', offset);
      if (next === -1) break;
      offset = next + 1;
      line += 1;
    }
    this.setSelection(offset, offset);
    this.focus();
    // Scroll the caret roughly into view.
    const lineHeight = parseFloat(getComputedStyle(this.el).lineHeight) || 24;
    this.el.scrollTop = Math.max(0, (lineNumber - 4) * lineHeight);
  }

  get lineColumn() {
    const value = this.el.value;
    const pos = this.el.selectionStart ?? 0;
    const before = value.slice(0, pos);
    const line = before.split('\n').length;
    const column = pos - before.lastIndexOf('\n');
    return { line, column };
  }

  destroy() {
    this.clearPending();
  }
}
