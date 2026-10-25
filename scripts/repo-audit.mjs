#!/usr/bin/env node
/**
 * Report every place that still mentions the current owner / repository names.
 *
 *   npm run repo:audit                       # this repository
 *   npm run repo:audit -- ../Wikifactory-Content ../Wikifactory-Core
 *   npm run repo:audit -- --strict           # fail when runtime code still does
 *
 * Runtime and build code read owner/repo from editor-config.json, so the
 * remaining owner hits should only be docs, tests and the generated config
 * module. After migrating an owner, run this to see what still needs editing.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { REPO } from './repo.mjs';

const here = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const strict = args.includes('--strict');
const targets = args.filter((arg) => !arg.startsWith('--'));

const SKIP_DIRS = ['.git', 'node_modules', 'dist', 'desktop/bin', 'desktop/.cache', 'desktop/.stage', 'desktop/dist'];
const SKIP_FILES = new Set(['package-lock.json']);

const owners = [...new Set([REPO.contentOwner, REPO.editorOwner])].filter(Boolean);
const repoNames = [...new Set([REPO.contentRepo, REPO.editorRepo])].filter(Boolean);

/** Runtime code and build scripts must not re-introduce a literal owner. */
function isRuntime(rel) {
  if (rel.startsWith('scripts/') && rel !== 'scripts/repo-audit.mjs') return true;
  if (rel.startsWith('app/assets/js/')) {
    return rel !== 'app/assets/js/editor-config.js' && rel !== 'app/assets/js/content-rules.js';
  }
  return ['app/index.html', 'app/sw.js', 'app/manifest.webmanifest'].includes(rel);
}

function walk(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith('.') && entry.name !== '.github') continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (SKIP_DIRS.some((skip) => full.endsWith(path.sep + skip) || full.endsWith('/' + skip))) continue;
      walk(full, out);
      continue;
    }
    if (SKIP_FILES.has(entry.name)) continue;
    if (
      /\.(png|jpe?g|webp|avif|gif|ico|ogg|zip|apk|exe|neu|p12|jks|keystore|idsig|woff2?|ttf|pdf)$/i.test(entry.name)
    ) {
      continue;
    }
    out.push(full);
  }
  return out;
}

function linesWith(text, needles) {
  return text
    .split('\n')
    .map((line, index) => ({ line, index }))
    .filter((item) => needles.some((needle) => item.line.includes(needle)));
}

let ownerHits = 0;
let runtimeOwnerHits = 0;
let repoHits = 0;

for (const root of targets.length ? targets : [here]) {
  const dir = path.resolve(process.cwd(), root);
  if (!fs.existsSync(dir)) {
    console.error(`[repo] 目录不存在：${dir}`);
    process.exitCode = 1;
    continue;
  }
  console.log(`\n=== ${dir}`);
  for (const file of walk(dir)) {
    let text;
    try {
      text = fs.readFileSync(file, 'utf8');
    } catch {
      continue;
    }
    const rel = path.relative(dir, file).split(path.sep).join('/');
    const runtime = dir === here && isRuntime(rel);
    const ownerLines = linesWith(text, owners);
    const repoLines = linesWith(text, repoNames);
    ownerHits += ownerLines.length;
    repoHits += repoLines.length;
    if (!ownerLines.length && !repoLines.length) continue;
    if (runtime) runtimeOwnerHits += ownerLines.length;

    const parts = [];
    if (ownerLines.length) parts.push(`owner ${ownerLines.length} 行`);
    if (repoLines.length) parts.push(`仓库名 ${repoLines.length} 行`);
    console.log(`${runtime ? '!' : ' '} ${rel} (${parts.join('，')})`);
    if (runtime && ownerLines.length) {
      for (const item of ownerLines.slice(0, 5)) {
        console.log(`    L${item.index + 1}: ${item.line.trim().slice(0, 120)}`);
      }
    }
  }
}

console.log(`\n[repo] owner 命中 ${ownerHits} 行，仓库名命中 ${repoHits} 行。`);
console.log('[repo] `!` = 运行时代码；owner 命中应只剩文档 / 测试 / 生成文件。');
console.log('[repo] 迁移清单：editor-config.json → npm run config:sync → npm run version:sync → npm run repo:audit。');
if (strict && runtimeOwnerHits) {
  console.error(`[repo] --strict：运行时代码仍有 ${runtimeOwnerHits} 行硬编码 owner。`);
  process.exit(1);
}
