import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const source = fs.readFileSync(path.join(root, 'app', 'sw.js'), 'utf8').replaceAll('__WFE_VERSION__', '1.2.8');
const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');

class FakeResponse {
  constructor(body = '', init = {}) {
    this.body = String(body);
    this.status = init.status ?? 200;
    this.ok = this.status < 400;
  }
  clone() {
    return new FakeResponse(this.body, { status: this.status });
  }
  text() {
    return Promise.resolve(this.body);
  }
  static error() {
    return new FakeResponse('', { status: 500 });
  }
}

class FakeRequest {
  constructor(url) {
    this.url = String(url);
    this.method = 'GET';
    this.mode = 'no-cors';
  }
}

function keyOf(request) {
  return typeof request === 'string' ? request : request.url;
}

/**
 * Load sw.js in a VM with a minimal Cache API so the lifecycle can be driven
 * from the test. `failing` lists URLs whose fetch/cache step rejects.
 */
function createWorker({ failing = [], caches: initial = [] } = {}) {
  const stores = new Map();
  for (const name of initial) stores.set(name, new Map());

  const cacheApi = (name) => {
    const store = stores.get(name);
    return {
      async add(url) {
        if (failing.includes(url)) throw new Error(`fetch failed: ${url}`);
        store.set(url, new FakeResponse(`cached ${name}:${url}`));
      },
      async addAll(urls) {
        // The real Cache.addAll is a single batch: one failure rejects all.
        for (const url of urls) if (failing.includes(url)) throw new Error(`fetch failed: ${url}`);
        for (const url of urls) store.set(url, new FakeResponse(`cached ${name}:${url}`));
      },
      async put(request, response) {
        store.set(keyOf(request), response);
      },
      async match(request) {
        return store.get(keyOf(request));
      },
    };
  };

  const caches = {
    async open(name) {
      if (!stores.has(name)) stores.set(name, new Map());
      return cacheApi(name);
    },
    async keys() {
      return [...stores.keys()];
    },
    async delete(name) {
      return stores.delete(name);
    },
    async match(request, options = {}) {
      const names = options.cacheName ? [options.cacheName] : [...stores.keys()];
      for (const name of names) {
        const hit = stores.get(name)?.get(keyOf(request));
        if (hit) return hit;
      }
      return undefined;
    },
  };

  const listeners = new Map();
  const calls = { skipWaiting: 0, claim: 0 };
  const self = {
    location: { origin: 'https://example.test' },
    addEventListener(type, handler) {
      listeners.set(type, handler);
    },
    async skipWaiting() {
      calls.skipWaiting += 1;
    },
    clients: {
      async claim() {
        calls.claim += 1;
      },
    },
  };

  const sandbox = {
    self,
    caches,
    fetch: async (request) => {
      const url = keyOf(request);
      if (failing.includes(url)) throw new Error(`fetch failed: ${url}`);
      return new FakeResponse(`network ${url}`);
    },
    Request: FakeRequest,
    Response: FakeResponse,
    URL,
    console: { warn() {}, log() {}, error() {} },
  };
  vm.runInNewContext(source, sandbox, { filename: 'sw.js' });

  async function dispatch(type) {
    const handler = listeners.get(type);
    assert.ok(handler, `missing ${type} handler`);
    const waits = [];
    handler({ waitUntil: (promise) => waits.push(promise) });
    return Promise.all(waits);
  }

  return { stores, calls, dispatch };
}

test('install fails atomically when a critical asset cannot be cached', async () => {
  const worker = createWorker({ failing: ['./assets/js/main.js'] });
  await assert.rejects(worker.dispatch('install'));
  assert.equal(worker.stores.has('wfe-1.2.8'), false, 'half-built bucket must be deleted');
  assert.equal(worker.calls.skipWaiting, 0, 'must not activate a partial version');
});

test('install activates only after every critical asset is cached', async () => {
  const worker = createWorker();
  await worker.dispatch('install');
  const cache = worker.stores.get('wfe-1.2.8');
  assert.ok(cache.size > 30, 'critical list cached');
  assert.ok(cache.has('./assets/js/main.js'));
  assert.equal(worker.calls.skipWaiting, 1);
});

test('a failing optional icon never blocks the install', async () => {
  const worker = createWorker({ failing: ['./assets/icons/app-icon.png'] });
  await worker.dispatch('install');
  assert.ok(worker.stores.get('wfe-1.2.8').has('./index.html'));
  assert.equal(worker.calls.skipWaiting, 1);
});

test('activation keeps the previous bucket and never deletes foreign caches', async () => {
  const worker = createWorker({ caches: ['wfe-1.2.6', 'wfe-old', 'wfe-meta', 'some-other-app'] });
  worker.stores.get('wfe-meta').set('./__wfe_active__', new FakeResponse('wfe-old'));
  await worker.dispatch('activate');
  assert.equal(worker.stores.has('wfe-1.2.8'), false);
  assert.equal(worker.stores.has('wfe-old'), true, 'previous version stays for open pages');
  assert.equal(worker.stores.has('wfe-1.2.6'), false, 'older buckets are pruned');
  assert.equal(worker.stores.has('some-other-app'), true, 'foreign caches are untouched');
  const active = worker.stores.get('wfe-meta').get('./__wfe_active__');
  assert.equal(await active.text(), 'wfe-1.2.8');
});

test('the worker never claims clients mid-load', () => {
  assert.equal(/clients\s*\.\s*claim\s*\(/.test(code), false);
});
