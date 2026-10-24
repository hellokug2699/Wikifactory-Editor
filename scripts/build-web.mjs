import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { VERSION } from './version.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const appDir = path.join(root, 'app');
const outDir = path.join(root, 'dist', 'web');
const version = VERSION;
const zipPath = path.join(root, 'dist', `Wikifactory-Editor-v${version}-web.zip`);

fs.rmSync(outDir, { recursive: true, force: true });
fs.mkdirSync(outDir, { recursive: true });
fs.cpSync(appDir, outDir, { recursive: true });

// Give every release its own service-worker cache bucket.
const swPath = path.join(outDir, 'sw.js');
fs.writeFileSync(swPath, fs.readFileSync(swPath, 'utf8').replaceAll('__WFE_VERSION__', version));

fs.rmSync(zipPath, { force: true });
try {
  execFileSync('zip', ['-qr', zipPath, '.'], { cwd: outDir, stdio: 'inherit' });
} catch (error) {
  console.error('需要 zip 命令来生成网页版压缩包。', error.message);
  process.exit(1);
}

console.log(`[web] ${path.relative(root, zipPath)} (${(fs.statSync(zipPath).size / 1024).toFixed(1)} KB)`);
console.log('[web] 解压后用任意静态服务器托管（需 https 或 localhost 才能启用 PWA / Service Worker）。');
