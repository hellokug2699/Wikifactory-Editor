import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compareVersions, parseVersion, planUpdate, releaseAsset } from '../app/assets/js/updates.js';

test('versions compare numerically, not lexicographically', () => {
  assert.deepEqual(parseVersion('v1.2.10'), [1, 2, 10]);
  assert.ok(compareVersions('1.2.10', '1.2.9') > 0);
  assert.ok(compareVersions('v1.2.4', '1.2.4') === 0);
  assert.ok(compareVersions('1.3', '1.2.99') > 0);
  assert.ok(compareVersions('garbage', '0.0.1') < 0);
});

test('release assets are matched by suffix', () => {
  const release = {
    assets: [
      { name: 'Wikifactory-Editor-v1.2.4-windows-x64.zip', url: 'zip' },
      { name: 'Wikifactory-Editor-v1.2.4-windows-x64-resources.neu', url: 'neu' },
      { name: 'Wikifactory-Editor-v1.2.4-android-release.apk', url: 'apk' },
    ],
  };
  assert.equal(releaseAsset(release, '-resources.neu').url, 'neu');
  assert.equal(releaseAsset(release, '-android-release.apk').url, 'apk');
  assert.equal(releaseAsset(release, '-web.zip'), null);
  assert.equal(releaseAsset(null, '-web.zip'), null);
});

test('update mode 0 auto-downloads, 1 prompts, 2 stays quiet', () => {
  const base = { latest: '1.3.0', current: '1.2.4', platform: 'desktop' };
  assert.equal(planUpdate({ ...base, mode: 0 }), 'auto');
  assert.equal(planUpdate({ ...base, mode: 1 }), 'prompt');
  assert.equal(planUpdate({ ...base, mode: 2 }), 'skip');
});

test('manual checks bypass mode 2 but still respect the version', () => {
  const base = { manual: true, latest: '1.3.0', current: '1.2.4', platform: 'android' };
  assert.equal(planUpdate({ ...base, mode: 2 }), 'prompt');
  assert.equal(planUpdate({ ...base, latest: '1.2.4' }), 'none');
  assert.equal(planUpdate({ ...base, latest: '' }), 'none');
  assert.equal(planUpdate({ ...base, latest: '1.2.3' }), 'none');
});

test('unknown modes behave like prompt mode', () => {
  const base = { manual: false, latest: '1.3.0', current: '1.2.4', platform: 'web' };
  assert.equal(planUpdate({ ...base, mode: undefined }), 'prompt');
  assert.equal(planUpdate({ ...base, mode: 9 }), 'prompt');
});
