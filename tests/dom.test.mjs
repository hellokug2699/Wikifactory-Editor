import { test } from 'node:test';
import assert from 'node:assert/strict';
import { h, raw } from '../app/assets/js/dom.js';
import { Window } from 'happy-dom';

const window = new Window();
globalThis.document = window.document;

test('h() escapes interpolated values', () => {
  const node = h`<div class="x" title="${'a"b'}">${'<script>'}</div>`;
  assert.equal(node.tagName, 'DIV');
  assert.equal(node.getAttribute('title'), 'a"b');
  assert.equal(node.textContent, '<script>');
  assert.equal(node.querySelectorAll('script').length, 0);
});

test('h() supports nodes, arrays and raw()', () => {
  const child = document.createElement('span');
  child.textContent = 'child';
  const node = h`<div>${child}${[1, 2]}${raw('<b>bold</b>')}</div>`;
  assert.equal(node.querySelector('span').textContent, 'child');
  assert.equal(node.textContent, 'child12bold');
  assert.equal(node.querySelector('b').textContent, 'bold');
});

test('h() skips null / false values', () => {
  const node = h`<p>${null}${false}${undefined}ok</p>`;
  assert.equal(node.textContent, 'ok');
});
