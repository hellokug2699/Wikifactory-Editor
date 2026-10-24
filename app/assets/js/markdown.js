/** Markdown + Wikifactory wiki-syntax preview renderer (on-demand). */

import { marked } from '../vendor/marked.esm.js';
import DOMPurify from '../vendor/purify.es.mjs';
import {
  CALLOUTS,
  CALLOUT_ALIASES,
  COLOR_ALIASES,
  COLOR_TOKENS,
  CSS_COLOR_RE,
  IMAGE_ALIGNS,
  IMAGE_SIZES,
  ICON_SIZES,
  PAGE_TAGS,
  GAME_AUDIO_DIR,
  EMBED_PROVIDERS,
  frontmatterData,
  embedPageUrl,
  isAllowedEmbedUrl,
  parseAudioMarker,
  parseEmbedMarker,
} from './validate.js';
import { escapeHtml, basename, stripExt } from './state.js';

const IMAGE_PREFIX_RE = /^(?:File|Image|文件)\s*[/:：\\]/i;
const AUDIO_PREFIX_RE = /^Audio\s*[/:：\\]/i;
const EMBED_PREFIX_RE = /^Embed\s*[/:：\\]/i;
const SAFE_MEDIA_RE = /^[a-z0-9][a-z0-9._-]*$/i;

function parseImageOptions(tail) {
  const separator = tail.includes('|') ? '|' : ';';
  const parts = tail
    .split(separator)
    .map((part) => part.trim())
    .filter(Boolean);
  const name = parts[0] || '';
  let size = 'md';
  let align = '';
  let alt = '';
  let caption = '';
  let framed = false;
  for (const part of parts.slice(1)) {
    const lower = part.toLowerCase();
    if (lower === 'thumb' || lower === 'frame') {
      framed = true;
      continue;
    }
    if (IMAGE_SIZES.includes(lower)) {
      size = lower;
      continue;
    }
    if (IMAGE_ALIGNS.includes(lower)) {
      align = lower;
      continue;
    }
    if (lower.startsWith('alt=')) {
      alt = part.slice(4).trim();
      continue;
    }
    if (/^\d+px$/.test(lower) || part.includes('=')) continue;
    caption = caption ? `${caption}|${part}` : part;
  }
  return { name, size, align, alt, caption, framed };
}

function resolveColor(raw) {
  if (raw.startsWith('&')) {
    const name = raw.slice(1).trim();
    return (
      COLOR_TOKENS[name.toUpperCase()] ||
      (COLOR_ALIASES[name.toLowerCase()] ? COLOR_TOKENS[COLOR_ALIASES[name.toLowerCase()]] : '')
    );
  }
  return CSS_COLOR_RE.test(raw) ? raw : '';
}

function iconStyle(options) {
  const style = [];
  for (const part of options.split(';')) {
    const eq = part.indexOf('=');
    if (eq === -1) continue;
    const key = part.slice(0, eq).trim().toLowerCase();
    const value = part.slice(eq + 1).trim();
    if (key !== 'bg' && key !== 'fg') continue;
    const color = resolveColor(value);
    if (!color) continue;
    style.push(key === 'bg' ? `background:${color}` : `color:${color}`);
  }
  return style.join(';');
}

function lookupAsset(assets, name) {
  if (!assets) return null;
  const lower = name.toLowerCase();
  return assets.get(lower) || assets.get(stripExt(lower)) || assets.get(basename(lower)) || null;
}

function photoIcon() {
  return '<svg viewBox="0 0 24 24" width="26" height="26" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="m21 15-5-5L5 21"/></svg>';
}

function audioIcon() {
  return '<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg>';
}

/* ------------------------------------------------------------ extensions */

const calloutExtension = {
  name: 'wfCallout',
  level: 'block',
  start(src) {
    const match = /^:::/m.exec(src);
    return match ? match.index : undefined;
  },
  tokenizer(src) {
    const match =
      /^:::[ \t]*([\w\u4e00-\u9fa5-]+)(?:\[([^\]]*)\])?[ \t]*\r?\n([\s\S]*?)\r?\n:::[ \t]*(?:\r?\n+|$)/.exec(src);
    if (!match) return undefined;
    return {
      type: 'wfCallout',
      raw: match[0],
      kind: match[1],
      title: match[2] || '',
      tokens: this.lexer.blockTokens(match[3], []),
    };
  },
  renderer(token) {
    const preset = CALLOUTS[token.kind] || CALLOUTS[CALLOUT_ALIASES[token.kind]] || CALLOUTS.note;
    const title = token.title || preset.label;
    const titleHtml = title ? `<p class="wf-callout__title">${escapeHtml(title)}</p>` : '';
    return `<div class="wf-callout wf-callout--${preset.tone}" data-kind="${escapeHtml(token.kind)}">${titleHtml}${this.parser.parse(token.tokens)}</div>`;
  },
};

const wikiImageExtension = {
  name: 'wfWikiImage',
  level: 'inline',
  start(src) {
    const match = /\[\[(?:File|Image|文件)\s*[/:：\\]/i.exec(src);
    return match ? match.index : undefined;
  },
  tokenizer(src) {
    const match = /^\[\[(?:File|Image|文件)\s*[/:：\\]([^[\]\n]+)\]\]/i.exec(src);
    if (!match) return undefined;
    const options = parseImageOptions(match[1]);
    return { type: 'wfWikiImage', raw: match[0], ...options };
  },
  renderer(token) {
    if (!SAFE_MEDIA_RE.test(token.name) || token.name.includes('..')) {
      return escapeHtml(token.raw);
    }
    const asset = lookupAsset(this.parser?.options?.assets || globalThis.__WFE_ASSETS__, token.name);
    const caption = token.caption ? `<span class="wf-figcaption">${escapeHtml(token.caption)}</span>` : '';
    const classes = ['wf-figure', 'wf-figure--inline', `wf-figure--${token.size}`];
    if (token.align) classes.push(`wf-figure--${token.align}`);
    if (token.framed) classes.push('wf-figure--frame');

    let media;
    if (asset) {
      media = `<img src="${escapeHtml(asset)}" alt="${escapeHtml(token.alt)}" loading="lazy" decoding="async">`;
    } else {
      const alt = token.alt || token.caption || '';
      media = `<span class="wf-image-placeholder" role="button" tabindex="0"
        data-wiki-file="${escapeHtml(token.name)}"
        data-wiki-alt="${escapeHtml(alt)}"
        aria-label="加载仓库图片 ${escapeHtml(token.name)}">${photoIcon()}
        <span class="wf-image-placeholder__text">
          <span class="wf-image-placeholder__name">${escapeHtml(token.name)}</span>
          ${alt ? `<span class="wf-image-placeholder__alt">${escapeHtml(alt)}</span>` : ''}
        </span>
        <span class="wf-image-placeholder__hint">点击加载仓库图片</span>
      </span>`;
    }
    return `<span class="${classes.join(' ')}">${media}${caption}</span>`;
  },
};

const wikiLinkExtension = {
  name: 'wfWikiLink',
  level: 'inline',
  start(src) {
    const match = /\[\[(?!\s*(?:File|Image|文件|Audio|Embed)\s*[/:：\\])/.exec(src);
    return match ? match.index : undefined;
  },
  tokenizer(src) {
    const match = /^\[\[([^[\]\n]+)\]\]/.exec(src);
    if (!match) return undefined;
    // Media markers must be handled by their own extensions, never as internal links.
    if (IMAGE_PREFIX_RE.test(match[1]) || AUDIO_PREFIX_RE.test(match[1]) || EMBED_PREFIX_RE.test(match[1]))
      return undefined;
    const pipe = match[1].indexOf('|');
    const target = (pipe === -1 ? match[1] : match[1].slice(0, pipe)).trim();
    const label = pipe === -1 ? '' : match[1].slice(pipe + 1).trim();
    return { type: 'wfWikiLink', raw: match[0], target, label };
  },
  renderer(token) {
    if (!token.target) return escapeHtml(token.raw);
    if (token.target.startsWith('#')) {
      const anchor = token.target.slice(1);
      return `<a href="#${encodeURIComponent(anchor)}">${escapeHtml(token.label || anchor)}</a>`;
    }
    const label = token.label || token.target.split('#')[0];
    const href = `#/${encodeURIComponent(token.target.split('#')[0])}`;
    return `<a class="wf-link-preview" href="${href}" data-target="${escapeHtml(token.target)}" title="站内链接：${escapeHtml(token.target)}">${escapeHtml(label)}</a>`;
  },
};

const wikiAudioExtension = {
  name: 'wfWikiAudio',
  level: 'inline',
  start(src) {
    const match = /\[\[Audio\s*[/:：\\]/i.exec(src);
    return match ? match.index : undefined;
  },
  tokenizer(src) {
    const match = /^\[\[Audio\s*[/:：\\]([^[\]\n]+)\]\]/i.exec(src);
    if (!match) return undefined;
    const parsed = parseAudioMarker(match[1]);
    return { type: 'wfWikiAudio', raw: match[0], ...parsed };
  },
  renderer(token) {
    if (!token || token.warning || !SAFE_MEDIA_RE.test(token.name.replace(/\.ogg$/i, ''))) {
      return escapeHtml(token?.raw || '');
    }
    const title = token.title
      ? `<span class="wf-audio-title">${escapeHtml(token.title)}</span>`
      : '<span class="wf-audio-title">OGG 音频</span>';
    return `<span class="wf-audio" role="button" tabindex="0" data-audio-file="${escapeHtml(token.name)}"
      data-audio-title="${escapeHtml(token.title || '')}" aria-label="加载音频 ${escapeHtml(token.name)}">
      <span class="wf-audio-icon">${audioIcon()}</span>
      <span class="wf-audio-text"><span class="wf-audio-name">${escapeHtml(token.name)}</span>${title}</span>
      <span class="wf-audio-hint">点击加载音频 · 来源：Content 仓库 ${escapeHtml(GAME_AUDIO_DIR)}/（OGG）</span>
    </span>`;
  },
};

const wikiEmbedExtension = {
  name: 'wfWikiEmbed',
  level: 'inline',
  start(src) {
    const match = /\[\[Embed\s*[/:：\\]/i.exec(src);
    return match ? match.index : undefined;
  },
  tokenizer(src) {
    const match = /^\[\[Embed\s*[/:：\\]([^[\]\n]+)\]\]/i.exec(src);
    if (!match) return undefined;
    const parsed = parseEmbedMarker(match[1]);
    return { type: 'wfWikiEmbed', raw: match[0], ...parsed };
  },
  renderer(token) {
    if (!token || !token.embedUrl || token.warning) {
      return `<span class="wf-embed-error">${escapeHtml(token?.warning || '无法嵌入该链接')}</span>`;
    }
    const title = token.title || token.provider || '嵌入播放器';
    const caption = token.title ? `<span class="wf-figcaption">${escapeHtml(token.title)}</span>` : '';
    const value = token.value || '';
    const slash = value.indexOf('/');
    const provider = token.provider || (slash === -1 ? value : value.slice(0, slash));
    const id = slash === -1 ? '' : value.slice(slash + 1);
    const label = EMBED_PROVIDERS.find((item) => item.id === provider)?.label || provider || '嵌入来源';
    const pageUrl = embedPageUrl(provider, id);
    const fallback = pageUrl
      ? `<a class="wf-embed-open" href="${escapeHtml(pageUrl)}" target="_blank" rel="noopener noreferrer">若无法播放，请点此打开原链接</a>`
      : '';
    return `<span class="wf-embed" data-provider="${escapeHtml(provider)}">
      <span class="wf-embed-frame"><iframe src="${escapeHtml(token.embedUrl)}" title="${escapeHtml(title)}" loading="lazy"
        allow="accelerometer; encrypted-media; picture-in-picture; fullscreen" allowfullscreen
        referrerpolicy="strict-origin-when-cross-origin"></iframe></span>
      <span class="wf-embed-meta">
        <span class="wf-embed-source">来源：${escapeHtml(label)} · ${escapeHtml(value)}</span>
        ${fallback}
      </span>${caption}
    </span>`;
  },
};

const iconExtension = {
  name: 'wfIcon',
  level: 'inline',
  start(src) {
    const match = /\[icon=/i.exec(src);
    return match ? match.index : undefined;
  },
  tokenizer(src) {
    const match = /^\[icon=([^\]\n]+)\]/i.exec(src);
    if (!match) return undefined;
    const parts = match[1]
      .split(';')
      .map((part) => part.trim())
      .filter(Boolean);
    const name = parts[0] || '';
    let size = 'sm';
    for (const part of parts.slice(1)) {
      const lower = part.toLowerCase();
      if (lower.startsWith('size=') && ICON_SIZES.includes(lower.slice(5))) size = lower.slice(5);
    }
    return {
      type: 'wfIcon',
      raw: match[0],
      name,
      size,
      style: iconStyle(parts.slice(1).join(';')),
      options: match[1],
    };
  },
  renderer(token) {
    if (!SAFE_MEDIA_RE.test(token.name)) return escapeHtml(token.raw);
    const asset = lookupAsset(this.parser?.options?.assets || globalThis.__WFE_ASSETS__, token.name);
    const style = token.style ? ` style="${token.style}"` : '';
    const inner = asset ? `<img src="${escapeHtml(asset)}" alt="">` : escapeHtml(token.name.slice(0, 2));
    return `<span class="wf-icon wf-icon--${token.size}" title="${escapeHtml(token.name)}"${style}>${inner}</span>`;
  },
};

marked.use({
  gfm: true,
  breaks: false,
  extensions: [
    calloutExtension,
    wikiImageExtension,
    wikiAudioExtension,
    wikiEmbedExtension,
    wikiLinkExtension,
    iconExtension,
  ],
});

/* --------------------------------------------------------------- rendering */

function prepareArticle(article, html) {
  const clean = DOMPurify.sanitize(html, {
    ADD_TAGS: ['figure', 'figcaption', 'iframe'],
    ADD_ATTR: [
      'loading',
      'decoding',
      'data-target',
      'data-kind',
      'role',
      'tabindex',
      'aria-label',
      'allow',
      'allowfullscreen',
      'referrerpolicy',
      'frameborder',
      'target',
      'rel',
    ],
    FORBID_TAGS: ['script', 'style', 'object', 'embed', 'form', 'input', 'button'],
    FORBID_ATTR: ['onerror', 'onload', 'onclick'],
    ALLOW_DATA_ATTR: true,
  });
  article.innerHTML = clean;

  // Only allow-list embed providers may stay framed.
  for (const frame of [...article.querySelectorAll('iframe')]) {
    if (!isAllowedEmbedUrl(frame.getAttribute('src'))) frame.remove();
  }

  // Relative Markdown images cannot be fetched in the preview (CSP), so show
  // filename + alt as a click-to-load placeholder instead of a broken image.
  for (const img of [...article.querySelectorAll('img')]) {
    const src = img.getAttribute('src') || '';
    if (!src || /^(data:|https?:|blob:)/i.test(src)) continue;
    const name = src.split('/').filter(Boolean).pop() || src;
    const alt = img.getAttribute('alt') || '';
    const placeholder = document.createElement('span');
    placeholder.className = 'wf-image-placeholder';
    placeholder.setAttribute('role', 'button');
    placeholder.setAttribute('tabindex', '0');
    placeholder.dataset.markdownSrc = src;
    placeholder.dataset.wikiAlt = alt;
    placeholder.setAttribute('aria-label', `加载仓库图片 ${name}`);
    placeholder.innerHTML = `${photoIcon()}
      <span class="wf-image-placeholder__text">
        <span class="wf-image-placeholder__name">${escapeHtml(name)}</span>
        ${alt ? `<span class="wf-image-placeholder__alt">${escapeHtml(alt)}</span>` : ''}
      </span>
      <span class="wf-image-placeholder__hint">点击加载仓库图片</span>`;
    img.replaceWith(placeholder);
  }

  // Table cell colours: remove the marker and apply the validated colour.
  for (const cell of article.querySelectorAll('td, th')) {
    const walker = document.createTreeWalker(cell, NodeFilter.SHOW_TEXT);
    const first = walker.nextNode();
    if (!first || !first.nodeValue) continue;
    const match = /^\s*\[([^\]]+)\]\s*/.exec(first.nodeValue);
    if (!match) continue;
    if (!/(?:^|;)\s*(?:bg|fg)\s*=/.test(match[1])) continue;
    let bg = '';
    let fg = '';
    for (const part of match[1].split(';')) {
      const eq = part.indexOf('=');
      if (eq === -1) continue;
      const key = part.slice(0, eq).trim().toLowerCase();
      const value = part.slice(eq + 1).trim();
      if (key !== 'bg' && key !== 'fg') continue;
      const color = resolveColor(value);
      if (!color) continue;
      if (key === 'bg') bg = color;
      else fg = color;
    }
    if (!bg && !fg) continue;
    first.nodeValue = first.nodeValue.slice(match[0].length);
    if (bg) cell.style.background = bg;
    if (fg) cell.style.color = fg;
  }

  // A Wiki image that occupies its own line should render as a block figure,
  // not as an inline chip.
  for (const paragraph of [...article.querySelectorAll('p')]) {
    const only = paragraph.children.length === 1 ? paragraph.firstElementChild : null;
    if (!only || !only.classList.contains('wf-figure') || !only.classList.contains('wf-figure--inline')) continue;
    const hasOtherText = [...paragraph.childNodes].some(
      (node) => node !== only && !(node.nodeType === Node.TEXT_NODE && !node.textContent.trim()),
    );
    if (hasOtherText) continue;
    only.classList.remove('wf-figure--inline');
    paragraph.replaceWith(only);
  }

  // Heading ids + anchors.
  const used = new Set();
  for (const heading of article.querySelectorAll('h1, h2, h3, h4, h5, h6')) {
    const text = heading.textContent.trim();
    const slug =
      text
        .toLowerCase()
        .replace(/[^\w\u4e00-\u9fa5]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 64) || 'section';
    let unique = slug;
    let index = 2;
    while (used.has(unique)) {
      unique = `${slug}-${index}`;
      index += 1;
    }
    used.add(unique);
    heading.id = unique;
  }

  return article;
}

function buildToc(article) {
  const headings = [...article.querySelectorAll('h2, h3, h4')];
  if (headings.length < 2) return { html: '', count: headings.length };
  const items = headings
    .map((heading) => {
      const level = Number(heading.tagName[1]);
      return `<a class="toc-h${level}" href="#${heading.id}">${escapeHtml(heading.textContent.trim())}</a>`;
    })
    .join('');
  return { html: items, count: headings.length };
}

const TAG_TONES = new Map(PAGE_TAGS.map((tag) => [tag.value, tag.tone]));

function renderMeta(data, path) {
  const title = data.title || stripExt(basename(path)) || '未命名页面';
  const tags = (data.tags || [])
    .map((tag) => `<span class="preview-tag" data-tone="${TAG_TONES.get(tag) || 'accent'}">${escapeHtml(tag)}</span>`)
    .join('');
  return `
    <div class="preview-meta">
      <h1 class="preview-title-main">${escapeHtml(title)}</h1>
      ${data.description ? `<p class="preview-desc">${escapeHtml(data.description)}</p>` : ''}
      ${tags ? `<div class="preview-tags">${tags}</div>` : ''}
      ${data.updated ? `<div class="preview-updated">更新于 ${escapeHtml(data.updated)}</div>` : ''}
    </div>
  `;
}

/**
 * Build the on-demand preview for a Content page.
 * @param {object} options
 * @param {string} options.path
 * @param {string} [options.fmRaw]
 * @param {string} [options.body]
 * @param {Map<string,string>} [options.assets] lowercase filename/path -> data URL
 * @param {HTMLElement} options.article target article element
 */
export function buildPreview({ path, fmRaw = '', body = '', assets = null, article }) {
  globalThis.__WFE_ASSETS__ = assets;

  const data = frontmatterData(fmRaw);
  const html = marked.parse(body);
  prepareArticle(article, `${renderMeta(data, path)}${html}`);
  const toc = buildToc(article);
  return {
    title: data.title || stripExt(basename(path)),
    toc,
  };
}

export function attachToc(previewArticle, tocNav) {
  tocNav.addEventListener('click', (event) => {
    const link = event.target.closest('a[href^="#"]');
    if (!link) return;
    const id = decodeURIComponent(link.getAttribute('href').slice(1));
    const target = previewArticle.querySelector(`[id="${CSS.escape(id)}"]`) || document.getElementById(id);
    if (target) {
      event.preventDefault();
      target.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  });
}
