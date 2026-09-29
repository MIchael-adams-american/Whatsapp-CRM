/**
 * Notifications page (sections 4, 11, 12).
 * Rule-based alerts (instant, offline) plus AI insights, every one clickable.
 */

import { el, clear } from '../lib/dom.js';
import { notify, confirmDialog, withBusy } from '../ui/kit.js';
import { insightCard, icon, statTile, badge } from '../ui/components.js';
import { buildNotifications, notificationCounts, groupNotifications } from '../domain/notifications.js';
import { formatDate } from '../lib/date.js';
import { currentLeads, scheduleBulkFollowUps, syncFromSheet, loadDemoData } from '../services/actions.js';
import { store, updateSettings, persistSettings } from '../lib/store.js';
import { EVENTS, emit } from '../lib/bus.js';
import { goToLeads, navigate } from '../router.js';
import { openLeadProfile } from './lead-profile.js';
import { openImportSheetModal } from './import-sheet.js';

export function renderNotifications(root) {
  const leads = currentLeads();
  const settings = store.get('settings');
  const now = new Date();
  const dismissed = settings.notificationsDismissed || {};

  const all = buildNotifications(leads, {
    now,
    sheet: store.get('sheet'),
    source: store.get('source'),
    dismissed: {},
  });
  const active = all.filter((n) => !dismissed[n.id]);
  const dismissedItems = all.filter((n) => dismissed[n.id]);
  const counts = notificationCounts(active);

  const wrap = el('div');

  wrap.appendChild(el('section', { class: 'section' }, [
    el('div', { class: 'row row--between' }, [
      el('div', {}, [
        el('h1', { text: 'Notifications', style: { fontSize: '1.3rem' } }),
        el('p', { class: 'muted', text: 'Everything My CRM thinks you should act on, in priority order.' }),
      ]),
      el('div', { class: 'btn-group' }, [
        el('button', {
          class: 'btn btn--sm btn--outline',
          type: 'button',
          text: 'Refresh',
          onclick: () => emit(EVENTS.VIEW_REFRESH),
        }, [icon('i-refresh'), el('span', { text: 'Refresh' })]),
        el('button', {
          class: 'btn btn--sm btn--outline',
          type: 'button',
          text: 'Import sheet',
          onclick: () => openImportSheetModal({ onDone: () => emit(EVENTS.VIEW_REFRESH) }),
        }),
      ]),
    ]),
    el('div', { class: 'grid grid--stats', style: { marginTop: '14px' } }, [
      statTile({ value: counts.urgent, label: 'Urgent', tone: counts.urgent ? 'red' : 'green', hint: 'Overdue & hot leads' }),
      statTile({ value: counts.today, label: "Today's actions", tone: counts.today ? 'orange' : '', hint: 'Due today' }),
      statTile({ value: active.length, label: 'Open alerts', hint: 'Total notifications' }),
      statTile({ value: dismissedItems.length, label: 'Dismissed', hint: 'Hidden until restored' }),
    ]),
  ]));

  if (!active.length) {
    wrap.appendChild(el('section', { class: 'panel' }, [
      el('div', { class: 'empty' }, [
        el('span', { class: 'empty__icon', text: '✅' }),
        el('h3', { text: 'You are all caught up' }),
        el('p', { text: 'No overdue follow-ups, no leads going quiet and nothing urgent. New alerts appear here automatically as your data changes.' }),
        el('button', {
          class: 'btn btn--sm btn--primary',
          type: 'button',
          text: 'Load demo data',
          onclick: () => { loadDemoData(); emit(EVENTS.VIEW_REFRESH); },
        }),
      ]),
    ]));
  }

  const groups = groupNotifications(active);
  for (const group of groups) {
    const section = el('section', { class: 'section' }, [
      el('div', { class: 'section__head' }, [
        el('h2', { text: group.label }),
        badge(String(group.items.length), 'outline'),
      ]),
      el('div', { class: 'stack' }, group.items.map((item) => insightCard(item, {
        onOpen: (notification) => openNotification(notification),
        onAction: (notification, action) => runAction(notification, action),
      }))),
    ]);
    wrap.appendChild(section);
  }

  if (dismissedItems.length) {
    const dismissedSection = el('section', { class: 'section' }, [
      el('div', { class: 'section__head' }, [
        el('h2', { text: 'Dismissed' }),
        badge(String(dismissedItems.length), 'outline'),
        el('button', {
          class: 'btn btn--xs btn--ghost',
          type: 'button',
          text: 'Restore all',
          onclick: () => {
            updateSettings({ notificationsDismissed: {} });
            notify.info('All notifications restored.');
            emit(EVENTS.VIEW_REFRESH);
          },
        }),
      ]),
      el('div', { class: 'stack' }, dismissedItems.map((notification) => el('div', { class: 'insight-card' }, [
        el('span', { class: 'insight__emoji', text: notification.icon }),
        el('div', { class: 'grow' }, [
          el('h3', { text: notification.title }),
          el('p', { class: 'small muted', style: { marginTop: '4px' }, text: notification.detail }),
          el('div', { class: 'btn-group', style: { marginTop: '8px' } }, [
            el('button', {
              class: 'btn btn--xs btn--outline',
              type: 'button',
              text: 'Restore',
              onclick: () => {
                const next = { ...(store.get('settings').notificationsDismissed || {}) };
                delete next[notification.id];
                updateSettings({ notificationsDismissed: next });
                notify.info('Notification restored.');
                emit(EVENTS.VIEW_REFRESH);
              },
            }),
          ]),
        ]),
      ]))),
    ]);
    wrap.appendChild(dismissedSection);
  }

  clear(root);
  root.appendChild(wrap);
}

function openNotification(notification) {
  if (notification.meta?.leadId) {
    openLeadProfile(notification.meta.leadId);
    return;
  }
  if (notification.filter) {
    goToLeads(notification.filter);
    return;
  }
  notify.info(notification.detail || notification.title);
}

async function runAction(notification, action) {
  switch (action.id) {
    case 'schedule-followups': {
      const ids = notification.meta?.ids || null;
      const confirmed = await confirmDialog({
        title: 'Schedule follow-ups?',
        message: 'My CRM will spread new follow-up dates across the next few days, highest priority first, skipping Sundays.',
        confirmLabel: 'Schedule them',
      });
      if (!confirmed) return;
      const result = scheduleBulkFollowUps(ids);
      notify.success(`${result.scheduled} follow-ups scheduled.`);
      emit(EVENTS.VIEW_REFRESH);
      return;
    }
    case 'campaign':
      navigate('campaigns', { query: { course: action.course || '' } });
      return;
    case 'sync': {
      const result = await syncFromSheet();
      if (result.ok) emit(EVENTS.VIEW_REFRESH);
      return;
    }
    case 'demo':
      loadDemoData();
      emit(EVENTS.VIEW_REFRESH);
      return;
    case 'connect-sheet':
      openImportSheetModal({ onDone: () => emit(EVENTS.VIEW_REFRESH) });
      return;
    case 'whatsapp': {
      if (notification.meta?.leadId) openLeadProfile(notification.meta.leadId);
      return;
    }
    case 'ai-message': {
      if (notification.meta?.leadId) openLeadProfile(notification.meta.leadId);
      return;
    }
    default:
      notify.info(action.label);
  }
}

export { runAction as runNotificationAction };
