/**
 * Follow-up intelligence.
 *
 * Turns raw dates into the categories the UI uses everywhere:
 * Overdue · Today · Tomorrow · This week · Upcoming · No follow-up,
 * and detects leads that have been *forgotten* (contacted, no reply, nothing
 * scheduled next) so the dashboard can prompt a "Schedule follow-up" action.
 */

import { daysFromToday, daysBetween, shortDistanceLabel, formatDate, relativeDayLabel, todayISO } from '../lib/date.js';

/** Statuses where a lead is finished — excluded from "work today" lists. */
export const CLOSED_STATUSES = ['Converted', 'Not Interested', 'Lost'];

export function isClosed(lead) {
  return CLOSED_STATUSES.includes(lead?.status);
}

export const FOLLOWUP_BUCKETS = [
  { id: 'overdue', label: 'Overdue', tone: 'red' },
  { id: 'today', label: 'Due today', tone: 'orange' },
  { id: 'tomorrow', label: 'Tomorrow', tone: 'orange' },
  { id: 'week', label: 'This week', tone: 'green' },
  { id: 'upcoming', label: 'Upcoming', tone: 'green' },
  { id: 'none', label: 'No follow-up', tone: 'neutral' },
];

/**
 * Follow-up state for a single lead.
 * @returns {{bucket:string,label:string,tone:string,days:number|null,short:string,closed:boolean,dueISO:string}}
 */
export function followUpState(lead, now = new Date()) {
  const due = lead?.nextFollowUp || '';
  const closed = isClosed(lead);

  if (!due) {
    return {
      bucket: 'none',
      label: 'No follow-up scheduled',
      tone: 'neutral',
      days: null,
      short: 'No follow-up',
      closed,
      dueISO: '',
    };
  }

  const days = daysFromToday(due, now);
  if (days === null) {
    return { bucket: 'none', label: 'No follow-up scheduled', tone: 'neutral', days: null, short: 'No follow-up', closed, dueISO: '' };
  }

  if (days < 0) {
    return {
      bucket: 'overdue',
      label: `Overdue by ${Math.abs(days)} ${Math.abs(days) === 1 ? 'day' : 'days'}`,
      tone: 'red',
      days,
      short: shortDistanceLabel(due, now),
      closed,
      dueISO: due,
    };
  }
  if (days === 0) {
    return { bucket: 'today', label: 'Due today', tone: 'orange', days: 0, short: 'Due today', closed, dueISO: due };
  }
  if (days === 1) {
    return { bucket: 'tomorrow', label: 'Due tomorrow', tone: 'orange', days: 1, short: 'Due tomorrow', closed, dueISO: due };
  }
  if (days <= 7) {
    return { bucket: 'week', label: `Due in ${days} days`, tone: 'green', days, short: shortDistanceLabel(due, now), closed, dueISO: due };
  }
  return {
    bucket: 'upcoming',
    label: `Scheduled ${formatDate(due)} (in ${days} days)`,
    tone: 'green',
    days,
    short: shortDistanceLabel(due, now),
    closed,
    dueISO: due,
  };
}

/** Convenience buckets for lists and counts. */
export function leadsByBucket(leads, bucket, now = new Date()) {
  const active = leads.filter((l) => !isClosed(l));
  switch (bucket) {
    case 'overdue':
      return active.filter((l) => followUpState(l, now).bucket === 'overdue')
        .sort((a, b) => (followUpState(a, now).days ?? 0) - (followUpState(b, now).days ?? 0));
    case 'today':
      return active.filter((l) => followUpState(l, now).bucket === 'today');
    case 'tomorrow':
      return active.filter((l) => followUpState(l, now).bucket === 'tomorrow');
    case 'week':
      return active.filter((l) => ['today', 'tomorrow', 'week'].includes(followUpState(l, now).bucket));
    case 'upcoming':
      return active.filter((l) => ['today', 'tomorrow', 'week', 'upcoming'].includes(followUpState(l, now).bucket));
    case 'dueOrOverdue':
      return active.filter((l) => ['overdue', 'today'].includes(followUpState(l, now).bucket));
    case 'none':
      return active.filter((l) => followUpState(l, now).bucket === 'none');
    case 'all':
    default:
      return leads.slice();
  }
}

export function countByBucket(leads, now = new Date()) {
  const counts = { overdue: 0, today: 0, tomorrow: 0, week: 0, upcoming: 0, none: 0, closed: 0, total: leads.length };
  for (const lead of leads) {
    if (isClosed(lead)) { counts.closed += 1; continue; }
    const state = followUpState(lead, now);
    counts[state.bucket] = (counts[state.bucket] || 0) + 1;
  }
  counts.dueOrOverdue = counts.overdue + counts.today;
  return counts;
}

/** Days since the lead was last contacted: positive in the past (null when unknown). */
export function daysSinceContact(lead, now = new Date()) {
  if (!lead?.lastContact) return null;
  return daysBetween(lead.lastContact, todayISO(now));
}

/** Leads that were contacted a while ago and have nothing scheduled next. */
export function findForgottenLeads(leads, now = new Date(), thresholdDays = 5) {
  return leads
    .filter((lead) => !isClosed(lead))
    .map((lead) => {
      const since = daysSinceContact(lead, now);
      if (since === null) return null;
      const state = followUpState(lead, now);
      const noNext = !lead.nextFollowUp;
      const overdueNoReply = state.bucket === 'overdue' && !lead.lastResponse;
      if (since >= thresholdDays && (noNext || overdueNoReply)) {
        return { lead, daysSinceContact: since, reason: noNext ? 'no-follow-up' : 'silent-overdue' };
      }
      return null;
    })
    .filter(Boolean)
    .sort((a, b) => b.daysSinceContact - a.daysSinceContact);
}

/** Leads with no reply for at least `thresholdDays` after being contacted. */
export function findSilentLeads(leads, now = new Date(), thresholdDays = 5) {
  return leads
    .filter((lead) => !isClosed(lead))
    .map((lead) => ({ lead, since: daysSinceContact(lead, now) }))
    .filter(({ lead, since }) => since !== null && since >= thresholdDays && !hasReplied(lead))
    .sort((a, b) => b.since - a.since);
}

/** A reply is any non-empty lastResponse that is not a "no reply" marker. */
export function hasReplied(lead) {
  const response = String(lead?.lastResponse || '').trim().toLowerCase();
  if (!response) return false;
  return !['no', 'none', 'no reply', 'no response', 'n/a', 'na', '-', 'not replied', 'unanswered'].includes(response);
}

export function isPositiveResponse(lead) {
  const response = String(lead?.lastResponse || '').trim().toLowerCase();
  if (!response) return false;
  return /(yes|interested|send|details|fee|price|ok|okay|call me|when|batch|sure|please|confirm)/.test(response);
}

/** Label describing the follow-up situation in one short sentence. */
export function followUpSentence(lead, now = new Date()) {
  const state = followUpState(lead, now);
  const last = lead?.lastContact ? `Last contacted ${relativeDayLabel(lead.lastContact, now).toLowerCase()}` : 'Never contacted';
  if (state.bucket === 'none') return `${last}. No next follow-up is scheduled.`;
  return `${last}. Follow-up ${state.label.toLowerCase()} (${formatDate(state.dueISO)}).`;
}

/** Map of ISO date -> number of follow-ups, used by the calendar. */
export function followUpCountsByDate(leads, now = new Date()) {
  const map = new Map();
  for (const lead of leads) {
    if (isClosed(lead) || !lead.nextFollowUp) continue;
    const iso = lead.nextFollowUp;
    if (!map.has(iso)) map.set(iso, { total: 0, overdue: 0, leads: [] });
    const bucket = map.get(iso);
    bucket.total += 1;
    if (daysFromToday(iso, now) < 0) bucket.overdue += 1;
    bucket.leads.push(lead);
  }
  return map;
}

export { todayISO };
