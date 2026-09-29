/**
 * Leads page (section 5): filters, search, sortable table (desktop) / cards
 * (mobile), pagination, column picker, CSV export and quick actions.
 */

import { el, clear } from '../lib/dom.js';
import { openModal, notify, confirmDialog, withBusy, emptyState } from '../ui/kit.js';
import { leadsList, LEAD_COLUMNS, DEFAULT_COLUMNS, icon } from '../ui/components.js';
import { COURSES, INTEREST_LEVELS, LEAD_STATUSES, LEAD_SORTS, SOURCES } from '../config.js';
import { EMPTY_FILTERS, applyFilters, describeFilters, isFilterActive } from '../domain/filters.js';
import { distinctValues } from '../domain/model.js';
import { computePriority } from '../domain/priority.js';
import { followUpState } from '../domain/followup.js';
import { downloadTextFile, objectsToCSV } from '../lib/utils.js';
import { formatDate } from '../lib/date.js';
import { currentLeads, deleteLead, scheduleBulkFollowUps } from '../services/actions.js';
import { store, persistUi } from '../lib/store.js';
import { EVENTS, emit } from '../lib/bus.js';
import { openLeadProfile } from './lead-profile.js';
import { openLeadForm } from './lead-form.js';
import { openImportSheetModal } from './import-sheet.js';

const PAGE_SIZE = 25;

const view = {
  filters: { ...EMPTY_FILTERS, showClosed: true },
  sort: 'priority',
  sortDir: 'desc',
  page: 1,
  columns: loadColumns(),
};

function loadColumns() {
  const saved = store.get('ui')?.leadColumns;
  if (Array.isArray(saved) && saved.length) return saved.filter((c) => LEAD_COLUMNS.some((col) => col.id === c));
  return DEFAULT_COLUMNS.slice();
}

function saveColumns(columns) {
  view.columns = columns;
  const ui = { ...(store.get('ui') || {}), leadColumns: columns };
  persistUi(ui);
  store.set({ ui }, 'ui');
}

export function applyRouteParams(query = {}) {
  view.filters = { ...EMPTY_FILTERS, showClosed: true, ...query };
  view.page = 1;
}

export function renderLeads(root, { query = {} } = {}) {
  applyRouteParams(query);
  const wrap = el('div');
  wrap.appendChild(toolbar());
  wrap.appendChild(filterBar());
  wrap.appendChild(listContainer());
  clear(root);
  root.appendChild(wrap);
}

/* ------------------------------------------------------------- toolbar -- */

function toolbar() {
  const leads = currentLeads();
  const bar = el('div', { class: 'toolbar' });

  const quick = el('div', { class: 'toolbar__group' });
  const presets = [
    { id: 'all', label: 'All', filters: {} },
    { id: 'today', label: "Today's follow-ups", filters: { bucket: 'today' } },
    { id: 'overdue', label: 'Overdue', filters: { bucket: 'overdue' } },
    { id: 'hot', label: 'Hot leads', filters: { tag: 'hot' } },
    { id: 'new', label: 'New', filters: { status: 'New' } },
    { id: 'noResponse', label: 'No response', filters: { tag: 'no-response' } },
    { id: 'forgotten', label: 'No follow-up', filters: { tag: 'no-followup' } },
  ];
  for (const preset of presets) {
    const active = matchesPreset(view.filters, preset.filters);
    quick.appendChild(el('button', {
      class: `chip ${active ? 'is-active' : ''}`.trim(),
      type: 'button',
      text: preset.label,
      onclick: () => {
        view.filters = { ...EMPTY_FILTERS, showClosed: true, ...preset.filters };
        view.page = 1;
        rerender();
      },
    }));
  }
  bar.appendChild(quick);

  const actions = el('div', { class: 'toolbar__group', style: { marginLeft: 'auto' } }, [
    el('button', {
      class: 'btn btn--sm btn--outline',
      type: 'button',
      onclick: () => openColumnsModal(),
    }, [icon('i-filter'), el('span', { text: 'Columns' })]),
    el('button', {
      class: 'btn btn--sm btn--outline',
      type: 'button',
      onclick: () => openImportSheetModal({ onDone: () => rerender() }),
    }, [icon('i-upload'), el('span', { text: 'Import Sheet' })]),
    el('button', {
      class: 'btn btn--sm btn--outline',
      type: 'button',
      onclick: exportCsv,
    }, [icon('i-download'), el('span', { text: 'Export CSV' })]),
    el('button', {
      class: 'btn btn--sm btn--primary',
      type: 'button',
      onclick: () => openLeadForm({ onSaved: () => rerender() }),
    }, [icon('i-plus'), el('span', { text: 'Add Lead' })]),
  ]);
  bar.appendChild(actions);

  bar.appendChild(el('span', { class: 'small muted', text: `${leads.length} leads in My CRM` }));
  return bar;
}

function matchesPreset(filters, preset) {
  const keys = Object.keys(preset);
  if (!keys.length) return !isFilterActive({ ...filters, q: '' });
  return keys.every((key) => filters[key] === preset[key]);
}

/* ---------------------------------------------------------- filter bar -- */

function filterBar() {
  const leads = currentLeads();
  const container = el('div', { class: 'panel__body', style: { borderBottom: '1px solid var(--line)' } });

  const dropdown = (key, label, options) => {
    const node = el('select', {
      'aria-label': label,
      onchange: (event) => {
        view.filters = { ...view.filters, [key]: event.target.value };
        view.page = 1;
        rerender();
      },
    });
    for (const [value, text] of options) {
      node.appendChild(el('option', { value, text, selected: String(view.filters[key] || '') === String(value) }));
    }
    return el('div', { class: 'field' }, [el('label', { text: label }), node]);
  };

  const courseOptions = [['', 'All courses']].concat(
    distinctValues(leads, 'course').map((c) => [c, c]),
  );
  const cityOptions = [['', 'All cities']].concat(distinctValues(leads, 'city').map((c) => [c, c]));
  const sourceOptions = [['', 'All sources']].concat(
    (distinctValues(leads, 'source').length ? distinctValues(leads, 'source') : SOURCES).map((c) => [c, c]),
  );
  const assigneeOptions = [['', 'Anyone']].concat(distinctValues(leads, 'assignedTo').map((c) => [c, c]));

  const grid = el('div', { class: 'filter-grid' }, [
    dropdown('status', 'Status', [['', 'All statuses']].concat(LEAD_STATUSES.map((s) => [s, s]))),
    dropdown('course', 'Course', courseOptions),
    dropdown('city', 'City', cityOptions),
    dropdown('interest', 'Interest', [['', 'Any interest']].concat(INTEREST_LEVELS.map((i) => [i, i]))),
    dropdown('source', 'Source', sourceOptions),
    dropdown('assignedTo', 'Assigned to', assigneeOptions),
    dropdown('bucket', 'Follow-up date', [
      ['', 'Any'],
      ['overdue', 'Overdue'],
      ['today', 'Due today'],
      ['tomorrow', 'Due tomorrow'],
      ['week', 'Due this week'],
      ['upcoming', 'Upcoming'],
      ['none', 'No follow-up date'],
    ]),
    dropdown('lastContact', 'Last contacted', [
      ['', 'Any time'],
      ['3', 'Not in 3+ days'],
      ['7', 'Not in 7+ days'],
      ['14', 'Not in 14+ days'],
      ['30', 'Not in 30+ days'],
    ]),
    dropdown('sort', 'Sort by', LEAD_SORTS.map((s) => [s.id, s.label])),
  ]);

  // "Sort by" drives the table ordering rather than a filter.
  const sortSelect = grid.querySelector('select[aria-label="Sort by"]');
  if (sortSelect) {
    sortSelect.value = view.sort;
    sortSelect.onchange = (event) => { view.sort = event.target.value; rerender(); };
    view.filters = { ...view.filters, sort: '' };
  }

  const footer = el('div', { class: 'row', style: { marginTop: '12px' } }, [
    el('label', { class: 'checkbox' }, [
      el('input', {
        type: 'checkbox',
        checked: view.filters.showClosed,
        onchange: (event) => {
          view.filters = { ...view.filters, showClosed: event.target.checked };
          rerender();
        },
      }),
      el('span', { text: 'Include converted, lost and not-interested leads' }),
    ]),
    isFilterActive(view.filters) ? el('button', {
      class: 'btn btn--xs btn--ghost',
      type: 'button',
      text: 'Clear all filters',
      onclick: () => {
        view.filters = { ...EMPTY_FILTERS, showClosed: true };
        view.page = 1;
        rerender();
      },
    }) : null,
  ]);

  container.appendChild(grid);
  container.appendChild(footer);
  return container;
}

/* --------------------------------------------------------------- list -- */

function listContainer() {
  const panel = el('div', { class: 'panel', style: { marginTop: '16px' } });
  const leads = currentLeads();
  const now = new Date();
  const filtered = applyFilters(leads, view.filters, now);

  const heading = el('div', { class: 'panel__head' }, [
    el('h2', {}, [icon('i-leads'), el('span', { text: filtered.length === leads.length ? 'All leads' : 'Filtered leads' })]),
    el('span', { class: 'badge badge--outline', text: `${filtered.length}` }),
    el('span', { class: 'small muted', text: describeFilters(view.filters) || 'No filters applied' }),
    el('span', { class: 'spacer' }),
    filtered.some((l) => !l.nextFollowUp) ? el('button', {
      class: 'btn btn--xs btn--outline',
      type: 'button',
      text: 'Schedule missing follow-ups',
      title: 'Spread new follow-up dates across the next days for leads that have none',
      onclick: async (event) => {
        const pending = filtered.filter((l) => !l.nextFollowUp);
        const confirmed = await confirmDialog({
          title: `Schedule follow-ups for ${pending.length} leads?`,
          message: 'My CRM will assign follow-up dates over the next few days, highest priority first, skipping Sundays. You can change any date afterwards.',
          confirmLabel: 'Schedule them',
        });
        if (!confirmed) return;
        await withBusy(event.currentTarget, 'Scheduling…', async () => {
          const result = scheduleBulkFollowUps(pending.map((l) => l.id));
          notify.success(`${result.scheduled} follow-ups scheduled.`);
          rerender();
        });
      },
    }) : null,
  ]);
  panel.appendChild(heading);

  if (!leads.length) {
    panel.appendChild(emptyState({
      icon: '📋',
      title: 'No leads yet',
      message: 'Load the demo data to explore My CRM, connect your Google Sheet, or add your first lead manually.',
      actions: [
        { label: 'Add a lead', class: 'btn btn--primary', onClick: () => openLeadForm({ onSaved: () => rerender() }) },
        { label: 'Connect Google Sheet', onClick: () => { window.location.hash = '#/settings?tab=sheet'; } },
      ],
    }));
    return panel;
  }

  if (!filtered.length) {
    panel.appendChild(emptyState({
      icon: '🔍',
      title: 'No leads match these filters',
      message: 'Try removing a filter, widening the date range, or searching for something else.',
      actions: [{
        label: 'Clear filters',
        class: 'btn btn--primary',
        onClick: () => { view.filters = { ...EMPTY_FILTERS, showClosed: true }; rerender(); },
      }],
    }));
    return panel;
  }

  const sorted = sortLeads(filtered, view.sort, now);
  const totalPages = Math.max(1, Math.ceil(sorted.length / PAGE_SIZE));
  const page = Math.min(view.page, totalPages);
  const pageItems = sorted.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  panel.appendChild(leadsList(pageItems, {
    columns: view.columns,
    now,
    sort: view.sort,
    onSort: (col) => {
      const map = {
        name: 'name', course: 'course', status: 'status', priority: 'priority',
        lastContact: 'lastContact', nextFollowUp: 'nextFollowUp', city: 'city',
        source: 'source', email: 'email', interest: 'interest', assignedTo: 'assignedTo',
        followUpCount: 'priority', lastResponse: 'priority', contact: 'name',
      };
      view.sort = map[col] || 'priority';
      rerender();
    },
    onOpen: (lead) => openLeadProfile(lead.id),
    priorityFor: (lead) => computePriority(lead, now),
    highlight: (view.filters.q || '').split(/\s+/).find((t) => t && !/^(overdue|today|tomorrow|hot|new|urgent|no-response|forgotten)$/i.test(t)) || '',
  }));

  panel.appendChild(pagination(page, totalPages, sorted.length));
  return panel;
}

function sortLeads(leads, sort, now) {
  const list = leads.slice();
  switch (sort) {
    case 'name':
      return list.sort((a, b) => a.name.localeCompare(b.name));
    case 'course':
      return list.sort((a, b) => String(a.course).localeCompare(String(b.course)) || a.name.localeCompare(b.name));
    case 'status':
      return list.sort((a, b) => String(a.status).localeCompare(String(b.status)) || a.name.localeCompare(b.name));
    case 'created':
      return list.sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
    case 'nextFollowUp':
      return list.sort((a, b) => String(a.nextFollowUp || '9999').localeCompare(String(b.nextFollowUp || '9999')));
    case 'lastContact':
      return list.sort((a, b) => String(a.lastContact || '0000').localeCompare(String(b.lastContact || '0000')));
    case 'priority':
    default:
      return list.sort((a, b) => {
        const pa = computePriority(a, now).score;
        const pb = computePriority(b, now).score;
        if (pb !== pa) return pb - pa;
        return String(a.nextFollowUp || '9999').localeCompare(String(b.nextFollowUp || '9999'));
      });
  }
}

function pagination(page, totalPages, total) {
  const wrap = el('div', { class: 'pagination' }, [
    el('span', { class: 'small muted', text: `Showing ${(page - 1) * PAGE_SIZE + 1}–${Math.min(page * PAGE_SIZE, total)} of ${total}` }),
    el('div', { class: 'pagination__pages' }, [
      el('button', {
        class: 'btn btn--xs btn--outline',
        type: 'button',
        text: 'Previous',
        disabled: page <= 1,
        onclick: () => { view.page = page - 1; rerender(); },
      }),
      el('span', { class: 'small', text: `Page ${page} of ${totalPages}` }),
      el('button', {
        class: 'btn btn--xs btn--outline',
        type: 'button',
        text: 'Next',
        disabled: page >= totalPages,
        onclick: () => { view.page = page + 1; rerender(); },
      }),
    ]),
  ]);
  return wrap;
}

/* ------------------------------------------------------------- columns -- */

function openColumnsModal() {
  const list = el('div', { class: 'column-list' });
  const selected = new Set(view.columns);

  for (const column of LEAD_COLUMNS) {
    const checkbox = el('input', {
      type: 'checkbox',
      checked: selected.has(column.id) || column.always,
      disabled: Boolean(column.always),
    });
    checkbox.dataset.column = column.id;
    const item = el('label', { class: 'checkbox' }, [checkbox, el('span', { text: column.label })]);
    if (column.always) item.dataset.locked = 'true';
    list.appendChild(item);
  }

  openModal({
    title: 'Choose columns',
    subtitle: 'Keep the table focused on what you actually use. Name, status, priority and follow-up date are always shown.',
    body: list,
    footer: [
      { label: 'Reset', class: 'btn btn--ghost', onClick: () => { saveColumns(DEFAULT_COLUMNS.slice()); notify.info('Columns reset.'); rerender(); } },
      {
        label: 'Save columns',
        class: 'btn btn--primary',
        onClick: () => {
          const chosen = Array.from(list.querySelectorAll('input[type="checkbox"]'))
            .filter((cb) => cb.checked || cb.disabled)
            .map((cb) => cb.dataset.column);
          const ordered = LEAD_COLUMNS.filter((c) => chosen.includes(c.id)).map((c) => c.id);
          saveColumns(ordered);
          notify.success('Column layout saved.');
          rerender();
        },
      },
    ],
  });
}

/* -------------------------------------------------------------- export -- */

function exportCsv() {
  const leads = applyFilters(currentLeads(), view.filters);
  if (!leads.length) {
    notify.warn('There are no leads to export with the current filters.');
    return;
  }
  const rows = leads.map((lead) => ({
    Name: lead.name,
    Phone: lead.phone,
    WhatsApp: lead.whatsapp,
    Email: lead.email,
    Course: lead.course,
    City: lead.city,
    Source: lead.source,
    Status: lead.status,
    Interest: lead.interest,
    'Last Contact': lead.lastContact,
    'Next Follow-up': lead.nextFollowUp,
    'Follow-ups': lead.followUpCount,
    'Last Response': lead.lastResponse,
    'Assigned To': lead.assignedTo,
    Notes: lead.notes,
    'Priority Score': computePriority(lead).score,
    'Follow-up Status': followUpState(lead).bucket,
    Created: lead.createdAt ? lead.createdAt.slice(0, 10) : '',
  }));
  const csv = objectsToCSV(rows);
  downloadTextFile(`my-crm-leads-${formatDate(new Date(), 'short').replace(/\s/g, '-')}.csv`, csv, 'text/csv;charset=utf-8');
  notify.success(`Exported ${rows.length} leads to CSV.`);
}

/* ---------------------------------------------------------------- misc -- */

function rerender() {
  emit(EVENTS.VIEW_REFRESH, { reason: 'leads' });
}

export { rerender as rerenderLeads };
