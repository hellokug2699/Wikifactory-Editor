import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  AGREEMENT_KEY,
  CC_LICENSE_NAME,
  CC_LICENSE_URL,
  hasAcceptedLicense,
  licenseNotices,
  rememberLicense,
} from '../app/assets/js/license-agreement.js';

function memoryStorage() {
  const map = new Map();
  return {
    failWrites: false,
    getItem: (key) => (map.has(key) ? map.get(key) : null),
    setItem(key, value) {
      if (this.failWrites) throw new Error('QuotaExceededError');
      map.set(key, String(value));
    },
    removeItem: (key) => map.delete(key),
  };
}

test('the agreement is off until this device remembers it', () => {
  const storage = memoryStorage();
  assert.equal(hasAcceptedLicense(storage), false);
  assert.equal(rememberLicense(storage), true);
  assert.equal(storage.getItem(AGREEMENT_KEY), 'yes');
  assert.equal(hasAcceptedLicense(storage), true);
});

test('a broken storage never blocks the editor', () => {
  const storage = memoryStorage();
  storage.failWrites = true;
  assert.equal(rememberLicense(storage), false);

  const throwing = {
    getItem() {
      throw new Error('denied');
    },
    setItem() {
      throw new Error('denied');
    },
  };
  assert.equal(hasAcceptedLicense(throwing), false);
  assert.equal(rememberLicense(throwing), false);
});

test('notice text keeps the license and the four obligations', () => {
  const notices = licenseNotices();
  assert.match(notices.intro, /CC BY-NC-SA 4\.0/);
  assert.equal(notices.points.length, 3);
  assert.match(notices.points[0], /其他网站/);
  assert.match(notices.points[0], /注释形式显式声明/);
  assert.match(notices.points[0], /独立许可协议/);
  assert.match(notices.points[1], /合并前/);
  assert.match(notices.points[1], /随时取消/);
  assert.match(notices.points[2], /合并后/);
  assert.match(notices.points[2], /无权要求本站删除/);
  assert.match(notices.remember, /仅当前设备/);
  assert.equal(notices.accept, '同意并继续');
  assert.ok(CC_LICENSE_URL.startsWith('https://creativecommons.org/'));
  assert.equal(CC_LICENSE_NAME, 'CC BY-NC-SA 4.0');
});
