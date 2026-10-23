#!/usr/bin/env node
/**
 * Sync the canonical page-category template to Wikifactory-Core.
 *
 *   node scripts/tags-sync.mjs --write  ../Wikifactory-Core
 *   node scripts/tags-sync.mjs --check  ../Wikifactory-Core
 *
 * The editor (app/assets/js/content-rules.js) is the source of truth. Core
 * stores a generated config/page-tags.json for display (labels / tones /
 * descriptions) plus the canonical rules hash, so a stale copy fails the check.
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PAGE_TAGS, RULES_VERSION } from '../app/assets/js/content-rules.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sourceRel = 'app/assets/js/content-rules.js';
const source = path.join(root, sourceRel);
const args = process.argv.slice(2);
const mode = args[0] || '--write';
const targetRepo = args[1] ? path.resolve(args[1]) : '';

if (!targetRepo) {
  console.error('用法：node scripts/tags-sync.mjs --write|--check <Wikifactory-Core 路径>');
  process.exit(1);
}

const target = path.join(targetRepo, 'config', 'page-tags.json');
const hash = crypto.createHash('sha256').update(fs.readFileSync(source)).digest('hex');
const payload = {
  version: RULES_VERSION,
  rulesSha256: hash,
  source: sourceRel,
  tags: PAGE_TAGS,
};
const text = `${JSON.stringify(payload, null, 2)}\n`;

if (mode === '--write') {
  if (!fs.existsSync(path.join(targetRepo, 'config'))) {
    console.error(`找不到 ${path.join(targetRepo, 'config')}，请确认传入的是 Wikifactory-Core 仓库。`);
    process.exit(1);
  }
  fs.writeFileSync(target, text);
  console.log(`已写入 ${target}`);
  console.log(`规则版本 ${RULES_VERSION}，共 ${PAGE_TAGS.length} 个分类，sha256 ${hash}`);
  process.exit(0);
}

if (mode === '--check') {
  if (!fs.existsSync(target)) {
    console.error(`目标仓库缺少 ${target}；请运行 --write 同步。`);
    process.exit(1);
  }
  if (fs.readFileSync(target, 'utf8') !== text) {
    console.error(`页面分类模板不一致：请运行 node scripts/tags-sync.mjs --write ${targetRepo}`);
    process.exit(1);
  }
  const recorded = JSON.parse(fs.readFileSync(target, 'utf8')).rulesSha256;
  if (recorded !== hash) {
    console.error(`Core 记录的规则哈希过期：${recorded}（当前 ${hash}）`);
    process.exit(1);
  }
  console.log(`页面分类模板一致：${RULES_VERSION} / ${PAGE_TAGS.length} 个分类 / ${hash.slice(0, 12)}…`);
  process.exit(0);
}

console.error(`未知参数 ${mode}`);
process.exit(1);
