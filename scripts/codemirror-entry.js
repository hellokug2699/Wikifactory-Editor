// Re-export the CodeMirror 6 surface used by the editor. Bundled into
// app/assets/vendor/codemirror.bundle.js by scripts/build-vendor.mjs.

export { EditorState, Compartment, RangeSetBuilder } from '@codemirror/state';
export {
  EditorView,
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
} from '@codemirror/view';
export {
  history,
  defaultKeymap,
  historyKeymap,
  indentWithTab,
  undo,
  redo,
} from '@codemirror/commands';
export { markdown, markdownLanguage } from '@codemirror/lang-markdown';
export { yaml } from '@codemirror/lang-yaml';
export { javascript } from '@codemirror/lang-javascript';
export { json } from '@codemirror/lang-json';
export { css } from '@codemirror/lang-css';
export { html } from '@codemirror/lang-html';
export { syntaxHighlighting, HighlightStyle, bracketMatching, indentOnInput } from '@codemirror/language';
export { tags } from '@lezer/highlight';
