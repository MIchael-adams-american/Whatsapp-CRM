/** Tiny DOM helpers — keeps view code readable without a framework. */

export const $ = (selector, root = document) => root.querySelector(selector);
export const $$ = (selector, root = document) => Array.from(root.querySelectorAll(selector));

/**
 * Create an element.
 *   el('div', { class: 'x', onclick: fn }, [child, 'text'])
 * Attributes are set as properties where it matters (checked, value, ...).
 */
export function el(tag, attrs = {}, children = []) {
  const node = document.createElement(tag);
  applyAttrs(node, attrs);
  append(node, children);
  return node;
}

function applyAttrs(node, attrs) {
  for (const [key, value] of Object.entries(attrs || {})) {
    if (value === null || value === undefined || value === false) continue;
    if (key === 'class' || key === 'className') node.className = value;
    else if (key === 'html') node.innerHTML = value;
    else if (key === 'text') node.textContent = value;
    else if (key === 'style' && typeof value === 'object') Object.assign(node.style, value);
    else if (key === 'dataset' && typeof value === 'object') Object.assign(node.dataset, value);
    else if (key.startsWith('on') && typeof value === 'function') node.addEventListener(key.slice(2).toLowerCase(), value);
    else if (key in node && key !== 'list' && key !== 'type' && typeof value !== 'object') {
      try { node[key] = value; } catch { node.setAttribute(key, String(value)); }
    } else {
      node.setAttribute(key, String(value));
    }
  }
}

function append(node, children) {
  const list = Array.isArray(children) ? children : [children];
  for (const child of list) {
    if (child === null || child === undefined || child === false) continue;
    if (child instanceof Node) node.appendChild(child);
    else node.appendChild(document.createTextNode(String(child)));
  }
}

/** Parse an HTML string into a single element (first child of a template). */
export function fromHTML(htmlString) {
  const template = document.createElement('template');
  template.innerHTML = String(htmlString).trim();
  return template.content.firstElementChild;
}

/** Replace all children of a node with new content. */
export function render(root, content) {
  if (!root) return;
  root.textContent = '';
  append(root, content);
  return root;
}

export function clear(root) {
  if (root) root.textContent = '';
  return root;
}

export function show(node, visible = true) {
  if (!node) return;
  if (visible) node.removeAttribute('hidden');
  else node.setAttribute('hidden', '');
}

export function setText(node, text) {
  if (node) node.textContent = text === null || text === undefined ? '' : String(text);
}

export function setHTML(node, html) {
  if (node) node.innerHTML = html;
}

/** Event delegation helper. */
export function delegate(root, eventName, selector, handler) {
  if (!root) return () => {};
  const listener = (event) => {
    const target = event.target instanceof Element ? event.target.closest(selector) : null;
    if (target && root.contains(target)) handler(event, target);
  };
  root.addEventListener(eventName, listener);
  return () => root.removeEventListener(eventName, listener);
}

/**
 * Global click delegation for [data-action] buttons.
 * Actions map: { 'name': (event, element) => void }
 */
export function wireActions(root, actions) {
  return delegate(root, 'click', '[data-action]', (event, target) => {
    const name = target.dataset.action;
    const handler = actions[name];
    if (!handler) return;
    if (target.tagName === 'A' || target.closest('button[type="submit"]')) event.preventDefault();
    if (target.tagName === 'BUTTON' && !target.type) event.preventDefault();
    handler(event, target);
  });
}

export function focusFirst(root, selector = 'input:not([type="hidden"]), select, textarea, button') {
  const node = root && root.querySelector(selector);
  if (node) {
    try { node.focus(); } catch { /* ignore */ }
  }
}

/** Basic focus trap for modals/drawers. */
export function trapFocus(container) {
  const handler = (event) => {
    if (event.key !== 'Tab') return;
    const focusables = $$(
      'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
      container,
    ).filter((node) => node.offsetParent !== null || node === document.activeElement);
    if (!focusables.length) return;
    const first = focusables[0];
    const last = focusables[focusables.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };
  container.addEventListener('keydown', handler);
  return () => container.removeEventListener('keydown', handler);
}

export function scrollLock(on) {
  document.body.style.overflow = on ? 'hidden' : '';
}

export function isMobileViewport() {
  return window.matchMedia('(max-width: 760px)').matches;
}
