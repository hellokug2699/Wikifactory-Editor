import assert from 'node:assert/strict';

/** Token-store self-test: roundtrip, no plaintext at rest, tamper handling, keystore bridge. */

const memory = new Map();
globalThis.localStorage = {
  getItem: (key) => (memory.has(key) ? memory.get(key) : null),
  setItem: (key, value) => {
    memory.set(key, String(value));
  },
  removeItem: (key) => {
    memory.delete(key);
  },
};
Object.defineProperty(globalThis, 'navigator', {
  configurable: true,
  value: {
    userAgent: 'node-test-agent',
    platform: 'linux',
    language: 'zh-CN',
    languages: ['zh-CN'],
    hardwareConcurrency: 4,
  },
});
Object.defineProperty(globalThis, 'screen', {
  configurable: true,
  value: { width: 1920, height: 1080 },
});

const { clearToken, loadToken, saveToken, tokenStorageKind } = await import('../app/assets/js/secure-token.js');

const TOKEN = 'ghp_selftest_abcdefghijklmnopqrstuvwx';
const STORE_KEY = 'wikifactory-editor:token:v1';
const results = [];
let failed = 0;

async function check(name, fn) {
  try {
    await fn();
    results.push(name);
    console.log(`  ok  ${name}`);
  } catch (error) {
    failed += 1;
    console.log(`  FAIL ${name} — ${error.message}`);
  }
}
function summary() {
  console.log(`\n${results.length} tests passed.`);
}

const saved = await saveToken(TOKEN, { login: 'tester' });
let raw = '';

await check('webcrypto store is available', () => assert.equal(tokenStorageKind(), 'webcrypto'));
await check('save reports success', () => assert.equal(saved.ok, true));
await check('stored record has no plaintext token', () => {
  raw = memory.get(STORE_KEY) || '';
  assert.ok(raw, 'record missing');
  assert.ok(!raw.includes(TOKEN), 'plaintext token found in storage');
  const record = JSON.parse(raw);
  assert.equal(record.kind, 'webcrypto');
  assert.ok(record.iv && record.data);
});
await check('token roundtrip', async () => {
  const restored = await loadToken();
  assert.equal(restored?.token, TOKEN);
  assert.equal(restored?.login, 'tester');
});
await check('install id is stored separately', () => {
  const install = memory.get('wikifactory-editor:install-id:v1');
  assert.ok(install && install !== TOKEN);
});
await check('tampered ciphertext is rejected but kept for inspection', async () => {
  const record = JSON.parse(raw);
  record.data = `${record.data.slice(0, 8)}AAAA${record.data.slice(12)}`;
  memory.set(STORE_KEY, JSON.stringify(record));
  assert.equal(await loadToken(), null);
  assert.equal(memory.has(STORE_KEY), true);
  assert.equal(memory.get('wikifactory-editor:token:v1:unreadable'), '1');
});
await check('clear removes the encrypted record', async () => {
  await saveToken(TOKEN, { login: 'tester' });
  await clearToken();
  assert.equal(memory.has(STORE_KEY), false);
  assert.equal(await loadToken(), null);
});

let bridgeBlob = '';
globalThis.AndroidEditor = {
  secureSet(value) {
    bridgeBlob = value;
    return 'true';
  },
  secureGet() {
    return bridgeBlob;
  },
  secureClear() {
    bridgeBlob = '';
  },
};
await check('android keystore bridge is detected', () => assert.equal(tokenStorageKind(), 'android-keystore'));
await check('android bridge roundtrip', async () => {
  const res = await saveToken(TOKEN, { login: 'android' });
  assert.equal(res.kind, 'android-keystore');
  assert.equal(res.ok, true);
  assert.ok(bridgeBlob.includes(TOKEN));
  assert.equal((await loadToken())?.token, TOKEN);
  await clearToken();
  assert.equal(bridgeBlob, '');
});

summary();
if (failed) process.exit(1);
