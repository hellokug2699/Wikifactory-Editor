/** Minimal line diff used by the PR confirmation dialog (no dependencies). */

const MAX_CELLS = 1_500_000;
const CONTEXT_LINES = 3;

function splitLines(text) {
  return String(text ?? '')
    .replace(/\r\n?/g, '\n')
    .split('\n');
}

function coarseDiff(oldLines, newLines, prefix, suffix) {
  const ops = [];
  for (const line of prefix) ops.push({ type: 'equal', text: line, oldLine: null, newLine: null });
  for (const line of oldLines) ops.push({ type: 'del', text: line, oldLine: null, newLine: null });
  for (const line of newLines) ops.push({ type: 'add', text: line, oldLine: null, newLine: null });
  for (const line of suffix) ops.push({ type: 'equal', text: line, oldLine: null, newLine: null });
  return numberOps(ops);
}

/** Attach 1-based old / new line numbers to each operation. */
function numberOps(ops) {
  let oldLine = 1;
  let newLine = 1;
  for (const op of ops) {
    if (op.type === 'equal') {
      op.oldLine = oldLine;
      op.newLine = newLine;
      oldLine += 1;
      newLine += 1;
    } else if (op.type === 'del') {
      op.oldLine = oldLine;
      op.newLine = null;
      oldLine += 1;
    } else {
      op.oldLine = null;
      op.newLine = newLine;
      newLine += 1;
    }
  }
  return ops;
}

/**
 * Line diff (LCS). Large documents fall back to a coarse "replace" diff so the
 * dialog stays responsive on mobile.
 * @param {string} oldText
 * @param {string} newText
 * @returns {Array<{type:'equal'|'add'|'del', text:string, oldLine:number|null, newLine:number|null}>}
 */
export function diffLines(oldText, newText) {
  const oldLines = splitLines(oldText);
  const newLines = splitLines(newText);

  let start = 0;
  while (start < oldLines.length && start < newLines.length && oldLines[start] === newLines[start]) start += 1;
  let endOld = oldLines.length;
  let endNew = newLines.length;
  while (endOld > start && endNew > start && oldLines[endOld - 1] === newLines[endNew - 1]) {
    endOld -= 1;
    endNew -= 1;
  }

  const prefix = oldLines.slice(0, start);
  const suffix = oldLines.slice(endOld);
  const a = oldLines.slice(start, endOld);
  const b = newLines.slice(start, endNew);

  if (a.length * b.length > MAX_CELLS) return coarseDiff(a, b, prefix, suffix);

  const cols = b.length + 1;
  const dp = new Uint32Array((a.length + 1) * cols);
  for (let i = a.length - 1; i >= 0; i -= 1) {
    for (let j = b.length - 1; j >= 0; j -= 1) {
      dp[i * cols + j] =
        a[i] === b[j] ? dp[(i + 1) * cols + j + 1] + 1 : Math.max(dp[(i + 1) * cols + j], dp[i * cols + j + 1]);
    }
  }

  const ops = [];
  for (const line of prefix) ops.push({ type: 'equal', text: line });
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      ops.push({ type: 'equal', text: a[i] });
      i += 1;
      j += 1;
    } else if (dp[(i + 1) * cols + j] >= dp[i * cols + j + 1]) {
      ops.push({ type: 'del', text: a[i] });
      i += 1;
    } else {
      ops.push({ type: 'add', text: b[j] });
      j += 1;
    }
  }
  while (i < a.length) {
    ops.push({ type: 'del', text: a[i] });
    i += 1;
  }
  while (j < b.length) {
    ops.push({ type: 'add', text: b[j] });
    j += 1;
  }
  for (const line of suffix) ops.push({ type: 'equal', text: line });
  return numberOps(ops);
}

/** @returns {{added:number, removed:number}} */
export function diffStats(ops) {
  let added = 0;
  let removed = 0;
  for (const op of ops || []) {
    if (op.type === 'add') added += 1;
    else if (op.type === 'del') removed += 1;
  }
  return { added, removed };
}

/**
 * Keep only changed lines plus `context` unchanged lines around them.
 * @returns {Array<object|{type:'gap', count:number}>}
 */
export function collapsedDiff(ops, context = CONTEXT_LINES) {
  const keep = new Set();
  for (let index = 0; index < ops.length; index += 1) {
    if (ops[index].type === 'equal') continue;
    const from = Math.max(0, index - context);
    const to = Math.min(ops.length - 1, index + context);
    for (let cursor = from; cursor <= to; cursor += 1) keep.add(cursor);
  }
  if (!keep.size) return [];

  const rows = [];
  let gap = 0;
  ops.forEach((op, index) => {
    if (!keep.has(index)) {
      gap += 1;
      return;
    }
    if (gap) {
      rows.push({ type: 'gap', count: gap });
      gap = 0;
    }
    rows.push(op);
  });
  if (gap) rows.push({ type: 'gap', count: gap });
  return rows;
}
