import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const appDir = path.join(root, 'app');
const outDir = path.join(root, 'dist', 'web');
const version = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).version;
const zipPath = path.join(root, 'dist', `Wikifactory-Editor-v${version}-web.zip`);

fs.rmSync(outDir, { recursive: true, force: true });
fs.mkdirSync(outDir, { recursive: true });
fs.cpSync(appDir, outDir, { recursive: true });

fs.writeFileSync(
  path.join(outDir, 'serve.mjs'),
  `import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
const root = process.cwd();
const port = Number(process.env.PORT || 8090);
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.json': 'application/json' };
http.createServer((req, res) => {
  const url = decodeURIComponent((req.url || '/').split('?')[0]);
  let file = path.join(root, url === '/' ? 'index.html' : url);
  if (!file.startsWith(root)) { res.writeHead(403); res.end('Forbidden'); return; }
  if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) file = path.join(root, 'index.html');
  res.writeHead(200, { 'Content-Type': types[path.extname(file)] || 'application/octet-stream' });
  fs.createReadStream(file).pipe(res);
}).listen(port, () => console.log('Wikifactory Editor: http://localhost:' + port));
`,
);

fs.rmSync(zipPath, { force: true });
try {
  execFileSync('zip', ['-qr', zipPath, '.'], { cwd: outDir, stdio: 'inherit' });
} catch (error) {
  console.error('需要 zip 命令来生成网页版压缩包。', error.message);
  process.exit(1);
}

console.log(`[web] ${path.relative(root, zipPath)} (${(fs.statSync(zipPath).size / 1024).toFixed(1)} KB)`);
console.log('[web] 解压后运行 `node serve.mjs`，然后打开 http://localhost:8090');
