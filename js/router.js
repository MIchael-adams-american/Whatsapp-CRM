/**
 * Hash router.
 *
 * Routes look like:  #/leads?bucket=overdue&course=IOSH%20Managing%20Safely
 * Because everything lives in the URL, any view (including a specific filter or
 * a single notification drill-down) can be linked, bookmarked and reloaded —
 * which also makes the app work on GitHub Pages / Netlify without redirects.
 */

import { filtersToParams, parseFiltersFromParams } from './domain/filters.js';
import { EMPTY_FILTERS } from './domain/filters.js';

const routes = [
  { name: 'dashboard', path: 'dashboard' },
  { name: 'leads', path: 'leads' },
  { name: 'lead', path: 'lead' },          // #/lead/<id>
  { name: 'followups', path: 'followups' },
  { name: 'notifications', path: 'notifications' },
  { name: 'insights', path: 'insights' },
  { name: 'campaigns', path: 'campaigns' },
  { name: 'settings', path: 'settings' },
];

export const ROUTE_TITLES = {
  dashboard: 'My CRM',
  leads: 'Leads',
  lead: 'Lead Profile',
  followups: 'Follow-ups',
  notifications: 'Notifications',
  insights: 'AI Insights',
  campaigns: 'Campaigns',
  settings: 'Settings',
};

let current = { name: 'dashboard', params: {}, query: {} };
const listeners = new Set();

/** Parse "#/leads?bucket=overdue" into a route object. */
export function parseHash(hash = window.location.hash) {
  const raw = String(hash || '').replace(/^#\/?/, '');
  if (!raw) return { name: 'dashboard', params: {}, query: {} };

  const [pathPart, queryPart] = raw.split('?');
  const segments = pathPart.split('/').filter(Boolean);
  const query = Object.fromEntries(new URLSearchParams(queryPart || ''));

  if (!segments.length) return { name: 'dashboard', params: {}, query };

  const [head, ...rest] = segments;
  const route = routes.find((r) => r.path === head);

  if (!route) {
    if (rest.length === 0 && /^[a-zA-Z0-9_:-]{6,}$/.test(head)) {
      return { name: 'leads', params: {}, query };
    }
    return { name: 'dashboard', params: {}, query };
  }

  if (route.name === 'lead') {
    return { name: 'lead', params: { id: rest[0] || '' }, query };
  }

  return { name: route.name, params: {}, query };
}

export function buildHash(name, { params = {}, query = {} } = {}) {
  const route = routes.find((r) => r.name === name) || routes[0];
  const path = route.path + (name === 'lead' && params.id ? `/${encodeURIComponent(params.id)}` : '');
  const search = new URLSearchParams();
  Object.entries(query || {}).forEach(([key, value]) => {
    if (value === '' || value === null || value === undefined || value === false) return;
    search.set(key, value === true ? '1' : String(value));
  });
  const qs = search.toString();
  return `#/${path}${qs ? `?${qs}` : ''}`;
}

export function currentRoute() {
  return current;
}

/** Navigate to a route (replaces history by default so back behaves naturally). */
export function navigate(name, { params = {}, query = {}, replace = false, keepScroll = false } = {}) {
  const hash = buildHash(name, { params, query });
  if (window.location.hash === hash) {
    // Same hash: force a re-render (used after data changes).
    handleHashChange({ keepScroll });
    return;
  }
  if (replace) window.history.replaceState(null, '', hash);
  else window.location.hash = hash;
  if (replace && !keepScroll) window.scrollTo({ top: 0 });
}

/** Navigate to the leads page with a filter set. */
export function goToLeads(filters = {}, { replace = false } = {}) {
  navigate('leads', {
    query: filtersToParams({ ...EMPTY_FILTERS, showClosed: true, ...filters }),
    replace,
  });
}

export function filtersFromQuery(query = {}) {
  return parseFiltersFromParams(query);
}

function handleHashChange({ keepScroll = false } = {}) {
  const next = parseHash();
  current = next;
  if (!keepScroll) window.scrollTo({ top: 0 });
  listeners.forEach((fn) => {
    try { fn(next); } catch (err) { console.error('[my crm] route handler failed', err); }
  });
}

export function onRouteChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function startRouter() {
  window.addEventListener('hashchange', () => handleHashChange());
  current = parseHash();
  return current;
}

export { routes };
