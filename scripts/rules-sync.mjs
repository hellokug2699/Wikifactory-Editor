#!/usr/bin/env node
/**
 * Keep the canonical content rules in sync with the content repository.
 *
 *   node scripts/rules-sync.mjs --hash
 *   node scripts/rules-sync.mjs --write  ../Wikifactory-Content
 *   node scripts/rules-sync.mjs --check  ../Wikifactory-Content
 *
 * The content repository vendors this file verbatim as
 * scripts/content-rules.mjs and stores its sha256 next to it. Content CI runs
 * scripts/check-rules.mjs, so any manual edit on either side fails fast.
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const source = path.join(root, 'app/assets/js/content-rules.js');
const targetName = 'content-rules.mjs';

const args = process.argv.slice(2);
const mode = args[0] || '--hash';
const targetRepo = args[1] ? path.resolve(args[1]) : '';

const sourceBytes = fs.readFileSync(source);
const hash = crypto.createHash('sha256').update(sourceBytes).digest('hex');

if (mode === '--hash') {
  console.log(hash);
  process.exit(0);
}

if (!targetRepo) {
  console.error('用法：node scripts/rules-sync.mjs --write|--check <Wikifactory-Content 路径>');
  process.exit(1);
}
const targetScripts = path.join(targetRepo, 'scripts');
const targetFile = path.join(targetScripts, targetName);
const checksumFile = path.join(targetScripts, 'content-rules.sha256');

if (mode === '--write') {
  if (!fs.existsSync(targetScripts)) {
    console.error(`找不到 ${targetScripts}，请确认传入的是 Wikifactory-Content 仓库。`);
    process.exit(1);
  }
  fs.copyFileSync(source, targetFile);
  fs.writeFileSync(checksumFile, `${hash}  ${targetName}\n`);
  console.log(`已写入 ${targetFile}`);
  console.log(`校验和 ${checksumFile}`);
  process.exit(0);
}

if (mode === '--check') {
  if (!fs.existsSync(targetFile)) {
    console.error(`目标仓库缺少 ${targetFile}；请运行 --write 同步。`);
    process.exit(1);
  }
  const targetHash = crypto.createHash('sha256').update(fs.readFileSync(targetFile)).digest('hex');
  if (targetHash !== hash) {
    console.error(`共享规则不一致：\n  编辑器 ${hash}\n  内容仓库 ${targetHash}\n请运行 node scripts/rules-sync.mjs --write ${targetRepo}`);
    process.exit(1);
  }
  if (fs.existsSync(checksumFile)) {
    const recorded = fs.readFileSync(checksumFile, 'utf8').split(/\s+/)[0];
    if (recorded !== hash) {
      console.error(`内容仓库的 content-rules.sha256 记录过期（${recorded}），请重新 --write。`);
      process.exit(1);
    }
  }
  console.log(`共享规则一致：${hash}`);
  process.exit(0);
}

console.error(`未知参数 ${mode}`);
process.exit(1);
