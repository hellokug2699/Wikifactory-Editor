import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const desktopDir = path.join(root, 'desktop');
const appDir = path.join(root, 'app');
const resourcesDir = path.join(desktopDir, 'resources');
const binDir = path.join(desktopDir, 'bin');
const cacheDir = path.join(desktopDir, '.cache');
const version = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).version;
const neutralinoVersion = '6.10.0';
const releaseZip = path.join(cacheDir, `neutralinojs-v${neutralinoVersion}.zip`);
const distDir = path.join(root, 'dist');
const outFile = path.join(distDir, `Wikifactory-Editor-v${version}-windows-x64.exe`);

function ensureBinaries() {
  fs.mkdirSync(binDir, { recursive: true });
  fs.mkdirSync(cacheDir, { recursive: true });
  const winBinary = path.join(binDir, 'neutralino-win_x64.exe');
  const linuxBinary = path.join(binDir, 'neutralino-linux_x64');
  if (fs.existsSync(winBinary) && fs.existsSync(linuxBinary)) return;

  if (!fs.existsSync(releaseZip)) {
    console.log(`[desktop] 下载 Neutralinojs v${neutralinoVersion}…`);
    execFileSync(
      'curl',
      [
        '-L',
        '--fail',
        '--retry',
        '3',
        '-o',
        releaseZip,
        `https://github.com/neutralinojs/neutralinojs/releases/download/v${neutralinoVersion}/neutralinojs-v${neutralinoVersion}.zip`,
      ],
      { stdio: 'inherit' },
    );
  }
  execFileSync('unzip', ['-o', '-j', releaseZip, 'neutralino-win_x64.exe', 'neutralino-linux_x64', '-d', binDir], {
    stdio: 'inherit',
  });
}

function runNeu(args) {
  const local = path.join(root, 'node_modules', '.bin', 'neu');
  if (fs.existsSync(local)) return execFileSync(local, args, { cwd: desktopDir, stdio: 'inherit' });
  return execFileSync('npx', ['--yes', `@neutralinojs/neu@11.8.0`, ...args], { cwd: desktopDir, stdio: 'inherit' });
}

ensureBinaries();
fs.rmSync(resourcesDir, { recursive: true, force: true });
fs.mkdirSync(resourcesDir, { recursive: true });
fs.cpSync(appDir, resourcesDir, { recursive: true });
// The CLI expects the Neutralino client library at resources/neutralino.js.
fs.copyFileSync(path.join(appDir, 'assets', 'vendor', 'neutralino.js'), path.join(resourcesDir, 'neutralino.js'));

console.log('[desktop] 打包单文件 exe（资源内嵌）…');
runNeu(['build', '--release', '--embed-resources']);

const built = path.join(desktopDir, 'dist', 'WikifactoryEditor', 'WikifactoryEditor-win_x64.exe');
if (!fs.existsSync(built)) {
  console.error('[desktop] 构建失败：未找到 Windows 可执行文件。');
  process.exit(1);
}
fs.mkdirSync(distDir, { recursive: true });
fs.copyFileSync(built, outFile);

const sha = crypto.createHash('sha256').update(fs.readFileSync(outFile)).digest('hex');
console.log(`[desktop] ${path.relative(root, outFile)} (${(fs.statSync(outFile).size / 1024 / 1024).toFixed(2)} MB)`);
console.log(`[desktop] sha256 ${sha}`);
console.log('[desktop] Windows 10/11 需要 WebView2 Runtime（通常已内置）。');

// Keep the source tree clean; binaries are cached under desktop/bin.
fs.rmSync(resourcesDir, { recursive: true, force: true });
fs.rmSync(path.join(desktopDir, 'dist'), { recursive: true, force: true });
