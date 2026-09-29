/**
 * One filter model shared by the Leads page, dashboard tiles, quick actions and
 * notification drill-downs. Everything is expressed as a plain object so it can
 * be stored in the URL hash and replayed later.
 */

import { followUpState, isClosed, daysSinceContact, hasReplied, findForgottenLeads } from './followup.js';
import { leadSearchBlob } from './model.js';
import { daysFromToday, todayISO, addDaysISO } from '../lib/date.js';

export const EMPTY_FILTERS = {
  q: '',
  status: '',
  course: '',
  city: '',
  interest: '',
  source: '',
  assignedTo: '',
  bucket: '',      // overdue | today | tomorrow | week | upcoming | none | dueOrOverdue
  lastContact: '', // 7 | 14 | 30 -> "not contacted in N days"
  tag: '',         // hot | new | no-response | uncontacted | no-followup | replied | priority-high
  ids: '',         // comma separated lead ids (notification drill-down)
  showClosed: false,
};

/** Pseudo-keywords understood by the search box. */
const SMART_KEYWORDS = {
  overdue: { bucket: 'overdue', label: 'Overdue follow-ups' },
  late: { bucket: 'overdue', label: 'Overdue follow-ups' },
  today: { bucket: 'today', label: 'Due today' },
  tomorrow: { bucket: 'tomorrow', label: 'Due tomorrow' },
  week: { bucket: 'week', label: 'Due this week' },
  upcoming: { bucket: 'upcoming', label: 'Upcoming follow-ups' },
  hot: { tag: 'hot', label: 'Hot leads' },
  new: { status: 'New', label: 'New leads' },
  'no-response': { tag: 'no-response', label: 'Leads with no response' },
  noresponse: { tag: 'no-response', label: 'Leads with no response' },
  silent: { tag: 'no-response', label: 'Leads with no response' },
  converted: { status: 'Converted', label: 'Converted leads' },
  lost: { status: 'Lost', label: 'Lost leads' },
  interested: { status: 'Interested', label: 'Interested leads' },
  forgotten: { tag: 'no-followup', label: 'Forgotten leads (no next follow-up)' },
  'no-followup': { tag: 'no-followup', label: 'Leads with no next follow-up' },
  uncontacted: { tag: 'uncontacted', label: 'Never contacted' },
  replied: { tag: 'replied', label: 'Leads that replied' },
  priority: { tag: 'priority-high', label: 'High priority leads' },
  urgent: { tag: 'priority-high', label: 'High priority leads' },
};

/**
 * Parse a search string into free text + recognised smart filters.
 * "hot NVQ" => { text: 'NVQ', filters: { tag: 'hot' } }
 */
export function parseSmartQuery(rawQuery) {
  const raw = String(rawQuery || '').trim();
  if (!raw) return { text: '', filters: {}, keywords: [] };

  const filters = {};
  const keywords = [];
  const textParts = [];

  for (const token of raw.split(/\s+/)) {
    const key = token.toLowerCase().replace(/"/g, '');
    if (SMART_KEYWORDS[key]) {
      const applied = SMART_KEYWORDS[key];
      Object.assign(filters, applied);
      keywords.push(applied.label);
    } else if (/^\d+\s*days?$/i.test(key)) {
      const days = parseInt(key, 10);
      if (days > 0) { filters.lastContact = String(days); keywords.push(`Not contacted in ${days} days`); }
    } else {
      textParts.push(token);
    }
  }

  return { text: textParts.join(' '), filters, keywords };
}

export function parseFiltersFromParams(params = {}) {
  const filters = { ...EMPTY_FILTERS };
  for (const key of Object.keys(EMPTY_FILTERS)) {
    if (params[key] === undefined || params[key] === null) continue;
    if (key === 'showClosed') filters[key] = params[key] === true || params[key] === '1' || params[key] === 'true';
    else filters[key] = String(params[key]);
  }
  return filters;
}

export function filtersToParams(filters) {
  const out = {};
  for (const [key, value] of Object.entries(filters || {})) {
    if (value === '' || value === null || value === undefined || value === false) continue;
    out[key] = value === true ? '1' : String(value);
  }
  return out;
}

export function isFilterActive(filters) {
  return Object.entries(filters || {}).some(([key, value]) => {
    if (value === '' || value === null || value === undefined || value === false) return false;
    return key !== 'showClosed';
  });
}

export function activeFilterCount(filters) {
  return Object.entries(filters || {}).filter(([key, value]) => value && value !== '' && key !== 'q' && key !== 'showClosed').length;
}

/** Apply every filter + search text. Returns a new array. */
export function applyFilters(leads, filters = {}, now = new Date()) {
  const f = { ...EMPTY_FILTERS, ...(filters || {}) };
  const { text, filters: smartFilters } = parseSmartQuery(f.q);
  const merged = { ...f, ...smartFilters };
  const tokens = text.toLowerCase().split(/\s+/).filter(Boolean);

  const result = leads.filter((lead) => {
    // Closed leads (Converted / Not Interested / Lost) stay out of working views
    // unless the user explicitly asks for them by status or via "show closed".
    if (!merged.showClosed && isClosed(lead) && !merged.status) return false;

    if (merged.status && lead.status !== merged.status) return false;
    if (merged.course && lead.course !== merged.course) return false;
    if (merged.city && lead.city !== merged.city) return false;
    if (merged.interest && lead.interest !== merged.interest) return false;
    if (merged.source && lead.source !== merged.source) return false;
    if (merged.assignedTo && lead.assignedTo !== merged.assignedTo) return false;

    if (merged.ids) {
      const idSet = String(merged.ids).split(',').map((s) => s.trim()).filter(Boolean);
      if (idSet.length && !idSet.includes(lead.id)) return false;
    }

    if (merged.bucket) {
      if (isClosed(lead)) return false;
      const state = followUpState(lead, now);
      if (merged.bucket === 'dueOrOverdue') {
        if (!['overdue', 'today'].includes(state.bucket)) return false;
      } else if (merged.bucket === 'upcoming') {
        if (!['today', 'tomorrow', 'week', 'upcoming'].includes(state.bucket)) return false;
      } else if (merged.bucket === 'week') {
        if (!['today', 'tomorrow', 'week'].includes(state.bucket)) return false;
      } else if (state.bucket !== merged.bucket) {
        return false;
      }
    }

    if (merged.lastContact) {
      const days = Number(merged.lastContact);
      const since = daysSinceContact(lead, now);
      if (since === null || Number.isNaN(days) || since < days) return false;
    }

    if (merged.tag && !matchesTag(lead, merged.tag, now)) return false;

    if (tokens.length) {
      const blob = leadSearchBlob(lead);
      const allMatch = tokens.every((token) => blob.includes(token));
      if (!allMatch) return false;
    }

    return true;
  });

  return result;
}

function matchesTag(lead, tag, now) {
  switch (tag) {
    case 'hot':
      return lead.interest === 'Hot' || lead.status === 'Hot';
    case 'new':
      return lead.status === 'New';
    case 'no-response':
      return !hasReplied(lead) && (daysSinceContact(lead, now) ?? 0) >= 5;
    case 'uncontacted':
      return !lead.lastContact;
    case 'no-followup':
      return !isClosed(lead) && !lead.nextFollowUp;
    case 'replied':
      return hasReplied(lead);
    case 'priority-high':
      return ['very-high', 'high'].includes(lead._priority?.level || computeLevelViaRank(lead, now));
    default:
      return true;
  }
}

/** Lazy import avoidance: compute priority level only when needed. */
function computeLevelViaRank(lead, now) {
  // Kept local to avoid a circular import at module load time.
  const hot = lead.interest === 'Hot' || lead.status === 'Hot';
  const due = lead.nextFollowUp ? daysFromToday(lead.nextFollowUp, now) : null;
  if (hot && due !== null && due <= 0) return 'very-high';
  if (hot || (due !== null && due < 0)) return 'high';
  return 'low';
}

/** Human sentence describing the current filter set, e.g. "Overdue follow-ups". */
export function describeFilters(filters = {}) {
  const bits = [];
  const { keywords } = parseSmartQuery(filters.q || '');
  keywords.forEach((k) => bits.push(k));
  if (filters.bucket && !keywords.length) {
    const labels = {
      overdue: 'Overdue follow-ups',
      today: 'Due today',
      tomorrow: 'Due tomorrow',
      week: 'Due this week',
      upcoming: 'Upcoming follow-ups',
      none: 'No follow-up scheduled',
      dueOrOverdue: 'Due or overdue',
    };
    bits.push(labels[filters.bucket] || `Follow-ups: ${filters.bucket}`);
  }
  if (filters.status) bits.push(`Status: ${filters.status}`);
  if (filters.course) bits.push(`Course: ${filters.course}`);
  if (filters.city) bits.push(`City: ${filters.city}`);
  if (filters.interest) bits.push(`Interest: ${filters.interest}`);
  if (filters.source) bits.push(`Source: ${filters.source}`);
  if (filters.assignedTo) bits.push(`Assigned to: ${filters.assignedTo}`);
  if (filters.lastContact) bits.push(`Not contacted in ${filters.lastContact}+ days`);
  if (filters.tag === 'no-followup') bits.push('No next follow-up');
  if (filters.ids) {
    const n = String(filters.ids).split(',').filter(Boolean).length;
    bits.push(`${n} selected ${n === 1 ? 'lead' : 'leads'}`);
  }
  return bits.join(' · ');
}

/* ------------------------------------------------------- quick presets -- */

export const QUICK_FILTERS = {
  todaysFollowUps: { ...EMPTY_FILTERS, bucket: 'today', showClosed: true },
  overdue: { ...EMPTY_FILTERS, bucket: 'overdue', showClosed: true },
  hotLeads: { ...EMPTY_FILTERS, tag: 'hot', showClosed: true },
  newLeads: { ...EMPTY_FILTERS, status: 'New', showClosed: true },
  noResponse: { ...EMPTY_FILTERS, tag: 'no-response', showClosed: true },
  forgotten: { ...EMPTY_FILTERS, tag: 'no-followup', showClosed: true },
  all: { ...EMPTY_FILTERS, showClosed: true },
};

export function rangeForPreset(preset, now = new Date()) {
  const today = todayISO(now);
  switch (preset) {
    case 'today': return [today, today];
    case 'tomorrow': return [addDaysISO(today, 1), addDaysISO(today, 1)];
    case 'week': return [today, addDaysISO(today, 7)];
    case 'overdue': return ['1900-01-01', addDaysISO(today, -1)];
    case 'upcoming': return [addDaysISO(today, 1), addDaysISO(today, 60)];
    default: return [today, today];
  }
}

export { findForgottenLeads };
