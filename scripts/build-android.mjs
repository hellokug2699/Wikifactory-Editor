import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const androidDir = path.join(root, 'android');
const appDir = path.join(root, 'app');
const assetsDir = path.join(androidDir, 'app', 'src', 'main', 'assets');
const version = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).version;
const distDir = path.join(root, 'dist');
const outFile = path.join(distDir, `Wikifactory-Editor-v${version}-android.apk`);

const androidHome =
  process.env.ANDROID_HOME ||
  process.env.ANDROID_SDK_ROOT ||
  (fs.existsSync('/opt/android-sdk') ? '/opt/android-sdk' : '');
if (!androidHome) {
  console.error('[android] 请设置 ANDROID_HOME（需要 Android SDK Platform 35 + Build-Tools 35.0.0）。');
  process.exit(1);
}

let javaHome = process.env.JAVA_HOME || '';
if (!javaHome) {
  try {
    javaHome = execFileSync('mise', ['where', 'java@21.0.12'], { encoding: 'utf8' }).trim();
  } catch {
    javaHome = process.env.JAVA_HOME || '';
  }
}
if (!javaHome) {
  console.error('[android] 请设置 JAVA_HOME 为 JDK 21（AGP 8.7 不支持 JDK 25）。');
  process.exit(1);
}

fs.writeFileSync(path.join(androidDir, 'local.properties'), `sdk.dir=${androidHome}\n`);
fs.rmSync(assetsDir, { recursive: true, force: true });
fs.mkdirSync(assetsDir, { recursive: true });
fs.cpSync(appDir, assetsDir, { recursive: true });

console.log('[android] 构建 debug-signed APK…');
const gradleArgs = ['assembleDebug', '--no-daemon', '--console=plain'];
// Gradle does not read the standard proxy environment variables; pass them as JVM properties.
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
execFileSync('gradle', gradleArgs, {
  cwd: androidDir,
  stdio: 'inherit',
  env: {
    ...process.env,
    JAVA_HOME: javaHome,
    ANDROID_HOME: androidHome,
    ANDROID_SDK_ROOT: androidHome,
  },
});

const built = path.join(androidDir, 'app', 'build', 'outputs', 'apk', 'debug', 'app-debug.apk');
if (!fs.existsSync(built)) {
  console.error('[android] 构建失败：未找到 APK 产物。');
  process.exit(1);
}
fs.mkdirSync(distDir, { recursive: true });
fs.copyFileSync(built, outFile);

const signer = path.join(androidHome, 'build-tools', '35.0.0', 'apksigner');
if (fs.existsSync(signer)) {
  try {
    execFileSync(signer, ['verify', '--verbose', '--print-certs', outFile], { stdio: 'inherit' });
  } catch {
    console.warn('[android] apksigner 校验未通过（APK 仍可能可安装）。');
  }
}

const sha = crypto.createHash('sha256').update(fs.readFileSync(outFile)).digest('hex');
console.log(`[android] ${path.relative(root, outFile)} (${(fs.statSync(outFile).size / 1024 / 1024).toFixed(2)} MB)`);
console.log(`[android] sha256 ${sha}`);
console.log('[android] 这是 debug 签名的本地测试包，不会发布到 Release；分发请使用 build:android:release 的签名 APK。');

fs.rmSync(assetsDir, { recursive: true, force: true });
