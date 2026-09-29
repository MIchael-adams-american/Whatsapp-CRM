/**
 * Google Sheets connectivity.
 *
 * Three ways to read a sheet, tried in order so a non-technical user usually
 * only has to paste a URL:
 *
 *  1. gviz/tq CSV endpoint — works for any sheet shared as
 *     "Anyone with the link can view". No key, no setup, CORS-friendly.
 *  2. Google Sheets API `values.get` with an API key — same requirement
 *     (public sheet) but returns exact cell values.
 *  3. Your own Google Apps Script Web App URL — the recommended route for a
 *     private business sheet. Never exposes the sheet or an API key.
 *     (See docs/GOOGLE_SHEETS_SETUP.md for the 3-minute setup.)
 *
 * Writing back to the sheet is optional, never automatic, and always requires
 * an explicit confirmation + an Apps Script URL that allows writes (section 14).
 */

import { parseSheetUrl, parseCSV, rowsToObjects } from '../lib/utils.js';
import { toISODate } from '../lib/date.js';
import { rowsToLeads, analyseSheet, autoMapColumns } from './mapping.js';

export class SheetError extends Error {
  constructor(code, message, detail = '') {
    super(message);
    this.name = 'SheetError';
    this.code = code;
    this.friendly = message;
    this.detail = detail;
  }
}

const SHEET_ERRORS = {
  'bad-url': 'That does not look like a Google Sheet link. Paste the full URL from your browser address bar.',
  'not-public': 'Google refused to share this sheet. Either set sharing to "Anyone with the link – Viewer", or use the Apps Script method for a private sheet (Settings → Google Sheet).',
  'no-sheet': 'The sheet could not be found. Check that the link is correct and that you are opening the right tab.',
  network: 'Could not reach Google Sheets. Check your internet connection and try again.',
  empty: 'The sheet has no rows to import. Add some leads and sync again.',
  'no-headers': 'No header row was found. Make sure row 1 (or your chosen header row) contains the column names.',
  'apps-script': 'The Apps Script URL did not return usable data. Check that the deployment is set to "Anyone" access and returns JSON.',
  'not-configured': 'No Google Sheet is connected yet. Add your sheet link in Settings → Google Sheet.',
  'write-disabled': 'Writing back to the sheet is disabled. Enable it in Settings → Google Sheet after reading the warning.',
};

function sheetError(code, detail = '') {
  return new SheetError(code, SHEET_ERRORS[code] || 'Google Sheets request failed.', detail);
}

/* --------------------------------------------------------------- URLs -- */

export function buildGvizUrl({ spreadsheetId, gid = '', sheetName = '', range = '' }) {
  if (!spreadsheetId) throw sheetError('bad-url');
  const params = new URLSearchParams({ tqx: 'out:csv' });
  // gviz accepts ?gid= for a specific tab, ?sheet= for a tab name and ?range= for a range.
  if (gid !== '' && gid !== null && gid !== undefined) params.set('gid', String(gid));
  else if (sheetName) params.set('sheet', String(sheetName));
  if (range && /^[A-Za-z]{1,3}\d{1,7}:[A-Za-z]{1,3}\d{1,7}$/.test(String(range).trim())) {
    params.set('range', String(range).trim());
  }
  return `https://docs.google.com/spreadsheets/d/${spreadsheetId}/gviz/tq?${params.toString()}`;
}

export function buildValuesUrl({ spreadsheetId, range, apiKey, sheetName }) {
  const a1 = encodeURIComponent(range || (sheetName ? `${sheetName}!A1:Z1000` : 'A1:Z1000'));
  const key = encodeURIComponent(apiKey || '');
  return `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${a1}?key=${key}&majorDimension=ROWS&valueRenderOption=FORMATTED_VALUE`;
}

export function sheetEditUrl(spreadsheetId, gid = '') {
  if (!spreadsheetId) return '';
  return `https://docs.google.com/spreadsheets/d/${spreadsheetId}/edit${gid !== '' && gid !== null && gid !== undefined ? `#gid=${gid}` : ''}`;
}

/* ---------------------------------------------------------- fetching -- */

async function fetchText(url, { timeout = 25000, headers = {} } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    const response = await fetch(url, { headers, signal: controller.signal, redirect: 'follow' });
    if (!response.ok) {
      if (response.status === 401 || response.status === 403) throw sheetError('not-public', `HTTP ${response.status}`);
      if (response.status === 404) throw sheetError('no-sheet', `HTTP ${response.status}`);
      throw sheetError('network', `HTTP ${response.status}`);
    }
    return await response.text();
  } catch (error) {
    if (error instanceof SheetError) throw error;
    if (error?.name === 'AbortError') throw sheetError('network', 'Request timed out.');
    throw sheetError('network', String(error?.message || error));
  } finally {
    clearTimeout(timer);
  }
}

/** Fetch the sheet as CSV rows using the gviz endpoint. */
export async function fetchSheetCsv(config) {
  const url = buildGvizUrl(config);
  const text = await fetchText(url);
  if (/<html/i.test(text.slice(0, 200)) && !text.includes(',')) {
    throw sheetError('not-public', 'Received an HTML login page instead of CSV.');
  }
  const rows = parseCSV(text);
  if (!rows.length) throw sheetError('empty');
  return rows;
}

/** Fetch rows through the Sheets API (public sheets + API key). */
export async function fetchSheetApi(config) {
  if (!config.apiKey) throw sheetError('not-public', 'No API key provided.');
  const url = buildValuesUrl(config);
  const text = await fetchText(url);
  let json = null;
  try { json = JSON.parse(text); } catch { /* handled below */ }
  if (!json) throw sheetError('network', 'Unexpected response from the Sheets API.');
  if (json.error) {
    const status = String(json.error.status || '');
    if (status === 'PERMISSION_DENIED' || status === 'UNAUTHENTICATED') throw sheetError('not-public', json.error.message);
    if (status === 'NOT_FOUND') throw sheetError('no-sheet', json.error.message);
    throw sheetError('network', json.error.message);
  }
  const rows = json.values || [];
  if (!rows.length) throw sheetError('empty');
  return rows.map((row) => row.map((cell) => (cell === null || cell === undefined ? '' : String(cell))));
}

/**
 * Fetch rows through the user's own Apps Script Web App.
 * The deployed script must answer GET with { ok: true, rows: [[...], ...] }
 * or { ok: true, values: [[...]] }.
 */
export async function fetchSheetAppsScript(config, params = {}) {
  const base = (config.appsScriptUrl || '').trim();
  if (!base) throw sheetError('apps-script', 'No Apps Script URL configured.');
  const url = new URL(base);
  url.searchParams.set('action', params.action || 'rows');
  if (config.sheetName) url.searchParams.set('sheet', config.sheetName);
  if (params.action === 'meta') url.searchParams.set('meta', '1');

  const text = await fetchText(url.toString());
  let json = null;
  try { json = JSON.parse(text); } catch { /* handled below */ }
  if (!json || json.ok === false) {
    throw sheetError('apps-script', json?.error || 'Unreadable response');
  }
  const rows = json.rows || json.values || (Array.isArray(json.data) ? json.data : null);
  if (!Array.isArray(rows) || !rows.length) throw sheetError('empty');
  return rows.map((row) => (Array.isArray(row) ? row.map((c) => (c === null || c === undefined ? '' : String(c))) : [String(row)]));
}

/** Try every configured adapter until one returns rows. */
export async function fetchSheetRows(config) {
  const attempts = [];
  const errors = [];

  if ((config.appsScriptUrl || '').trim()) {
    attempts.push(['apps-script', () => fetchSheetAppsScript(config)]);
  }
  if (config.spreadsheetId) {
    attempts.push(['gviz', () => fetchSheetCsv(config)]);
    if ((config.apiKey || '').trim()) attempts.push(['api', () => fetchSheetApi(config)]);
  }

  if (!attempts.length) throw sheetError('not-configured');

  for (const [name, run] of attempts) {
    try {
      const rows = await run();
      return { rows, via: name };
    } catch (error) {
      errors.push({ name, code: error.code || 'network', message: error.friendly || error.message });
      if (error.code === 'empty') throw error;
    }
  }

  // Prefer the most informative failure so the user gets actionable advice.
  const priority = ['not-public', 'no-sheet', 'no-headers', 'apps-script', 'bad-url', 'network'];
  const detail = errors.map((e) => `${e.name}: ${e.message}`).join(' | ');
  const pick = priority.find((code) => errors.some((e) => e.code === code));
  if (pick && pick !== 'network') throw sheetError(pick, detail);
  throw sheetError('network', detail);
}

/* ------------------------------------------------------- import flow -- */

/**
 * Full import: fetch rows, parse headers, map columns, build leads.
 * @returns {Promise<{leads:Array, headers:string[], mapping:object, analysis:object, vias:string, rowCount:number}>}
 */
export async function importSheet(config, { savedMapping = {}, headerRow = 1 } = {}) {
  const { rows, via } = await fetchSheetRows(config);
  const headerIndex = Math.max(0, Number(headerRow || 1) - 1);
  if (rows.length <= headerIndex) throw sheetError('no-headers');

  const headers = rows[headerIndex].map((h) => String(h ?? '').trim()).filter((h) => h !== '');
  if (!headers.length) throw sheetError('no-headers');

  const dataRows = rows.slice(headerIndex + 1);
  const records = rowsToObjects([rows[headerIndex], ...dataRows]).records;
  const analysis = analyseSheet(headers, records, savedMapping);
  const mapping = { ...analysis.mapping, ...stripEmpty(savedMapping) };

  const leads = rowsToLeads(records, mapping, { headerOffset: headerIndex });

  return {
    leads,
    headers,
    records,
    mapping,
    analysis: { ...analysis, mapping },
    via,
    rowCount: dataRows.length,
  };
}

function stripEmpty(obj = {}) {
  const out = {};
  for (const [k, v] of Object.entries(obj || {})) {
    if (v) out[k] = v;
  }
  return out;
}

/** Preview without importing — used by the setup wizard. */
export async function previewSheet(config, { headerRow = 1 } = {}) {
  const { rows, via } = await fetchSheetRows(config);
  const headerIndex = Math.max(0, Number(headerRow || 1) - 1);
  const rawHeaders = rows[headerIndex] || [];
  const headers = rawHeaders.map((h) => String(h ?? '').trim()).filter(Boolean);
  const records = rowsToObjects([rawHeaders, ...rows.slice(headerIndex + 1)]).records;
  const analysis = analyseSheet(headers, records);
  return { headers, records, analysis, via, totalRows: Math.max(0, rows.length - headerIndex - 1) };
}

/* --------------------------------------------------- change detection -- */

/**
 * Merge freshly imported leads with the ones already on the device.
 * Locally-created leads (added in the CRM) are preserved, and existing timelines
 * are kept so activity history is never lost (section 14).
 */
export function mergeSheetLeads(existing, incoming) {
  const byId = new Map(existing.map((lead) => [lead.id, lead]));
  const added = [];
  const updated = [];
  const unchanged = [];
  const removed = [];
  const seen = new Set();

  for (const lead of incoming) {
    seen.add(lead.id);
    const current = byId.get(lead.id);
    if (!current) {
      added.push(lead);
      continue;
    }
    const merged = {
      ...current,
      ...lead,
      id: current.id,
      timeline: mergeTimelines(current.timeline, lead.timeline),
      aiSuggest: current.aiSuggest,
      createdAt: current.createdAt || lead.createdAt,
      updatedAt: new Date().toISOString(),
    };
    if (current.signature === lead.signature) {
      unchanged.push(merged);
    } else {
      updated.push({ before: current, after: merged });
    }
  }

  // Leads on this device that the sheet no longer contains: local-only leads are
  // always kept; sheet-sourced ones are reported so the caller can decide.
  const localOnly = existing.filter((lead) => !seen.has(lead.id) && lead.localOnly);
  existing.forEach((lead) => {
    if (!seen.has(lead.id) && !lead.localOnly) removed.push(lead);
  });

  return {
    removed,
    leads: [...incoming.map((lead) => {
      const current = byId.get(lead.id);
      if (!current) return lead;
      return {
        ...current,
        ...lead,
        id: current.id,
        timeline: mergeTimelines(current.timeline, lead.timeline),
        aiSuggest: current.aiSuggest,
        createdAt: current.createdAt || lead.createdAt,
      };
    }), ...localOnly],
    added,
    updated,
    unchanged: unchanged.length,
  };
}

function mergeTimelines(current = [], incoming = []) {
  const map = new Map();
  for (const entry of [...current, ...incoming]) {
    if (!entry) continue;
    const key = `${entry.type}|${entry.at}|${entry.text}`;
    if (!map.has(key)) map.set(key, entry);
  }
  return Array.from(map.values()).sort((a, b) => String(a.at).localeCompare(String(b.at)));
}

/** Describe what changed in a language a non-technical user understands. */
export function describeSync({ added = [], updated = [], unchanged = 0, removed = [] }, total) {
  const bits = [];
  if (added.length) bits.push(`${added.length} new`);
  if (updated.length) bits.push(`${updated.length} updated`);
  if (removed.length) bits.push(`${removed.length} no longer in the sheet`);
  if (unchanged) bits.push(`${unchanged} unchanged`);
  return bits.length ? `${bits.join(' · ')} (${total} leads in the sheet)` : `No changes detected (${total} leads)`;
}

/* ------------------------------------------------------- write-back -- */

/**
 * Write a single cell range back to the sheet through Apps Script.
 * Only ever called after explicit user confirmation.
 */
export async function writeBack({ appsScriptUrl, sheetName, row, values, spreadsheetId }) {
  if (!appsScriptUrl) throw sheetError('write-disabled', 'Writing requires an Apps Script URL with write access enabled.');
  const response = await fetch(appsScriptUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify({ action: 'updateRow', sheet: sheetName || '', row, values, spreadsheetId: spreadsheetId || '' }),
  });
  const text = await response.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* handled below */ }
  if (!response.ok || !json || json.ok === false) {
    throw sheetError('apps-script', json?.error || `Write failed (HTTP ${response.status})`);
  }
  return json;
}

/** Ask the Apps Script endpoint for sheet metadata (tabs, row count). */
export async function fetchSheetMeta(config) {
  try {
    const text = await fetchTextWithTimeout(`${config.appsScriptUrl}${config.appsScriptUrl.includes('?') ? '&' : '?'}action=meta`, 12000);
    const json = JSON.parse(text);
    return { ok: true, data: json };
  } catch (error) {
    return { ok: false, error: error.friendly || error.message };
  }
}

async function fetchTextWithTimeout(url, timeout) {
  return fetchText(url, { timeout });
}

export { parseSheetUrl, autoMapColumns, toISODate };
