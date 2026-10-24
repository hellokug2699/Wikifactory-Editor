import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const desktopDir = path.join(root, 'desktop');
const appDir = path.join(root, 'app');
const resourcesDir = path.join(desktopDir, 'resources');
const stageDir = path.join(desktopDir, '.stage');
const binDir = path.join(desktopDir, 'bin');
const cacheDir = path.join(desktopDir, '.cache');
const version = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).version;
const neutralinoVersion = '6.10.0';
const releaseZip = path.join(cacheDir, `neutralinojs-v${neutralinoVersion}.zip`);
const distDir = path.join(root, 'dist');
const bundleName = 'Wikifactory-Editor';
const stageApp = path.join(stageDir, bundleName);
const outZip = path.join(distDir, `Wikifactory-Editor-v${version}-windows-x64.zip`);

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

function sha256(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

ensureBinaries();
fs.rmSync(resourcesDir, { recursive: true, force: true });
fs.mkdirSync(resourcesDir, { recursive: true });
fs.cpSync(appDir, resourcesDir, { recursive: true });
// The CLI expects the Neutralino client library at resources/neutralino.js.
fs.copyFileSync(path.join(appDir, 'assets', 'vendor', 'neutralino.js'), path.join(resourcesDir, 'neutralino.js'));

// Standard two-file distribution (exe + resources.neu). The previous single-file
// exe appended resources to the PE, which several Windows AV/SmartScreen setups
// refused to launch; keeping resources external matches the framework default.
console.log('[desktop] 打包 exe + resources.neu…');
runNeu(['build', '--release']);

const builtDir = path.join(desktopDir, 'dist', 'WikifactoryEditor');
const builtExe = path.join(builtDir, 'WikifactoryEditor-win_x64.exe');
const builtResources = path.join(builtDir, 'resources.neu');
if (!fs.existsSync(builtExe) || !fs.existsSync(builtResources)) {
  console.error('[desktop] 构建失败：未找到 Windows 可执行文件或 resources.neu。');
  process.exit(1);
}

fs.rmSync(stageDir, { recursive: true, force: true });
fs.mkdirSync(stageApp, { recursive: true });
const stagedExe = path.join(stageApp, `${bundleName}.exe`);
fs.copyFileSync(builtExe, stagedExe);
fs.copyFileSync(builtResources, path.join(stageApp, 'resources.neu'));

let signed = false;
if (process.env.WINDOWS_SIGNING_P12) {
  console.log('[desktop] 使用自签名证书签署 exe…');
  execFileSync(process.execPath, [path.join(root, 'scripts', 'sign-windows.mjs'), stagedExe], { stdio: 'inherit' });
  signed = true;
} else {
  console.log('[desktop] 未设置 WINDOWS_SIGNING_P12，跳过 Authenticode 签名。');
}

fs.writeFileSync(
  path.join(stageApp, 'README.txt'),
  [
    `Wikifactory Editor v${version}（Windows x64 便携版）`,
    '',
    `1. 解压后双击 ${bundleName}.exe 运行。`,
    `2. ${bundleName}.exe 必须与 resources.neu 放在同一目录；缺少 resources.neu 会无法启动。`,
    '3. 需要 Microsoft Edge WebView2 Runtime（Windows 10/11 通常自带）。',
    '   若提示缺少运行库：https://go.microsoft.com/fwlink/p/?LinkId=2124703',
    '4. 若从浏览器下载后无法运行：右键 exe → 属性 → 勾选「解除锁定」→ 确定。',
    '5. 启动失败时，同目录下会生成 neutralinojs.log，可据此排查（常见原因是杀毒软件拦截或缺少 WebView2）。',
    '',
    signed
      ? '本 exe 使用 Wikifactory Editor 自签名证书签名；签名可在「文件属性 → 数字签名」中查看。'
      : '本 exe 未签名，Windows 可能显示 SmartScreen 警告。',
    '',
    'https://github.com/hellokug2699/Wikifactory-Editor',
  ].join('\r\n'),
  'utf8',
);

fs.mkdirSync(distDir, { recursive: true });
fs.rmSync(outZip, { force: true });
execFileSync('zip', ['-r', '-9', '-q', outZip, bundleName], { cwd: stageDir, stdio: 'inherit' });

console.log(`[desktop] ${path.relative(root, outZip)} (${(fs.statSync(outZip).size / 1024 / 1024).toFixed(2)} MB)`);
console.log(`[desktop] sha256 ${sha256(outZip)}`);
console.log(`[desktop] exe (${signed ? 'signed' : 'unsigned'}) sha256 ${sha256(stagedExe)}`);
console.log('[desktop] 解压后双击运行；需要 WebView2 Runtime。');

// Keep the source tree clean; binaries are cached under desktop/bin.
fs.rmSync(resourcesDir, { recursive: true, force: true });
fs.rmSync(stageDir, { recursive: true, force: true });
fs.rmSync(path.join(desktopDir, 'dist'), { recursive: true, force: true });
