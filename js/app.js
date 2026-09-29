/**
 * My CRM — application bootstrap.
 *
 * Wires the store, router, views, global search, notifications badges,
 * auto-sync and error handling together. This is the only file that knows about
 * every part of the app.
 */

import { $, $$, wireActions, setText, clear, show } from './lib/dom.js';
import { debounce } from './lib/utils.js';
import { store, loadPersistedState, replaceLeads, isDemoSource } from './lib/store.js';
import { EVENTS, emit, on } from './lib/bus.js';
import { storage, persistUi, updateSettings } from './lib/store.js';
import { startRouter, onRouteChange, ROUTE_TITLES, navigate, goToLeads, currentRoute } from './router.js';
import { notify, closeDrawer, closeAllModals, drawerIsOpen } from './ui/kit.js';
import { buildDemoLeads } from './data/demo-data.js';
import { buildNotifications, notificationCounts } from './domain/notifications.js';
import { countByBucket } from './domain/followup.js';
import { aiStatus, cacheApi } from './services/ai.js';
import { getCachedAnalysis, setCachedAnalysis, clearAiCache } from './lib/store.js';
import { storeAiSuggestion, syncFromSheet, currentLeads, loadDemoData } from './services/actions.js';
import { openLeadForm } from './views/lead-form.js';
import { openLeadProfile, initLeadProfile } from './views/lead-profile.js';
import { renderDashboard } from './views/dashboard.js';
import { renderLeads } from './views/leads.js';
import { renderFollowUps } from './views/followups.js';
import { renderNotifications } from './views/notifications.js';
import { renderInsights } from './views/insights.js';
import { renderCampaigns } from './views/campaigns.js';
import { renderSettings } from './views/settings.js';

let autoSyncTimer = null;

/* ------------------------------------------------------------- bootstrap -- */

function boot() {
  const persisted = loadPersistedState();
  store.set({
    settings: persisted.settings,
    sheet: persisted.sheet,
    leads: persisted.leads,
    source: persisted.source,
    aiCache: persisted.aiCache,
    aiMeta: persisted.aiMeta,
    ui: persisted.ui,
    hydrated: true,
  }, 'hydrate');

  wireAiCache();

  // First run: load demo data so the dashboard is never empty on arrival.
  if (!store.get('leads').length && !persisted.sheet.spreadsheetId && !persisted.sheet.appsScriptUrl) {
    replaceLeads(buildDemoLeads(), 'demo');
    store.set({ ui: { ...(store.get('ui') || {}), welcomed: true } }, 'ui');
  } else if (!store.get('leads').length && (persisted.sheet.spreadsheetId || persisted.sheet.appsScriptUrl)) {
    notify.info('My CRM is ready. Run "Sync Now" to pull your leads from Google Sheets.');
  }

  wireGlobalActions();
  wireSearch();
  wireGlobalErrorHandling();
  wireNetworkStatus();
  initLeadProfile();

  onRouteChange((route) => {
    store.set({ route }, 'route');
    renderCurrentView(route);
    updateChrome();
  });

  on(EVENTS.VIEW_REFRESH, () => {
    renderCurrentView(currentRoute());
    updateChrome();
  });

  on(EVENTS.DATA_CHANGED, ({ reason }) => {
    if (reason === 'leads' || reason === 'sheet') updateChrome();
  });

  startRouter();
  renderCurrentView(currentRoute());
  updateChrome();
  scheduleAutoSync();

  // Let the browser settle before any background AI work.
  window.setTimeout(() => maybeWarmCache(), 1200);
}

/** Connect the AI cache to the persisted store (section 27). */
function wireAiCache() {
  cacheApi.get = (key) => getCachedAnalysis(key);
  cacheApi.set = (key, value) => setCachedAnalysis(key, { ...value, at: value.at || new Date().toISOString() });
  cacheApi.enabled = () => store.get('settings').aiCacheEnabled !== false;
}

/* ------------------------------------------------------------ rendering -- */

function renderCurrentView(route = currentRoute()) {
  const view = $('#view');
  if (!view) return;
  try {
    switch (route.name) {
      case 'leads':
        renderLeads(view, { query: route.query });
        break;
      case 'lead': {
        renderLeads(view, { query: {} });
        if (route.params.id) {
          const lead = currentLeads().find((l) => l.id === route.params.id);
          if (lead) openLeadProfile(lead.id);
          else notify.warn('That lead could not be found.');
        }
        break;
      }
      case 'followups':
        renderFollowUps(view, { query: route.query });
        break;
      case 'notifications':
        renderNotifications(view);
        break;
      case 'insights':
        renderInsights(view);
        break;
      case 'campaigns':
        renderCampaigns(view, { query: route.query });
        break;
      case 'settings':
        renderSettings(view, { query: route.query });
        break;
      case 'dashboard':
      default:
        renderDashboard(view);
    }
  } catch (error) {
    console.error('[my crm] view failed to render', error);
    renderFriendlyError(view, error);
  }
}

function renderFriendlyError(view, error) {
  clear(view);
  view.appendChild(
    Object.assign(document.createElement('div'), { className: 'panel' }),
  );
  const panel = view.firstElementChild;
  const body = document.createElement('div');
  body.className = 'panel__body';
  const h = document.createElement('h2');
  h.textContent = 'Something went wrong on this screen';
  const p = document.createElement('p');
  p.className = 'muted';
  p.textContent = 'Your data is safe. Try again, or reload the page. If it keeps happening, open the browser console for the exact message.';
  const details = document.createElement('pre');
  details.className = 'code';
  details.textContent = String(error?.message || error);
  const retry = document.createElement('button');
  retry.className = 'btn btn--primary btn--sm';
  retry.type = 'button';
  retry.textContent = 'Reload this view';
  retry.addEventListener('click', () => renderCurrentView());
  body.append(h, p, details, retry);
  panel.appendChild(body);
}

/** Topbar title, badges, data-source chip, footer. */
function updateChrome() {
  const route = currentRoute();
  const leads = currentLeads();
  const now = new Date();
  const bucketCounts = countByBucket(leads, now);
  const notifications = buildNotifications(leads, {
    now,
    sheet: store.get('sheet'),
    source: store.get('source'),
    dismissed: store.get('settings').notificationsDismissed || {},
  });
  const counts = notificationCounts(notifications);

  const pageTitle = ROUTE_TITLES[route.name] || 'My CRM';
  setText($('#pageTitle'), pageTitle);
  document.title = route.name === 'dashboard' ? 'My CRM — AI Lead Management & Follow-ups' : `${pageTitle} · My CRM`;
  const subtitleMap = {
    dashboard: 'Your day at a glance',
    leads: `${leads.length} leads`,
    lead: 'Lead profile',
    followups: `${bucketCounts.today} due today · ${bucketCounts.overdue} overdue`,
    notifications: counts.total ? `${counts.total} open alerts` : 'Nothing urgent',
    insights: 'Marketing intelligence from your lead data',
    campaigns: 'Generate and copy campaign messages',
    settings: 'Connections, AI and privacy',
  };
  setText($('#pageSubtitle'), subtitleMap[route.name] || '');

  // Navigation counts
  setCount('[data-count="leads"]', leads.length);
  setCount('[data-count="overdue"]', bucketCounts.overdue);
  setCount('[data-count="notifications"]', counts.total);

  // Nav active states (desktop + mobile)
  $$('[data-route]').forEach((link) => {
    const isActive = link.dataset.route === route.name
      || (route.name === 'lead' && link.dataset.route === 'leads');
    link.classList.toggle('is-active', isActive);
  });

  // Data-source chip
  const isSheet = !isDemoSource();
  setText($('#dataSourceLabel'), isSheet ? (store.get('sheet').sheetName || 'Google Sheet') : 'Demo data');
  setText($('#dataSourceSub'), isSheet
    ? (store.get('sheet').lastSyncAt ? `Synced ${new Date(store.get('sheet').lastSyncAt).toLocaleString()}` : 'Not synced yet')
    : 'Not connected to Google Sheets');
  setText($('#footerSource'), isSheet ? 'Connected to Google Sheets' : 'Demo mode');

  const lastSync = store.get('sheet').lastSyncAt;
  setText($('#footerSync'), lastSync ? `Last synced: ${new Date(lastSync).toLocaleString()}` : '');

  const ai = aiStatus(store.get('settings'));
  setText($('#brandSub'), ai.ok ? 'AI assistant active' : 'Built-in assistant');

  // Search field reflects the current query when on the leads page
  const searchInput = $('#globalSearch');
  if (searchInput && route.name !== 'leads') {
    searchInput.value = '';
    show($('.search__clear'), false);
  }
}

function setCount(selector, value) {
  $$(selector).forEach((node) => {
    node.textContent = String(value);
    show(node, value > 0);
  });
}

/* -------------------------------------------------------- global search -- */

function wireSearch() {
  const input = $('#globalSearch');
  const clearButton = $('.search__clear');
  if (!input) return;

  const runSearch = debounce((value) => {
    const query = value.trim();
    const currentQuery = currentRoute().query || {};
    if (!query) {
      if (currentRoute().name === 'leads' && currentQuery.q) {
        navigate('leads', { query: { ...currentQuery, q: '' }, replace: true });
      }
      return;
    }
    if (currentRoute().name === 'leads') {
      navigate('leads', { query: { ...currentQuery, q: query }, replace: true, keepScroll: true });
    } else {
      navigate('leads', { query: { q: query, showClosed: true } });
    }
  }, 260);

  input.addEventListener('input', () => {
    show(clearButton, Boolean(input.value.trim()));
    runSearch(input.value);
  });

  input.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      runSearch.flush?.();
      const query = input.value.trim();
      if (query) navigate('leads', { query: { q: query, showClosed: true } });
    }
    if (event.key === 'Escape') {
      input.value = '';
      show(clearButton, false);
      input.blur();
    }
  });

  $('#globalSearchForm')?.addEventListener('submit', (event) => {
    event.preventDefault();
    const query = input.value.trim();
    if (query) navigate('leads', { query: { q: query, showClosed: true } });
  });

  // "/" focuses search, like most professional tools.
  document.addEventListener('keydown', (event) => {
    const tag = document.activeElement?.tagName;
    const typing = tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || document.activeElement?.isContentEditable;
    if (event.key === '/' && !typing) {
      event.preventDefault();
      input.focus();
      input.select();
    }
    if (event.key === 'Escape' && !drawerIsOpen()) {
      closeAllModals();
    }
  });
}

/* ------------------------------------------------------- global actions -- */

function wireGlobalActions() {
  wireActions(document, {
    'add-lead': () => openLeadForm({ onSaved: (lead) => { if (lead) openLeadProfile(lead.id); } }),
    'sync-now': async () => {
      const result = await syncFromSheet();
      if (result.ok) emit(EVENTS.VIEW_REFRESH);
    },
    'toggle-sidebar': (_event, element) => {
      const open = document.body.classList.toggle('nav-open');
      element.setAttribute('aria-expanded', String(open));
      show($('#scrim'), open);
    },
    'clear-search': () => {
      const input = $('#globalSearch');
      if (input) { input.value = ''; input.focus(); }
      show($('.search__clear'), false);
      if (currentRoute().name === 'leads') {
        navigate('leads', { query: { ...currentRoute().query, q: '' }, replace: true });
      }
    },
    'go-notifications': () => navigate('notifications'),
  });

  $('#scrim')?.addEventListener('click', () => {
    document.body.classList.remove('nav-open');
    show($('#scrim'), false);
    const toggle = $('[data-action="toggle-sidebar"]');
    if (toggle) toggle.setAttribute('aria-expanded', 'false');
  });

  // Close the mobile nav after any navigation link is used.
  $$('a[href^="#/"]').forEach((link) => link.addEventListener('click', () => {
    document.body.classList.remove('nav-open');
    show($('#scrim'), false);
  }));
}

/* --------------------------------------------------- network & autosync -- */

function wireNetworkStatus() {
  const banner = $('#offlineBanner');
  const update = () => {
    const offline = navigator.onLine === false;
    show(banner, offline);
    if (!offline) scheduleAutoSync();
  };
  window.addEventListener('online', update);
  window.addEventListener('offline', update);
  update();
}

function scheduleAutoSync() {
  if (autoSyncTimer) {
    clearInterval(autoSyncTimer);
    autoSyncTimer = null;
  }
  const sheet = store.get('sheet');
  if (!sheet.autoSyncEnabled || (!sheet.spreadsheetId && !sheet.appsScriptUrl)) return;
  const minutes = Math.max(5, Number(sheet.autoSyncMinutes) || 15);
  autoSyncTimer = setInterval(() => {
    if (document.hidden || navigator.onLine === false) return;
    syncFromSheet({ silent: true }).then((result) => {
      if (result.ok && (result.added?.length || result.updated?.length)) {
        notify.info(`${result.added?.length || 0} new and ${result.updated?.length || 0} updated leads imported from your sheet.`, { title: 'Sheet updated' });
        emit(EVENTS.VIEW_REFRESH);
      }
    });
  }, minutes * 60 * 1000);
}

/* ------------------------------------------------------- error handling -- */

function wireGlobalErrorHandling() {
  window.addEventListener('error', (event) => {
    if (event.message?.includes('ResizeObserver')) return;
    console.error('[my crm] runtime error', event.error || event.message);
  });

  window.addEventListener('unhandledrejection', (event) => {
    const reason = event.reason;
    if (reason?.code && reason?.friendly) {
      notify.error(reason.friendly, { title: 'Request failed' });
    } else {
      console.error('[my crm] unhandled rejection', reason);
    }
    event.preventDefault();
  });
}

/** Warm the cache for the highest-priority leads when idle (bounded). */
function maybeWarmCache() {
  if (!aiStatus(store.get('settings')).ok) return;
  if (store.get('settings').aiCacheEnabled === false) return;
  if (document.hidden) return;
  // Intentionally lightweight: only pre-compute the first lead and only on the
  // dashboard, everything else is generated on demand to protect the quota.
  const route = currentRoute();
  if (route.name !== 'dashboard') return;
  const lead = currentLeads()[0];
  if (!lead) return;
  // Nothing to do beyond signalling availability — analysis runs on request.
  void lead;
}

/* ---------------------------------------------------------------- start -- */

export function startApp() {
  boot();
}

export { boot, renderCurrentView };

// Auto-start when the module is loaded by the browser.
if (typeof window !== 'undefined') {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', startApp, { once: true });
  } else {
    startApp();
  }
}

export { storeAiSuggestion, goToLeads, updateSettings, persistUi, storage, $ };
