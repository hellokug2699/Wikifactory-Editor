/**
 * Authenticode-sign a Windows executable with a self-signed certificate.
 *
 * Usage:
 *   node scripts/sign-windows.mjs <path-to-exe>
 *   node scripts/sign-windows.mjs --verify <path-to-exe>
 *
 * Environment:
 *   WINDOWS_SIGNING_P12        path to a PKCS#12 file, or its base64 text
 *   WINDOWS_SIGNING_PASSWORD   PKCS#12 password
 *   WINDOWS_SIGNING_NAME       optional description (default: Wikifactory Editor)
 *
 * The certificate is self-signed, so SmartScreen still warns. The point is
 * integrity: anyone can compare the signature against the published
 * desktop/codesign/wikifactory-editor-codesign.crt fingerprint.
 */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';

const args = process.argv.slice(2);
const verifyOnly = args[0] === '--verify';
const target = verifyOnly ? args[1] : args[0];
if (!target) {
  console.error('用法：node scripts/sign-windows.mjs [--verify] <exe>');
  process.exit(1);
}
if (!fs.existsSync(target)) {
  console.error(`[sign] 文件不存在：${target}`);
  process.exit(1);
}

function fingerprint(pemPath) {
  const pem = fs.readFileSync(pemPath, 'utf8');
  const der = Buffer.from(pem.replace(/-----BEGIN CERTIFICATE-----|-----END CERTIFICATE-----|\s/g, ''), 'base64');
  return crypto
    .createHash('sha256')
    .update(der)
    .digest('hex')
    .toUpperCase()
    .replace(/(..)(?=.)/g, '$1:');
}

function verify(exe) {
  const certPath = process.env.WINDOWS_SIGNING_CERT || '';
  const args = ['verify', '-in', exe];
  if (certPath && fs.existsSync(certPath)) args.push('-CAfile', certPath);
  const run = spawnSync('osslsigncode', args, { encoding: 'utf8' });
  const out = `${run.stdout || ''}${run.stderr || ''}`;
  const digests = out.match(
    /Current message digest\s*:\s*([0-9A-F]+)[\s\S]*?Calculated message digest\s*:\s*([0-9A-F]+)/i,
  );
  const digestOk = Boolean(digests) && digests[1] === digests[2];
  const signed = /Number of verified signatures:\s*1/i.test(out);
  const chainOk = /Succeeded/i.test(out) || /Signature verification:\s*ok/i.test(out);

  if (!signed || !digestOk) {
    console.error('[sign] 签名校验失败（签名或摘要不匹配）。');
    if (out.trim()) console.error(out.trim().split('\n').slice(-6).join('\n'));
    return false;
  }
  if (certPath && fs.existsSync(certPath)) {
    console.log(`[sign] 证书 SHA-256：${fingerprint(certPath)}`);
  }
  if (chainOk) console.log('[sign] 签名校验通过。');
  else console.log('[sign] 签名摘要匹配；自签名证书不受系统信任（预期行为，不代表被篡改）。');
  return true;
}

if (verifyOnly) {
  process.exit(verify(target) ? 0 : 1);
}

const p12Env = process.env.WINDOWS_SIGNING_P12 || '';
const password = process.env.WINDOWS_SIGNING_PASSWORD || '';
if (!p12Env) {
  console.error('[sign] 未设置 WINDOWS_SIGNING_P12；跳过签名。');
  process.exit(2);
}

let p12Path = p12Env;
let tempDir = '';
if (!fs.existsSync(p12Env)) {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wfe-sign-'));
  p12Path = path.join(tempDir, 'signing.p12');
  fs.writeFileSync(p12Path, Buffer.from(p12Env.replace(/\s+/g, ''), 'base64'));
}

const signed = `${target}.signed`;
try {
  execFileSync(
    'osslsigncode',
    [
      'sign',
      '-pkcs12',
      p12Path,
      '-pass',
      password,
      '-n',
      process.env.WINDOWS_SIGNING_NAME || 'Wikifactory Editor',
      '-i',
      'https://github.com/hellokug2699/Wikifactory-Editor',
      '-h',
      'sha256',
      '-in',
      target,
      '-out',
      signed,
    ],
    { stdio: 'inherit' },
  );
  fs.renameSync(signed, target);
  verify(target);
} finally {
  if (fs.existsSync(signed)) fs.rmSync(signed, { force: true });
  if (tempDir) fs.rmSync(tempDir, { recursive: true, force: true });
}
