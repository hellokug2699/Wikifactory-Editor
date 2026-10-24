/** Frontmatter form: markup + pure value helpers (DOM-free except markup strings). */
import { escapeHtml } from './state.js';

export const FM_FIELDS = ['title', 'description', 'tags', 'order', 'updated', 'draft', 'toc'];

/**
 * @param {{tags: Array<{value:string,label:string,description:string}>, issueUrl: string}} options
 * @returns {string} form markup
 */
export function fmFormHtml({ tags, issueUrl }) {
  const tagChips = tags
    .map(
      (tag) => `
    <button type="button" class="chip" data-tag="${escapeHtml(tag.value)}"
      title="${escapeHtml(tag.description)}" aria-pressed="false">${escapeHtml(tag.label)}</button>
  `,
    )
    .join('');
  return `
    <label class="field">
      <span class="field-label">标题 title</span>
      <input class="input" data-fm="title" id="fm-title" placeholder="页面标题（缺省用文件名）" autocomplete="off">
    </label>
    <label class="field">
      <span class="field-label">摘要 description</span>
      <textarea class="input" data-fm="description" id="fm-description" rows="2" placeholder="用于列表卡片与 SEO"></textarea>
    </label>
    <div class="field">
      <span class="field-label">页面分类 tags</span>
      <div class="chip-row tag-picker" id="fm-tags" role="group" aria-label="页面分类">${tagChips}</div>
      <p class="form-help">分类由编辑器模板统一分发；未在模板中的分类会被内容门禁拒绝。需要新增分类请
        <a href="${issueUrl}" target="_blank" rel="noopener">在编辑器仓库提交 issue</a>。</p>
    </div>
    <details class="fm-advanced">
      <summary>更多选项（排序 / 日期 / 草稿 / 目录）</summary>
      <div class="fm-grid-2">
        <label class="field">
          <span class="field-label">排序 order</span>
          <input class="input" data-fm="order" id="fm-order" type="number" placeholder="10">
        </label>
        <label class="field">
          <span class="field-label">更新日期 updated</span>
          <input class="input" data-fm="updated" id="fm-updated" type="date">
        </label>
      </div>
      <label class="check-row"><input type="checkbox" data-fm="draft" id="fm-draft"><span>草稿（draft：仅开发环境可见）</span></label>
      <label class="check-row"><input type="checkbox" data-fm="toc" id="fm-toc" checked><span>显示页内目录（toc）</span></label>
    </details>
    <p class="form-help">表单修改会先进入「待应用」状态，点击「应用更改」并确认差异后才写入 frontmatter；未知字段与注释保持不变。</p>
  `;
}

/**
 * Convert a form control value to the YAML value for a field.
 * Empty text deletes the key; `draft: false` and `toc: true` are defaults and are deleted.
 */
export function formValueToYaml(field, value) {
  if (field === 'order') {
    if (value === '' || value === null || value === undefined) return '';
    const number = Number(value);
    return Number.isFinite(number) ? number : '';
  }
  if (field === 'draft') return value ? true : '';
  if (field === 'toc') return value ? '' : false;
  if (field === 'tags') return Array.isArray(value) ? value : [];
  return String(value ?? '');
}

function normalize(key, value) {
  if (key === 'tags') return JSON.stringify(Array.isArray(value) ? value : []);
  if (key === 'order') return value === null || value === undefined || value === '' ? '' : String(value);
  if (key === 'draft') return value ? 'true' : '';
  if (key === 'toc') return value === false ? 'false' : '';
  return String(value ?? '');
}

/**
 * Compare the form's current values with the parsed frontmatter and return only changes.
 * @param {object} data result of frontmatterData()
 * @param {Record<string, unknown>} values form values (already passed through formValueToYaml)
 */
export function collectFormChanges(data, values) {
  const current = {
    title: data.title,
    description: data.description,
    tags: data.tags,
    order: data.order,
    updated: data.updated,
    draft: data.draft,
    toc: data.toc,
  };
  const changes = {};
  for (const field of FM_FIELDS) {
    if (!(field in values)) continue;
    const next = values[field];
    if (normalize(field, next) === normalize(field, current[field])) continue;
    changes[field] = next;
  }
  return changes;
}

/** Apply a tag chip toggle to the current tag list. */
export function toggleTag(tags, tag) {
  const list = Array.isArray(tags) ? tags : [];
  return list.includes(tag) ? list.filter((item) => item !== tag) : [...list, tag];
}

/** Short summary used on the apply bar. */
export function describeChanges(changes) {
  const keys = Object.keys(changes);
  if (!keys.length) return '';
  return keys
    .map(
      (key) =>
        `${{ title: '标题', description: '摘要', tags: '分类', order: '排序', updated: '日期', draft: '草稿', toc: '目录' }[key] || key}`,
    )
    .join(' / ');
}
