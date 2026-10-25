#!/usr/bin/env node
/**
 * Sign / verify editor-config.json with an ECDSA P-256 key.
 *
 *   node scripts/config-sign.mjs --keygen [private-key-path]
 *   node scripts/config-sign.mjs --sign
 *   node scripts/config-sign.mjs --verify
 *
 * The public key (`editor-config.pub.jwk`) and the detached signature
 * (`editor-config.json.sig`, base64 of the raw r||s value) are committed. The
 * private key never belongs in this repository; pass CONFIG_SIGNING_KEY or let
 * --keygen write it outside the work tree.
 *
 * This separates two questions that SHA-256 alone cannot:
 *   - integrity: "the file matches the hash baked at build time"
 *   - authenticity: "the file was signed by the configuration publisher"
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const CONFIG_PATH = path.join(root, 'editor-config.json');
export const SIGNATURE_PATH = path.join(root, 'editor-config.json.sig');
export const PUBLIC_KEY_PATH = path.join(root, 'editor-config.pub.jwk');
const DEFAULT_KEY_PATH = path.resolve(root, '..', '.config-signing', 'config-signing-key.pem');

/** The signature covers the LF-normalised JSON, like the build-time hash. */
export function canonicalConfig(text) {
  return String(text).replace(/\r\n/g, '\n');
}

export function keyIdOf(jwk) {
  const der = crypto.createPublicKey({ key: jwk, format: 'jwk' }).export({ type: 'spki', format: 'der' });
  return crypto.createHash('sha256').update(der).digest('hex');
}

export function signConfig(text, privateKey) {
  return crypto.sign('sha256', Buffer.from(canonicalConfig(text)), {
    key: privateKey,
    dsaEncoding: 'ieee-p1363',
  });
}

export function verifyConfig(text, signatureBase64, jwk) {
  try {
    const publicKey = crypto.createPublicKey({ key: jwk, format: 'jwk' });
    return crypto.verify(
      'sha256',
      Buffer.from(canonicalConfig(text)),
      { key: publicKey, dsaEncoding: 'ieee-p1363' },
      Buffer.from(String(signatureBase64).trim(), 'base64'),
    );
  } catch {
    return false;
  }
}

export function readPublicJwk(file = PUBLIC_KEY_PATH) {
  if (!fs.existsSync(file)) return null;
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

function keygen(target = DEFAULT_KEY_PATH) {
  const { privateKey, publicKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' });
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, privateKey.export({ type: 'pkcs8', format: 'pem' }), { mode: 0o600 });
  const jwk = publicKey.export({ format: 'jwk' });
  fs.writeFileSync(PUBLIC_KEY_PATH, `${JSON.stringify(jwk, null, 2)}\n`);
  console.log(`[config] 私钥：${target}`);
  console.log(`[config] 公钥：${path.relative(root, PUBLIC_KEY_PATH)}`);
  console.log(`[config] keyId：${keyIdOf(jwk)}`);
  console.log('[config] 请重新运行 npm run config:sync 与 npm run config:sign，并提交公钥与签名。');
}

function keyPath() {
  return process.env.CONFIG_SIGNING_KEY || DEFAULT_KEY_PATH;
}

function sign() {
  const text = fs.readFileSync(CONFIG_PATH, 'utf8');
  const target = keyPath();
  if (!fs.existsSync(target)) {
    console.error(
      `[config] 找不到私钥：${target}\n` +
        '  先生成：node scripts/config-sign.mjs --keygen [路径]\n' +
        '  或设置 CONFIG_SIGNING_KEY 指向私钥文件。',
    );
    process.exit(1);
  }
  const signature = signConfig(text, fs.readFileSync(target, 'utf8'));
  fs.writeFileSync(SIGNATURE_PATH, `${signature.toString('base64')}\n`);
  console.log(`[config] 已签名：${path.relative(root, SIGNATURE_PATH)}`);
  verify();
}

function verify() {
  const jwk = readPublicJwk();
  if (!jwk) {
    console.error('[config] 缺少 editor-config.pub.jwk，请运行 npm run config:keygen。');
    process.exit(1);
  }
  if (!fs.existsSync(SIGNATURE_PATH)) {
    console.error('[config] 缺少 editor-config.json.sig，请运行 npm run config:sign。');
    process.exit(1);
  }
  const text = fs.readFileSync(CONFIG_PATH, 'utf8');
  const signature = fs.readFileSync(SIGNATURE_PATH, 'utf8');
  if (!verifyConfig(text, signature, jwk)) {
    console.error('[config] 签名无效：editor-config.json 与签名不匹配。');
    process.exit(1);
  }
  console.log(`[config] 签名有效（keyId ${keyIdOf(jwk)}）。`);
}

function main() {
  const args = process.argv.slice(2);
  if (args.includes('--keygen')) {
    const index = args.indexOf('--keygen');
    keygen(args[index + 1] ? path.resolve(args[index + 1]) : DEFAULT_KEY_PATH);
    return;
  }
  if (args.includes('--sign')) return sign();
  if (args.includes('--verify')) return verify();
  console.error('用法：node scripts/config-sign.mjs --keygen [path] | --sign | --verify');
  process.exit(1);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
