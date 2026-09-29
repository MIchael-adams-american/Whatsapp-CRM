/**
 * Smart column mapping.
 *
 * Google Sheets are never perfectly structured, so My CRM guesses which column
 * belongs to which CRM field, remembers the user's corrections, and lets them
 * override everything manually (section 13).
 */

import { CRM_FIELDS } from '../config.js';
import { parseDateValue } from '../lib/date.js';
import { normalizePhone } from '../lib/utils.js';
import { normalizeLead, normalizeStatus, normalizeInterest } from '../domain/model.js';

/** Lowercase, strip punctuation/accents so "Follow-up Date" == "follow up date". */
export function normalizeHeader(header) {
  return String(header || '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/**
 * Guess the mapping between CRM fields and sheet headers.
 * @param {string[]} headers
 * @param {object} savedMapping previously saved field -> header mapping
 * @returns {{ mapping: object, headers: string[], unmapped: string[], missing: string[] }}
 */
export function autoMapColumns(headers = [], savedMapping = {}) {
  const mapping = {};
  const used = new Set();
  const normalized = headers.map((h) => ({ header: h, norm: normalizeHeader(h) }));

  // 1. Trust the saved mapping when the header still exists.
  for (const field of CRM_FIELDS) {
    const saved = savedMapping?.[field.key];
    if (saved && headers.includes(saved)) {
      mapping[field.key] = saved;
      used.add(saved);
    }
  }

  // 2. Exact alias match.
  for (const field of CRM_FIELDS) {
    if (mapping[field.key]) continue;
    const aliases = [field.label, field.key, ...field.aliases].map(normalizeHeader);
    const hit = normalized.find((h) => !used.has(h.header) && aliases.includes(h.norm));
    if (hit) {
      mapping[field.key] = hit.header;
      used.add(hit.header);
    }
  }

  // 3. Partial match (header contains an alias, or alias contains the header).
  for (const field of CRM_FIELDS) {
    if (mapping[field.key]) continue;
    const aliases = [field.label, ...field.aliases].map(normalizeHeader);
    const hit = normalized.find((h) => {
      if (used.has(h.header)) return false;
      return aliases.some((alias) => h.norm.includes(alias) || (alias.length > 4 && alias.includes(h.norm) && h.norm.length > 3));
    });
    if (hit) {
      mapping[field.key] = hit.header;
      used.add(hit.header);
    }
  }

  const unmapped = headers.filter((h) => !used.has(h));
  const missing = CRM_FIELDS.filter((f) => !mapping[f.key]).map((f) => f.key);

  return { mapping, headers, unmapped, missing };
}

/** Analyse a sheet so the setup screen can show useful feedback. */
export function analyseSheet(headers, records, savedMapping = {}) {
  const { mapping, unmapped, missing } = autoMapColumns(headers, savedMapping);
  const sample = records.slice(0, 3);
  const filled = {};
  for (const field of CRM_FIELDS) {
    const header = mapping[field.key];
    if (!header) { filled[field.key] = false; continue; }
    filled[field.key] = sample.some((row) => String(row[header] ?? '').trim() !== '');
  }
  return {
    mapping,
    unmapped,
    missing,
    filled,
    warnings: buildWarnings(mapping, records, filled),
    previewRows: records.slice(0, 5),
  };
}

function buildWarnings(mapping, records, filled) {
  const warnings = [];
  if (!mapping.name) warnings.push({ level: 'error', message: 'No column was matched to "Lead Name". Please map it manually — every lead needs a name.' });
  else if (!filled.name) warnings.push({ level: 'warn', message: 'The mapped "Lead Name" column looks empty in the first rows. Check the header row number.' });
  if (!mapping.phone && !mapping.whatsapp && !mapping.email) {
    warnings.push({ level: 'warn', message: 'No phone, WhatsApp or email column matched. Leads will import without contact details.' });
  }
  if (!mapping.nextFollowUp) warnings.push({ level: 'info', message: 'No follow-up date column found — the CRM will treat those leads as "no follow-up" and suggest dates for you.' });
  if (records.length === 0) warnings.push({ level: 'warn', message: 'The sheet appears to have no data rows below the header.' });
  return warnings;
}

/**
 * Convert sheet records into lead objects using a mapping.
 * @param {object[]} records rows as objects (keyed by header)
 * @param {object} mapping CRM field -> header
 * @param {{headerOffset?:number}} options
 */
export function rowsToLeads(records, mapping, { headerOffset = 1 } = {}) {
  const leads = [];
  records.forEach((row, index) => {
    const get = (field) => {
      const header = mapping?.[field];
      if (!header) return '';
      const value = row[header];
      return value === undefined || value === null ? '' : String(value).trim();
    };

    const name = get('name');
    const phone = normalizePhone(get('phone'));
    const whatsapp = normalizePhone(get('whatsapp'));
    const email = get('email');

    // Skip completely empty rows, and rows with no name and no contact at all.
    const hasAnything = Object.values(row).some((v) => String(v ?? '').trim() !== '');
    if (!hasAnything) return;
    if (!name && !phone && !whatsapp && !email) return;

    const rawStatus = get('status');
    const rawInterest = get('interest');
    const status = rawStatus ? normalizeStatus(rawStatus) : (get('lastContact') ? 'Contacted' : 'New');
    const interest = rawInterest ? normalizeInterest(rawInterest, 'Cold') : 'Cold';

    const followUpCountRaw = get('followUpCount');
    const followUpCount = Number(String(followUpCountRaw).replace(/[^\d]/g, '')) || 0;

    // Keep every unmapped column so nothing from the sheet is silently lost.
    const extra = {};
    for (const [header, value] of Object.entries(row)) {
      if (Object.values(mapping || {}).includes(header)) continue;
      if (String(value ?? '').trim() === '') continue;
      extra[header] = String(value).trim();
    }

    const lead = normalizeLead({
      name: name || 'Unnamed lead',
      phone,
      whatsapp,
      email,
      course: get('course'),
      city: get('city'),
      source: get('source'),
      status,
      interest,
      lastContact: get('lastContact'),
      nextFollowUp: get('nextFollowUp'),
      notes: get('notes'),
      assignedTo: get('assignedTo'),
      followUpCount,
      lastResponse: get('lastResponse'),
      sheetRow: index + 1 + headerOffset,
      extra,
      timeline: [{
        id: `ev_sheet_${index + 1 + headerOffset}`,
        type: 'imported',
        at: new Date().toISOString(),
        text: 'Imported from Google Sheet',
      }],
    }, { preserveId: true });

    leads.push(lead);
  });
  return leads;
}

/** Guess the column type from its values (shown in the mapping UI). */
export function guessColumnType(values = []) {
  const sample = values.filter((v) => String(v ?? '').trim() !== '').slice(0, 12);
  if (!sample.length) return 'empty';
  const dateish = sample.filter((v) => parseDateValue(v) !== null).length;
  if (dateish >= Math.ceil(sample.length * 0.7)) return 'date';
  const numeric = sample.filter((v) => /^[\d+\-\s().]+$/.test(String(v))).length;
  if (numeric === sample.length) return 'number';
  return 'text';
}

export { CRM_FIELDS };
