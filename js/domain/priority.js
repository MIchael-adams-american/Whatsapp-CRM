/**
 * Lead priority algorithm (section 24).
 *
 * Deliberately rule-based and explainable — the AI may *suggest* priority, but
 * the CRM always computes its own deterministic score so results are stable and
 * every score can be explained to the user.
 *
 * Factors: interest level · status · days since last contact · follow-up due
 * date · previous response · course interest · number of follow-ups · whether
 * the lead already requested information.
 */

import { PRIORITY_BY_ID } from '../config.js';
import { daysFromToday, formatDate } from '../lib/date.js';
import { followUpState, isClosed, hasReplied, isPositiveResponse, daysSinceContact } from './followup.js';

const INTEREST_POINTS = { Hot: 26, Warm: 14, Cold: 2 };
const STATUS_POINTS = {
  Hot: 18,
  Interested: 14,
  'Follow-up': 10,
  New: 6,
  Contacted: 5,
  Converted: 0,
  'Not Interested': 0,
  Lost: 0,
};

const INFO_REQUEST_RE = /(fee|fees|price|cost|discount|detail|details|brochure|syllabus|batch|registration|admission|installment|instalment|requirement|eligib)/i;

/**
 * @returns {{
 *   score:number, level:string, label:string, tone:string, rank:number,
 *   reasons:string[], closed:boolean, followUp:object
 * }}
 */
export function computePriority(lead, now = new Date()) {
  const followUp = followUpState(lead, now);
  const reasons = [];
  let score = 0;

  if (isClosed(lead)) {
    return {
      score: 0,
      level: 'minimal',
      label: 'Closed',
      tone: 'grey',
      rank: 1,
      reasons: [`Lead is marked ${lead.status}`],
      closed: true,
      followUp,
    };
  }

  /* 1. Interest level */
  score += INTEREST_POINTS[lead.interest] ?? 2;
  if (lead.interest === 'Hot') reasons.push('Marked as hot interest');
  else if (lead.interest === 'Warm') reasons.push('Warm interest');

  /* 2. Status */
  score += STATUS_POINTS[lead.status] ?? 0;
  if (lead.status === 'Hot') reasons.push('Status: Hot');
  else if (lead.status === 'Interested') reasons.push('Status: Interested');

  /* 3. Follow-up due date */
  const dueDays = followUp.days;
  if (followUp.bucket === 'overdue') {
    score += 22 + Math.min(8, Math.abs(dueDays) * 2);
    reasons.push(`Follow-up ${Math.abs(dueDays)} ${Math.abs(dueDays) === 1 ? 'day' : 'days'} overdue`);
  } else if (followUp.bucket === 'today') {
    score += 18;
    reasons.push('Follow-up due today');
  } else if (followUp.bucket === 'tomorrow') {
    score += 10;
  } else if (followUp.bucket === 'week') {
    score += 5;
  } else if (followUp.bucket === 'none' && lead.status !== 'New') {
    score += 4;
    reasons.push('No next follow-up scheduled');
  }

  /* 4. Days since last contact (silence grows priority, but not for brand-new leads) */
  const sinceContact = daysSinceContact(lead, now);
  if (sinceContact !== null) {
    if (sinceContact >= 10) { score += 14; reasons.push(`No contact for ${sinceContact} days`); }
    else if (sinceContact >= 7) { score += 10; reasons.push(`No contact for ${sinceContact} days`); }
    else if (sinceContact >= 4) { score += 7; }
    else if (sinceContact >= 2) { score += 3; }
  } else if (lead.status === 'New') {
    score += 6;
    reasons.push('New lead — never contacted');
  }

  /* 5. Previous response */
  if (isPositiveResponse(lead)) {
    score += 12;
    reasons.push(`Lead replied: "${truncateResponse(lead.lastResponse)}"`);
  } else if (hasReplied(lead)) {
    score += 5;
  } else if (lead.followUpCount > 0) {
    score += 6;
    reasons.push('Contacted but no reply yet');
  }

  /* 6. Course interest is real (a course is named) */
  if (lead.course) score += 4;

  /* 7. Follow-up effort already spent */
  if (lead.followUpCount === 0) score += 4;
  else if (lead.followUpCount <= 2) score += 2;
  else if (lead.followUpCount >= 5) { score -= 5; reasons.push(`${lead.followUpCount} follow-ups already made`); }

  /* 8. Lead previously asked for information */
  const askedForInfo = INFO_REQUEST_RE.test(lead.notes || '') || INFO_REQUEST_RE.test(lead.lastResponse || '');
  if (askedForInfo) { score += 8; reasons.push('Asked for course / fee information'); }

  /* 9. Contactability — email only is harder to work */
  const hasPhone = Boolean(lead.phone || lead.whatsapp);
  if (!hasPhone) { score -= 3; reasons.push('No phone number — email only'); }

  score = Math.max(0, Math.min(100, Math.round(score)));

  let level = 'minimal';
  if (score >= 72) level = 'very-high';
  else if (score >= 55) level = 'high';
  else if (score >= 36) level = 'medium';
  else if (score >= 18) level = 'low';

  const meta = PRIORITY_BY_ID[level];
  return {
    score,
    level,
    label: meta.label,
    tone: meta.tone,
    rank: meta.rank,
    reasons: reasons.slice(0, 4),
    closed: false,
    followUp,
  };
}

function truncateResponse(value) {
  const s = String(value || '').trim();
  return s.length > 48 ? `${s.slice(0, 47)}…` : s;
}

/** Attach priority to every lead (sorted highest first). */
export function rankLeads(leads, now = new Date()) {
  return leads
    .map((lead) => ({ lead, priority: computePriority(lead, now) }))
    .sort((a, b) => {
      if (b.priority.score !== a.priority.score) return b.priority.score - a.priority.score;
      const aDue = a.lead.nextFollowUp || '9999-99-99';
      const bDue = b.lead.nextFollowUp || '9999-99-99';
      return aDue.localeCompare(bDue);
    });
}

/** id -> priority, for quick lookups while rendering lists. */
export function priorityIndex(leads, now = new Date()) {
  const map = new Map();
  for (const lead of leads) map.set(lead.id, computePriority(lead, now));
  return map;
}

/** The single lead that deserves attention first right now. */
export function topPriorityLead(leads, now = new Date()) {
  const active = leads.filter((lead) => !isClosed(lead));
  if (!active.length) return null;
  const ranked = rankLeads(active, now);
  return ranked[0];
}

/** "Very High · 82" style short label used in tables. */
export function priorityBadgeText(priority) {
  return `${priority.label} · ${priority.score}`;
}

export function priorityExplainer(priority, lead, now = new Date()) {
  const bits = [...priority.reasons];
  if (lead.nextFollowUp) bits.push(`Follow-up: ${formatDate(lead.nextFollowUp)}`);
  return bits.join(' · ');
}
