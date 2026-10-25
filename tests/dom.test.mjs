import { test } from 'node:test';
import assert from 'node:assert/strict';
import { h, raw } from '../app/assets/js/dom.js';
import { Window } from 'happy-dom';

const window = new Window();
globalThis.window = window;
globalThis.document = window.document;
globalThis.requestAnimationFrame = (callback) => setTimeout(callback, 0);

// ui.js touches the document at import time, so load it after the globals exist.
document.body.innerHTML = '<div id="modal-root"></div><div id="toast-region"></div>';
const { hideTooltip, showTooltip } = await import('../app/assets/js/ui.js');

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

test('tapping a toolbar button shows a temporary tooltip', async () => {
  const anchor = document.createElement('button');
  document.body.appendChild(anchor);

  showTooltip(anchor, '粗体：插入 **** 并定位中间 (Ctrl+B)', 10);
  const node = document.querySelector('.click-tooltip');
  assert.ok(node, 'tooltip node should exist');
  assert.equal(node.textContent, '粗体：插入 **** 并定位中间 (Ctrl+B)');
  assert.equal(node.getAttribute('role'), 'tooltip');
  assert.ok(node.dataset.placement === 'top' || node.dataset.placement === 'bottom');

  // Auto-hide plus the fade-out removal.
  await new Promise((resolve) => setTimeout(resolve, 260));
  assert.equal(document.querySelector('.click-tooltip'), null);
});

test('hideTooltip removes an open tooltip immediately', async () => {
  const anchor = document.createElement('button');
  document.body.appendChild(anchor);
  showTooltip(anchor, '分隔线', 5000);
  assert.ok(document.querySelector('.click-tooltip'));
  hideTooltip();
  await new Promise((resolve) => setTimeout(resolve, 200));
  assert.equal(document.querySelector('.click-tooltip'), null);
});
