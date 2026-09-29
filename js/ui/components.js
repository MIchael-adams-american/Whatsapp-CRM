/**
 * Shared presentational components.
 * Every function returns a DOM node — no innerHTML with user data anywhere.
 */

import { el, clear } from '../lib/dom.js';
import { escapeRegExp, whatsappLink, telLink, mailtoLink, initials } from '../lib/utils.js';
import { formatDate, relativeDayLabel, shortDistanceLabel, formatDateTime, daysFromToday } from '../lib/date.js';
import { STATUS_TONE, INTEREST_TONE } from '../config.js';
import { followUpState, isClosed } from '../domain/followup.js';
import { computePriority } from '../domain/priority.js';

/* --------------------------------------------------------------- icons -- */

export function icon(name, cls = 'icon') {
  return el('svg', { class: cls, 'aria-hidden': 'true' }, [el('use', { href: `#${name}` })]);
}

/* -------------------------------------------------------------- badges -- */

export function badge(text, tone = 'grey', extraClass = '') {
  return el('span', { class: `badge badge--${tone} ${extraClass}`.trim(), text });
}

export function statusBadge(status) {
  return badge(status || 'New', STATUS_TONE[status] || 'grey', 'badge--dot');
}

export function interestBadge(interest) {
  const icons = { Hot: '🔥 ', Warm: '🌤 ', Cold: '❄️ ' };
  return badge(`${icons[interest] || ''}${interest || 'Cold'}`, INTEREST_TONE[interest] || 'grey');
}

export function priorityBadge(priority, { showScore = true, showReason = false } = {}) {
  const toneMap = { red: 'red', orange: 'orange', blue: 'blue', green: 'green', grey: 'outline' };
  const node = badge(
    `${priority.label}${showScore ? ` · ${priority.score}` : ''}`,
    toneMap[priority.tone] || 'outline',
    'priority-pill',
  );
  if (showReason && priority.reasons?.length) node.title = priority.reasons.join(' · ');
  return node;
}

/** Coloured follow-up chip: 🔴 Overdue by 3 days / 🟠 Due today / 🟢 Upcoming. */
export function followUpBadge(lead, now = new Date()) {
  const state = followUpState(lead, now);
  if (state.bucket === 'none') {
    return badge('No follow-up', 'outline');
  }
  const toneMap = { red: 'red', orange: 'orange', green: 'green' };
  const dot = state.bucket === 'overdue' ? '🔴 ' : state.bucket === 'today' ? '🟠 ' : '🟢 ';
  return badge(`${dot}${state.short}`, toneMap[state.tone] || 'outline');
}

export function followUpText(lead, now = new Date()) {
  const state = followUpState(lead, now);
  if (state.bucket === 'none') return el('span', { class: 'muted', text: 'Not scheduled' });
  const tone = state.tone === 'red' ? 'var(--red)' : state.tone === 'orange' ? 'var(--orange)' : 'var(--green-dark)';
  return el('span', { style: { color: tone, fontWeight: '600' }, text: formatDate(state.dueISO) });
}

/* ----------------------------------------------------------- stat tile -- */

export function statTile({ value, label, hint = '', tone = '', iconName = '', onClick = null, title = '' }) {
  const attrs = {
    class: `stat ${tone ? `stat--${tone}` : ''}`.trim(),
    title: title || hint || label,
  };
  const node = onClick ? el('button', { ...attrs, type: 'button', onclick: onClick }) : el('div', attrs);
  node.appendChild(el('span', { class: 'stat__value', text: String(value) }));
  node.appendChild(el('span', { class: 'stat__label', text: label }));
  if (hint) node.appendChild(el('span', { class: 'stat__hint', text: hint }));
  if (iconName) node.appendChild(icon(iconName, 'icon stat__icon'));
  return node;
}

/* ------------------------------------------------------------ insights -- */

const SEVERITY_TONE = { red: 'red', orange: 'orange', flame: 'flame', green: 'green', blue: 'blue', info: 'info' };

/** Clickable notification / insight row. */
export function insightRow(notification, onOpen) {
  const row = el('button', {
    class: `insight insight--${SEVERITY_TONE[notification.severity] || 'info'}`,
    type: 'button',
    onclick: () => onOpen(notification),
  }, [
    el('span', { class: 'insight__emoji', 'aria-hidden': 'true', text: notification.icon || '💡' }),
    el('span', { class: 'insight__body' }, [
      el('span', { class: 'insight__title', text: notification.title }),
      notification.detail ? el('span', { class: 'insight__detail', text: notification.detail }) : null,
    ]),
    icon('i-chevron-right', 'icon insight__go'),
  ]);
  return row;
}

export function insightCard(notification, { onOpen = null, onAction = null } = {}) {
  const card = el('div', { class: `insight-card insight-card--${SEVERITY_TONE[notification.severity] || 'info'}` }, [
    el('span', { class: 'insight__emoji', 'aria-hidden': 'true', text: notification.icon || '💡' }),
    el('div', { class: 'grow' }, [
      el('h3', { text: notification.title }),
      notification.detail ? el('p', { class: 'small', style: { margin: '6px 0 0', color: 'var(--ink-2)' }, text: notification.detail }) : null,
      (notification.cta || notification.actions?.length) ? el('div', { class: 'btn-group', style: { marginTop: '10px' } }, [
        notification.cta && onOpen ? el('button', {
          class: 'btn btn--sm btn--primary',
          type: 'button',
          text: notification.cta,
          onclick: () => onOpen(notification),
        }) : null,
        ...(notification.actions || []).map((action) => el('button', {
          class: 'btn btn--sm btn--outline',
          type: 'button',
          text: action.label,
          onclick: () => onAction?.(notification, action),
        })),
      ]) : null,
    ]),
  ]);
  return card;
}

/* ------------------------------------------------------------- charts -- */

export function distributionBars(rows, { total = null, tone = 'green', suffix = '' } = {}) {
  const max = total || Math.max(1, ...rows.map((r) => r.count));
  const wrap = el('div', { class: 'bars' });
  for (const row of rows) {
    wrap.appendChild(el('div', { class: 'bars__row' }, [
      el('span', { class: 'truncate', title: row.name, text: row.name }),
      el('span', { class: `bar ${tone === 'red' ? 'bar--red' : tone === 'orange' ? 'bar--orange' : ''}` }, [
        el('span', { style: { width: `${Math.max(4, Math.round((row.count / max) * 100))}%` } }),
      ]),
      el('span', { class: 'nowrap muted', text: `${row.count}${suffix}` }),
    ]));
  }
  return wrap;
}

/* ----------------------------------------------------------- lead rows -- */

export const LEAD_COLUMNS = [
  { id: 'name', label: 'Lead', always: true },
  { id: 'contact', label: 'Phone / WhatsApp', always: true },
  { id: 'course', label: 'Course', always: true },
  { id: 'city', label: 'City' },
  { id: 'email', label: 'Email' },
  { id: 'source', label: 'Source' },
  { id: 'status', label: 'Status', always: true },
  { id: 'interest', label: 'Interest' },
  { id: 'priority', label: 'Priority', always: true },
  { id: 'lastContact', label: 'Last Contact' },
  { id: 'nextFollowUp', label: 'Next Follow-up', always: true },
  { id: 'assignedTo', label: 'Assigned To' },
  { id: 'followUpCount', label: 'Follow-ups' },
  { id: 'lastResponse', label: 'Last Response' },
];

export const DEFAULT_COLUMNS = ['name', 'contact', 'course', 'status', 'priority', 'lastContact', 'nextFollowUp'];

const COLUMN_SIZES = {
  name: 'minmax(150px, 1.3fr)',
  contact: 'minmax(130px, 1fr)',
  course: 'minmax(150px, 1.2fr)',
  city: 'minmax(80px, .7fr)',
  email: 'minmax(140px, 1fr)',
  source: 'minmax(90px, .7fr)',
  status: 'minmax(105px, .8fr)',
  interest: 'minmax(90px, .7fr)',
  priority: 'minmax(110px, .8fr)',
  lastContact: 'minmax(90px, .7fr)',
  nextFollowUp: 'minmax(110px, .8fr)',
  assignedTo: 'minmax(100px, .8fr)',
  followUpCount: 'minmax(70px, .5fr)',
  lastResponse: 'minmax(120px, 1fr)',
};

function cell(label, content, extraClass = '', { secondary = false } = {}) {
  const node = el('div', { class: `cell ${extraClass} ${secondary ? 'cell--secondary' : ''}`.trim() }, [
    label ? el('span', { class: 'cell__sub cell-label', text: label }) : null,
    typeof content === 'string' ? el('span', { text: content }) : content,
  ]);
  return node;
}

/** One row of the desktop lead table. */
export function leadRow(lead, { columns = DEFAULT_COLUMNS, priority = null, now = new Date(), onOpen, highlight = '' } = {}) {
  const p = priority || computePriority(lead, now);
  const state = followUpState(lead, now);
  const rowClass = [
    'lead-table__row',
    state.bucket === 'overdue' ? 'is-overdue' : '',
    state.bucket === 'today' ? 'is-today' : '',
    !isClosed(lead) && (lead.interest === 'Hot' || lead.status === 'Hot') ? 'is-hot' : '',
  ].filter(Boolean).join(' ');

  const row = el('div', {
    class: rowClass,
    style: { gridTemplateColumns: columns.map((c) => COLUMN_SIZES[c] || '1fr').join(' ') + ' 96px' },
    onclick: (event) => {
      if (event.target.closest('a, button')) return;
      onOpen?.(lead);
    },
  });

  const nameCell = el('div', { class: 'cell cell--name' }, [
    highlight ? highlightText(lead.name, highlight) : el('span', { text: lead.name }),
    lead.assignedTo ? el('span', { class: 'cell__sub', text: lead.assignedTo }) : null,
  ]);

  for (const col of columns) {
    switch (col) {
      case 'name':
        row.appendChild(nameCell);
        break;
      case 'contact': {
        const links = el('div', { class: 'row', style: { gap: '8px' } });
        if (lead.phone || lead.whatsapp) {
          links.appendChild(el('a', {
            href: telLink(lead.phone || lead.whatsapp),
            class: 'small nowrap',
            text: lead.phone || lead.whatsapp,
            title: 'Call',
          }));
        }
        if (lead.whatsapp) {
          links.appendChild(el('a', {
            href: whatsappLink(lead.whatsapp, '', ''),
            target: '_blank',
            rel: 'noopener',
            class: 'small nowrap',
            text: 'WhatsApp',
            title: 'Open WhatsApp',
          }));
        }
        if (!lead.phone && !lead.whatsapp) links.appendChild(el('span', { class: 'muted small', text: '—' }));
        row.appendChild(cell('', links));
        break;
      }
      case 'course':
        row.appendChild(cell('', el('span', { class: 'truncate', title: lead.course || '', text: lead.course || '—' })));
        break;
      case 'city':
        row.appendChild(cell('', lead.city || '—', '', { secondary: true }));
        break;
      case 'email':
        row.appendChild(cell('', lead.email
          ? el('a', { href: mailtoLink(lead.email), class: 'truncate small', text: lead.email })
          : el('span', { class: 'muted', text: '—' }), '', { secondary: true }));
        break;
      case 'source':
        row.appendChild(cell('', lead.source || '—', '', { secondary: true }));
        break;
      case 'status':
        row.appendChild(cell('', statusBadge(lead.status)));
        break;
      case 'interest':
        row.appendChild(cell('', interestBadge(lead.interest), '', { secondary: true }));
        break;
      case 'priority':
        row.appendChild(cell('', priorityBadge(p, { showReason: true })));
        break;
      case 'lastContact':
        row.appendChild(cell('', lastContactCell(lead, now), '', { secondary: true }));
        break;
      case 'nextFollowUp':
        row.appendChild(cell('', followUpCell(lead, now)));
        break;
      case 'assignedTo':
        row.appendChild(cell('', lead.assignedTo || '—', '', { secondary: true }));
        break;
      case 'followUpCount':
        row.appendChild(cell('', String(lead.followUpCount ?? 0), '', { secondary: true }));
        break;
      case 'lastResponse':
        row.appendChild(cell('', lead.lastResponse || '—', '', { secondary: true }));
        break;
      default:
        row.appendChild(cell('', ''));
    }
  }

  row.appendChild(el('div', { class: 'cell cell--actions' }, [
    actionLink('i-chat', lead.whatsapp || lead.phone, 'WhatsApp', () => whatsappLink(lead.whatsapp || lead.phone), true),
    actionLink('i-phone', lead.phone || lead.whatsapp, 'Call', () => telLink(lead.phone || lead.whatsapp)),
    el('button', {
      class: 'row-action',
      type: 'button',
      title: 'Open lead profile',
      'aria-label': `Open ${lead.name}`,
      onclick: () => onOpen?.(lead),
    }, [icon('i-chevron-right')]),
  ]));

  return row;
}

function actionLink(iconName, value, label, hrefFn, external = false) {
  const href = value ? hrefFn() : '';
  if (!href) {
    return el('button', { class: 'row-action', type: 'button', disabled: true, title: `No ${label.toLowerCase()} number`, 'aria-label': label }, [icon(iconName)]);
  }
  const attrs = {
    class: `row-action ${label === 'WhatsApp' ? 'row-action--wa' : ''}`,
    href,
    title: label,
    'aria-label': `${label} ${label === 'Call' ? '' : 'message'}`.trim(),
  };
  if (external) {
    attrs.target = '_blank';
    attrs.rel = 'noopener';
  }
  return el('a', attrs, [icon(iconName)]);
}

function lastContactCell(lead, now) {
  if (!lead.lastContact) return el('span', { class: 'muted', text: 'Never' });
  const diff = daysFromToday(lead.lastContact, now);
  const stale = diff !== null && diff <= -7;
  return el('span', { title: formatDate(lead.lastContact), style: stale ? { color: 'var(--red)', fontWeight: '600' } : null },
    [relativeDayLabel(lead.lastContact, now)]);
}

function followUpCell(lead, now) {
  const state = followUpState(lead, now);
  if (state.bucket === 'none') return el('span', { class: 'muted', text: 'Not scheduled' });
  const tone = state.tone === 'red' ? 'var(--red)' : state.tone === 'orange' ? 'var(--orange)' : 'var(--green-dark)';
  return el('span', { style: { color: tone, fontWeight: '600' }, title: formatDate(state.dueISO) }, [
    el('span', { text: state.short }),
    el('span', { class: 'cell__sub', text: formatDate(state.dueISO, 'short') }),
  ]);
}

/** Mobile card version of a lead (used on narrow screens). */
export function leadCard(lead, { priority = null, now = new Date(), onOpen } = {}) {
  const p = priority || computePriority(lead, now);
  const state = followUpState(lead, now);
  const cls = state.bucket === 'overdue' ? 'lead-card--overdue'
    : state.bucket === 'today' ? 'lead-card--today'
      : (lead.interest === 'Hot' || lead.status === 'Hot') ? 'lead-card--hot'
        : 'lead-card--upcoming';

  const card = el('div', { class: `lead-card ${cls}` }, [
    el('div', { class: 'lead-card__top' }, [
      el('div', { class: 'grow' }, [
        el('button', { class: 'name-link lead-card__name', type: 'button', text: lead.name, onclick: () => onOpen?.(lead) }),
        el('div', { class: 'row', style: { marginTop: '6px' } }, [
          statusBadge(lead.status),
          interestBadge(lead.interest),
          priorityBadge(p, { showScore: false }),
        ]),
      ]),
      followUpBadge(lead, now),
    ]),
    el('div', { class: 'lead-card__meta' }, [
      el('span', {}, [icon('i-sheet'), el('span', { text: lead.course || 'Course not specified' })]),
      el('span', {}, [icon('i-phone'), el('span', { text: lead.phone || lead.whatsapp || 'No number' })]),
      el('span', {}, [icon('i-clock'), el('span', { text: lead.lastContact ? `Last contact ${relativeDayLabel(lead.lastContact, now).toLowerCase()}` : 'Never contacted' })]),
      lead.city ? el('span', {}, [icon('i-user'), el('span', { text: lead.city })]): null,
    ]),
    el('div', { class: 'lead-card__foot' }, [
      el('button', { class: 'btn btn--sm btn--primary', type: 'button', text: 'Open', onclick: () => onOpen?.(lead) }),
      (lead.whatsapp || lead.phone) ? el('a', {
        class: 'btn btn--sm btn--outline',
        href: whatsappLink(lead.whatsapp || lead.phone),
        target: '_blank',
        rel: 'noopener',
        text: 'WhatsApp',
      }) : null,
      lead.phone || lead.whatsapp ? el('a', { class: 'btn btn--sm btn--outline', href: telLink(lead.phone || lead.whatsapp), text: 'Call' }) : null,
    ]),
  ]);
  return card;
}

function highlightText(text, query) {
  const source = String(text || '');
  if (!query) return el('span', { text: source });
  const span = el('span');
  const re = new RegExp(`(${escapeRegExp(query)})`, 'ig');
  const parts = source.split(re);
  for (const part of parts) {
    if (!part) continue;
    if (re.test(part) && part.toLowerCase() === String(query).toLowerCase()) {
      span.appendChild(el('mark', { text: part, style: { background: 'var(--green-soft)', color: 'inherit' } }));
    } else {
      span.appendChild(document.createTextNode(part));
    }
  }
  return span;
}

export { cell as leadCell, highlightText, actionLink };

/* ------------------------------------------------------------- tables -- */

/** Lead list: table on desktop, cards on mobile. */
export function leadsList(leads, {
  columns = DEFAULT_COLUMNS,
  now = new Date(),
  onOpen,
  priorityFor = null,
  highlight = '',
  sort = 'priority',
  onSort = null,
} = {}) {
  const wrap = el('div');
  if (!leads.length) return wrap;

  const table = el('div', { class: 'table-wrap lead-table' });
  const head = el('div', {
    class: 'lead-table__head',
    style: { gridTemplateColumns: columns.map((c) => COLUMN_SIZES[c] || '1fr').join(' ') + ' 96px' },
  });
  for (const col of columns) {
    const def = LEAD_COLUMNS.find((c) => c.id === col);
    const label = def ? def.label : col;
    head.appendChild(el('button', {
      type: 'button',
      text: label,
      title: onSort ? `Sort by ${label}` : undefined,
      onclick: onSort ? () => onSort(col) : undefined,
    }));
  }
  head.appendChild(el('span', { class: 'sr-only', text: 'Actions' }));
  table.appendChild(head);

  for (const lead of leads) {
    table.appendChild(leadRow(lead, {
      columns,
      now,
      onOpen,
      highlight,
      priority: priorityFor ? priorityFor(lead) : null,
    }));
  }
  wrap.appendChild(table);

  const cards = el('div', { class: 'lead-cards mobile-only' });
  for (const lead of leads) {
    cards.appendChild(leadCard(lead, { now, onOpen, priority: priorityFor ? priorityFor(lead) : null }));
  }
  wrap.appendChild(cards);
  return wrap;
}

/** Compact follow-up list item (calendar day view, dashboard lists). */
export function followUpItem(lead, { now = new Date(), onOpen, priority = null } = {}) {
  const state = followUpState(lead, now);
  const p = priority || computePriority(lead, now);
  return el('button', { class: 'fu-item', type: 'button', onclick: () => onOpen?.(lead) }, [
    el('span', { class: 'fu-item__when' }, [
      followUpBadge(lead, now),
    ]),
    el('span', { class: 'fu-item__main' }, [
      el('span', { class: 'row', style: { gap: '8px' } }, [
        el('strong', { text: lead.name }),
        statusBadge(lead.status),
        lead.interest === 'Hot' ? interestBadge('Hot') : null,
      ]),
      el('span', { class: 'cell__sub', text: [lead.course, lead.city, lead.phone || lead.whatsapp].filter(Boolean).join(' · ') || 'No contact details' }),
    ]),
    el('span', { class: 'nowrap' }, [priorityBadge(p, { showScore: false })]),
  ]);
}

/* ----------------------------------------------------------- timeline -- */

const TIMELINE_META = {
  created: { icon: 'i-plus', tone: 'green', label: 'Lead created' },
  imported: { icon: 'i-sheet', tone: 'blue', label: 'Imported' },
  call_made: { icon: 'i-phone', tone: 'green', label: 'Call made' },
  message_sent: { icon: 'i-chat', tone: 'green', label: 'Message sent' },
  follow_up_scheduled: { icon: 'i-calendar', tone: 'orange', label: 'Follow-up scheduled' },
  replied: { icon: 'i-check', tone: 'green', label: 'Lead replied' },
  status_changed: { icon: 'i-refresh', tone: 'blue', label: 'Status changed' },
  note_added: { icon: 'i-edit', tone: 'blue', label: 'Note added' },
  ai_message: { icon: 'i-wand', tone: 'green', label: 'AI message generated' },
  ai_analysis: { icon: 'i-sparkles', tone: 'blue', label: 'AI analysis' },
  sync: { icon: 'i-sync', tone: 'blue', label: 'Sheet sync' },
  note: { icon: 'i-edit', tone: 'blue', label: 'Note' },
};

export function timelineList(timeline = []) {
  const sorted = [...timeline].sort((a, b) => String(b.at).localeCompare(String(a.at)));
  const list = el('ul', { class: 'timeline' });
  for (const entry of sorted.slice(0, 40)) {
    const meta = TIMELINE_META[entry.type] || TIMELINE_META.note;
    list.appendChild(el('li', { class: `is-${meta.tone}` }, [
      el('div', { class: 'row', style: { gap: '6px' } }, [
        icon(meta.icon, 'icon'),
        el('span', { class: 'timeline__text', text: entry.text || meta.label }),
      ]),
      el('div', { class: 'timeline__time', text: `${meta.label} · ${formatDateTime(entry.at)}` }),
    ]));
  }
  return list;
}

export function noteItem(note) {
  return el('div', { class: 'note' }, [
    el('div', { class: 'note__body', text: note.text }),
    el('div', { class: 'note__meta' }, [
      el('span', { text: formatDateTime(note.at) }),
      note.author ? el('span', { text: note.author }) : null,
    ]),
  ]);
}

/* --------------------------------------------------------------- misc -- */

export function avatar(name) {
  return el('span', {
    class: 'brand-mark',
    style: { width: '34px', height: '34px', fontSize: '.84rem', borderRadius: '50%' },
    'aria-hidden': 'true',
    text: initials(name),
  });
}

export function aiSourceNote(result) {
  if (!result) return null;
  const map = {
    gemini: { text: 'Generated by Gemini', tone: 'green' },
    cache: { text: 'From AI cache (data unchanged)', tone: 'outline' },
    local: { text: 'Built-in suggestions (AI not used)', tone: 'outline' },
  };
  const info = map[result.source] || map.local;
  const bits = [badge(info.text, info.tone)];
  if (result.error?.friendly) bits.push(el('span', { class: 'small muted', text: result.error.friendly }));
  return el('div', { class: 'row', style: { gap: '8px' } }, bits);
}

export function copyButton(getText, { label = 'Copy Message', onCopied = null, class: cls = 'btn btn--outline btn--sm' } = {}) {
  return el('button', {
    class: cls,
    type: 'button',
    onclick: async (event) => {
      const button = event.currentTarget;
      const text = typeof getText === 'function' ? await getText() : getText;
      const { copyToClipboard } = await import('../lib/utils.js');
      const ok = await copyToClipboard(text);
      const original = button.textContent;
      button.textContent = ok ? 'Copied ✓' : 'Select and copy';
      button.disabled = true;
      if (ok && onCopied) onCopied();
      setTimeout(() => { button.textContent = original; button.disabled = false; }, 1600);
    },
  }, [icon('i-copy'), el('span', { text: label })]);
}

export { clear };
