/** Modal, toast and theme helpers. */

import { icon } from './icons.js';

const modalRoot = document.getElementById('modal-root');
const toastRegion = document.getElementById('toast-region');
let activeModal = null;
let lastFocus = null;

export function toast(message, type = 'info', timeout = 3200) {
  const node = document.createElement('div');
  node.className = `toast is-${type}`;
  node.setAttribute('role', 'status');
  node.setAttribute('aria-live', type === 'error' ? 'assertive' : 'polite');
  const iconName = type === 'success' ? 'check' : type === 'error' ? 'alert-circle' : 'info';
  node.innerHTML = `<span class="toast-icon">${icon(iconName)}</span><span>${escape(message)}</span>`;
  toastRegion.appendChild(node);
  const remove = () => {
    node.classList.add('is-leaving');
    setTimeout(() => node.remove(), 200);
  };
  const timer = setTimeout(remove, timeout);
  node.addEventListener('click', () => {
    clearTimeout(timer);
    remove();
  });
  return remove;
}

export function escape(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

/**
 * Open a modal.
 * @param {object} options
 * @param {string} options.title
 * @param {string} [options.subtitle]
 * @param {string|HTMLElement} options.body
 * @param {Array|string} [options.footer]
 * @param {'normal'|'wide'|'narrow'} [options.size]
 * @param {(modal: object) => void} [options.onMount]
 * @param {() => void} [options.onClose]
 */
export function openModal(options) {
  closeModal(true);
  lastFocus = document.activeElement;
  const {
    title = '',
    subtitle = '',
    body = '',
    footer = '',
    size = 'normal',
    onMount,
    onClose,
    dismissible = true,
  } = options;

  const wrapper = document.createElement('div');
  wrapper.className = `modal ${size === 'wide' ? 'is-wide' : size === 'narrow' ? 'is-narrow' : ''}`.trim();
  wrapper.setAttribute('role', 'dialog');
  wrapper.setAttribute('aria-modal', 'true');
  wrapper.setAttribute('aria-label', title);

  wrapper.innerHTML = `
    <div class="modal-head">
      <div class="modal-head-text">
        <h2 class="modal-title">${escape(title)}</h2>
        ${subtitle ? `<p class="modal-subtitle">${subtitle}</p>` : ''}
      </div>
      <button class="modal-close" type="button" aria-label="关闭">${icon('x')}</button>
    </div>
    <div class="modal-body"></div>
    <div class="modal-foot"></div>
  `;

  const bodyEl = wrapper.querySelector('.modal-body');
  if (body instanceof HTMLElement) bodyEl.appendChild(body);
  else bodyEl.innerHTML = body;

  const footEl = wrapper.querySelector('.modal-foot');
  if (Array.isArray(footer)) {
    for (const action of footer) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = `btn ${action.className || ''}`.trim();
      button.textContent = action.label;
      if (action.id) button.id = action.id;
      if (action.disabled) button.disabled = true;
      button.addEventListener('click', async () => {
        if (action.onClick) await action.onClick(api);
      });
      footEl.appendChild(button);
    }
    if (footer.length === 0) footEl.remove();
  } else if (typeof footer === 'string' && footer.trim()) {
    footEl.innerHTML = footer;
  } else {
    footEl.remove();
  }

  modalRoot.innerHTML = '';
  modalRoot.appendChild(wrapper);
  modalRoot.hidden = false;
  document.body.classList.add('modal-open');

  const close = () => closeModal();
  wrapper.querySelector('.modal-close').addEventListener('click', close);

  const api = {
    el: wrapper,
    body: bodyEl,
    foot: footEl,
    busy: false,
    close,
    setBusy(busy) {
      api.busy = Boolean(busy);
      for (const button of wrapper.querySelectorAll('.modal-foot .btn')) {
        button.disabled = api.busy;
      }
      // While a request is running, Esc / backdrop must not throw the work away.
      wrapper.querySelector('.modal-close').disabled = api.busy;
      wrapper.classList.toggle('is-busy', api.busy);
    },
  };

  activeModal = { wrapper, api, onClose, dismissible };
  setTimeout(() => {
    const target = wrapper.querySelector('[autofocus], input, textarea, select, button.btn-primary');
    if (target) target.focus();
  }, 30);

  if (onMount) onMount(api);
  return api;
}

function onKeydown(event) {
  if (!activeModal) return;
  if (event.key === 'Escape') {
    // Busy modals (PR creation, batch rename) keep Esc inert so a request is
    // never abandoned halfway.
    if (activeModal.api?.busy) return;
    event.preventDefault();
    closeModal();
  }
  if (event.key === 'Tab') {
    const focusables = activeModal.wrapper.querySelectorAll(
      'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
    );
    if (focusables.length === 0) return;
    const first = focusables[0];
    const last = focusables[focusables.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }
}
document.addEventListener('keydown', onKeydown);
modalRoot.addEventListener('click', (event) => {
  if (event.target !== modalRoot) return;
  if (!activeModal?.dismissible || activeModal.api?.busy) return;
  closeModal();
});

export function closeModal(immediate = false) {
  if (!activeModal) return;
  const { wrapper, onClose } = activeModal;
  activeModal = null;
  if (immediate) {
    wrapper.remove();
    modalRoot.hidden = true;
    document.body.classList.remove('modal-open');
  } else {
    wrapper.style.animation = 'fadeIn .12s reverse';
    setTimeout(() => {
      wrapper.remove();
      if (!modalRoot.children.length) {
        modalRoot.hidden = true;
        document.body.classList.remove('modal-open');
      }
    }, 110);
  }
  if (onClose) onClose();
  if (lastFocus && typeof lastFocus.focus === 'function') {
    setTimeout(() => lastFocus.focus(), 20);
  }
}

export function confirmDialog({ title, message, confirmText = '确定', cancelText = '取消', danger = false }) {
  return new Promise((resolve) => {
    const modal = openModal({
      title,
      body: `<p style="margin:0;font-size:13px;line-height:1.7;color:var(--text-soft)">${message}</p>`,
      size: 'narrow',
      footer: [
        {
          label: cancelText,
          className: 'btn-ghost',
          onClick: () => {
            resolve(false);
            modal.close();
          },
        },
        {
          label: confirmText,
          className: danger ? 'btn-danger' : 'btn-primary',
          onClick: () => {
            resolve(true);
            modal.close();
          },
        },
      ],
      onClose: () => resolve(false),
    });
  });
}

/* ------------------------------------------------------------------ theme */
const THEME_ORDER = ['auto', 'light', 'dark'];

export function effectiveTheme(theme) {
  if (theme === 'auto') {
    return window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
  }
  return theme;
}

export function applyTheme(theme) {
  const resolved = effectiveTheme(theme);
  document.documentElement.setAttribute('data-theme', resolved);
  const button = document.getElementById('btn-theme');
  if (button) {
    const iconName = theme === 'auto' ? 'contrast' : resolved === 'light' ? 'sun' : 'moon';
    button.innerHTML = icon(iconName);
    button.title = theme === 'auto' ? '主题：跟随系统' : theme === 'light' ? '主题：亮色' : '主题：暗色';
    button.setAttribute('aria-label', button.title);
  }
  const meta = document.querySelector('meta[name="color-scheme"]');
  if (meta) meta.setAttribute('content', resolved === 'dark' ? 'dark light' : 'light dark');
}

export function nextTheme(current) {
  const index = THEME_ORDER.indexOf(current);
  return THEME_ORDER[(index + 1) % THEME_ORDER.length];
}

export function initThemeWatcher(getTheme) {
  const media = window.matchMedia('(prefers-color-scheme: light)');
  const handler = () => {
    if (getTheme() === 'auto') applyTheme('auto');
  };
  if (media.addEventListener) media.addEventListener('change', handler);
  else media.addListener(handler);
}
