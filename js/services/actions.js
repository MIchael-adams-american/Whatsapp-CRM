/**
 * Shared write operations ("use cases").
 * Views call these instead of touching the store directly, so every mutation
 * logs activity, updates signatures and refreshes the UI consistently.
 */

import {
  store, addLead as storeAddLead, patchLead, removeLead as storeRemoveLead,
  replaceLeads, updateSheetConfig, persistLeads, logActivity, isDemoSource,
} from '../lib/store.js';
import { EVENTS, emit } from '../lib/bus.js';
import { nowISO, todayISO, addDaysISO, toISODate, formatDate } from '../lib/date.js';
import { normalizePhone, uid, titleCase } from '../lib/utils.js';
import { createLead, addTimelineEvent, normalizeLead, validateLeadInput } from '../domain/model.js';
import { computePriority } from '../domain/priority.js';
import { followUpState, isClosed } from '../domain/followup.js';
import { suggestFollowUpDate } from '../domain/notifications.js';
import { buildDemoLeads } from '../data/demo-data.js';
import { mergeSheetLeads, importSheet, describeSync } from './sheets.js';
import { notify } from '../ui/kit.js';

/* ------------------------------------------------------------ helpers -- */

function allLeads() {
  return store.get('leads');
}

function findLead(id) {
  return allLeads().find((lead) => lead.id === id) || null;
}

export function refresh(reason = 'leads') {
  emit(EVENTS.DATA_CHANGED, { reason });
}

function logEvent(leadId, type, text, meta = null) {
  const lead = findLead(leadId);
  if (!lead) return null;
  const updated = addTimelineEvent(lead, { id: uid('ev'), type, at: nowISO(), text, meta });
  return patchLead(leadId, { timeline: updated.timeline }, { touch: true });
}

/* -------------------------------------------------------------- leads -- */

export function saveLeadFromForm(input, { leadId = null } = {}) {
  const { valid, errors, value } = validateLeadInput(input);
  if (!valid) return { ok: false, errors };

  const payload = {
    ...value,
    phone: normalizePhone(value.phone),
    whatsapp: normalizePhone(value.whatsapp || value.phone),
    email: String(value.email || '').trim(),
    city: titleCase(value.city),
    source: value.source ? titleCase(value.source) : '',
    lastContact: toISODate(value.lastContact) || '',
    nextFollowUp: toISODate(value.nextFollowUp) || '',
    followUpCount: Number(value.followUpCount) || 0,
  };

  if (leadId) {
    const existing = findLead(leadId);
    if (!existing) return { ok: false, errors: { name: 'This lead no longer exists.' } };
    const statusChanged = existing.status !== payload.status;
    const followUpChanged = (existing.nextFollowUp || '') !== (payload.nextFollowUp || '');
    const updated = patchLead(leadId, payload);
    if (statusChanged) logEvent(leadId, 'status_changed', `Status changed from ${existing.status} to ${payload.status}`);
    if (followUpChanged && payload.nextFollowUp) {
      logEvent(leadId, 'follow_up_scheduled', `Follow-up scheduled for ${formatDate(payload.nextFollowUp)}`);
    }
    refresh('leads');
    emit(EVENTS.LEAD_UPDATED, { leadId });
    return { ok: true, lead: updated };
  }

  const lead = createLead({ ...payload, localOnly: true, createdVia: 'manual entry' });
  storeAddLead(lead);
  logActivity({ type: 'lead_created', text: `Added lead ${lead.name}` });
  refresh('leads');
  return { ok: true, lead };
}

export function deleteLead(leadId) {
  const lead = findLead(leadId);
  if (!lead) return false;
  storeRemoveLead(leadId);
  logActivity({ type: 'lead_deleted', text: `Deleted lead ${lead.name}` });
  refresh('leads');
  return true;
}

/** Log a contact attempt (call / WhatsApp / message) and update the lead. */
export function logContact(leadId, { type = 'call_made', note = '', nextFollowUp = '', status = '' } = {}) {
  const lead = findLead(leadId);
  if (!lead) return null;

  const labels = { call_made: 'Call made', message_sent: 'Message sent', replied: 'Lead replied', note_added: 'Note added' };
  const patch = {
    lastContact: todayISO(),
    followUpCount: (Number(lead.followUpCount) || 0) + 1,
  };
  if (status) patch.status = status;
  if (nextFollowUp) patch.nextFollowUp = toISODate(nextFollowUp);
  else if (type !== 'note_added' && !lead.nextFollowUp) {
    patch.nextFollowUp = suggestFollowUpDate(lead, followUpState(lead));
  }
  if (note) patch.notes = note;

  patchLead(leadId, patch);

  let description = `${labels[type] || 'Contact logged'}`;
  if (note) description += ` — ${note}`;
  logEvent(leadId, type, description);
  if (patch.nextFollowUp && patch.nextFollowUp !== lead.nextFollowUp) {
    logEvent(leadId, 'follow_up_scheduled', `Follow-up scheduled for ${formatDate(patch.nextFollowUp)}`);
  }

  refresh('leads');
  emit(EVENTS.LEAD_UPDATED, { leadId });
  return findLead(leadId);
}

export function addNote(leadId, text) {
  const lead = findLead(leadId);
  if (!lead || !String(text || '').trim()) return null;
  const note = String(text).trim();
  const combined = lead.notes ? `${lead.notes}\n${new Date().toLocaleDateString()} — ${note}` : `${new Date().toLocaleDateString()} — ${note}`;
  patchLead(leadId, { notes: combined });
  logEvent(leadId, 'note_added', `Note: ${note}`);
  refresh('leads');
  emit(EVENTS.LEAD_UPDATED, { leadId });
  return findLead(leadId);
}

export function setStatus(leadId, status, extra = {}) {
  const lead = findLead(leadId);
  if (!lead) return null;
  if (lead.status === status) return lead;
  patchLead(leadId, { status, ...extra });
  logEvent(leadId, 'status_changed', `Status changed to ${status}`);
  if (status === 'Converted') logActivity({ type: 'converted', text: `${lead.name} converted` });
  refresh('leads');
  emit(EVENTS.LEAD_UPDATED, { leadId });
  return findLead(leadId);
}

export function setInterest(leadId, interest) {
  const lead = findLead(leadId);
  if (!lead || lead.interest === interest) return lead;
  patchLead(leadId, { interest });
  refresh('leads');
  emit(EVENTS.LEAD_UPDATED, { leadId });
  return findLead(leadId);
}

export function scheduleFollowUp(leadId, isoDate, note = '') {
  const lead = findLead(leadId);
  if (!lead) return null;
  const iso = toISODate(isoDate);
  if (!iso) return null;
  patchLead(leadId, { nextFollowUp: iso });
  logEvent(leadId, 'follow_up_scheduled', `Follow-up scheduled for ${formatDate(iso)}${note ? ` — ${note}` : ''}`);
  refresh('leads');
  emit(EVENTS.LEAD_UPDATED, { leadId });
  return findLead(leadId);
}

/** Bulk-schedule follow-ups for forgotten leads, spread across the next days. */
export function scheduleBulkFollowUps(leadIds = null, { startOffset = 0 } = {}) {
  const leads = allLeads().filter((lead) => !isClosed(lead)
    && !lead.nextFollowUp
    && (leadIds ? leadIds.includes(lead.id) : true));

  if (!leads.length) return { scheduled: 0, skipped: 0 };

  const ranked = leads
    .map((lead) => ({ lead, priority: computePriority(lead) }))
    .sort((a, b) => b.priority.score - a.priority.score);

  let index = 0;
  const perDay = Math.max(3, Math.ceil(ranked.length / 4));
  for (const { lead, priority } of ranked) {
    const slot = Math.floor(index / perDay);
    const offset = startOffset + slot + (priority.level === 'very-high' ? 0 : 1);
    const iso = addDaysISO(todayISO(), offset);
    const weekday = new Date(`${iso}T00:00:00`).getDay();
    const adjusted = weekday === 0 ? addDaysISO(iso, 1) : iso;
    const updated = addTimelineEvent(lead, {
      id: uid('ev'),
      type: 'follow_up_scheduled',
      at: nowISO(),
      text: `Follow-up scheduled for ${formatDate(adjusted)} (suggested by My CRM)`,
    });
    patchLead(lead.id, { nextFollowUp: adjusted, timeline: updated.timeline });
    index += 1;
  }

  logActivity({ type: 'bulk_schedule', text: `Scheduled follow-ups for ${ranked.length} leads` });
  refresh('leads');
  return { scheduled: ranked.length, skipped: 0 };
}

/** Apply an AI / rules recommendation to a lead with one click. */
export function applySuggestion(leadId, suggestion) {
  const lead = findLead(leadId);
  if (!lead || !suggestion) return null;
  const patch = {};
  const events = [];

  if (suggestion.suggestedFollowUpDate) {
    patch.nextFollowUp = toISODate(suggestion.suggestedFollowUpDate);
    events.push({ type: 'follow_up_scheduled', text: `Follow-up scheduled for ${formatDate(patch.nextFollowUp)} (AI suggestion)` });
  }
  if (suggestion.status && suggestion.status !== lead.status) {
    patch.status = suggestion.status;
    events.push({ type: 'status_changed', text: `Status changed to ${suggestion.status} (AI suggestion)` });
  }
  if (suggestion.interest && suggestion.interest !== lead.interest) {
    patch.interest = suggestion.interest;
  }
  if (!Object.keys(patch).length) return lead;

  let timeline = lead.timeline || [];
  for (const event of events) {
    timeline = addTimelineEvent({ ...lead, timeline }, { id: uid('ev'), at: nowISO(), ...event }).timeline;
  }
  patch.timeline = timeline;
  patch.aiSuggest = { ...suggestion, appliedAt: nowISO() };

  patchLead(leadId, patch);
  refresh('leads');
  emit(EVENTS.LEAD_UPDATED, { leadId });
  return findLead(leadId);
}

/** Persist the latest AI analysis against the lead (used for badge + cache). */
export function storeAiSuggestion(leadId, suggestion) {
  patchLead(leadId, { aiSuggest: { ...suggestion, at: nowISO() } }, { touch: false });
  emit(EVENTS.LEAD_UPDATED, { leadId });
}

/* --------------------------------------------------------------- data -- */

export function loadDemoData({ silent = false } = {}) {
  const leads = buildDemoLeads();
  replaceLeads(leads, 'demo');
  logActivity({ type: 'demo', text: `Loaded ${leads.length} demo leads` });
  refresh('leads');
  if (!silent) notify.success(`Demo data loaded — ${leads.length} sample leads ready to explore.`);
  return leads;
}

export function clearAllLeads() {
  replaceLeads([], 'demo');
  refresh('leads');
}

/** Import from a connected Google Sheet, merging with what is on the device. */
export async function syncFromSheet({ silent = false } = {}) {
  const sheet = store.get('sheet');
  if (!sheet.spreadsheetId && !sheet.appsScriptUrl) {
    if (!silent) notify.warn('Connect a Google Sheet first (Settings → Google Sheet).', { title: 'No sheet connected' });
    return { ok: false, code: 'not-configured' };
  }

  try {
    const result = await importSheet(sheet, { savedMapping: sheet.columns, headerRow: sheet.headerRow });
    const existing = store.get('leads');
    const merge = mergeSheetLeads(existing, result.leads);

    // Safety net: never delete a large part of the CRM because a range/tab was
    // mis-configured. If the sync would remove many leads, keep them and warn.
    const sheetSourced = existing.filter((lead) => !lead.localOnly).length;
    const suspicious = merge.removed.length >= 5
      && sheetSourced > 0
      && merge.removed.length / sheetSourced > 0.25;

    if (suspicious) {
      const kept = [...merge.leads, ...merge.removed];
      merge.leads = kept;
      merge.keptFromDevice = merge.removed.length;
      merge.removed = [];
      logActivity({ type: 'sync_warning', text: `Kept ${merge.keptFromDevice} leads that were not found in the sheet` });
    }

    replaceLeads(merge.leads, 'sheet');
    updateSheetConfig({
      columns: result.mapping,
      lastSyncAt: nowISO(),
      lastSyncStatus: 'ok',
      lastSyncMessage: describeSync(merge, result.leads.length),
      lastSyncCount: result.leads.length,
      headerRow: sheet.headerRow || 1,
    });
    logActivity({ type: 'sync', text: `Synced ${result.leads.length} leads from Google Sheet` });

    const summary = describeSync(merge, result.leads.length);
    if (merge.keptFromDevice) {
      notify.warn(`${merge.keptFromDevice} leads on this device were not found in the sheet and were kept. Check the tab or range in Settings → Google Sheet.`, {
        title: 'Partial sync detected',
        duration: 9000,
      });
    } else if (!silent) {
      notify.success(summary, { title: 'Sync complete', duration: 6000 });
    }
    refresh('leads');
    emit(EVENTS.SYNC_DONE, { added: merge.added.length, updated: merge.updated.length, total: result.leads.length });
    return { ok: true, ...result, added: merge.added, updated: merge.updated, unchanged: merge.unchanged };
  } catch (error) {
    updateSheetConfig({
      lastSyncStatus: 'error',
      lastSyncMessage: error.friendly || error.message || 'Sync failed',
    });
    logActivity({ type: 'sync_error', text: `Sheet sync failed: ${error.message}` });
    if (!silent) {
      notify.error(error.friendly || error.message || 'Could not read the Google Sheet.', { title: 'Sync failed' });
    }
    return { ok: false, error };
  }
}

export function importLeadsFromRows(leads, source = 'sheet') {
  const existing = store.get('leads');
  const merge = mergeSheetLeads(existing, leads);
  replaceLeads(merge.leads, source);
  refresh('leads');
  return merge;
}

/* -------------------------------------------------------------- misc -- */

export function leadById(id) {
  return findLead(id);
}

export function currentLeads() {
  return allLeads();
}

export function priorityFor(lead) {
  return computePriority(lead);
}

export function isDemo() {
  return isDemoSource();
}

export function normalizeLeadInput(input) {
  return normalizeLead(input, { preserveId: true });
}

export { store, persistLeads };
