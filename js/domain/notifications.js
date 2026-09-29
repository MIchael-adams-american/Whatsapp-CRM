/**
 * Local notification / AI-insight engine.
 *
 * These rules run instantly in the browser on every data change, so the
 * dashboard is useful even when the AI is switched off or unavailable. The
 * Gemini-generated daily summary is layered on top of these results.
 *
 * Every notification carries a `filter` object that the Leads page understands,
 * which is what makes each notification clickable and actionable.
 */

import { daysFromToday, relativeDayLabel, formatDate, todayISO, addDaysISO, friendlyTimestamp } from '../lib/date.js';
import { pluralize, sum, uniq } from '../lib/utils.js';
import {
  isClosed, followUpState, daysSinceContact, hasReplied, findForgottenLeads, findSilentLeads,
} from './followup.js';
import { rankLeads, computePriority } from './priority.js';
import { QUICK_FILTERS } from './filters.js';
import { coursePerformance, courseTrendThisWeek, followUpHealth } from './analytics.js';

const SEVERITY_ICON = {
  red: '🔴',
  orange: '🟠',
  flame: '🔥',
  green: '🟢',
  blue: '🔵',
  info: '💡',
};

const GROUP_ORDER = { urgent: 0, today: 1, attention: 2, opportunity: 3, insight: 4 };

function make({ id, severity, group, title, detail, filter, cta, actions = [], meta = {} }) {
  return {
    id,
    severity,
    icon: SEVERITY_ICON[severity] || '💡',
    group,
    title,
    detail,
    filter: filter || null,
    cta: cta || (filter ? 'View leads' : ''),
    actions,
    meta,
    aiGenerated: false,
  };
}

/**
 * Build the full notification list for the current dataset.
 * @param {Array} leads
 * @param {{now?:Date, sheet?:object, source?:string, dismissed?:object}} options
 */
export function buildNotifications(leads, options = {}) {
  const now = options.now || new Date();
  const sheet = options.sheet || {};
  const source = options.source || 'demo';
  const dismissed = options.dismissed || {};
  const out = [];

  if (!leads.length) {
    out.push(make({
      id: 'no-data',
      severity: 'info',
      group: 'attention',
      title: 'No leads loaded yet',
      detail: 'Load the demo data to explore My CRM, or connect your Google Sheet to start working real leads.',
      cta: 'Open settings',
      filter: null,
      actions: [{ id: 'demo', label: 'Load demo data' }, { id: 'connect-sheet', label: 'Connect Google Sheet' }],
    }));
    return out;
  }

  const active = leads.filter((l) => !isClosed(l));
  const ranked = rankLeads(active, now);
  const health = followUpHealth(leads, now);

  /* ---------------------------------------------------------- 1. overdue -- */
  const overdue = active
    .filter((l) => followUpState(l, now).bucket === 'overdue')
    .sort((a, b) => (daysFromToday(a.nextFollowUp, now) ?? 0) - (daysFromToday(b.nextFollowUp, now) ?? 0));

  if (overdue.length) {
    const worst = overdue[0];
    const worstDays = Math.abs(daysFromToday(worst.nextFollowUp, now) ?? 0);
    out.push(make({
      id: 'overdue-followups',
      severity: 'red',
      group: 'urgent',
      title: `${pluralize(overdue.length, 'follow-up')} ${overdue.length === 1 ? 'is' : 'are'} overdue`,
      detail: `${worst.name} is ${worstDays} ${worstDays === 1 ? 'day' : 'days'} late${overdue.length > 1 ? `, plus ${overdue.length - 1} more` : ''}. Average delay: ${health.avgOverdueDays} days.`,
      filter: { ...QUICK_FILTERS.overdue, ids: '' },
      cta: `Show ${overdue.length === 1 ? 'this lead' : `these ${overdue.length} leads`}`,
      meta: { ids: overdue.map((l) => l.id), count: overdue.length },
    }));
  }

  /* -------------------------------------------------------- 2. due today -- */
  const dueToday = active.filter((l) => followUpState(l, now).bucket === 'today');
  if (dueToday.length) {
    out.push(make({
      id: 'due-today',
      severity: 'orange',
      group: 'today',
      title: `${pluralize(dueToday.length, 'lead')} ${dueToday.length === 1 ? 'needs' : 'need'} follow-up today`,
      detail: pickNames(dueToday) + todayFocusHint(dueToday, now),
      filter: { ...QUICK_FILTERS.todaysFollowUps },
      cta: `${dueToday.length === 1 ? 'Show lead' : 'Show leads'}`,
      meta: { ids: dueToday.map((l) => l.id), count: dueToday.length },
    }));
  }

  /* --------------------------------------------------------- 3. hot leads -- */
  const hotNeedingAttention = active.filter((l) => {
    const hot = l.interest === 'Hot' || l.status === 'Hot';
    if (!hot) return false;
    const state = followUpState(l, now);
    const since = daysSinceContact(l, now);
    return state.bucket === 'overdue' || state.bucket === 'today' || state.bucket === 'none'
      || (since !== null && since >= 3 && !hasReplied(l));
  });
  if (hotNeedingAttention.length) {
    out.push(make({
      id: 'hot-attention',
      severity: 'flame',
      group: 'urgent',
      title: `${pluralize(hotNeedingAttention.length, 'hot lead')} ${hotNeedingAttention.length === 1 ? 'requires' : 'require'} attention`,
      detail: pickNames(hotNeedingAttention, 3) + topCourseHint(hotNeedingAttention),
      filter: { tag: 'hot', bucket: '', showClosed: true },
      cta: 'Show hot leads',
      meta: { ids: hotNeedingAttention.map((l) => l.id), count: hotNeedingAttention.length },
    }));
  }

  /* --------------------------------------------- 4. who to call right now -- */
  const callNow = ranked
    .filter(({ lead }) => {
      const state = followUpState(lead, now);
      return (lead.phone || lead.whatsapp) && ['overdue', 'today'].includes(state.bucket);
    })
    .slice(0, 1);

  if (callNow.length && overdue.length + dueToday.length > 0) {
    const { lead, priority } = callNow[0];
    out.push(make({
      id: `call-${lead.id}`,
      severity: 'orange',
      group: 'today',
      title: `📞 Call ${lead.name} today`,
      detail: `${priority.label} priority (${priority.score}/100)${lead.course ? ` · ${lead.course}` : ''}. ${priority.reasons[0] || 'Follow-up is due.'}`,
      filter: { ids: lead.id, showClosed: true },
      cta: 'Open lead',
      meta: { ids: [lead.id], leadId: lead.id },
    }));
  }

  /* -------------------------------------------- 5. leads going quiet (N d) -- */
  const silent = findSilentLeads(leads, now, 5);
  if (silent.length) {
    const [first, ...rest] = silent;
    out.push(make({
      id: 'no-response',
      severity: 'orange',
      group: 'attention',
      title: `${pluralize(silent.length, 'lead')} ${silent.length === 1 ? 'has' : 'have'} not replied for 5+ days`,
      detail: `${first.lead.name} has been silent for ${first.since} days${rest.length ? `, ${rest[0].lead.name} for ${rest[0].since} days` : ''}.`,
      filter: { tag: 'no-response', showClosed: true },
      cta: 'Show silent leads',
      meta: { ids: silent.map((s) => s.lead.id), count: silent.length },
    }));

    silent.slice(0, 3).forEach(({ lead, since }) => {
      out.push(make({
        id: `silent-${lead.id}`,
        severity: since >= 10 ? 'red' : 'orange',
        group: 'attention',
        title: `⚠️ ${lead.name} has not replied for ${since} days`,
        detail: `${lead.course || 'Course not specified'} · last contacted ${relativeDayLabel(lead.lastContact, now).toLowerCase()}${lead.nextFollowUp ? ` · next follow-up ${formatDate(lead.nextFollowUp)}` : ' · no follow-up scheduled'}.`,
        filter: { ids: lead.id, showClosed: true },
        cta: 'Open lead',
        actions: [{ id: 'whatsapp', label: 'WhatsApp' }, { id: 'ai-message', label: 'Generate message' }],
        meta: { ids: [lead.id], leadId: lead.id },
      }));
    });
  }

  /* ----------------------------------------- 6. forgotten / missing next -- */
  const forgotten = findForgottenLeads(leads, now, 5);
  if (forgotten.length) {
    const [first, ...rest] = forgotten;
    out.push(make({
      id: 'missing-followup',
      severity: 'orange',
      group: 'urgent',
      title: `Follow-up missing for ${pluralize(forgotten.length, 'lead')}`,
      detail: `${first.lead.name} was contacted ${first.daysSinceContact} days ago but no next follow-up is scheduled${rest.length ? ` · ${rest.length} more like this` : ''}.`,
      filter: { tag: 'no-followup', showClosed: true },
      cta: 'Show these leads',
      actions: [{ id: 'schedule-followups', label: 'Schedule follow-ups' }],
      meta: { ids: forgotten.map((f) => f.lead.id), count: forgotten.length },
    }));
  }

  /* ------------------------------------ 7. course clusters not worked on -- */
  coursePerformance(leads, now)
    .filter((row) => row.total >= 3 && row.open >= 2 && (row.silent >= 2 || row.overdue >= 2))
    .slice(0, 2)
    .forEach((row) => {
      out.push(make({
        id: `course-gap-${row.course}`,
        severity: 'blue',
        group: 'opportunity',
        title: `💡 ${row.silent + row.overdue}+ ${row.course} leads have not been followed up`,
        detail: `${row.total} leads interested in ${row.course} · ${row.converted} converted · ${row.silent} silent 7+ days · ${row.overdue} overdue. A short reactivation message could unlock ${row.open} open leads.`,
        filter: { course: row.course, showClosed: true },
        cta: 'Show these leads',
        actions: [{ id: 'campaign', label: 'Generate campaign message', course: row.course }],
        meta: { course: row.course },
      }));
    });

  /* ------------------------------------------------------ 8. course trends -- */
  courseTrendThisWeek(leads, now)
    .filter((row) => row.delta >= 2 && row.thisWeek >= 2)
    .slice(0, 2)
    .forEach((row) => {
      out.push(make({
        id: `trend-${row.course}`,
        severity: 'green',
        group: 'insight',
        title: `📈 ${row.course} leads have increased this week`,
        detail: `${row.thisWeek} new leads this week vs ${row.lastWeek} last week (+${row.delta}). Make sure the new enquiries get a same-day response.`,
        filter: { course: row.course, showClosed: true },
        cta: 'Show these leads',
      }));
    });

  /* ------------------------------------------------- 9. new leads untouched -- */
  const untouchedNew = active.filter((l) => l.status === 'New'
    && !l.lastContact
    && (l.createdAt ? (daysFromToday(l.createdAt.slice(0, 10), now) ?? 0) <= -2 : false));
  if (untouchedNew.length) {
    out.push(make({
      id: 'new-untouched',
      severity: 'orange',
      group: 'today',
      title: `${pluralize(untouchedNew.length, 'new lead')} never contacted`,
      detail: `${pickNames(untouchedNew, 3)} — these came in over 2 days ago and have had no first contact.`,
      filter: { tag: 'uncontacted', status: 'New', showClosed: true },
      cta: 'Show new leads',
      meta: { ids: untouchedNew.map((l) => l.id), count: untouchedNew.length },
    }));
  }

  /* -------------------------------------------- 10. replied but not actioned */
  const repliedNoAction = active.filter((l) => hasReplied(l) && !l.nextFollowUp);
  if (repliedNoAction.length) {
    out.push(make({
      id: 'replied-no-action',
      severity: 'blue',
      group: 'opportunity',
      title: `${pluralize(repliedNoAction.length, 'lead')} replied — no follow-up scheduled`,
      detail: `${pickNames(repliedNoAction, 2)} replied and are waiting for the next step. Schedule a follow-up before they go cold.`,
      filter: { tag: 'replied', bucket: 'none', showClosed: true },
      cta: 'Show these leads',
      actions: [{ id: 'schedule-followups', label: 'Schedule follow-ups' }],
      meta: { ids: repliedNoAction.map((l) => l.id), count: repliedNoAction.length },
    }));
  }

  /* ------------------------------------------------ 11. weekend / health -- */
  if (health.weekendContacts >= 5 && health.weekendSilentRate >= 60) {
    out.push(make({
      id: 'weekend-followup',
      severity: 'blue',
      group: 'insight',
      title: `${health.weekendSilentRate}% of weekend enquiries never replied`,
      detail: `${health.weekendContacts} leads were first contacted at the weekend; ${health.weekendSilent} never responded. Try a weekday-morning follow-up instead.`,
      filter: { tag: 'no-response', showClosed: true },
      cta: 'Show silent leads',
    }));
  }

  /* ------------------------------------------------------ 12. sheet sync -- */
  if (source === 'sheet' && sheet.lastSyncAt) {
    const stale = (daysFromToday(sheet.lastSyncAt.slice(0, 10), now) ?? 0) <= -3;
    if (stale) {
      out.push(make({
        id: 'sync-stale',
        severity: 'blue',
        group: 'attention',
        title: 'Google Sheet has not been synced for 3+ days',
        detail: `Last synced ${friendlyTimestamp(sheet.lastSyncAt, now)}. Sync now so new enquiries appear in your dashboard.`,
        cta: 'Sync now',
        actions: [{ id: 'sync', label: 'Sync now' }],
      }));
    }
  }

  return out
    .filter((n) => !dismissed[n.id])
    .sort((a, b) => (GROUP_ORDER[a.group] ?? 9) - (GROUP_ORDER[b.group] ?? 9));
}

function pickNames(leads, limit = 2) {
  const names = uniq(leads.map((l) => l.name)).slice(0, limit);
  if (!names.length) return '';
  if (leads.length > names.length) return `${names.join(', ')} and ${leads.length - names.length} more`;
  return names.join(', ');
}

function todayFocusHint(leads, now) {
  const overdueCount = leads.filter((l) => followUpState(l, now).bucket === 'overdue').length;
  const hot = leads.filter((l) => l.interest === 'Hot' || l.status === 'Hot').length;
  const bits = [];
  if (overdueCount) bits.push(`${overdueCount} overdue`);
  if (hot) bits.push(`${hot} hot`);
  return bits.length ? ` · ${bits.join(' · ')}` : '';
}

function topCourseHint(leads) {
  const courses = uniq(leads.map((l) => l.course).filter(Boolean));
  if (!courses.length) return '';
  if (courses.length === 1) return ` All interested in ${courses[0]}.`;
  return ` Most interest: ${courses[0]}.`;
}

/** Small counts for navigation badges. */
export function notificationCounts(notifications) {
  return {
    total: notifications.length,
    urgent: notifications.filter((n) => n.group === 'urgent').length,
    today: notifications.filter((n) => n.group === 'today').length,
  };
}

export function groupNotifications(notifications) {
  const groups = [
    { id: 'urgent', label: 'Needs attention now', items: [] },
    { id: 'today', label: "Today's actions", items: [] },
    { id: 'attention', label: 'Going quiet', items: [] },
    { id: 'opportunity', label: 'Opportunities', items: [] },
    { id: 'insight', label: 'Insights', items: [] },
  ];
  for (const n of notifications) {
    const group = groups.find((g) => g.id === n.group) || groups[4];
    group.items.push(n);
  }
  return groups.filter((g) => g.items.length);
}

/**
 * Locally generated daily summary — used instantly, and as the fallback when
 * the AI is unavailable or not configured (section 12).
 */
export function localDailySummary(leads, now = new Date()) {
  const active = leads.filter((l) => !isClosed(l));
  const ranked = rankLeads(active, now);
  const overdue = active.filter((l) => followUpState(l, now).bucket === 'overdue');
  const today = active.filter((l) => followUpState(l, now).bucket === 'today');
  const hot = active.filter((l) => l.interest === 'Hot' || l.status === 'Hot');
  const silent = findSilentLeads(leads, now, 5);
  const focus = ranked[0];

  const lines = [];
  lines.push(`Today you have ${pluralize(today.length + overdue.length, 'follow-up')}: ${today.length} due today and ${overdue.length} overdue.`);
  if (hot.length) lines.push(`${pluralize(hot.length, 'lead')} ${hot.length === 1 ? 'is' : 'are'} highly interested.`);
  if (silent.length) lines.push(`${pluralize(silent.length, 'lead')} ${silent.length === 1 ? 'has' : 'have'} not replied for more than 5 days.`);
  const forgotten = active.filter((l) => !l.nextFollowUp && (daysSinceContact(l, now) ?? 0) >= 5);
  if (forgotten.length) lines.push(`${pluralize(forgotten.length, 'lead')} contacted recently ${forgotten.length === 1 ? 'has' : 'have'} no next follow-up scheduled.`);
  if (focus) {
    lines.push(`The highest priority lead is ${focus.lead.name}${focus.lead.course ? `, who is interested in ${focus.lead.course}` : ''} (priority ${focus.priority.score}/100).`);
  }
  if (!active.length) lines[0] = 'There are no active leads yet. Load the demo data or connect your Google Sheet to get started.';

  return {
    headline: focus ? `${today.length + overdue.length} follow-ups today · start with ${focus.lead.name}` : 'No follow-ups scheduled today',
    summary: lines.join(' '),
    generatedBy: 'local',
    at: new Date().toISOString(),
    focusLeadId: focus ? focus.lead.id : '',
    stats: {
      dueToday: today.length,
      overdue: overdue.length,
      hot: hot.length,
      silent: silent.length,
      total: leads.length,
      converted: leads.filter((l) => l.status === 'Converted').length,
    },
  };
}

/** "What should I do next?" — local rule-based suggestion for a lead. */
export function localNextAction(lead, now = new Date()) {
  const priority = computePriority(lead, now);
  const state = followUpState(lead, now);
  const since = daysSinceContact(lead, now);
  const silent = since !== null && since >= 5 && !hasReplied(lead);
  const replied = hasReplied(lead);

  let actionType = 'whatsapp';
  let reason = '';

  if (isClosed(lead)) {
    return {
      actionType: 'none',
      label: 'No action needed',
      reason: `This lead is marked ${lead.status}.`,
      priority,
    };
  }

  if (state.bucket === 'overdue') {
    actionType = 'call';
    reason = `Follow-up is ${Math.abs(state.days)} ${Math.abs(state.days) === 1 ? 'day' : 'days'} overdue — a call now has the best chance of a reply.`;
  } else if (state.bucket === 'today') {
    actionType = 'whatsapp';
    reason = 'Follow-up is due today. A short WhatsApp message keeps the conversation warm.';
  } else if (silent) {
    actionType = 'whatsapp';
    reason = `${lead.name} has not replied for ${since} days — send a light, low-pressure reminder.`;
  } else if (replied && !lead.nextFollowUp) {
    actionType = 'course_details';
    reason = 'The lead replied and no follow-up is scheduled. Send the course details and agree a next step.';
  } else if (!lead.nextFollowUp) {
    actionType = 'follow_later';
    reason = 'No follow-up is scheduled. Set a date so this lead does not get forgotten.';
  } else if (lead.status === 'New') {
    actionType = 'call';
    reason = 'New lead — first contact should happen as soon as possible.';
  } else {
    actionType = 'reminder';
    reason = `Next follow-up is ${formatDate(lead.nextFollowUp)} (${relativeDayLabel(lead.nextFollowUp, now).toLowerCase()}). Keep the plan and send a reminder when the date arrives.`;
  }

  return {
    actionType,
    label: actionLabel(actionType),
    reason,
    priority,
    suggestedDate: suggestFollowUpDate(lead, state, now),
  };
}

function actionLabel(actionType) {
  const map = {
    call: 'Call',
    whatsapp: 'Send WhatsApp',
    course_details: 'Send Course Details',
    fee_details: 'Send Fee Details',
    reminder: 'Send Reminder',
    follow_later: 'Follow Up Later',
    converted: 'Mark as Converted',
    lost: 'Mark as Lost',
    none: 'No action needed',
  };
  return map[actionType] || 'Follow up';
}

/** Sensible default for the next follow-up date (skips to next weekday). */
export function suggestFollowUpDate(lead, state = followUpState(lead), now = new Date()) {
  const base = daysFromToday(todayISO(now), now);
  let days = 2;
  if (state.bucket === 'overdue') days = 0;
  else if (state.bucket === 'today') days = 2;
  else if (lead.interest === 'Hot') days = 1;
  else if (lead.interest === 'Warm') days = 3;
  else days = 5;
  if (base === null) days = 2;
  let iso = addDaysISO(todayISO(now), days);
  // Avoid scheduling on a Sunday — most teams do not work Sundays.
  const d = new Date(`${iso}T00:00:00`);
  if (d.getDay() === 0) iso = addDaysISO(iso, 1);
  return iso;
}

export { SEVERITY_ICON };
