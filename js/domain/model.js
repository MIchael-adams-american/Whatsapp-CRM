/**
 * The Lead model: normalisation, validation and timeline helpers.
 *
 * Every lead that enters the app (demo data, Google Sheet row, CSV import,
 * manual entry) passes through `normalizeLead`, so the rest of the app can rely
 * on a consistent shape and never crash on missing values.
 */

import { EMPTY_LEAD, INTEREST_LEVELS, LEAD_STATUSES, CRM_FIELDS } from '../config.js';
import { toISODate, nowISO } from '../lib/date.js';
import { hashString, normalizePhone, titleCase, uniq, uid, emptyToNull } from '../lib/utils.js';
import { SIGNATURE_FIELDS } from '../lib/store.js';

const STATUS_ALIASES = {
  new: 'New',
  fresh: 'New',
  'new lead': 'New',
  contacted: 'Contacted',
  'in progress': 'Contacted',
  called: 'Contacted',
  interested: 'Interested',
  'very interested': 'Interested',
  'follow up': 'Follow-up',
  'follow-up': 'Follow-up',
  followup: 'Follow-up',
  pending: 'Follow-up',
  hot: 'Hot',
  'hot lead': 'Hot',
  converted: 'Converted',
  won: 'Converted',
  enrolled: 'Converted',
  registered: 'Converted',
  'not interested': 'Not Interested',
  notinterested: 'Not Interested',
  'no interest': 'Not Interested',
  lost: 'Lost',
  dead: 'Lost',
  cold: 'Not Interested',
};

const INTEREST_ALIASES = {
  cold: 'Cold',
  low: 'Cold',
  cool: 'Cold',
  warm: 'Warm',
  medium: 'Warm',
  mild: 'Warm',
  hot: 'Hot',
  high: 'Hot',
  'very hot': 'Hot',
  urgent: 'Hot',
};

export function normalizeStatus(value, fallback = 'New') {
  if (!value) return fallback;
  const key = String(value).trim().toLowerCase().replace(/\s+/g, ' ');
  return STATUS_ALIASES[key] || STATUS_ALIASES[key.replace(/[\s_-]/g, '')] || fallback;
}

export function normalizeInterest(value, fallback = 'Cold') {
  if (!value) return fallback;
  const key = String(value).trim().toLowerCase();
  return INTEREST_ALIASES[key] || fallback;
}

export function isKnownStatus(value) {
  return LEAD_STATUSES.includes(value);
}

export function isKnownInterest(value) {
  return INTEREST_LEVELS.includes(value);
}

/** Infer a sensible interest level from status when the sheet has no column. */
function inferInterest(status, fallback = 'Cold') {
  switch (status) {
    case 'Hot': return 'Hot';
    case 'Interested': return 'Warm';
    case 'Follow-up': return 'Warm';
    case 'Converted': return 'Hot';
    default: return fallback;
  }
}

/**
 * Turn any partial object into a complete, safe lead.
 * `opts.preserveId` keeps an existing id (used when merging sheet updates).
 */
export function normalizeLead(input = {}, opts = {}) {
  const lead = { ...EMPTY_LEAD, ...(input || {}) };

  lead.name = clean(lead.name) || 'Unnamed lead';
  lead.phone = normalizePhone(lead.phone);
  lead.whatsapp = normalizePhone(lead.whatsapp) || lead.phone;
  lead.email = clean(lead.email);
  lead.course = clean(lead.course);
  lead.city = titleCase(clean(lead.city));
  lead.source = titleCase(clean(lead.source));
  lead.assignedTo = clean(lead.assignedTo);
  lead.lastResponse = clean(lead.lastResponse);
  lead.notes = clean(lead.notes);
  lead.status = normalizeStatus(lead.status);
  lead.interest = normalizeInterest(lead.interest, inferInterest(lead.status));

  lead.lastContact = toISODate(lead.lastContact) || '';
  lead.nextFollowUp = toISODate(lead.nextFollowUp) || '';

  const followCount = Number(lead.followUpCount);
  lead.followUpCount = Number.isFinite(followCount) && followCount >= 0 ? Math.floor(followCount) : 0;

  lead.timeline = Array.isArray(lead.timeline) ? lead.timeline.filter(Boolean).map(normalizeTimelineEntry) : [];
  lead.aiSuggest = lead.aiSuggest && typeof lead.aiSuggest === 'object' ? lead.aiSuggest : null;
  lead.extra = lead.extra && typeof lead.extra === 'object' ? lead.extra : {};

  lead.createdAt = lead.createdAt || (lead.timeline.length ? earliestAt(lead.timeline) : nowISO());
  lead.updatedAt = lead.updatedAt || lead.createdAt;

  lead.sheetRow = Number.isFinite(Number(lead.sheetRow)) ? Number(lead.sheetRow) : null;

  if (!lead.id || !opts.preserveId) {
    lead.id = lead.id && opts.forceId ? lead.id : (lead.id || makeLeadId(lead));
  }

  if (!lead.timeline.length) {
    lead.timeline.push({
      id: uid('ev'),
      type: 'created',
      at: lead.createdAt,
      text: 'Lead added to My CRM',
    });
  }

  lead.signature = signatureOfLead(lead);
  return lead;
}

function clean(value) {
  if (value === null || value === undefined) return '';
  return String(value).replace(/\s+/g, ' ').trim();
}

function normalizeTimelineEntry(entry) {
  if (typeof entry === 'string') {
    return { id: uid('ev'), type: 'note', at: nowISO(), text: entry };
  }
  return {
    id: entry.id || uid('ev'),
    type: entry.type || 'note',
    at: entry.at || nowISO(),
    text: entry.text || '',
    meta: entry.meta || null,
  };
}

function earliestAt(timeline) {
  return timeline
    .map((e) => e.at)
    .filter(Boolean)
    .sort()[0] || nowISO();
}

/**
 * Stable id derived from the phone number (or email / name+course+city), so a
 * repeated sheet sync never duplicates a lead and two spellings of the same
 * number ("+92 300…" and "0092 300…") resolve to the same record.
 */
export function makeLeadId(lead) {
  const basis = canonicalContact(lead.phone || lead.whatsapp) || lead.email || `${lead.name}|${lead.course}|${lead.city}`;
  return `lead_${hashString(basis.toLowerCase())}`;
}

function canonicalContact(value) {
  const digits = String(value || '').replace(/\D/g, '');
  // Strip international/trunk prefixes so 00923001234567 === 923001234567 === 03001234567.
  return digits.replace(/^0+/, '');
}

export function signatureOfLead(lead) {
  return SIGNATURE_FIELDS.map((field) => String(lead?.[field] ?? '')).join('|');
}

/** Create a brand-new lead from form input. */
export function createLead(input = {}) {
  const now = nowISO();
  const lead = normalizeLead({
    ...input,
    id: makeLeadId(input),
    createdAt: now,
    updatedAt: now,
    timeline: [{
      id: uid('ev'),
      type: 'created',
      at: now,
      text: input.createdVia ? `Lead created (${input.createdVia})` : 'Lead created',
    }],
  }, { preserveId: true, forceId: false });
  return lead;
}

export function addTimelineEvent(lead, event) {
  const entry = normalizeTimelineEntry(event);
  return {
    ...lead,
    timeline: [...(lead.timeline || []), entry],
    updatedAt: nowISO(),
  };
}

/* ---------------------------------------------------------- validation -- */

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

/**
 * Validate lead form input. Returns { valid, errors, value }.
 * Only a name plus one contact method is mandatory — keep it easy for
 * non-technical users.
 */
export function validateLeadInput(input = {}) {
  const errors = {};
  const value = { ...input };

  const name = clean(input.name);
  if (!name) errors.name = 'Please enter the lead name.';
  else if (name.length > 120) errors.name = 'Name looks too long.';

  const phone = normalizePhone(input.phone);
  const whatsapp = normalizePhone(input.whatsapp);
  const email = clean(input.email);

  if (!phone && !whatsapp && !email) {
    errors.phone = 'Add a phone, WhatsApp number or email so you can contact this lead.';
  }

  const digits = phone.replace(/\+/g, '');
  if (phone && digits.length < 6) errors.phone = 'That phone number looks too short.';
  if (whatsapp && whatsapp.replace(/\+/g, '').length < 6) errors.whatsapp = 'That WhatsApp number looks too short.';

  if (email && !EMAIL_RE.test(email)) errors.email = 'That email address looks invalid.';

  for (const field of CRM_FIELDS) {
    if (field.type !== 'date') continue;
    const raw = input[field.key];
    if (raw && !toISODate(raw)) errors[field.key] = 'Please pick a valid date.';
  }

  return { valid: Object.keys(errors).length === 0, errors, value };
}

/* ------------------------------------------------------------- helpers -- */

/** All linkable identifiers for a lead (used by search). */
export function leadSearchBlob(lead) {
  return [
    lead.name, lead.phone, lead.whatsapp, lead.email, lead.course, lead.city,
    lead.source, lead.status, lead.interest, lead.assignedTo, lead.notes,
    lead.lastResponse, ...Object.values(lead.extra || {}),
  ].filter(Boolean).join(' ').toLowerCase();
}

/** Distinct values for filter dropdowns. */
export function distinctValues(leads, key) {
  return uniq(leads.map((lead) => lead[key]).filter((v) => v !== '' && v !== null && v !== undefined))
    .sort((a, b) => String(a).localeCompare(String(b)));
}

/** Merge a fresh sheet record into an existing lead without losing local data. */
export function mergeLead(existing, incoming) {
  const merged = { ...existing, ...incoming, id: existing.id, timeline: existing.timeline || [] };
  const changed = SIGNATURE_FIELDS.some((f) => String(existing?.[f] ?? '') !== String(merged?.[f] ?? ''));
  merged.updatedAt = existing.updatedAt;
  merged.createdAt = existing.createdAt || incoming.createdAt;
  return { lead: normalizeLead(merged, { preserveId: true }), changed };
}

export { emptyToNull };
