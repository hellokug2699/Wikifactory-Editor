import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { canonicalConfig, keyIdOf, readPublicJwk, signConfig, verifyConfig } from '../scripts/config-sign.mjs';
import { verifyConfigSignature } from '../app/assets/js/config.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const configText = fs.readFileSync(path.join(root, 'editor-config.json'), 'utf8');
const signature = fs.readFileSync(path.join(root, 'editor-config.json.sig'), 'utf8');
const jwk = readPublicJwk();

test('the committed signature matches the committed public key', () => {
  assert.ok(jwk, 'editor-config.pub.jwk is committed');
  assert.equal(verifyConfig(configText, signature, jwk), true);
  assert.match(keyIdOf(jwk), /^[0-9a-f]{64}$/);
});

test('tampering with the config invalidates the signature', () => {
  const tampered = configText.replace(/"maxUploadMb": 20/, '"maxUploadMb": 200');
  assert.notEqual(tampered, configText);
  assert.equal(verifyConfig(tampered, signature, jwk), false);
});

test('CRLF checkouts verify the same as LF', () => {
  const crlf = configText.replace(/\n/g, '\r\n');
  assert.equal(canonicalConfig(crlf), configText);
  assert.equal(verifyConfig(crlf, signature, jwk), true);
});

test('sign/verify round-trip with a fresh key', async () => {
  const { privateKey, publicKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' });
  const freshJwk = publicKey.export({ format: 'jwk' });
  const text = JSON.stringify({ version: 1, content: { owner: 'a', repo: 'b' } }, null, 2);
  const sig = signConfig(text, privateKey).toString('base64');
  assert.equal(verifyConfig(text, sig, freshJwk), true);
  assert.equal(verifyConfig(`${text} `, sig, freshJwk), false);
  // The browser-side verifier accepts the same signature and key.
  assert.equal(await verifyConfigSignature(text, sig, freshJwk), true);
  assert.equal(await verifyConfigSignature(`${text}x`, sig, freshJwk), false);
});

test('a broken signature or key never throws', async () => {
  assert.equal(verifyConfig(configText, 'not-base64', jwk), false);
  assert.equal(verifyConfig(configText, signature, { kty: 'EC' }), false);
  assert.equal(await verifyConfigSignature(configText, signature, null), false);
  assert.equal(await verifyConfigSignature(configText, '', jwk), false);
});
