// Small DOM helpers — no framework, no build step.

export function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (value == null || value === false) continue;
    if (key === 'class') el.className = value;
    else if (key === 'dataset') Object.assign(el.dataset, value);
    else if (key.startsWith('on') && typeof value === 'function') {
      el.addEventListener(key.slice(2).toLowerCase(), value);
    } else if (value === true) el.setAttribute(key, '');
    else el.setAttribute(key, value);
  }
  for (const child of children.flat(Infinity)) {
    if (child == null || child === false) continue;
    el.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return el;
}

// One visually-hidden aria-live="polite" region for the whole app. Deploy
// progress announcements route through it (build notes: "One aria-live
// region for the whole app; progress + toasts route through it").
export function announce(message) {
  const region = document.getElementById('announcer');
  if (!region || !message) return;
  // Clear first so repeated identical text still triggers a new announcement.
  region.textContent = '';
  // eslint-disable-next-line no-unused-expressions
  region.offsetHeight; // force reflow
  region.textContent = message;
}

export function toast(message, { error = false, ms = 3500 } = {}) {
  const region = document.getElementById(error ? 'toasts-alert' : 'toasts');
  const el = h('div', { class: `toast${error ? ' error' : ''}` }, message);
  region.append(el);
  setTimeout(() => el.remove(), ms);
}

export function badge(state, label) {
  const text = label || { pass: 'Pass', warn: 'Fix me', fail: 'Blocker', neutral: '—' }[state] || state;
  return h('span', { class: `badge ${state}` }, text);
}

// A Primer-style "Box": a bordered, radiused panel with a canvas-subtle
// header row (14px/600 title) and a padded body. `header` may be a plain
// string (wrapped in the default title markup) or a fully custom row Node
// when a section needs extra header content (badges, actions, counts).
export function box(id, header, ...body) {
  return h('section', { class: 'box', id },
    h('div', { class: 'box-header' },
      typeof header === 'string' ? h('h2', { class: 'box-title' }, header) : header
    ),
    h('div', { class: 'box-body' }, ...body)
  );
}

const SVG_NS = 'http://www.w3.org/2000/svg';
const STATUS_PATHS = {
  // octicon check-circle-fill
  pass: 'M8 16A8 8 0 1 0 8 0a8 8 0 0 0 0 16Zm3.78-9.72a.75.75 0 0 0-1.06-1.06L6.75 9.19 5.28 7.72a.75.75 0 0 0-1.06 1.06l2 2a.75.75 0 0 0 1.06 0l4.5-4.5Z',
  // octicon alert-fill
  warn: 'M6.457 1.047c.659-1.234 2.427-1.234 3.086 0l6.082 11.378A1.75 1.75 0 0 1 14.082 15H1.918a1.75 1.75 0 0 1-1.543-2.575Zm1.763.707a.25.25 0 0 0-.44 0L1.698 13.132a.25.25 0 0 0 .22.368h12.164a.25.25 0 0 0 .22-.368Zm.53 3.996v2.5a.75.75 0 0 1-1.5 0v-2.5a.75.75 0 0 1 1.5 0ZM9 11a1 1 0 1 1-2 0 1 1 0 0 1 2 0Z',
  // octicon x-circle-fill
  fail: 'M8 16A8 8 0 1 0 8 0a8 8 0 0 0 0 16ZM5.72 5.72a.75.75 0 0 1 1.06 0L8 6.94l1.22-1.22a.75.75 0 1 1 1.06 1.06L9.06 8l1.22 1.22a.75.75 0 1 1-1.06 1.06L8 9.06l-1.22 1.22a.75.75 0 0 1-1.06-1.06L6.94 8 5.72 6.78a.75.75 0 0 1 0-1.06Z',
  // octicon dash
  neutral: 'M2 7.75A.75.75 0 0 1 2.75 7h10.5a.75.75 0 0 1 0 1.5H2.75A.75.75 0 0 1 2 7.75Z',
};
const STATUS_LABELS = { pass: 'Pass', warn: 'Needs attention', fail: 'Blocker', neutral: 'Not checked' };

// Octicon-style inline status icon for checklist rows. The svg itself is
// aria-hidden (color alone isn't a reliable signal); a visually-hidden text
// label carries the same state to screen readers.
export function statusIcon(state) {
  const d = STATUS_PATHS[state] || STATUS_PATHS.neutral;
  const label = STATUS_LABELS[state] || state;
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', '0 0 16 16');
  svg.setAttribute('width', '16');
  svg.setAttribute('height', '16');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('class', `status-icon status-icon-${state}`);
  const path = document.createElementNS(SVG_NS, 'path');
  path.setAttribute('d', d);
  path.setAttribute('fill', 'currentColor');
  svg.append(path);
  return h('span', { class: 'status-icon-wrap' }, svg, h('span', { class: 'visually-hidden' }, label));
}

export async function copyText(text, successMessage = 'URL copied') {
  try {
    await navigator.clipboard.writeText(text);
    toast(successMessage);
    return true;
  } catch {
    toast('Could not copy — select the text manually', { error: true });
    return false;
  }
}

// CopyField / row copy button — flips to "Copied ✓" for 2s on success,
// per spec §c.4 and the CopyField component entry (§e).
export function copyButton(text, label = 'Copy') {
  let resetTimer = null;
  const btn = h('button', {
    class: 'ghost copy-btn',
    type: 'button',
    onclick: async () => {
      const ok = await copyText(text);
      if (!ok) return;
      clearTimeout(resetTimer);
      btn.textContent = 'Copied ✓';
      btn.classList.add('copied');
      resetTimer = setTimeout(() => {
        btn.textContent = label;
        btn.classList.remove('copied');
      }, 2000);
    },
  }, label);
  return btn;
}
