import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import {
  clearToken,
  loadToken,
  saveToken,
  tokenStorageKind,
  tokenStoreUnreadable,
} from '../app/assets/js/secure-token.js';

const STORE_KEY = 'wikifactory-editor:token:v1';

const original = {
  localStorage: Object.getOwnPropertyDescriptor(globalThis, 'localStorage'),
  navigator: Object.getOwnPropertyDescriptor(globalThis, 'navigator'),
  screen: Object.getOwnPropertyDescriptor(globalThis, 'screen'),
};

let store;

function installStorage() {
  store = new Map();
  Object.defineProperty(globalThis, 'localStorage', {
    value: {
      getItem: (key) => (store.has(key) ? store.get(key) : null),
      setItem: (key, value) => store.set(key, String(value)),
      removeItem: (key) => store.delete(key),
    },
    configurable: true,
  });
}

function installDevice({ language = 'zh-CN', width = 1920 } = {}) {
  Object.defineProperty(globalThis, 'navigator', {
    value: {
      userAgent: 'Mozilla/5.0',
      platform: 'Linux',
      language,
      languages: [language],
      hardwareConcurrency: 8,
    },
    configurable: true,
  });
  Object.defineProperty(globalThis, 'screen', {
    value: { width, height: 1080 },
    configurable: true,
  });
}

before(() => {
  installStorage();
  installDevice();
});

after(() => {
  for (const [name, descriptor] of Object.entries(original)) {
    if (descriptor) Object.defineProperty(globalThis, name, descriptor);
    else delete globalThis[name];
  }
});

test('a saved token survives a changed language and screen size', async () => {
  installStorage();
  installDevice({ language: 'zh-CN', width: 1920 });
  const saved = await saveToken('ghp_example', { login: 'alice' });
  assert.equal(saved.ok, true);
  assert.equal(saved.kind, 'webcrypto');
  assert.equal(tokenStorageKind(), 'webcrypto');

  assert.equal((await loadToken()).token, 'ghp_example');

  // Changing language / screen no longer breaks decryption: they are not part
  // of the current key derivation.
  installDevice({ language: 'en-US', width: 1280 });
  const loaded = await loadToken();
  assert.equal(loaded.token, 'ghp_example');
  assert.equal(loaded.login, 'alice');
  assert.equal(tokenStoreUnreadable(), false);
});

test('an undecryptable record is kept rather than deleted', async () => {
  installStorage();
  installDevice();
  await saveToken('ghp_second', {});
  const parsed = JSON.parse(store.get(STORE_KEY));
  parsed.data = 'AAAA';
  store.set(STORE_KEY, JSON.stringify(parsed));

  assert.equal(await loadToken(), null);
  assert.equal(tokenStoreUnreadable(), true);
  assert.ok(store.has(STORE_KEY), 'record must not be silently deleted');

  // Saving a new token clears the unreadable marker.
  await saveToken('ghp_third', {});
  assert.equal(tokenStoreUnreadable(), false);
  assert.equal((await loadToken()).token, 'ghp_third');
});

test('clearToken removes the record and the marker', async () => {
  installStorage();
  installDevice();
  await saveToken('ghp_fourth', {});
  await clearToken();
  assert.equal(store.has(STORE_KEY), false);
  assert.equal(tokenStoreUnreadable(), false);
});
