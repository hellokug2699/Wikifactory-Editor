import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  NET,
  androidNetworkState,
  localNetworkState,
  notifyGithubUnreachable,
  onGithubUnreachable,
  probeGithub,
} from '../app/assets/js/net-status.js';

test('the Android bridge wins over navigator.onLine', () => {
  assert.equal(androidNetworkState({ isNetworkAvailable: () => true }), NET.OK);
  assert.equal(androidNetworkState({ isNetworkAvailable: () => 'false' }), NET.DOWN);
  assert.equal(androidNetworkState({}), null);
  assert.equal(androidNetworkState({ isNetworkAvailable: () => 'maybe' }), null);

  assert.equal(localNetworkState({ api: { isNetworkAvailable: () => false }, nav: { onLine: true } }), NET.DOWN);
  assert.equal(localNetworkState({ api: null, nav: { onLine: false } }), NET.DOWN);
  assert.equal(localNetworkState({ api: null, nav: {} }), NET.UNKNOWN);
});

test('a throwing Android bridge falls back to navigator.onLine', () => {
  const api = {
    isNetworkAvailable() {
      throw new Error('bridge unavailable');
    },
  };
  assert.equal(localNetworkState({ api, nav: { onLine: true } }), NET.OK);
  assert.equal(localNetworkState({ api, nav: { onLine: false } }), NET.DOWN);
});

test('any GitHub answer below 500 counts as reachable', async () => {
  const ok = await probeGithub({ fetchImpl: async () => ({ status: 200 }) });
  assert.equal(ok.state, NET.OK);
  assert.equal(ok.status, 200);
  assert.ok(ok.latency >= 0);

  // Rate-limited or unauthenticated still means the connection works.
  const forbidden = await probeGithub({ fetchImpl: async () => ({ status: 403 }) });
  assert.equal(forbidden.state, NET.OK);

  const serverError = await probeGithub({ fetchImpl: async () => ({ status: 503 }) });
  assert.equal(serverError.state, NET.DOWN);
});

test('network errors and timeouts are reported as down', async () => {
  const timeout = await probeGithub({
    fetchImpl: async () => {
      throw Object.assign(new Error('aborted'), { name: 'AbortError' });
    },
  });
  assert.equal(timeout.state, NET.DOWN);
  assert.equal(timeout.error, 'timeout');

  const offline = await probeGithub({
    fetchImpl: async () => {
      throw new TypeError('Failed to fetch');
    },
  });
  assert.equal(offline.state, NET.DOWN);
  assert.equal(offline.status, 0);
});

test('the probe is a token-free GET with a timeout signal', async () => {
  let seen;
  await probeGithub({
    fetchImpl: async (url, options) => {
      seen = { url, options };
      return { status: 200 };
    },
    timeout: 1234,
  });
  assert.equal(seen.url, 'https://api.github.com/rate_limit');
  assert.equal(seen.options.method, 'GET');
  assert.equal(seen.options.cache, 'no-store');
  assert.ok(seen.options.signal, 'a timeout signal must be attached');
  assert.equal(seen.options.headers.Authorization, undefined);
});

test('unreachable notifications reach subscribers and survive a broken listener', () => {
  const hits = [];
  const off = onGithubUnreachable((error) => hits.push(error));
  onGithubUnreachable(() => {
    throw new Error('boom');
  });

  notifyGithubUnreachable({ status: 0 });
  assert.equal(hits.length, 1);

  off();
  notifyGithubUnreachable({ status: 500 });
  assert.equal(hits.length, 1);
});
