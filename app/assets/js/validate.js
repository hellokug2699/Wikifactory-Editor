/** Wikifactory Content rules: page paths, frontmatter and Wiki syntax. */

export const RESERVED_PATHS = ['search', 'pagefind', '_astro', '404', 'about'];

export const CALLOUTS = {
  note: { label: '说明', tone: 'neutral' },
  tip: { label: '提示', tone: 'success' },
  warning: { label: '注意', tone: 'warning' },
  danger: { label: '危险', tone: 'danger' },
  info: { label: '信息', tone: 'accent' },
  example: { label: '示例', tone: 'neutral' },
};

export const CALLOUT_ALIASES = {
  注意: 'warning',
  警告: 'warning',
  提示: 'tip',
  技巧: 'tip',
  危险: 'danger',
  信息: 'info',
  说明: 'note',
  备注: 'note',
  示例: 'example',
};

export const IMAGE_EXTENSIONS = ['png', 'jpg', 'jpeg', 'webp', 'avif', 'gif', 'svg'];
export const ICON_EXTENSIONS = ['svg', 'png', 'webp', 'jpg', 'jpeg', 'avif', 'gif'];
export const IMAGE_SIZES = ['sm', 'md', 'lg', 'full'];
export const IMAGE_ALIGNS = ['left', 'center', 'right'];
export const ICON_SIZES = ['sm', 'md', 'lg'];

export const COLOR_TOKENS = {
  R: '#c62828',
  O: '#ef6c00',
  Y: '#f9a825',
  G: '#2e7d32',
  B: '#1565c0',
  P: '#6a1b9a',
  K: '#37474f',
};

export const COLOR_ALIASES = {
  red: 'R',
  orange: 'O',
  yellow: 'Y',
  green: 'G',
  blue: 'B',
  purple: 'P',
  gray: 'K',
  grey: 'K',
};

export const CSS_COLOR_RE = /^(?:#(?:[0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})|rgba?\([0-9.,%\s/]+\)|hsla?\([0-9deg.,%\s/]+\)|[a-z]+)$/i;
const SAFE_MEDIA_RE = /^[a-z0-9][a-z0-9._-]*$/i;
const ILLEGAL_SEGMENT_RE = /[/\\:*?"<>|\u0000-\u001f]/;

export function issue(severity, message, extra = {}) {
  return { severity, message, ...extra };
}

export function normalizePath(value) {
  return String(value || '').trim().replace(/^\/+/, '').replace(/\/+$/, '');
}

export function lineOf(text, index) {
  return text.slice(0, index).split('\n').length;
}

/* ------------------------------------------------------------- frontmatter */

/** Split a document into YAML frontmatter and body. */
export function splitFrontmatter(text) {
  const source = String(text ?? '').replace(/^\uFEFF/, '');
  if (!/^---[ \t]*\r?\n/.test(source)) {
    return { raw: '', body: source, present: false, issues: [] };
  }
  const lines = source.split(/\r?\n/);
  let end = -1;
  for (let i = 1; i < lines.length; i += 1) {
    if (/^---[ \t]*$/.test(lines[i]) || /^\.\.\.[ \t]*$/.test(lines[i])) {
      end = i;
      break;
    }
  }
  if (end === -1) {
    return {
      raw: lines.slice(1).join('\n'),
      body: '',
      present: true,
      issues: [issue('error', 'frontmatter 缺少结束分隔线 ---', { line: 1 })],
    };
  }
  return {
    raw: lines.slice(1, end).join('\n'),
    body: lines.slice(end + 1).join('\n'),
    present: true,
    issues: [],
  };
}

export function joinDocument(raw, body) {
  const cleanRaw = String(raw || '').replace(/^\s*\n|\s*$/g, '');
  const cleanBody = String(body || '').replace(/^\n+/, '');
  if (!cleanRaw) return cleanBody;
  return `---\n${cleanRaw}\n---\n\n${cleanBody}`;
}

function stripQuotes(value) {
  if (value.length >= 2) {
    const head = value[0];
    const tail = value[value.length - 1];
    if ((head === '"' && tail === '"') || (head === "'" && tail === "'")) return value.slice(1, -1);
  }
  return value;
}

function splitInlineList(value) {
  const inner = value.slice(1, -1).trim();
  if (!inner) return [];
  return inner.split(',').map((part) => stripQuotes(part.trim())).filter(Boolean);
}

function coerceValue(raw) {
  const value = raw.trim();
  if (!value) return '';
  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
    return stripQuotes(value);
  }
  if (value.startsWith('[') && value.endsWith(']')) return splitInlineList(value);
  if (/^(true|false)$/i.test(value)) return value.toLowerCase() === 'true';
  if (/^(null|~)$/i.test(value)) return null;
  if (/^-?\d+(\.\d+)?$/.test(value)) return Number(value);
  return value.split(' #')[0].trim();
}

/** Minimal top-level YAML reader (frontmatter fields only). */
export function parseYamlLite(raw) {
  const map = {};
  const issues = [];
  const lines = String(raw || '').split(/\r?\n/);
  let currentKey = null;

  lines.forEach((line, index) => {
    if (!line.trim() || line.trim().startsWith('#')) return;
    if (/^\t/.test(line)) {
      issues.push(issue('error', 'YAML 不能使用 Tab 缩进', { line: index + 1 }));
      return;
    }
    const listMatch = /^\s*-\s*(.*)$/.exec(line);
    if (listMatch && currentKey) {
      if (!Array.isArray(map[currentKey])) map[currentKey] = [];
      map[currentKey].push(coerceValue(listMatch[1]));
      return;
    }
    const match = /^([A-Za-z0-9_.-]+)\s*:\s*(.*)$/.exec(line);
    if (!match) return;
    const [, key, rest] = match;
    currentKey = key;
    if (Object.prototype.hasOwnProperty.call(map, key)) {
      issues.push(issue('warn', `frontmatter 字段重复：${key}`, { line: index + 1 }));
    }
    map[key] = rest.trim() ? coerceValue(rest) : '';
  });

  return { map, issues };
}

export function frontmatterData(raw) {
  const { map, issues } = parseYamlLite(raw);
  return {
    title: typeof map.title === 'string' ? map.title : '',
    description: typeof map.description === 'string' ? map.description : '',
    tags: Array.isArray(map.tags) ? map.tags.map(String) : [],
    order: typeof map.order === 'number' ? map.order : null,
    draft: map.draft === true,
    updated: typeof map.updated === 'string' ? map.updated : '',
    toc: map.toc === false ? false : true,
    map,
    issues,
  };
}

function yamlScalar(value) {
  if (typeof value === 'number') return String(value);
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  const text = String(value).replace(/\s*\n+\s*/g, ' ');
  if (!text) return '';
  if (/^[a-zA-Z0-9\u4e00-\u9fa5][^:#]*$/.test(text) && !/^\s|\s$/.test(text)) return text;
  return `"${text.replaceAll('\\', '\\\\').replaceAll('"', '\\"')}"`;
}

/** Update one top-level frontmatter field without touching the rest of the YAML. */
export function setYamlField(raw, key, value) {
  const lines = String(raw || '').split(/\r?\n/);
  const keyRe = new RegExp(`^${escapeRegExp(key)}\\s*:`);
  let index = -1;
  for (let i = 0; i < lines.length; i += 1) {
    if (keyRe.test(lines[i])) { index = i; break; }
  }

  let rendered = '';
  if (Array.isArray(value)) {
    rendered = value.length ? `[${value.map((item) => yamlScalar(item)).join(', ')}]` : '';
  } else if (value === null || value === undefined || value === '') {
    rendered = '';
  } else {
    rendered = yamlScalar(value);
  }

  if (index === -1) {
    if (rendered) lines.push(`${key}: ${rendered}`);
    return lines.join('\n').replace(/^\n+|\n+$/g, '');
  }

  // Remove an existing block value (indented list / multiline scalar).
  let end = index + 1;
  while (end < lines.length && (/^\s+/.test(lines[end]) || /^\s*-/.test(lines[end]))) end += 1;

  if (!rendered) {
    lines.splice(index, end - index);
  } else {
    lines.splice(index, end - index, `${key}: ${rendered}`);
  }
  return lines.join('\n').replace(/^\n+|\n+$/g, '');
}

export function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/* ------------------------------------------------------------------- paths */

export function validateContentPath(path) {
  const issues = [];
  const value = normalizePath(path);
  if (!value) return [issue('error', '仓库路径不能为空')];
  if (/\\/.test(path)) issues.push(issue('error', '路径不能包含反斜杠 \\'));
  if (value.split('/').includes('..')) issues.push(issue('error', '路径不能包含 ..'));
  if (path.startsWith('/')) issues.push(issue('warn', '路径不需要以 / 开头，提交时会自动去掉'));

  const segments = value.split('/').filter(Boolean);
  for (const segment of segments) {
    if (ILLEGAL_SEGMENT_RE.test(segment)) {
      issues.push(issue('error', `路径片段含非法字符：${segment}`));
    }
    if (segment.trim() !== segment) issues.push(issue('error', `路径片段首尾不能有空白：${segment}`));
    if (/^\./.test(segment)) issues.push(issue('error', `路径片段不能以点开头：${segment}`));
  }

  if (segments[0] !== 'games') {
    issues.push(issue('error', 'Content 页面必须位于 games/ 目录下'));
  } else if (segments.length < 4) {
    issues.push(issue('error', '层级不足：应为 games/<游戏>/<分类>/…/<页面>.md'));
  }
  if (segments.length >= 2 && RESERVED_PATHS.includes(segments[1].toLowerCase())) {
    issues.push(issue('error', `游戏目录名与站点保留路径冲突：${segments[1]}（${RESERVED_PATHS.join(' / ')}）`));
  }
  const file = segments[segments.length - 1] || '';
  const ext = file.split('.').pop();
  if (!['md', 'mdx'].includes(ext)) {
    issues.push(issue('error', '页面扩展名必须是 .md 或 .mdx（小写）'));
  }
  if (file.includes('.') && ext !== ext.toLowerCase()) {
    issues.push(issue('error', '扩展名必须为小写'));
  }
  if (segments.some((segment) => segment.startsWith('_'))) {
    issues.push(issue('warn', '以 _ 开头的文件 / 目录通常不是正文页面（如 _game.yml、_cover）'));
  }

  return issues;
}

export function validateFrontmatter(raw) {
  const issues = [];
  const { map, issues: yamlIssues } = parseYamlLite(raw);
  issues.push(...yamlIssues);

  if (raw.trim()) {
    if ('title' in map && typeof map.title !== 'string') issues.push(issue('error', 'title 必须是字符串'));
    if ('description' in map && typeof map.description !== 'string') issues.push(issue('error', 'description 必须是字符串'));
    if ('tags' in map && !Array.isArray(map.tags)) issues.push(issue('error', 'tags 必须是字符串数组'));
    if ('order' in map && typeof map.order !== 'number') issues.push(issue('error', 'order 必须是数字'));
    if ('draft' in map && typeof map.draft !== 'boolean') issues.push(issue('error', 'draft 必须是布尔值'));
    if ('toc' in map && typeof map.toc !== 'boolean') issues.push(issue('error', 'toc 必须是布尔值'));
    if ('updated' in map) {
      const value = map.updated;
      const ok = typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(value));
      if (!ok) issues.push(issue('error', 'updated 必须是 YYYY-MM-DD 格式的合法日期'));
    }
    if (!map.title) issues.push(issue('warn', '未填写 title，页面将使用文件名作为标题'));
  }
  return issues;
}

/* ------------------------------------------------------------ wiki syntax */

function maskCode(text) {
  return text.replace(/```[\s\S]*?```/g, (block) => block.replace(/[^\n]/g, ' '))
    .replace(/~~~[\s\S]*?~~~/g, (block) => block.replace(/[^\n]/g, ' '))
    .replace(/(`+)[\s\S]*?\1/g, (span) => span.replace(/[^\n]/g, ' '));
}

function resolveCellColor(raw) {
  if (raw.startsWith('&')) {
    const name = raw.slice(1).trim();
    const color = COLOR_TOKENS[name.toUpperCase()] || (COLOR_ALIASES[name.toLowerCase()] ? COLOR_TOKENS[COLOR_ALIASES[name.toLowerCase()]] : undefined);
    return color ? { color } : { error: `未知快捷色名「${raw}」` };
  }
  return CSS_COLOR_RE.test(raw) ? { color: raw } : { error: `颜色值不合法「${raw}」` };
}

function validateColorOptions(options, line, issues, label = '颜色') {
  for (const part of options.split(';')) {
    const eq = part.indexOf('=');
    if (eq === -1) continue;
    const key = part.slice(0, eq).trim().toLowerCase();
    const value = part.slice(eq + 1).trim();
    if (key !== 'bg' && key !== 'fg') continue;
    const resolved = resolveCellColor(value);
    if (resolved.error) issues.push(issue('warn', `${label}：${resolved.error}，构建时会被忽略`, { line }));
  }
}

function parseImageMarker(tail) {
  const separator = tail.includes('|') ? '|' : ';';
  const parts = tail.split(separator).map((part) => part.trim()).filter(Boolean);
  return parts;
}

export function validateWikiSyntax(text) {
  const issues = [];
  const masked = maskCode(String(text || ''));

  // Callouts: unknown type / missing closer.
  const calloutLines = masked.split('\n');
  calloutLines.forEach((line, index) => {
    const match = /^:::([\w\u4e00-\u9fa5-]+)(?:\[([^\]]*)\])?[ \t]*$/.exec(line);
    if (!match) return;
    const kind = match[1];
    if (!CALLOUTS[kind] && !CALLOUT_ALIASES[kind]) {
      issues.push(issue('warn', `未知横幅类型「${kind}」，会回退为 note`, { line: index + 1 }));
    }
    if (!calloutLines.slice(index + 1).some((next) => /^:::[ \t]*$/.test(next))) {
      issues.push(issue('error', '横幅缺少结束标记 :::', { line: index + 1 }));
    }
  });

  // Unescaped File: prefix is parsed as a directive by the site build.
  const colonRe = /\[\[(?:File|Image|文件)\s*:(?!\\)[^\]\n]*\]\]/gi;
  for (const match of masked.matchAll(colonRe)) {
    issues.push(issue('error', '正文图片请使用 File/ 而不是 File:（避免与 ::: 指令冲突）', {
      line: lineOf(masked, match.index),
    }));
  }

  // Images: `[[File/name|thumb|md|...]]` or `[[File/name;thumb;md]]`
  const imageRe = /\[\[(?:File|Image|文件)\s*[/\\]([^[\]\n]+)\]\]/gi;
  for (const match of masked.matchAll(imageRe)) {
    const line = lineOf(masked, match.index);
    const parts = parseImageMarker(match[1]);
    const name = parts[0] || '';
    if (!SAFE_MEDIA_RE.test(name) || name.includes('..')) {
      issues.push(issue('error', `图片名称不安全：${name || '(空)'}（只允许字母 / 数字 / . _ -）`, { line }));
      continue;
    }
    const lower = name.toLowerCase();
    const ext = lower.includes('.') ? lower.split('.').pop() : '';
    if (ext && !IMAGE_EXTENSIONS.includes(ext)) {
      issues.push(issue('warn', `图片扩展名 .${ext} 不在站点支持列表（${IMAGE_EXTENSIONS.join(' / ')}）`, { line }));
    }
    for (const part of parts.slice(1)) {
      const option = part.toLowerCase();
      if (option === 'thumb' || option === 'frame') continue;
      if (IMAGE_SIZES.includes(option) || IMAGE_ALIGNS.includes(option)) continue;
      if (option.startsWith('alt=')) continue;
      if (/^\d+px$/.test(option)) {
        issues.push(issue('warn', `像素尺寸 ${part} 会收敛到预设；建议直接写 sm / md / lg / full`, { line }));
        continue;
      }
      if (part.includes('=')) {
        issues.push(issue('warn', `未知的图片选项「${part}」，构建时会被忽略`, { line }));
        continue;
      }
      // Remaining plain text is the caption.
    }
  }

  // Icons: `[icon=name;size=lg;bg=#eee;fg=#333]`
  const iconRe = /\[icon=([^\]\n]+)\]/gi;
  for (const match of masked.matchAll(iconRe)) {
    const line = lineOf(masked, match.index);
    const parts = match[1].split(';').map((part) => part.trim()).filter(Boolean);
    const name = parts[0] || '';
    if (!SAFE_MEDIA_RE.test(name) || name.includes('..')) {
      issues.push(issue('error', `图标名称不安全：${name || '(空)'}`, { line }));
    }
    for (const part of parts.slice(1)) {
      const eq = part.indexOf('=');
      const key = eq === -1 ? part.toLowerCase() : part.slice(0, eq).trim().toLowerCase();
      const value = eq === -1 ? '' : part.slice(eq + 1).trim();
      if (key === 'size') {
        if (!ICON_SIZES.includes(value.toLowerCase())) {
          issues.push(issue('warn', `未知图标尺寸「${value}」，可用 sm / md / lg`, { line }));
        }
      } else if (key === 'bg' || key === 'fg') {
        validateColorOptions(`${key}=${value}`, line, issues, '图标颜色');
      } else {
        issues.push(issue('warn', `未知图标选项「${part}」`, { line }));
      }
    }
  }

  // Table cell colours at the start of a cell.
  masked.split('\n').forEach((line, index) => {
    if (!line.trim().startsWith('|')) return;
    for (const cell of line.split('|')) {
      const match = /^\s*\[([^\]]+)\]/.exec(cell);
      if (!match) continue;
      if (!/(?:^|;)\s*(?:bg|fg)\s*=/.test(match[1])) continue;
      validateColorOptions(match[1], index + 1, issues, '表格单元格颜色');
    }
  });

  // Wiki links: empty target.
  const linkRe = /\[\[([^[\]\n]+)\]\]/g;
  for (const match of masked.matchAll(linkRe)) {
    if (/^(?:File|Image|文件)\s*[/\\:：]/i.test(match[1])) continue;
    const target = match[1].split('|')[0].trim();
    if (!target) issues.push(issue('error', '站内链接目标为空', { line: lineOf(masked, match.index) }));
    if (/^[^#].*\\/.test(target)) issues.push(issue('warn', `站内链接包含反斜杠：${target}`, { line: lineOf(masked, match.index) }));
  }

  return issues;
}

/* -------------------------------------------------------------- aggregate */

export function validateDocument({ path, fmRaw = '', body = '' }) {
  return [
    ...validateContentPath(path).map((item) => ({ ...item, source: 'path' })),
    ...validateFrontmatter(fmRaw).map((item) => ({ ...item, source: 'frontmatter' })),
    ...validateWikiSyntax(body).map((item) => ({ ...item, source: 'body' })),
  ];
}

export function summarizeIssues(issues) {
  const errors = issues.filter((item) => item.severity === 'error').length;
  const warnings = issues.filter((item) => item.severity === 'warn').length;
  return { errors, warnings, total: issues.length };
}

export function countCharacters(text) {
  const value = String(text || '');
  const cjk = (value.match(/[\u3400-\u9fff\u3040-\u30ff]/g) || []).length;
  const words = (value.match(/[A-Za-z0-9_'-]+/g) || []).length;
  return { characters: value.length, words: cjk + words };
}
