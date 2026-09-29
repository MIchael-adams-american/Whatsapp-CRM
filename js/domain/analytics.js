/**
 * Aggregate analytics computed locally (never sent to the AI in full).
 * These numbers power the dashboard, the AI Marketing Insights page and the
 * compact summary object handed to Gemini.
 */

import { countBy, groupBy, sum, uniq } from '../lib/utils.js';
import { daysFromToday, todayISO, addDaysISO, isWeekend } from '../lib/date.js';
import {
  countByBucket, isClosed, daysSinceContact, hasReplied, isPositiveResponse,
} from './followup.js';
import { computePriority } from './priority.js';

export function overviewStats(leads, now = new Date()) {
  const active = leads.filter((l) => !isClosed(l));
  const buckets = countByBucket(leads, now);

  const callsToday = active.filter((l) => {
    const due = l.nextFollowUp ? daysFromToday(l.nextFollowUp, now) : null;
    return (l.phone || l.whatsapp) && due !== null && due <= 0;
  });

  const followUpsToday = active.filter((l) => l.nextFollowUp === todayISO(now));
  const hotLeads = active.filter((l) => l.interest === 'Hot' || l.status === 'Hot');
  const newLeads = active.filter((l) => l.status === 'New');
  const noResponse = active.filter((l) => !hasReplied(l) && (daysSinceContact(l, now) ?? -1) >= 5);
  const converted = leads.filter((l) => l.status === 'Converted');
  const replied = active.filter((l) => hasReplied(l) && !l.nextFollowUp);

  return {
    total: leads.length,
    active: active.length,
    callsToday: callsToday.length,
    followUpsToday: followUpsToday.length,
    overdue: buckets.overdue,
    overdueLeads: active.filter((l) => l.nextFollowUp && (daysFromToday(l.nextFollowUp, now) ?? 0) < 0),
    todayLeads: followUpsToday,
    tomorrow: buckets.tomorrow,
    week: buckets.week,
    noFollowUp: buckets.none,
    hotLeads,
    newLeads,
    noResponse,
    converted,
    convertedCount: converted.length,
    repliedAwaitingAction: replied,
    buckets,
  };
}

/** Distribution of a field, biggest first, with a friendly label. */
export function distribution(leads, keyFn, { limit = 8, label = 'Unspecified' } = {}) {
  const counts = countBy(leads, (lead) => {
    const value = keyFn(lead);
    return value === '' || value === null || value === undefined ? label : String(value);
  });
  return Array.from(counts.entries())
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name))
    .slice(0, limit);
}

export function courseBreakdown(leads) {
  return distribution(leads, (l) => l.course, { limit: 12, label: 'Course not specified' });
}

export function sourceBreakdown(leads) {
  return distribution(leads, (l) => l.source, { limit: 10, label: 'Source not specified' });
}

export function cityBreakdown(leads) {
  return distribution(leads, (l) => l.city, { limit: 8, label: 'City not specified' });
}

export function statusBreakdown(leads) {
  return distribution(leads, (l) => l.status, { limit: 10 });
}

export function interestBreakdown(leads) {
  return ['Hot', 'Warm', 'Cold'].map((level) => ({
    name: level,
    count: leads.filter((l) => l.interest === level).length,
  }));
}

/**
 * Per-course funnel: interested vs converted vs stalled, plus how many have
 * gone quiet. Drives "Many leads are interested in IOSH but are not converting".
 */
export function coursePerformance(leads, now = new Date()) {
  const grouped = groupBy(leads, (l) => l.course || 'Course not specified');
  const rows = [];
  for (const [course, group] of grouped) {
    const total = group.length;
    const converted = group.filter((l) => l.status === 'Converted').length;
    const notInterested = group.filter((l) => ['Not Interested', 'Lost'].includes(l.status)).length;
    const open = total - converted - notInterested;
    const silent = group.filter((l) => !hasReplied(l) && (daysSinceContact(l, now) ?? 0) >= 7).length;
    const hot = group.filter((l) => l.interest === 'Hot' || l.status === 'Hot').length;
    const overdue = group.filter((l) => l.nextFollowUp && (daysFromToday(l.nextFollowUp, now) ?? 0) < 0).length;
    rows.push({
      course,
      total,
      converted,
      notInterested,
      open,
      silent,
      hot,
      overdue,
      conversionRate: total ? Math.round((converted / total) * 100) : 0,
    });
  }
  return rows.sort((a, b) => b.total - a.total);
}

/** New leads per week for the last N weeks (trend detection). */
export function weeklyTrend(leads, weeks = 4, now = new Date()) {
  const out = [];
  for (let i = weeks - 1; i >= 0; i -= 1) {
    const end = addDaysISO(todayISO(now), -(i * 7));
    const start = addDaysISO(end, -6);
    const count = leads.filter((lead) => {
      const created = lead.createdAt ? lead.createdAt.slice(0, 10) : '';
      return created >= start && created <= end;
    }).length;
    out.push({ label: i === 0 ? 'This week' : `${i} week${i > 1 ? 's' : ''} ago`, start, end, count });
  }
  return out;
}

export function courseTrendThisWeek(leads, now = new Date()) {
  const thisWeekStart = addDaysISO(todayISO(now), -6);
  const prevWeekStart = addDaysISO(todayISO(now), -13);
  const added = (lead) => (lead.createdAt ? lead.createdAt.slice(0, 10) : '');
  const courses = uniq(leads.map((l) => l.course).filter(Boolean));
  const rows = [];
  for (const course of courses) {
    const ofCourse = leads.filter((l) => l.course === course);
    const thisWeek = ofCourse.filter((l) => added(l) >= thisWeekStart).length;
    const lastWeek = ofCourse.filter((l) => added(l) >= prevWeekStart && added(l) < thisWeekStart).length;
    const delta = thisWeek - lastWeek;
    if (thisWeek > 0 || lastWeek > 0) rows.push({ course, thisWeek, lastWeek, delta });
  }
  return rows.sort((a, b) => b.delta - a.delta);
}

/**
 * Follow-up responsiveness: how long, on average, the team takes to act.
 * Also splits contact attempts by weekday to surface "weekend leads are
 * followed up late".
 */
export function followUpHealth(leads, now = new Date()) {
  const active = leads.filter((l) => !isClosed(l));
  const withContact = active.filter((l) => l.lastContact);

  const overdue = active.filter((l) => l.nextFollowUp && (daysFromToday(l.nextFollowUp, now) ?? 0) < 0);
  const avgOverdueDays = overdue.length
    ? Math.round(sum(overdue, (l) => Math.abs(daysFromToday(l.nextFollowUp, now))) / overdue.length)
    : 0;

  const silent = active
    .map((l) => ({ lead: l, since: daysSinceContact(l, now) }))
    .filter(({ since }) => since !== null)
    .sort((a, b) => b.since - a.since);

  const avgSilence = silent.length ? Math.round(sum(silent, (x) => x.since) / silent.length) : 0;

  const weekendContacts = withContact.filter((l) => isWeekend(l.lastContact)).length;
  const weekendSilent = withContact.filter((l) => isWeekend(l.lastContact) && !hasReplied(l)).length;

  const noFollowUp = active.filter((l) => !l.nextFollowUp).length;
  const avgFollowUps = active.length ? (sum(active, (l) => l.followUpCount) / active.length) : 0;

  return {
    avgOverdueDays,
    avgSilence,
    silentOver7: silent.filter((x) => x.since >= 7).length,
    silentOver14: silent.filter((x) => x.since >= 14).length,
    weekendContacts,
    weekendSilent,
    weekendSilentRate: weekendContacts ? Math.round((weekendSilent / weekendContacts) * 100) : 0,
    noFollowUp,
    missingFollowUpRate: active.length ? Math.round((noFollowUp / active.length) * 100) : 0,
    avgFollowUps: Math.round(avgFollowUps * 10) / 10,
    positiveResponses: active.filter(isPositiveResponse).length,
  };
}

/** Everything the AI Marketing Insights page needs, in one object. */
export function marketingSnapshot(leads, now = new Date()) {
  const active = leads.filter((l) => !isClosed(l));
  const stats = overviewStats(leads, now);
  return {
    totals: {
      leads: leads.length,
      active: active.length,
      converted: stats.convertedCount,
      hot: stats.hotLeads.length,
      newThisWeek: leads.filter((l) => (l.createdAt || '') >= addDaysISO(todayISO(now), -6)).length,
      conversionRate: leads.length ? Math.round((stats.convertedCount / leads.length) * 100) : 0,
    },
    courses: coursePerformance(leads, now).slice(0, 8),
    sources: sourceBreakdown(leads).slice(0, 6),
    cities: cityBreakdown(leads).slice(0, 5),
    interest: interestBreakdown(active),
    statuses: statusBreakdown(leads),
    trend: courseTrendThisWeek(leads, now).slice(0, 6),
    health: followUpHealth(leads, now),
  };
}

/** Small, dense text summary — this is what we are willing to send to the AI. */
export function compactSummaryText(snapshot) {
  const lines = [];
  const t = snapshot.totals;
  lines.push(`Totals: ${t.leads} leads, ${t.active} active, ${t.converted} converted (${t.conversionRate}%), ${t.hot} hot, ${t.newThisWeek} new this week.`);
  if (snapshot.courses.length) {
    lines.push('Courses: ' + snapshot.courses.map((c) => `${c.course}: ${c.total} total, ${c.converted} converted, ${c.silent} silent 7d+, ${c.overdue} overdue`).join(' | '));
  }
  if (snapshot.sources.length) {
    lines.push('Sources: ' + snapshot.sources.map((s) => `${s.name}: ${s.count}`).join(', '));
  }
  if (snapshot.trend.length) {
    lines.push('Weekly trend: ' + snapshot.trend.map((r) => `${r.course} ${r.delta >= 0 ? '+' : ''}${r.delta}`).join(', '));
  }
  const h = snapshot.health;
  lines.push(`Follow-up health: avg ${h.avgOverdueDays} days overdue, ${h.noFollowUp} leads with no next follow-up (${h.missingFollowUpRate}%), ${h.silentOver7} silent 7d+, ${h.silentOver14} silent 14d+, weekend contacts ${h.weekendContacts} of which ${h.weekendSilentRate}% unanswered, avg follow-ups per lead ${h.avgFollowUps}.`);
  return lines.join('\n');
}

/** Priority distribution for dashboards ("waiting for attention" buckets). */
export function prioritySpread(leads, now = new Date()) {
  const levels = { 'very-high': 0, high: 0, medium: 0, low: 0, minimal: 0 };
  for (const lead of leads) {
    const p = computePriority(lead, now);
    levels[p.level] = (levels[p.level] || 0) + 1;
  }
  return levels;
}
