/**
 * UI primitives: toasts, modals, drawers, confirm/prompt dialogs.
 * Small, dependency-free and accessible (Esc to close, focus trapping, labels).
 */

import { el, $, clear, focusFirst, trapFocus, scrollLock } from '../lib/dom.js';

/* -------------------------------------------------------------- toasts -- */

const TOAST_ICON = { success: 'i-check', error: 'i-alert', warn: 'i-alert', info: 'i-sparkles' };

export function toast(message, { type = 'info', title = '', duration = 4200, action = null } = {}) {
  const root = $('#toast-root');
  if (!root) return () => {};

  const node = el('div', { class: `toast toast--${type}`, role: 'status' }, [
    el('svg', { class: 'icon', 'aria-hidden': 'true' }, [el('use', { href: `#${TOAST_ICON[type] || 'i-sparkles'}` })]),
    el('div', { class: 'grow' }, [
      title ? el('strong', { text: title }) : null,
      el('div', { text: message }),
      action ? el('button', {
        class: 'btn btn--xs btn--outline',
        type: 'button',
        style: { marginTop: '8px' },
        text: action.label,
        onclick: () => { action.onClick?.(); dismiss(); },
      }) : null,
    ]),
  ]);

  root.appendChild(node);
  const timer = duration > 0 ? setTimeout(dismiss, duration) : null;

  function dismiss() {
    if (timer) clearTimeout(timer);
    node.remove();
  }

  node.addEventListener('click', (event) => {
    if (event.target === node) dismiss();
  });

  return dismiss;
}

export const notify = {
  success: (msg, opts) => toast(msg, { ...opts, type: 'success' }),
  error: (msg, opts) => toast(msg, { ...opts, type: 'error', duration: 7000 }),
  warn: (msg, opts) => toast(msg, { ...opts, type: 'warn', duration: 6000 }),
  info: (msg, opts) => toast(msg, { ...opts, type: 'info' }),
};

/* -------------------------------------------------------------- modals -- */

const modalStack = [];

/**
 * Open a modal.
 * @returns {{close:Function, root:HTMLElement, setBusy:Function}}
 */
export function openModal({
  title = '',
  subtitle = '',
  body = null,
  footer = [],
  size = '',
  onClose = null,
  onSubmit = null,
  closeOnBackdrop = true,
  labelledBy = 'modal-title',
} = {}) {
  const root = $('#modal-root');
  if (!root) return null;

  const bodyNode = el('div', { class: 'modal__body' });
  if (body instanceof Node) bodyNode.appendChild(body);
  else if (typeof body === 'string') bodyNode.innerHTML = body;

  const footNode = el('div', { class: 'modal__foot' });
  const footButtons = [];
  for (const item of footer) {
    if (!item) continue;
    const btn = el('button', {
      class: item.class || 'btn btn--outline',
      type: item.type || 'button',
      text: item.label,
      onclick: async (event) => {
        if (item.onClick) await item.onClick(event, api);
        if (item.close !== false) api.close();
      },
    });
    footButtons.push(btn);
    footNode.appendChild(btn);
  }

  const modal = el('div', { class: `modal ${size}`.trim(), role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': labelledBy, tabindex: '-1' }, [
    el('div', { class: 'modal__head' }, [
      el('div', { class: 'grow' }, [
        el('h2', { id: labelledBy, text: title }),
        subtitle ? el('p', { class: 'muted small', text: subtitle, style: { margin: '4px 0 0' } }) : null,
      ]),
      el('button', {
        class: 'icon-btn icon-btn--sm',
        type: 'button',
        'aria-label': 'Close dialog',
        onclick: () => api.close(),
      }, [el('svg', { class: 'icon', 'aria-hidden': 'true' }, [el('use', { href: '#i-close' })])]),
    ]),
    bodyNode,
    footer.length ? footNode : null,
  ]);

  const backdrop = el('div', {
    class: 'modal-backdrop',
    onclick: (event) => { if (closeOnBackdrop && event.target === backdrop) api.close(); },
  }, [modal]);

  if (onSubmit) {
    modal.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
        event.preventDefault();
        onSubmit();
      }
    });
  }

  const releaseTrap = trapFocus(modal);
  const onKeyDown = (event) => {
    if (event.key === 'Escape' && modalStack[modalStack.length - 1]?.id === api.id) {
      event.stopPropagation();
      api.close();
    }
  };
  document.addEventListener('keydown', onKeyDown, true);

  root.appendChild(backdrop);
  scrollLock(true);

  const api = {
    id: `modal_${Math.random().toString(36).slice(2)}`,
    root: modal,
    body: bodyNode,
    footer: footNode,
    buttons: footButtons,
    setBusy(busy, label = 'Working…') {
      footButtons.forEach((btn) => { btn.disabled = busy; });
      const primary = footButtons[footButtons.length - 1];
      if (!primary) return;
      if (busy) {
        primary.dataset.label = primary.textContent;
        clear(primary);
        primary.appendChild(el('span', { class: 'spinner' }));
        primary.appendChild(el('span', { text: label }));
      } else if (primary.dataset.label) {
        primary.textContent = primary.dataset.label;
      }
    },
    close() {
      const index = modalStack.indexOf(api);
      if (index >= 0) modalStack.splice(index, 1);
      releaseTrap();
      document.removeEventListener('keydown', onKeyDown, true);
      backdrop.remove();
      if (!modalStack.length) scrollLock(false);
      if (onClose) onClose();
    },
  };

  modalStack.push(api);
  setTimeout(() => {
    const firstField = modal.querySelector('input:not([type="hidden"]):not([disabled]), textarea, select');
    if (firstField) firstField.focus();
    else modal.focus();
  }, 30);

  return api;
}

export function closeAllModals() {
  while (modalStack.length) modalStack[modalStack.length - 1].close();
}

/** Simple confirm dialog -> Promise<boolean>. */
export function confirmDialog({
  title = 'Are you sure?',
  message = '',
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  danger = false,
  details = '',
} = {}) {
  return new Promise((resolve) => {
    let settled = false;
    const body = el('div', {}, [
      message ? el('p', { text: message }) : null,
      details ? el('p', { class: 'muted small', text: details }) : null,
    ]);

    const modal = openModal({
      title,
      body,
      size: 'modal--sm',
      onClose: () => { if (!settled) { settled = true; resolve(false); } },
      footer: [
        { label: cancelLabel, class: 'btn btn--outline', onClick: () => { settled = true; resolve(false); } },
        {
          label: confirmLabel,
          class: danger ? 'btn btn--danger-solid' : 'btn btn--primary',
          onClick: () => { settled = true; resolve(true); },
        },
      ],
    });
    if (modal) focusFirst(modal.root, '.modal__foot button:last-child');
  });
}

/** Prompt dialog (single or multi-line) -> Promise<string|null>. */
export function promptDialog({
  title = 'Enter a value',
  label = '',
  value = '',
  placeholder = '',
  multiline = false,
  confirmLabel = 'Save',
  hint = '',
} = {}) {
  return new Promise((resolve) => {
    let settled = false;
    const input = multiline
      ? el('textarea', { placeholder, value })
      : el('input', { type: 'text', placeholder, value });

    const body = el('div', {}, [
      el('div', { class: 'field' }, [
        label ? el('label', { text: label }) : null,
        input,
        hint ? el('span', { class: 'field__hint', text: hint }) : null,
      ]),
    ]);

    const finish = (result) => {
      if (settled) return;
      settled = true;
      resolve(result);
    };

    openModal({
      title,
      body,
      size: 'modal--sm',
      onClose: () => finish(null),
      footer: [
        { label: 'Cancel', class: 'btn btn--outline', onClick: () => finish(null) },
        { label: confirmLabel, class: 'btn btn--primary', onClick: () => finish(input.value.trim() || null) },
      ],
    });
    setTimeout(() => { input.focus(); input.select?.(); }, 40);
  });
}

/* ------------------------------------------------------------- drawers -- */

let activeDrawer = null;

/**
 * Slide-in panel used for the Lead Profile (section 6) and record editors.
 * @returns {{close:Function, body:HTMLElement, root:HTMLElement}}
 */
export function openDrawer({ title = '', subtitle = '', content = null, footer = null, onClose = null } = {}) {
  const root = $('#drawer-root');
  if (!root) return null;
  closeDrawer();

  const bodyNode = el('div', { class: 'drawer__body' });
  if (content instanceof Node) bodyNode.appendChild(content);
  else if (typeof content === 'string') bodyNode.innerHTML = content;

  const drawer = el('aside', { class: 'drawer', role: 'dialog', 'aria-modal': 'true', 'aria-label': title, tabindex: '-1' }, [
    el('header', { class: 'drawer__head' }, [
      el('div', { class: 'grow' }, [
        el('h2', { text: title }),
        subtitle ? el('p', { class: 'muted small', style: { margin: '4px 0 0' } }, [subtitle]) : null,
      ]),
      el('button', {
        class: 'icon-btn',
        type: 'button',
        'aria-label': 'Close panel',
        onclick: () => closeDrawer(),
      }, [el('svg', { class: 'icon', 'aria-hidden': 'true' }, [el('use', { href: '#i-close' })])]),
    ]),
    bodyNode,
    footer || null,
  ]);

  const scrim = el('div', { class: 'scrim', onclick: () => closeDrawer() });
  root.appendChild(scrim);
  root.appendChild(drawer);
  document.body.classList.add('drawer-open');

  const releaseTrap = trapFocus(drawer);
  const onKey = (event) => { if (event.key === 'Escape') { event.stopPropagation(); closeDrawer(); } };
  document.addEventListener('keydown', onKey, true);
  setTimeout(() => drawer.focus(), 30);

  activeDrawer = {
    root: drawer,
    body: bodyNode,
    close: () => closeDrawer(),
    cleanup: () => {
      releaseTrap();
      document.removeEventListener('keydown', onKey, true);
    },
    onClose,
  };

  return activeDrawer;
}

export function closeDrawer() {
  const root = $('#drawer-root');
  if (!root || !activeDrawer) return;
  const { cleanup, onClose } = activeDrawer;
  activeDrawer = null;
  cleanup();
  clear(root);
  document.body.classList.remove('drawer-open');
  if (onClose) onClose();
}

export function drawerIsOpen() {
  return Boolean(activeDrawer);
}

/** Replace the drawer body (used when a lead is updated in place). */
export function updateDrawer({ title, subtitle, content }) {
  if (!activeDrawer) return;
  const head = activeDrawer.root.querySelector('.drawer__head');
  if (head) {
    const h2 = head.querySelector('h2');
    if (h2 && title) h2.textContent = title;
    const sub = head.querySelector('p');
    if (sub && subtitle !== undefined) clear(sub).appendChild(document.createTextNode(subtitle));
  }
  if (content) {
    clear(activeDrawer.body);
    if (content instanceof Node) activeDrawer.body.appendChild(content);
    else activeDrawer.body.innerHTML = content;
  }
}

export function drawerBody() {
  return activeDrawer ? activeDrawer.body : null;
}

/* ------------------------------------------------------- busy helpers -- */

/** Run an async action with a busy state on the button. */
export async function withBusy(button, label, fn) {
  if (!button) return fn();
  const original = button.innerHTML;
  button.disabled = true;
  button.setAttribute('aria-busy', 'true');
  clear(button);
  button.appendChild(el('span', { class: 'spinner' }));
  if (label) button.appendChild(el('span', { text: label }));
  try {
    return await fn();
  } finally {
    button.disabled = false;
    button.removeAttribute('aria-busy');
    button.innerHTML = original;
  }
}

/** Inline loading state for panels. */
export function loadingBlock(message = 'Loading…') {
  return el('div', { class: 'loading-block', 'aria-live': 'polite' }, [
    el('div', { class: 'skeleton skeleton--title' }),
    el('div', { class: 'skeleton-row' }, [
      el('div', { class: 'skeleton skeleton--card' }),
      el('div', { class: 'skeleton skeleton--card' }),
      el('div', { class: 'skeleton skeleton--card' }),
    ]),
    el('p', { class: 'muted center', text: message }),
  ]);
}

export function emptyState({ icon = '📋', title, message, actions = [] }) {
  const node = el('div', { class: 'empty' }, [
    el('span', { class: 'empty__icon', text: icon, 'aria-hidden': 'true' }),
    el('h3', { text: title }),
    message ? el('p', { text: message }) : null,
    actions.length ? el('div', { class: 'row', style: { justifyContent: 'center' } }, actions.map((a) => el('button', {
      class: a.class || 'btn btn--outline',
      type: 'button',
      text: a.label,
      onclick: a.onClick,
    }))) : null,
  ]);
  return node;
}

export function errorState({ title = 'Something went wrong', message = '', retry = null }) {
  return emptyState({
    icon: '⚠️',
    title,
    message,
    actions: retry ? [{ label: 'Try again', class: 'btn btn--primary', onClick: retry }] : [],
  });
}
