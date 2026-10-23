#!/usr/bin/env node
/**
 * Build and sign a release APK with your own keystore.
 *
 * Required environment variables:
 *   ANDROID_KEYSTORE            path to the .jks / .keystore
 *   ANDROID_KEYSTORE_PASSWORD   store password
 *   ANDROID_KEY_ALIAS           key alias
 *   ANDROID_KEY_PASSWORD        key password
 *
 * Optional: JAVA_HOME, ANDROID_HOME / ANDROID_SDK_ROOT
 *
 * Usage:
 *   node scripts/android-release.mjs                     # gradle assembleRelease + sign + verify
 *   node scripts/android-release.mjs --apk <file.apk>    # re-sign an existing APK
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const version = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).version;
const distDir = path.join(root, 'dist');

const keystore = process.env.ANDROID_KEYSTORE || '';
const storePassword = process.env.ANDROID_KEYSTORE_PASSWORD || '';
const keyAlias = process.env.ANDROID_KEY_ALIAS || '';
const keyPassword = process.env.ANDROID_KEY_PASSWORD || '';

const missing = [
  ['ANDROID_KEYSTORE', keystore],
  ['ANDROID_KEYSTORE_PASSWORD', storePassword],
  ['ANDROID_KEY_ALIAS', keyAlias],
  ['ANDROID_KEY_PASSWORD', keyPassword],
].filter(([, value]) => !value).map(([name]) => name);

if (missing.length) {
  console.error('[android:release] 缺少签名环境变量：');
  for (const name of missing) console.error(`  - ${name}`);
  console.error('\n示例：');
  console.error('  KEYTOOL=$(dirname $(mise where java@21 2>/dev/null || which java))/keytool');
  console.error('  keytool -genkeypair -v -keystore release.jks -alias wikifactory -keyalg RSA -keysize 2048 -validity 10000');
  console.error('  export ANDROID_KEYSTORE=$PWD/release.jks ANDROID_KEYSTORE_PASSWORD=*** ANDROID_KEY_ALIAS=wikifactory ANDROID_KEY_PASSWORD=***');
  console.error('  npm run build:android:release');
  process.exit(1);
}
if (!fs.existsSync(keystore)) {
  console.error(`[android:release] 找不到 keystore：${keystore}`);
  process.exit(1);
}

const androidHome = process.env.ANDROID_HOME || process.env.ANDROID_SDK_ROOT || '/opt/android-sdk';
let javaHome = process.env.JAVA_HOME || '';
if (!javaHome) {
  try {
    javaHome = execFileSync('mise', ['where', 'java@21'], { encoding: 'utf8' }).trim();
  } catch {
    javaHome = '';
  }
}
if (!javaHome) {
  try {
    execFileSync('java', ['-version'], { stdio: 'ignore' });
  } catch {
    console.error('[android:release] 找不到 Java，请设置 JAVA_HOME（JDK 17+，推荐 21）。');
    process.exit(1);
  }
}

function buildToolsDir() {
  const base = path.join(androidHome, 'build-tools');
  if (!fs.existsSync(base)) return '';
  const versions = fs.readdirSync(base).filter((name) => /^\d+(\.\d+)*$/.test(name)).sort((a, b) => {
    const left = a.split('.').map(Number);
    const right = b.split('.').map(Number);
    for (let i = 0; i < Math.max(left.length, right.length); i += 1) {
      if ((left[i] || 0) !== (right[i] || 0)) return (left[i] || 0) - (right[i] || 0);
    }
    return 0;
  });
  return versions.length ? path.join(base, versions[versions.length - 1]) : '';
}

const tools = buildToolsDir();
const apksigner = tools ? path.join(tools, 'apksigner') : '';
if (!apksigner || !fs.existsSync(apksigner)) {
  console.error('[android:release] 找不到 apksigner，请安装 Android SDK Build-Tools 35。');
  process.exit(1);
}

const args = process.argv.slice(2);
const apkIndex = args.indexOf('--apk');
const existingApk = apkIndex >= 0 ? path.resolve(args[apkIndex + 1] || '') : '';
fs.mkdirSync(distDir, { recursive: true });
const outFile = path.join(distDir, `Wikifactory-Editor-v${version}-android-release.apk`);

function sign(inputApk) {
  fs.rmSync(outFile, { force: true });
  execFileSync(apksigner, [
    'sign',
    '--ks', keystore,
    '--ks-key-alias', keyAlias,
    '--ks-pass', `env:ANDROID_KEYSTORE_PASSWORD`,
    '--key-pass', `env:ANDROID_KEY_PASSWORD`,
    '--v4-signing-enabled', 'false',
    '--out', outFile,
    inputApk,
  ], { stdio: 'inherit', env: process.env });
  const certs = execFileSync(apksigner, ['verify', '--print-certs', outFile], {
    encoding: 'utf8',
    env: process.env,
  });
  console.log(`[android:release] 签名完成：${outFile}`);
  console.log(certs.trim().split('\n').filter((line) => /SHA-256|Signer/.test(line)).join('\n'));
  const hash = crypto.createHash('sha256').update(fs.readFileSync(outFile)).digest('hex');
  console.log(`[android:release] sha256 ${hash}`);
  return outFile;
}

if (existingApk) {
  if (!fs.existsSync(existingApk)) {
    console.error(`[android:release] 找不到 APK：${existingApk}`);
    process.exit(1);
  }
  sign(existingApk);
  process.exit(0);
}

const androidDir = path.join(root, 'android');
const assetsDir = path.join(androidDir, 'app', 'src', 'main', 'assets');
fs.writeFileSync(path.join(androidDir, 'local.properties'), `sdk.dir=${androidHome}\n`);

// The WebView shell loads app/ from assets; copy it in for the build and clean up afterwards.
fs.rmSync(assetsDir, { recursive: true, force: true });
fs.cpSync(path.join(root, 'app'), assetsDir, { recursive: true });

const gradleArgs = ['assembleRelease', '-x', 'lintVitalRelease', '--no-daemon', '--console=plain'];
const proxyUrl = process.env.HTTPS_PROXY || process.env.https_proxy || process.env.HTTP_PROXY || process.env.http_proxy;
if (proxyUrl) {
  try {
    const proxy = new URL(proxyUrl);
    if (proxy.hostname) {
      gradleArgs.push(
        `-Dhttps.proxyHost=${proxy.hostname}`,
        `-Dhttps.proxyPort=${proxy.port || 8080}`,
        `-Dhttp.proxyHost=${proxy.hostname}`,
        `-Dhttp.proxyPort=${proxy.port || 8080}`,
        '-Dhttp.nonProxyHosts=localhost|127.0.0.1',
      );
    }
  } catch {
    // Ignore malformed proxy values.
  }
}

console.log('[android:release] 构建 release APK…');
const gradleEnv = {
  ...process.env,
  ANDROID_HOME: androidHome,
  ANDROID_SDK_ROOT: androidHome,
};
if (javaHome) gradleEnv.JAVA_HOME = javaHome;
try {
  execFileSync('gradle', gradleArgs, {
    cwd: androidDir,
    stdio: 'inherit',
    env: gradleEnv,
  });
} finally {
  fs.rmSync(assetsDir, { recursive: true, force: true });
}

const releaseDir = path.join(androidDir, 'app', 'build', 'outputs', 'apk', 'release');
const built = [path.join(releaseDir, 'app-release-unsigned.apk'), path.join(releaseDir, 'app-release.apk')]
  .find((file) => fs.existsSync(file));
if (!built) {
  console.error('[android:release] 构建失败：未找到 release APK');
  process.exit(1);
}
sign(built);
