/**
 * Follow-ups page (sections 10, 23): bucket tabs + a month calendar where each
 * day shows how many follow-ups are due, with a drill-down list underneath.
 */

import { el, clear } from '../lib/dom.js';
import { notify, confirmDialog, withBusy } from '../ui/kit.js';
import { icon, followUpItem, statTile, badge } from '../ui/components.js';
import {
  MONTH_NAMES, formatDate, relativeDayLabel, todayISO, addDaysISO, monthGrid, daysFromToday, friendlyTimestamp,
} from '../lib/date.js';
import { countByBucket, leadsByBucket, followUpCountsByDate } from '../domain/followup.js';
import { rankLeads } from '../domain/priority.js';
import { currentLeads, scheduleBulkFollowUps, syncFromSheet } from '../services/actions.js';
import { store } from '../lib/store.js';
import { EVENTS, emit } from '../lib/bus.js';
import { openLeadProfile } from './lead-profile.js';
import { openLeadForm } from './lead-form.js';
import { goToLeads } from '../router.js';

const state = {
  preset: 'today',   // today | tomorrow | week | overdue | upcoming | none
  selectedDate: '',
  month: null,       // { year, month } — 1-based month
};

export function renderFollowUps(root, { query = {} } = {}) {
  const leads = currentLeads();
  const now = new Date();
  if (query.preset) state.preset = query.preset;
  if (query.date) { state.selectedDate = query.date; state.preset = 'date'; }
  if (!state.month) state.month = { year: now.getFullYear(), month: now.getMonth() + 1 };

  const wrap = el('div');
  wrap.appendChild(bucketTabs(leads, now));
  wrap.appendChild(calendarPanel(leads, now));
  wrap.appendChild(listPanel(leads, now));

  clear(root);
  root.appendChild(wrap);
}

/* ---------------------------------------------------------------- tabs -- */

function bucketTabs(leads, now) {
  const counts = countByBucket(leads, now);
  const tabs = [
    { id: 'today', label: 'Today', count: counts.today, tone: counts.today ? 'orange' : '' },
    { id: 'tomorrow', label: 'Tomorrow', count: counts.tomorrow, tone: '' },
    { id: 'week', label: 'This week', count: counts.week, tone: 'green' },
    { id: 'overdue', label: 'Overdue', count: counts.overdue, tone: counts.overdue ? 'red' : 'green' },
    { id: 'upcoming', label: 'Upcoming', count: counts.upcoming + counts.week, tone: '' },
    { id: 'none', label: 'No follow-up', count: counts.none, tone: counts.none ? 'orange' : '' },
  ];

  const grid = el('div', { class: 'grid grid--stats section' }, tabs.map((tab) => statTile({
    value: tab.count,
    label: tab.label,
    tone: tab.tone,
    hint: tab.id === 'none' ? 'Missing dates' : '',
    onClick: () => {
      state.preset = tab.id;
      state.selectedDate = '';
      emit(EVENTS.VIEW_REFRESH);
    },
    title: `Show ${tab.label.toLowerCase()} follow-ups`,
  })));

  // Highlight the active preset
  const active = grid.children[tabs.findIndex((t) => t.id === state.preset)];
  if (active) active.style.borderColor = 'var(--green)';

  return grid;
}

/* ------------------------------------------------------------ calendar -- */

function calendarPanel(leads, now) {
  const panel = el('section', { class: 'panel section' });
  const counts = followUpCountsByDate(leads, now);
  const { year, month } = state.month;

  panel.appendChild(el('div', { class: 'panel__head' }, [
    el('h2', {}, [icon('i-calendar'), el('span', { text: 'Follow-up calendar' })]),
    el('span', { class: 'spacer' }),
    el('button', {
      class: 'icon-btn icon-btn--sm',
      type: 'button',
      'aria-label': 'Previous month',
      onclick: () => { shiftMonth(-1); },
    }, [icon('i-chevron-left')]),
    el('strong', { text: `${MONTH_NAMES[month - 1]} ${year}`, style: { minWidth: '140px', textAlign: 'center' } }),
    el('button', {
      class: 'icon-btn icon-btn--sm',
      type: 'button',
      'aria-label': 'Next month',
      onclick: () => { shiftMonth(1); },
    }, [icon('i-chevron-right')]),
    el('button', {
      class: 'btn btn--xs btn--ghost',
      type: 'button',
      text: 'This month',
      onclick: () => { state.month = { year: new Date().getFullYear(), month: new Date().getMonth() + 1 }; emit(EVENTS.VIEW_REFRESH); },
    }),
  ]));

  const body = el('div', { class: 'panel__body' });
  const table = el('table', { class: 'calendar' });
  const thead = el('thead');
  thead.appendChild(el('tr', {}, ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((d) => el('th', { text: d }))));
  table.appendChild(thead);

  const tbody = el('tbody');
  for (const week of monthGrid(year, month)) {
    const tr = el('tr');
    for (const day of week) {
      const bucket = counts.get(day.iso);
      const isToday = day.iso === todayISO(now);
      const overdue = bucket && daysFromToday(day.iso, now) < 0;
      const selected = state.selectedDate === day.iso;
      const cell = el('td', {}, [
        el('button', {
          class: `calendar__day ${isToday ? 'is-today' : ''} ${selected ? 'is-selected' : ''} ${day.inMonth ? '' : 'is-outside'}`.trim(),
          type: 'button',
          title: bucket ? `${bucket.total} follow-up${bucket.total === 1 ? '' : 's'} on ${formatDate(day.iso)}` : `No follow-ups on ${formatDate(day.iso)}`,
          onclick: () => {
            state.selectedDate = state.selectedDate === day.iso ? '' : day.iso;
            state.preset = 'date';
            emit(EVENTS.VIEW_REFRESH);
          },
        }, [
          el('span', { text: String(day.day) }),
          bucket ? el('span', {
            class: `calendar__count ${overdue ? 'calendar__count--over' : ''}`.trim(),
            text: String(bucket.total),
          }) : el('span', { class: 'calendar__count', style: { visibility: 'hidden' }, text: '0' }),
        ]),
      ]);
      tr.appendChild(cell);
    }
    tbody.appendChild(tr);
  }
  table.appendChild(tbody);
  body.appendChild(table);

  body.appendChild(el('div', { class: 'kv-inline', style: { marginTop: '14px' } }, [
    badge('Overdue', 'red', 'badge--dot'),
    badge('Due today / tomorrow', 'orange', 'badge--dot'),
    badge('Upcoming', 'green', 'badge--dot'),
    el('span', { class: 'small muted', text: 'Click any date to see the leads due that day.' }),
  ]));

  panel.appendChild(body);
  return panel;
}

function shiftMonth(delta) {
  const { year, month } = state.month;
  const next = new Date(year, month - 1 + delta, 1);
  state.month = { year: next.getFullYear(), month: next.getMonth() + 1 };
  emit(EVENTS.VIEW_REFRESH);
}

/* ---------------------------------------------------------------- list -- */

function listPanel(leads, now) {
  const panel = el('section', { class: 'panel' });
  const { rows, title, empty } = resolveRows(leads, now);

  panel.appendChild(el('div', { class: 'panel__head' }, [
    el('h2', {}, [icon('i-clock'), el('span', { text: title })]),
    el('span', { class: 'badge badge--outline', text: String(rows.length) }),
    el('span', { class: 'spacer' }),
    rows.length ? el('button', {
      class: 'btn btn--xs btn--outline',
      type: 'button',
      text: 'Open in Leads',
      onclick: () => goToLeads(presetToFilter(state.preset)),
    }) : null,
    rows.some((l) => !l.nextFollowUp) ? el('button', {
      class: 'btn btn--xs btn--primary',
      type: 'button',
      text: 'Schedule missing follow-ups',
      onclick: async (event) => {
        const pending = rows.filter((l) => !l.nextFollowUp);
        const confirmed = await confirmDialog({
          title: `Schedule follow-ups for ${pending.length} leads?`,
          message: 'My CRM assigns dates over the next days, highest priority first, skipping Sundays. You can edit any date afterwards.',
          confirmLabel: 'Schedule them',
        });
        if (!confirmed) return;
        await withBusy(event.currentTarget, 'Scheduling…', async () => {
          const result = scheduleBulkFollowUps(pending.map((l) => l.id));
          notify.success(`${result.scheduled} follow-ups scheduled.`);
          emit(EVENTS.VIEW_REFRESH);
        });
      },
    }) : null,
  ]));

  if (!rows.length) {
    panel.appendChild(el('div', { class: 'empty' }, [
      el('span', { class: 'empty__icon', text: '📭' }),
      el('h3', { text: empty }),
      el('p', { text: 'Nothing to do in this bucket right now — pick another day or bucket above.' }),
      el('button', {
        class: 'btn btn--sm btn--outline',
        type: 'button',
        text: 'Add a lead',
        onclick: () => openLeadForm({ onSaved: () => emit(EVENTS.VIEW_REFRESH) }),
      }),
    ]));
    return panel;
  }

  const ranked = rankLeads(rows, now);
  const list = el('div');
  for (const { lead, priority } of ranked) {
    list.appendChild(followUpItem(lead, { now, priority, onOpen: (l) => openLeadProfile(l.id) }));
  }
  panel.appendChild(list);

  const sheet = store.get('sheet');
  if (sheet.lastSyncAt) {
    panel.appendChild(el('div', { class: 'panel__foot small muted' }, [
      el('span', { text: `Last synced: ${friendlyTimestamp(sheet.lastSyncAt)} · ${sheet.lastSyncMessage || ''}` }),
      el('button', {
        class: 'btn btn--xs btn--ghost',
        type: 'button',
        text: 'Sync now',
        style: { marginLeft: '10px' },
        onclick: async (event) => {
          await withBusy(event.currentTarget, 'Syncing…', async () => {
            await syncFromSheet();
          });
        },
      }),
    ]));
  }

  return panel;
}

function resolveRows(leads, now) {
  const preset = state.preset;
  if (preset === 'date') {
    const date = state.selectedDate;
    return {
      rows: leads.filter((l) => l.nextFollowUp === date),
      title: `Follow-ups on ${formatDate(date, 'long')}`,
      empty: 'No follow-ups on this date',
    };
  }

  const map = {
    today: ['Due today', 'Nothing is due today'],
    tomorrow: ['Due tomorrow', 'Nothing is due tomorrow'],
    week: ['Due in the next 7 days', 'Nothing scheduled this week'],
    overdue: ['Overdue follow-ups', 'Nothing is overdue'],
    upcoming: ['Upcoming follow-ups', 'No upcoming follow-ups'],
    none: ['Leads with no follow-up date', 'Every active lead has a follow-up date'],
  };
  const [title, empty] = map[preset] || map.today;
  const bucket = preset === 'week' ? 'week' : preset;
  return { rows: leadsByBucket(leads, bucket, now), title, empty };
}

function presetToFilter(preset) {
  if (preset === 'date') return { bucket: '', ids: '' };
  if (preset === 'week') return { bucket: 'week' };
  if (preset === 'none') return { tag: 'no-followup' };
  return { bucket: preset };
}
