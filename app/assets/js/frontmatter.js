/**
 * Frontmatter parsing/editing built on the real YAML parser.
 *
 * The editor keeps the raw frontmatter text as the source of truth. Field edits
 * go through the YAML document API so comments, block scalars and unknown keys
 * survive a roundtrip.
 */
import { isSeq, parseDocument } from '../vendor/yaml.bundle.js';

function yamlIssue(message, line) {
  return { severity: 'error', message, ...(Number.isFinite(line) ? { line } : {}) };
}

/**
 * @param {string} raw frontmatter text without the `---` fences
 * @returns {{doc: object, map: Record<string, unknown>, issues: Array<object>}}
 */
export function parseYaml(raw) {
  const doc = parseDocument(String(raw ?? ''), { prettyErrors: false, uniqueKeys: true });
  const issues = (doc.errors || []).map((error) => {
    const line = error.linePos?.[0]?.line;
    return yamlIssue(error.message.split('\n')[0], line);
  });
  let map = {};
  try {
    const value = doc.toJS({ maxAliasCount: 100 }) ?? {};
    map = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  } catch (error) {
    issues.push(yamlIssue(`YAML 解析失败：${error.message}`));
  }
  return { doc, map, issues };
}

/** Compatibility wrapper used by the validator. */
export function parseYamlLite(raw) {
  const { map, issues } = parseYaml(raw);
  return { map, issues };
}

export function frontmatterData(raw) {
  const { map, issues } = parseYaml(raw);
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

function toString(doc) {
  return doc.toString({ lineWidth: 0, flowCollectionPadding: false }).replace(/\s+$/, '');
}

/**
 * Set or delete one top-level field while preserving comments and unknown keys.
 * @param {string} raw
 * @param {string} key
 * @param {unknown} value
 */
function writeField(doc, key, value) {
  if (value === null || value === undefined || value === '') {
    doc.delete(key);
    return;
  }
  const previous = doc.get(key, true);
  const node = doc.createNode(value);
  if (isSeq(node) && Array.isArray(value)) node.flow = true;
  if (previous?.comment != null && node.comment == null) node.comment = previous.comment;
  doc.set(key, node);
}

export function setYamlField(raw, key, value) {
  const { doc } = parseYaml(raw);
  writeField(doc, key, value);
  return toString(doc);
}

/**
 * Apply several top-level changes in one pass (one YAML document edit).
 * @param {string} raw
 * @param {Record<string, unknown>} changes
 */
export function applyYamlChanges(raw, changes) {
  const { doc } = parseYaml(raw);
  for (const [key, value] of Object.entries(changes || {})) writeField(doc, key, value);
  return toString(doc);
}

/** Current top-level value for a key, or undefined. */
export function yamlFieldValue(raw, key) {
  const { map } = parseYaml(raw);
  return map[key];
}
