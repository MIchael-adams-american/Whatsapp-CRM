/**
 * Dashboard (sections 3, 4, 12, 17, 29).
 * "Open My CRM → immediately know what I need to do today."
 */

import { el, clear } from '../lib/dom.js';
import { notify, confirmDialog, withBusy } from '../ui/kit.js';
import {
  statTile, insightRow, icon, followUpItem, distributionBars, aiSourceNote, badge, followUpBadge,
} from '../ui/components.js';
import { greeting, formatDate, relativeDayLabel, friendlyTimestamp, todayISO } from '../lib/date.js';
import { pluralize } from '../lib/utils.js';
import { overviewStats, courseBreakdown, sourceBreakdown, followUpHealth, prioritySpread } from '../domain/analytics.js';
import { rankLeads, computePriority } from '../domain/priority.js';
import { buildNotifications } from '../domain/notifications.js';
import { countByBucket, findForgottenLeads } from '../domain/followup.js';
import { dailySummary, aiStatus } from '../services/ai.js';
import { currentLeads, loadDemoData, scheduleBulkFollowUps, syncFromSheet } from '../services/actions.js';
import { store, setAiMeta, isDemoSource } from '../lib/store.js';
import { EVENTS, emit } from '../lib/bus.js';
import { openLeadProfile } from './lead-profile.js';
import { openLeadForm } from './lead-form.js';
import { openImportSheetModal } from './import-sheet.js';
import { goToLeads } from '../router.js';

let summaryState = { data: null, loading: false, error: null, attempted: false };

export function renderDashboard(root) {
  const leads = currentLeads();
  const now = new Date();
  const wrap = el('div');

  wrap.appendChild(summaryHeader(leads, now));
  wrap.appendChild(quickActions());
  wrap.appendChild(statsGrid(leads, now));
  wrap.appendChild(dailySummaryPanel(leads, now));
  wrap.appendChild(notificationsPanel(leads));

  const columns = el('div', { class: 'grid grid--2' }, [
    todayPanel(leads, now),
    overduePanel(leads, now),
  ]);
  wrap.appendChild(columns);

  wrap.appendChild(missingFollowUpPanel(leads, now));
  wrap.appendChild(glancePanel(leads, now));

  clear(root);
  root.appendChild(wrap);
}

/* -------------------------------------------------------------- header -- */

function summaryHeader(leads, now) {
  const stats = overviewStats(leads, now);
  const urgent = stats.overdue + stats.hotLeads.length;
  const headline = greeting(now);
  const message = leads.length
    ? 'Here is what needs your attention today.'
    : "Let's get your leads in — load the demo data or connect your Google Sheet.";

  return el('section', { class: 'section' }, [
    el('div', { class: 'row row--between' }, [
      el('div', {}, [
        el('h1', { text: headline, style: { fontSize: '1.4rem' } }),
        el('p', { class: 'muted', text: message }),
      ]),
      el('div', { class: 'row' }, [
        urgent ? badge(`${urgent} need attention`, 'red', 'badge--dot') : badge('All clear', 'green', 'badge--dot'),
        isDemoSource() ? badge('Demo data', 'outline') : badge('Google Sheet', 'green'),
      ]),
    ]),
  ]);
}

/* ------------------------------------------------------- quick actions -- */

function quickActions() {
  return el('section', { class: 'section' }, [
    el('div', { class: 'btn-group' }, [
      el('button', { class: 'btn btn--primary btn--sm', type: 'button', onclick: () => openLeadForm({ onSaved: () => emit(EVENTS.VIEW_REFRESH) }) },
        [icon('i-plus'), el('span', { text: 'Add Lead' })]),
      el('button', { class: 'btn btn--outline btn--sm', type: 'button', onclick: () => openImportSheetModal({ onDone: () => emit(EVENTS.VIEW_REFRESH) }) },
        [icon('i-upload'), el('span', { text: 'Import Sheet' })]),
      el('button', {
        class: 'btn btn--outline btn--sm',
        type: 'button',
        onclick: async (event) => {
          await withBusy(event.currentTarget, 'Syncing…', async () => {
            const result = await syncFromSheet();
            if (result.ok) emit(EVENTS.VIEW_REFRESH);
          });
        },
      }, [icon('i-sync'), el('span', { text: 'Sync Now' })]),
      el('button', { class: 'btn btn--outline btn--sm', type: 'button', text: "Today's Follow-ups", onclick: () => goToLeads({ bucket: 'today' }) }),
      el('button', { class: 'btn btn--outline btn--sm', type: 'button', text: 'Overdue', onclick: () => goToLeads({ bucket: 'overdue' }) }),
      el('button', { class: 'btn btn--outline btn--sm', type: 'button', text: 'Hot Leads', onclick: () => goToLeads({ tag: 'hot' }) }),
      el('button', {
        class: 'btn btn--outline btn--sm',
        type: 'button',
        onclick: (event) => generateSummary(event.currentTarget, true),
      }, [icon('i-sparkles'), el('span', { text: 'Generate Daily AI Summary' })]),
    ]),
  ]);
}

/* --------------------------------------------------------------- stats -- */

function statsGrid(leads, now) {
  const stats = overviewStats(leads, now);
  const grid = el('div', { class: 'grid grid--stats' }, [
    statTile({
      value: stats.callsToday, label: 'Calls Today', hint: 'Due or overdue', tone: stats.callsToday ? 'blue' : '',
      iconName: 'i-phone', onClick: () => goToLeads({ bucket: 'dueOrOverdue' }),
      title: 'Leads with a phone number whose follow-up is due today or overdue',
    }),
    statTile({
      value: stats.followUpsToday, label: 'Follow-ups Today', hint: 'Scheduled for today', tone: stats.followUpsToday ? 'green' : '',
      iconName: 'i-calendar', onClick: () => goToLeads({ bucket: 'today' }),
    }),
    statTile({
      value: stats.overdue, label: 'Overdue Follow-ups', hint: stats.overdue ? 'Needs action now' : 'Nothing overdue', tone: stats.overdue ? 'red' : 'green',
      iconName: 'i-alert', onClick: () => goToLeads({ bucket: 'overdue' }),
    }),
    statTile({
      value: stats.hotLeads.length, label: 'Hot Leads', hint: 'High interest', tone: stats.hotLeads.length ? 'flame' : '',
      iconName: 'i-fire', onClick: () => goToLeads({ tag: 'hot' }),
    }),
    statTile({
      value: stats.newLeads.length, label: 'New Leads', hint: 'Not yet worked', tone: stats.newLeads.length ? 'blue' : '',
      iconName: 'i-plus', onClick: () => goToLeads({ status: 'New' }),
    }),
    statTile({
      value: stats.noResponse.length, label: 'No Response', hint: 'Silent 5+ days', tone: stats.noResponse.length ? 'orange' : '',
      iconName: 'i-clock', onClick: () => goToLeads({ tag: 'no-response' }),
    }),
  ]);
  return el('section', { class: 'section' }, [grid]);
}

/* ------------------------------------------------------- daily summary -- */

function dailySummaryPanel(leads, now) {
  const panel = el('section', { class: 'panel section' });
  const status = aiStatus(store.get('settings'));

  panel.appendChild(el('div', { class: 'panel__head' }, [
    el('h2', {}, [icon('i-sparkles'), el('span', { text: 'Daily AI Summary' })]),
    el('span', { class: 'spacer' }),
    summaryState.data ? el('span', { class: 'small muted', text: `Updated ${friendlyTimestamp(summaryState.data.at || new Date().toISOString(), now)}` }) : null,
    el('button', {
      class: 'btn btn--xs btn--outline',
      type: 'button',
      text: summaryState.data ? 'Refresh summary' : 'Generate summary',
      onclick: (event) => generateSummary(event.currentTarget, true),
    }, [icon('i-refresh'), el('span', { text: 'Refresh' })]),
  ]));

  const body = el('div', { class: 'panel__body' });
  if (summaryState.loading) {
    body.appendChild(el('p', { class: 'muted', text: 'Reading your leads and writing today\'s briefing…' }));
  } else if (summaryState.data) {
    const data = summaryState.data;
    body.appendChild(el('p', { style: { fontWeight: '600' }, text: data.headline }));
    body.appendChild(el('p', { text: data.summary }));
    if (data.priorities?.length) {
      body.appendChild(el('div', { style: { marginTop: '12px' } }, [
        el('div', { class: 'ai-block__label', text: 'Do these first' }),
        el('ol', { style: { margin: '6px 0 0 18px', padding: 0 } }, data.priorities.map((p) => el('li', { text: p }))),
      ]));
    }
    if (data.risks?.length) {
      body.appendChild(el('div', { style: { marginTop: '12px' } }, [
        el('div', { class: 'ai-block__label', text: 'At risk' }),
        el('ul', { style: { margin: '6px 0 0 18px', padding: 0 } }, data.risks.map((p) => el('li', { text: p }))),
      ]));
    }
    if (data.quickWins?.length) {
      body.appendChild(el('div', { style: { marginTop: '12px' } }, [
        el('div', { class: 'ai-block__label', text: 'Quick wins' }),
        el('ul', { style: { margin: '6px 0 0 18px', padding: 0 } }, data.quickWins.map((p) => el('li', { text: p }))),
      ]));
    }
    body.appendChild(el('div', { style: { marginTop: '12px' } }, [
      aiSourceNote({ source: data.generatedBy === 'gemini' ? 'gemini' : 'local', error: summaryState.error }),
    ]));
  } else {
    body.appendChild(el('p', { class: 'muted', text: 'Generate today\'s briefing: what is due, what is overdue, and which leads matter most.' }));
    if (!status.ok) body.appendChild(el('p', { class: 'field__hint', text: `${status.label}. ${status.hint}` }));
  }

  panel.appendChild(body);

  if (!summaryState.data && !summaryState.loading && !summaryState.attempted) {
    // Generate once automatically for a first-run feel, without blocking the UI.
    setTimeout(() => generateSummary(null, false), 60);
  }

  return panel;
}

async function generateSummary(button, notifyUser) {
  if (summaryState.loading) return;
  summaryState.loading = true;
  summaryState.attempted = true;
  emit(EVENTS.VIEW_REFRESH);
  try {
    const result = await dailySummary(currentLeads(), { settings: store.get('settings'), force: true });
    summaryState.data = result.data;
    summaryState.error = result.error || null;
    setAiMeta({ dailySummary: result.data, lastRunAt: new Date().toISOString() });
    if (notifyUser) {
      if (result.error) notify.warn(result.error.friendly, { title: 'Used the built-in summary' });
      else notify.success('Daily summary updated.');
    }
  } catch (error) {
    summaryState.error = { friendly: 'Could not generate the summary.' };
    if (notifyUser) notify.error('Could not generate the daily summary.');
  } finally {
    summaryState.loading = false;
    emit(EVENTS.VIEW_REFRESH);
  }
}

/* ------------------------------------------------------- notifications -- */

function notificationsPanel(leads) {
  const settings = store.get('settings');
  const notifications = buildNotifications(leads, {
    now: new Date(),
    sheet: store.get('sheet'),
    source: store.get('source'),
    dismissed: settings.notificationsDismissed || {},
  }).slice(0, 6);

  const panel = el('section', { class: 'panel section' });
  panel.appendChild(el('div', { class: 'panel__head' }, [
    el('h2', {}, [icon('i-bell'), el('span', { text: 'Notifications & AI insights' })]),
    el('span', { class: 'spacer' }),
    el('a', { class: 'btn btn--xs btn--outline', href: '#/notifications', text: 'View all' }),
  ]));

  if (!notifications.length) {
    panel.appendChild(el('div', { class: 'empty' }, [
      el('span', { class: 'empty__icon', text: '✅' }),
      el('h3', { text: 'Nothing urgent right now' }),
      el('p', { text: 'When follow-ups become overdue, leads go quiet or new opportunities appear, they will show up here.' }),
    ]));
    return panel;
  }

  const list = el('div', { class: 'insight-list' });
  for (const notification of notifications) {
    list.appendChild(insightRow(notification, () => handleNotification(notification)));
  }
  panel.appendChild(list);
  return panel;
}

export function handleNotification(notification) {
  if (notification.actions?.length && !notification.cta) {
    // Notifications without a filter are action-only (e.g. sync reminders).
    notify.info(notification.detail || notification.title);
    return;
  }
  if (notification.filter) {
    goToLeads(notification.filter);
    return;
  }
  if (notification.actions?.includes('sync')) {
    syncFromSheet();
  }
}

/* -------------------------------------------------------- today/overdue -- */

function todayPanel(leads, now) {
  const dueToday = leads.filter((l) => l.nextFollowUp === todayISO(now) && !['Converted', 'Lost', 'Not Interested'].includes(l.status));
  const panel = el('section', { class: 'panel' });

  panel.appendChild(el('div', { class: 'panel__head' }, [
    el('h2', {}, [icon('i-calendar'), el('span', { text: "Today's follow-ups" })]),
    el('span', { class: 'badge badge--outline', text: String(dueToday.length) }),
    el('span', { class: 'spacer' }),
    dueToday.length ? el('a', { class: 'small', href: '#/leads?bucket=today', text: 'See all' }) : null,
  ]));

  if (!dueToday.length) {
    panel.appendChild(el('div', { class: 'empty' }, [
      el('span', { class: 'empty__icon', text: '📅' }),
      el('h3', { text: 'No follow-ups due today' }),
      el('p', { text: 'Either you are ahead of schedule, or this is a good moment to schedule the next step for your open leads.' }),
    ]));
    return panel;
  }

  const ranked = rankLeads(dueToday, now).slice(0, 6);
  const list = el('div');
  for (const { lead, priority } of ranked) {
    list.appendChild(followUpItem(lead, { now, onOpen: (l) => openLeadProfile(l.id), priority }));
  }
  panel.appendChild(list);
  return panel;
}

function overduePanel(leads, now) {
  const overdue = leads.filter((l) => l.nextFollowUp
    && l.nextFollowUp < todayISO(now)
    && !['Converted', 'Lost', 'Not Interested'].includes(l.status));
  const panel = el('section', { class: 'panel' });

  panel.appendChild(el('div', { class: 'panel__head' }, [
    el('h2', {}, [icon('i-alert'), el('span', { text: 'Overdue follow-ups' })]),
    el('span', { class: `badge ${overdue.length ? 'badge--red' : 'badge--green'}`, text: String(overdue.length) }),
    el('span', { class: 'spacer' }),
    overdue.length ? el('a', { class: 'small', href: '#/leads?bucket=overdue', text: 'See all' }) : null,
  ]));

  if (!overdue.length) {
    panel.appendChild(el('div', { class: 'empty' }, [
      el('span', { class: 'empty__icon', text: '🎉' }),
      el('h3', { text: 'Nothing is overdue' }),
      el('p', { text: 'Every scheduled follow-up is on time. Nice work.' }),
    ]));
    return panel;
  }

  const ranked = rankLeads(overdue, now).slice(0, 6);
  const list = el('div');
  for (const { lead, priority } of ranked) {
    list.appendChild(followUpItem(lead, { now, onOpen: (l) => openLeadProfile(l.id), priority }));
  }
  panel.appendChild(list);
  return panel;
}

/* -------------------------------------------------------- missing follow -- */

function missingFollowUpPanel(leads, now) {
  const forgotten = findForgottenLeads(leads, now, 5);
  if (!forgotten.length) return el('span');

  const panel = el('section', { class: 'panel section' });
  panel.appendChild(el('div', { class: 'panel__head' }, [
    el('h2', {}, [icon('i-alert'), el('span', { text: 'Follow-up missing' })]),
    el('span', { class: 'badge badge--orange', text: String(forgotten.length) }),
    el('span', { class: 'spacer' }),
    el('button', {
      class: 'btn btn--xs btn--primary',
      type: 'button',
      text: 'Schedule follow-ups',
      onclick: async (event) => {
        const confirmed = await confirmDialog({
          title: `Schedule follow-ups for ${forgotten.length} leads?`,
          message: 'Dates are spread over the next few days, starting with the highest priority lead and skipping Sundays.',
          confirmLabel: 'Schedule them',
        });
        if (!confirmed) return;
        await withBusy(event.currentTarget, 'Scheduling…', async () => {
          const result = scheduleBulkFollowUps(forgotten.map((f) => f.lead.id));
          notify.success(`${result.scheduled} follow-ups scheduled.`);
          emit(EVENTS.VIEW_REFRESH);
        });
      },
    }),
  ]));

  const list = el('div');
  for (const item of forgotten.slice(0, 4)) {
    list.appendChild(followUpItem(item.lead, { now, onOpen: (l) => openLeadProfile(l.id) }));
  }
  panel.appendChild(list);
  const note = el('div', { class: 'panel__foot small muted' }, [
    el('span', { text: `${forgotten[0].lead.name} was contacted ${forgotten[0].daysSinceContact} days ago but no next follow-up is scheduled.` }),
  ]);
  panel.appendChild(note);
  return panel;
}

/* -------------------------------------------------------------- glance -- */

function glancePanel(leads, now) {
  const health = followUpHealth(leads, now);
  const courses = courseBreakdown(leads).slice(0, 5);
  const sources = sourceBreakdown(leads).slice(0, 5);
  const buckets = countByBucket(leads, now);
  const priority = prioritySpread(leads, now);

  const panel = el('section', { class: 'panel section' });
  panel.appendChild(el('div', { class: 'panel__head' }, [
    el('h2', {}, [icon('i-chart'), el('span', { text: 'At a glance' })]),
    el('span', { class: 'spacer' }),
    el('a', { class: 'small', href: '#/insights', text: 'AI marketing insights' }),
  ]));

  const body = el('div', { class: 'panel__body' });
  const grid = el('div', { class: 'grid grid--2' }, [
    el('div', {}, [
      el('div', { class: 'ai-block__label', text: 'Leads by course' }),
      courses.length ? distributionBars(courses) : el('p', { class: 'small muted', text: 'No course data yet.' }),
    ]),
    el('div', {}, [
      el('div', { class: 'ai-block__label', text: 'Leads by source' }),
      sources.length ? distributionBars(sources, { tone: 'orange' }) : el('p', { class: 'small muted', text: 'No source data yet.' }),
    ]),
  ]);
  body.appendChild(grid);

  body.appendChild(el('div', { class: 'kv-inline', style: { marginTop: '16px' } }, [
    el('span', {}, [el('strong', { text: 'Overdue: ' }), el('span', { text: String(buckets.overdue) })]),
    el('span', {}, [el('strong', { text: 'Due today: ' }), el('span', { text: String(buckets.today) })]),
    el('span', {}, [el('strong', { text: 'No follow-up: ' }), el('span', { text: String(buckets.none) })]),
    el('span', {}, [el('strong', { text: 'Very high priority: ' }), el('span', { text: String(priority['very-high'] || 0) })]),
    el('span', {}, [el('strong', { text: 'Silent 7+ days: ' }), el('span', { text: String(health.silentOver7) })]),
    el('span', {}, [el('strong', { text: 'Converted: ' }), el('span', { text: String(leads.filter((l) => l.status === 'Converted').length) })]),
  ]));

  panel.appendChild(body);
  return panel;
}

export function resetDashboardSummary() {
  summaryState = { data: null, loading: false, error: null, attempted: false };
}
