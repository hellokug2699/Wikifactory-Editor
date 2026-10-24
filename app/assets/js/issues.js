/** Issue grouping / inline-diagnostic mapping (pure, no DOM). */

export const SOURCE_LABELS = {
  path: '路径',
  frontmatter: '元数据',
  body: '正文',
  repo: '仓库',
};

export function issueCounts(issues = []) {
  let errors = 0;
  let warnings = 0;
  for (const item of issues) {
    if (item.severity === 'error') errors += 1;
    else warnings += 1;
  }
  return { errors, warnings, total: issues.length };
}

/** Server-side (repo) findings belong to the body editor. */
export function issuesForEditor(issues = [], editor = 'body') {
  if (editor === 'frontmatter') return issues.filter((item) => item.source === 'frontmatter');
  return issues.filter((item) => item.source === 'body' || item.source === 'repo' || item.source === 'path');
}

/**
 * Map issues to CodeMirror-like diagnostics using 1-based line numbers.
 * @param {Array<object>} issues
 * @param {(line:number) => {from:number,to:number}|null} lineRange
 */
export function toDiagnostics(issues, lineRange) {
  const out = [];
  for (const item of dedupeIssues(issues)) {
    if (!item?.message || !Number.isFinite(item.line)) continue;
    const range = lineRange(item.line);
    if (!range) continue;
    out.push({
      from: range.from,
      to: range.to,
      severity: item.severity === 'error' ? 'error' : 'warning',
      message: item.message,
      source: 'wikifactory',
    });
  }
  return out;
}

/** Stable key for deduplicating issues when merging sync + repo results. */
export function issueKey(item) {
  return `${item?.source || ''}|${item?.line ?? ''}|${item?.message || ''}`;
}

export function dedupeIssues(issues = []) {
  const seen = new Set();
  const out = [];
  for (const item of issues) {
    const key = issueKey(item);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(item);
  }
  return out;
}

/** Editor + line to jump to when a user clicks an issue. */
export function jumpTarget(issue) {
  if (!issue) return { editor: 'body', line: 1 };
  return {
    editor: issue.source === 'frontmatter' ? 'frontmatter' : 'body',
    line: Number.isFinite(issue.line) ? issue.line : 1,
  };
}
