/**
 * Application state + browser persistence.
 *
 * Everything is client-side: leads, settings, sheet config and the AI cache are
 * kept in localStorage under the "mycrm.v1." namespace so the app can run as a
 * pure static site (Netlify / Vercel / GitHub Pages) with no backend.
 */

import { deepClone, safeJSONParse } from './utils.js';

const NS = 'mycrm.v1.';
const memoryFallback = new Map();
let storageAvailable = null;

function hasLocalStorage() {
  if (storageAvailable !== null) return storageAvailable;
  try {
    const probe = `${NS}__probe__`;
    window.localStorage.setItem(probe, '1');
    window.localStorage.removeItem(probe);
    storageAvailable = true;
  } catch {
    storageAvailable = false;
  }
  return storageAvailable;
}

export const storage = {
  get(key, fallback = null) {
    const full = NS + key;
    try {
      const raw = hasLocalStorage() ? window.localStorage.getItem(full) : memoryFallback.get(full);
      if (raw === null || raw === undefined) return fallback;
      const parsed = safeJSONParse(raw, undefined);
      return parsed === undefined ? fallback : parsed;
    } catch {
      return fallback;
    }
  },
  set(key, value) {
    const full = NS + key;
    try {
      const raw = JSON.stringify(value);
      if (hasLocalStorage()) window.localStorage.setItem(full, raw);
      else memoryFallback.set(full, raw);
      return true;
    } catch {
      // Quota exceeded or storage blocked — keep the session usable in memory.
      try { memoryFallback.set(full, JSON.stringify(value)); } catch { /* ignore */ }
      return false;
    }
  },
  remove(key) {
    const full = NS + key;
    try {
      if (hasLocalStorage()) window.localStorage.removeItem(full);
      memoryFallback.delete(full);
    } catch { /* ignore */ }
  },
  /** Remove every key this app owns. Used by "Disconnect & remove stored data". */
  clearAll() {
    try {
      if (hasLocalStorage()) {
        const keys = [];
        for (let i = 0; i < window.localStorage.length; i += 1) {
          const k = window.localStorage.key(i);
          if (k && k.startsWith(NS)) keys.push(k);
        }
        keys.forEach((k) => window.localStorage.removeItem(k));
      }
      memoryFallback.clear();
    } catch { /* ignore */ }
  },
  isPersistent() {
    return hasLocalStorage();
  },
};

/* ------------------------------------------------------------- defaults -- */

export const DEFAULT_SETTINGS = {
  /** Gemini API key (stored locally in your browser only). */
  geminiApiKey: '',
  /** Gemini model id. */
  geminiModel: 'gemini-2.0-flash',
  /** Optional serverless proxy endpoint that holds the key server-side. */
  aiProxyUrl: '',
  /** Send only the minimum lead fields to the AI. */
  aiMinimalPayload: true,
  /** Cache AI results until the lead actually changes. */
  aiCacheEnabled: true,
  /** Owner / agency details used to personalise generated messages. */
  businessName: '',
  senderName: '',
  countryCode: '',
  currency: 'PKR',
  /** Greeting style for generated messages: auto | salam | hello | formal. */
  messageGreeting: 'auto',
  /** Allow writing back to the sheet (always asks for confirmation first). */
  sheetWriteBackEnabled: false,
  dailySummaryEnabled: true,
  notificationsDismissed: {},
};

export const DEFAULT_SHEET = {
  url: '',
  spreadsheetId: '',
  gid: '',
  sheetName: '',
  /** Custom Apps Script Web App URL (works for private sheets). */
  appsScriptUrl: '',
  /** Optional Google Sheets API key — only works for public sheets. */
  apiKey: '',
  /** Column headers detected on the last successful import (drives column mapping UI). */
  headers: [],
  /** Column mapping: CRM field -> header name in the sheet. */
  columns: {},
  /** Row number that holds the column headers. */
  headerRow: 1,
  /** Restrict import to a range such as "A1:L500" (optional). */
  range: '',
  /** Last successful sync metadata. */
  lastSyncAt: '',
  lastSyncStatus: '',
  lastSyncMessage: '',
  lastSyncCount: 0,
  /** Per-row hash of the sheet digest, used for change detection. */
  rowSignatures: {},
  autoSyncEnabled: false,
  autoSyncMinutes: 15,
};

/* ---------------------------------------------------------------- store -- */

class Store {
  constructor(initial) {
    this.state = deepClone(initial);
    this.listeners = new Set();
  }

  get(key) {
    return key ? this.state[key] : this.state;
  }

  /** Shallow-merge a patch and notify subscribers. */
  set(patch, reason = 'update') {
    this.state = { ...this.state, ...patch };
    this.listeners.forEach((fn) => {
      try { fn(this.state, reason, patch); } catch (err) { console.error('[my crm] listener failed', err); }
    });
    return this.state;
  }

  subscribe(fn) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }
}

export const store = new Store({
  route: { name: 'dashboard', params: {} },
  hydrated: false,
  source: 'demo', // 'demo' | 'sheet'
  leads: [],
  settings: { ...DEFAULT_SETTINGS },
  sheet: { ...DEFAULT_SHEET },
  aiCache: {},
  aiMeta: { dailySummary: null, insights: null, lastRunAt: '' },
  activity: [],
});

/* ---------------------------------------------------------- persistence -- */

export function loadPersistedState() {
  const settings = { ...DEFAULT_SETTINGS, ...(storage.get('settings', {}) || {}) };
  const sheet = { ...DEFAULT_SHEET, ...(storage.get('sheet', {}) || {}) };
  const leads = storage.get('leads', []) || [];
  const source = storage.get('source', 'demo') || 'demo';
  const aiCache = storage.get('aiCache', {}) || {};
  const aiMeta = storage.get('aiMeta', { dailySummary: null, insights: null, lastRunAt: '' }) || {};
  const ui = storage.get('ui', {}) || {};
  return { settings, sheet, leads, source, aiCache, aiMeta, ui };
}

export function persistSettings() {
  storage.set('settings', store.get('settings'));
}

export function persistSheet() {
  storage.set('sheet', store.get('sheet'));
}

export function persistLeads() {
  storage.set('leads', store.get('leads'));
  storage.set('source', store.get('source'));
}

export function persistAiCache() {
  storage.set('aiCache', store.get('aiCache'));
  storage.set('aiMeta', store.get('aiMeta'));
}

export function persistUi(ui) {
  storage.set('ui', ui);
}

/** Wipe everything this app stored (used by the "remove data" settings action). */
export function purgeAllData() {
  storage.clearAll();
}

export function updateSheetConfig(patch) {
  store.set({ sheet: { ...store.get('sheet'), ...patch } }, 'sheet');
  persistSheet();
  return store.get('sheet');
}

export function updateSettings(patch) {
  store.set({ settings: { ...store.get('settings'), ...patch } }, 'settings');
  persistSettings();
  return store.get('settings');
}

export function replaceLeads(leads, source = store.get('source')) {
  store.set({ leads, source }, 'leads');
  persistLeads();
}

export function patchLead(leadId, patch, { touch = true } = {}) {
  const leads = store.get('leads').map((lead) => {
    if (lead.id !== leadId) return lead;
    const next = { ...lead, ...patch };
    next.signature = signatureOf(next);
    if (touch) next.updatedAt = new Date().toISOString();
    return next;
  });
  store.set({ leads }, 'leads');
  persistLeads();
  return leads.find((l) => l.id === leadId) || null;
}

export function addLead(lead) {
  const leads = [lead, ...store.get('leads')];
  store.set({ leads }, 'leads');
  persistLeads();
  return lead;
}

export function removeLead(leadId) {
  const leads = store.get('leads').filter((l) => l.id !== leadId);
  store.set({ leads }, 'leads');
  persistLeads();
}

/** Fields that change how a lead is scored / analysed. */
export const SIGNATURE_FIELDS = [
  'name', 'phone', 'whatsapp', 'email', 'course', 'city', 'source', 'status',
  'interest', 'lastContact', 'nextFollowUp', 'notes', 'assignedTo', 'followUpCount',
];

export function signatureOf(lead) {
  return SIGNATURE_FIELDS.map((f) => String(lead?.[f] ?? '')).join('|');
}

/* ------------------------------------------------------------- AI cache -- */

export function getCachedAnalysis(key) {
  const cache = store.get('aiCache') || {};
  return cache[key] || null;
}

export function setCachedAnalysis(key, value) {
  const cache = { ...(store.get('aiCache') || {}) };
  cache[key] = value;
  // Keep the cache bounded so localStorage never fills up.
  const keys = Object.keys(cache);
  if (keys.length > 400) {
    keys.sort((a, b) => String(cache[a]?.at || '').localeCompare(String(cache[b]?.at || '')));
    keys.slice(0, keys.length - 400).forEach((k) => delete cache[k]);
  }
  store.set({ aiCache: cache }, 'ai');
  persistAiCache();
}

export function clearAiCache() {
  store.set({ aiCache: {}, aiMeta: { dailySummary: null, insights: null, lastRunAt: '' } }, 'ai');
  persistAiCache();
}

export function setAiMeta(patch) {
  store.set({ aiMeta: { ...store.get('aiMeta'), ...patch } }, 'ai');
  persistAiCache();
}

/** Append to the app-level activity log (settings page shows the last entries). */
export function logActivity(entry) {
  const activity = [{ at: new Date().toISOString(), ...entry }, ...store.get('activity')].slice(0, 50);
  store.set({ activity }, 'activity');
}

export function isDemoSource() {
  return store.get('source') !== 'sheet';
}
