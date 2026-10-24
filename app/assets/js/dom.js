/** Tiny template helper: `h` returns a real DOM node, escaping values by default. */

function collectComments(node, out = []) {
  for (const child of [...(node.childNodes || [])]) {
    if (child.nodeType === 8) out.push(child);
    else collectComments(child, out);
  }
  return out;
}

export function raw(value) {
  return { __raw: String(value ?? '') };
}

function escapeValue(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

/**
 * @param {TemplateStringsArray} strings
 * @param {...unknown} values strings, numbers, nodes, arrays, or raw()
 * @returns {HTMLElement}
 */
export function h(strings, ...values) {
  const doc = globalThis.document;
  if (!doc) throw new Error('h() 需要 DOM 环境');
  const slots = [];
  let html = '';
  strings.forEach((chunk, index) => {
    html += chunk;
    if (index >= values.length) return;
    const value = values[index];
    if (value === null || value === undefined || value === false) return;
    if (value?.__raw !== undefined) {
      html += value.__raw;
      return;
    }
    if (Array.isArray(value)) {
      html += value
        .map((item) => {
          if (item?.nodeType) {
            slots.push(item);
            return `<!--h${slots.length - 1}-->`;
          }
          return escapeValue(item);
        })
        .join('');
      return;
    }
    if (value?.nodeType) {
      slots.push(value);
      html += `<!--h${slots.length - 1}-->`;
      return;
    }
    html += escapeValue(value);
  });

  const template = doc.createElement('template');
  template.innerHTML = html.trim();
  const fragment = template.content;
  for (const comment of collectComments(fragment)) {
    const match = /^h(\d+)$/.exec(comment.nodeValue || '');
    if (!match) continue;
    const node = slots[Number(match[1])];
    if (node) comment.replaceWith(node);
    else comment.remove();
  }
  const element = fragment.firstElementChild;
  if (!element) throw new Error('h() 模板必须包含一个根元素');
  return element;
}
