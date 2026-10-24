import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Window } from 'happy-dom';
import { DICTIONARIES, LANGS, applyI18n, currentLang, setLang, t, tOr } from '../app/assets/js/i18n.js';

test('every key exists in both languages', () => {
  const zhKeys = Object.keys(DICTIONARIES.zh).sort();
  const enKeys = Object.keys(DICTIONARIES.en).sort();
  assert.deepEqual(enKeys, zhKeys);
  for (const key of zhKeys) {
    assert.ok(DICTIONARIES.zh[key].trim(), `${key} empty zh`);
    assert.ok(DICTIONARIES.en[key].trim(), `${key} empty en`);
  }
});

test('t() switches language and falls back to zh', () => {
  assert.equal(setLang('en'), 'en');
  assert.equal(t('nav.preview'), 'Preview');
  assert.equal(setLang('zh'), 'zh');
  assert.equal(t('nav.preview'), '预览');
  assert.equal(setLang('de'), 'zh');
  assert.equal(currentLang(), 'zh');
  assert.equal(t('missing.key'), '');
  assert.equal(tOr('missing.key', '回退'), '回退');
  assert.equal(tOr('nav.preview', '回退'), '预览');
});

test('LANGS lists both languages', () => {
  assert.deepEqual(
    LANGS.map((lang) => lang.value),
    ['zh', 'en'],
  );
});

test('applyI18n fills text and attributes', () => {
  setLang('en');
  const window = new Window();
  const host = window.document.createElement('div');
  host.innerHTML = `<button id="a" data-i18n="nav.preview" data-i18n-title="nav.previewTitle">预览</button>
    <span data-i18n="side.load">加载</span>`;
  applyI18n(host);
  assert.equal(host.querySelector('#a').textContent, 'Preview');
  assert.equal(host.querySelector('#a').getAttribute('title'), 'Preview page (Ctrl+Enter)');
  assert.equal(host.querySelector('span').textContent, 'Load');
  setLang('zh');
});
