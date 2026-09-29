/**
 * Built-in (offline) sales assistant.
 *
 * My CRM must never be a dead end: when there is no Gemini key, no internet, a
 * quota error, or the API is down, these local generators still produce useful
 * analysis, follow-up messages, daily summaries and marketing insights from the
 * data already on the device. Everything the AI would return has a local
 * equivalent with the same shape, marked `generatedBy: 'local'`.
 */

import { courseInfo } from '../config.js';
import { formatDate, relativeDayLabel, daysFromToday, todayISO, addDaysISO, formatDateTime } from '../lib/date.js';
import { hashString, truncate, uniq } from '../lib/utils.js';
import { followUpState, daysSinceContact, hasReplied, isClosed } from '../domain/followup.js';
import { computePriority } from '../domain/priority.js';
import { suggestFollowUpDate, localDailySummary } from '../domain/notifications.js';
import { followUpHealth, coursePerformance } from '../domain/analytics.js';

/* ------------------------------------------------------------- helpers -- */

function firstName(name) {
  return String(name || '').trim().split(/\s+/)[0] || 'there';
}

function safeLead(lead = {}) {
  return lead || {};
}

function greeting(lead, settings = {}, seed = 0) {
  const name = safeLead(lead).name || '';
  const style = settings.messageGreeting || 'auto';
  const first = firstName(name);
  const options = {
    auto: [
      `Hello ${first},`,
      `Hi ${first},`,
      `Assalam o Alaikum ${first},`,
    ],
    salam: [`Assalam o Alaikum ${first},`, `Assalam o Alaikum ${firstName(name)},`],
    hello: [`Hello ${first},`, `Hi ${first},`],
    formal: [`Dear ${name || first},`, `Dear ${first},`],
  };
  const list = options[style] || options.auto;
  return list[Math.abs(seed) % list.length];
}

function signOff(settings = {}) {
  const parts = [];
  if (settings.senderName) parts.push(settings.senderName);
  if (settings.businessName) parts.push(settings.businessName);
  if (!parts.length) return '';
  return `\n\n${parts.join(' · ')}`;
}

function courseLine(lead) {
  const lead0 = safeLead(lead);
  return lead0.course ? lead0.course : 'the course you enquired about';
}

function daysSince(lead, now = new Date()) {
  const since = daysSinceContact(lead, now);
  return since === null ? null : since;
}

function silencePhrase(lead, now = new Date()) {
  const since = daysSince(lead, now);
  if (since === null) return '';
  if (since === 0) return 'we spoke earlier today';
  if (since === 1) return 'we spoke yesterday';
  if (since < 7) return `we last spoke ${since} days ago`;
  if (since < 14) return 'we spoke about a week ago';
  if (since < 45) return `it has been about ${Math.round(since / 7)} weeks since we spoke`;
  return 'we last spoke a few months ago';
}

function highlight(lead) {
  const info = courseInfo(safeLead(lead).course);
  const bits = info?.highlights || [];
  return bits.length ? bits[0].toLowerCase() : 'flexible study options';
}

function notesHint(lead) {
  const notes = String(safeLead(lead).notes || '');
  if (!notes) return '';
  const match = notes.match(/(fee|fees|price|cost|discount|batch|schedule|installment|instalment|visa|requirement|eligibility)/i);
  if (!match) return '';
  return match[1].toLowerCase();
}

/* ------------------------------------------------ follow-up messages -- */

const STYLE_TEMPLATES = {
  friendly: [
    (lead, ctx) => `${greeting(lead, ctx.settings, ctx.variant)} hope you are doing well. Just following up regarding the ${courseLine(lead)}. You had shown interest earlier, so I wanted to check if you would like me to share the upcoming batch and registration details?`,
    (lead, ctx) => `${greeting(lead, ctx.settings, ctx.variant)} I hope everything is going well at your end. I wanted to check in about the ${courseLine(lead)} — the next batch is being planned and I can hold a place for you if you are still interested. Would you like the details?`,
    (lead, ctx) => `${greeting(lead, ctx.settings, ctx.variant)} just a friendly check-in about your ${courseLine(lead)} enquiry. Would you like me to send the current fee structure and the next start date so you can decide comfortably?`,
  ],
  professional: [
    (lead, ctx) => `${greeting(lead, ctx.settings, ctx.variant)} I hope this message finds you well. I am following up on your enquiry regarding the ${courseLine(lead)}. I would be glad to share the programme outline, fee structure and the next available batch. May I ask what time suits you for a short call?`,
    (lead, ctx) => `${greeting(lead, ctx.settings, ctx.variant)} thank you for your earlier interest in the ${courseLine(lead)}. To help you take the next step, I can send the entry requirements, duration and the enrolment schedule. Would you like me to prepare that for you?`,
  ],
  short: [
    (lead) => `${greeting(lead, ctx_settings_placeholder(), 0)} quick follow-up on the ${courseLine(lead)} — should I send the next batch dates and fee details?`,
    (lead) => `Hi ${firstName(lead.name)}, still interested in the ${courseLine(lead)}? I can share the next batch and fee details today.`,
    (lead) => `${greeting(lead, {}, 0)} the next ${courseLine(lead)} batch is filling up. Want me to send the details?`,
  ],
  followup: [
    (lead, ctx) => `${greeting(lead, ctx.settings, ctx.variant)} I wanted to follow up on our last conversation about the ${courseLine(lead)}. ${silencePhrase(lead, ctx.now) ? `Since ${silencePhrase(lead, ctx.now)}, ` : ''}I did not want you to miss the upcoming intake. Shall I send the batch dates and registration steps?`,
    (lead, ctx) => `${greeting(lead, ctx.settings, ctx.variant)} just checking back on the ${courseLine(lead)} enquiry. Have you had a chance to review the details I shared? I am happy to answer any questions so you can make a clear decision.`,
  ],
  reminder: [
    (lead, ctx) => `${greeting(lead, ctx.settings, ctx.variant)} a quick reminder about the ${courseLine(lead)}. The next batch starts soon${ctx.hint ? ` and you had asked about the ${ctx.hint}` : ''}. Would you like me to reserve a seat for you while you decide?`,
    (lead, ctx) => `${greeting(lead, ctx.settings, ctx.variant)} friendly reminder that registration for the ${courseLine(lead)} is open. If you share your preferred schedule, I will confirm the seat and send the joining details.`,
  ],
  promotional: [
    (lead, ctx) => `${greeting(lead, ctx.settings, ctx.variant)} the new ${courseLine(lead)} batch is now open, and seats are limited. We are offering ${highlight(lead)}, delivered by experienced HSE trainers. Would you like me to send the fee details and reserve your place?`,
    (lead, ctx) => `${greeting(lead, ctx.settings, ctx.variant)} good news — the ${courseLine(lead)} intake is open this month. Places fill quickly and you can start with a flexible plan. Reply "YES" and I will send the full offer and registration link.`,
  ],
  reengagement: [
    (lead, ctx) => `${greeting(lead, ctx.settings, ctx.variant)} ${silencePhrase(lead, ctx.now) || 'it has been a while'}! I am revisiting our conversation about the ${courseLine(lead)}. Things have moved on — there are new batch dates and updated options that may suit you better now. Would you like a quick update?`,
    (lead, ctx) => `${greeting(lead, ctx.settings, ctx.variant)} it has been some time since your ${courseLine(lead)} enquiry. Many of our students started exactly where you are now. If the timing works better today, I can send the latest schedule and fees in one message.`,
  ],
  final: [
    (lead, ctx) => `${greeting(lead, ctx.settings, ctx.variant)} I do not want to keep bothering you, so this is my last follow-up about the ${courseLine(lead)}. If the timing is not right, just reply "later" and I will close it for now. If you are still interested, tell me the best time to call and I will take care of the rest.`,
  ],
};

// Kept for template 1 of "short" which does not need settings context.
function ctx_settings_placeholder() { return {}; }

/** Generate a follow-up / marketing message without the AI. */
export function localMessage(lead, { style = 'friendly', settings = {}, variant = 0, now = new Date() } = {}) {
  const templates = STYLE_TEMPLATES[style] || STYLE_TEMPLATES.friendly;
  const template = templates[Math.abs(variant) % templates.length];
  const ctx = { settings, variant, now, hint: notesHint(lead) };
  let message = template(lead, ctx).replace(/\s+/g, ' ').trim();
  message = `${message}${signOff(settings)}`;

  const notes = [
    `Style: ${style}`,
    lead?.course ? `Course: ${lead.course}` : '',
    daysSince(lead, now) !== null ? `Last contact: ${daysSince(lead, now)} days ago` : '',
  ].filter(Boolean).join(' · ');

  return { message, notes, variant, generatedBy: 'local' };
}

/** Local "Make shorter" / "Make more professional" rewrites. */
export function localRefine(message, mode, lead, { settings = {}, now = new Date() } = {}) {
  const text = String(message || '').replace(/\s+/g, ' ').trim();
  if (!text) return localMessage(lead, { settings, now }).message;

  if (mode === 'shorter') {
    const sentences = text.split(/(?<=[.!?])\s+/).filter(Boolean);
    const keep = sentences.slice(0, Math.max(2, Math.min(3, sentences.length)));
    let out = keep.join(' ');
    if (out.length > 220) out = `${out.slice(0, 217).trim()}…`;
    return out;
  }

  if (mode === 'professional') {
    let out = text
      .replace(/^(hi|hey|hello)\b[^,]*,\s*/i, `Dear ${safeLead(lead).name || firstName(safeLead(lead).name)},\n\n`)
      .replace(/\bwant\b/gi, 'would like')
      .replace(/\bsend you\b/gi, 'share with you')
      .replace(/\bget back\b/gi, 'respond')
      .replace(/\bASAP\b/g, 'at your earliest convenience')
      .replace(/\bthanks\b/gi, 'thank you')
      .replace(/\bcan't\b/gi, 'cannot')
      .replace(/\bdon't\b/gi, 'do not')
      .replace(/\bI'll\b/g, 'I will')
      .replace(/\bwe're\b/gi, 'we are')
      .replace(/\bit's\b/gi, 'it is');
    if (!/kind regards|best regards|regards,/i.test(out)) {
      out += `\n\nKind regards,\n${settings.senderName || 'Admissions Team'}${settings.businessName ? `\n${settings.businessName}` : ''}`;
    }
    return out;
  }

  return text;
}

/* ------------------------------------------------- lead AI analysis -- */

const PRIORITY_LABEL = {
  'very-high': 'Very High',
  high: 'High',
  medium: 'Medium',
  low: 'Low',
  minimal: 'Minimal',
};

/** Rule-based equivalent of "Analyze with AI" (same output shape). */
export function localAnalysis(lead, now = new Date()) {
  const priority = computePriority(lead, now);
  const state = followUpState(lead, now);
  const since = daysSinceContact(lead, now);
  const replied = hasReplied(lead);
  const info = courseInfo(lead.course);

  let recommendedAction = '';
  let actionType = 'whatsapp';
  let approach = '';

  if (isClosed(lead)) {
    recommendedAction = `No action needed — this lead is marked ${lead.status}. Keep them on the nurture list.`;
    actionType = 'none';
    approach = 'Optional: send a thank-you or seasonal message to stay in touch.';
  } else if (state.bucket === 'overdue') {
    recommendedAction = `Call ${firstName(lead.name)} today — the follow-up is ${Math.abs(state.days)} ${Math.abs(state.days) === 1 ? 'day' : 'days'} overdue.`;
    actionType = 'call';
    approach = 'Open with an apology for the delay, confirm the course is still of interest, then move straight to fees and the next batch date.';
  } else if (state.bucket === 'today') {
    recommendedAction = `Send a short WhatsApp follow-up today${lead.course ? ` about the ${lead.course}` : ''}.`;
    actionType = 'whatsapp';
    approach = 'Keep it to 2–3 lines: reference the course, mention the upcoming batch, ask a simple yes/no question.';
  } else if (since !== null && since >= 5 && !replied) {
    recommendedAction = `${firstName(lead.name)} has not replied for ${since} days — send a low-pressure reminder and offer to close the file if the timing is wrong.`;
    actionType = 'reminder';
    approach = 'Acknowledge the silence politely, give one clear reason to reply (new batch / fee update), and make replying effortless.';
  } else if (lead.status === 'New' || !lead.lastContact) {
    recommendedAction = `First contact: call ${firstName(lead.name)} and confirm the course requirement.`;
    actionType = 'call';
    approach = 'Introduce yourself briefly, ask about their current job role and what they want to achieve, then recommend the right qualification.';
  } else if (replied && !lead.nextFollowUp) {
    recommendedAction = 'The lead has replied but nothing is scheduled — set a follow-up date and send the details they asked for.';
    actionType = 'course_details';
    approach = 'Answer their question directly, attach the outline or fee sheet, and propose a specific next step with a date.';
  } else {
    recommendedAction = `Follow up on ${formatDate(lead.nextFollowUp)} with a course update${info?.duration ? ` (${info.duration})` : ''}.`;
    actionType = 'reminder';
    approach = 'Keep the relationship warm: share a student success story or the next intake date.';
  }

  const reasonBits = [...priority.reasons];
  if (lead.lastResponse) reasonBits.push(`Last response: "${truncate(lead.lastResponse, 60)}"`);
  if (!lead.nextFollowUp) reasonBits.push('No next follow-up scheduled');

  return {
    status: lead.status,
    interest: lead.interest,
    priority: PRIORITY_LABEL[priority.level] || 'Medium',
    priorityScore: priority.score,
    recommendedAction,
    actionType,
    suggestedFollowUpDate: suggestFollowUpDate(lead, state, now),
    reason: reasonBits.join('. ') || 'No strong signals in the data yet — keep following the standard schedule.',
    communicationApproach: approach,
    generatedBy: 'local',
    at: new Date().toISOString(),
  };
}

/* --------------------------------------------------- daily summary -- */

export function localSummary(leads, now = new Date()) {
  const summary = localDailySummary(leads, now);
  return { ...summary, generatedBy: 'local' };
}

/* ------------------------------------------------ marketing insights -- */

export function localMarketingInsights(leads, now = new Date()) {
  const insights = [];
  const health = followUpHealth(leads, now);
  const courses = coursePerformance(leads, now);
  const total = leads.length || 1;

  const stalled = courses.filter((c) => c.total >= 3 && c.converted === 0).sort((a, b) => b.total - a.total);
  if (stalled.length) {
    const c = stalled[0];
    insights.push({
      title: `Interest in ${c.course} is not converting`,
      detail: `${c.total} leads enquired about ${c.course} and none have converted yet. ${c.silent} have been silent for over a week and ${c.overdue} have overdue follow-ups.`,
      severity: 'orange',
      suggestedAction: `Run a short WhatsApp reactivation sequence for the ${c.course} list and invite them to the next intake.`,
      marketingIdea: `"${c.course} — new batch starting soon. Reply YES for fee structure and seat availability."`,
    });
  }

  const oldUnworked = leads.filter((l) => !isClosed(l) && (daysSinceContact(l, now) ?? 0) >= 21);
  if (oldUnworked.length >= 3) {
    insights.push({
      title: `${oldUnworked.length} older enquiries could be reactivated`,
      detail: `${oldUnworked.length} leads have not been contacted in 3+ weeks. Older NVQ and IOSH enquiries often re-engage when a new batch is announced.`,
      severity: 'blue',
      suggestedAction: 'Send a reactivation campaign highlighting new batch dates and updated fees.',
      marketingIdea: '"We have a new intake for the qualification you asked about — would you like the updated details?"',
    });
  }

  const sourceCounts = new Map();
  leads.forEach((l) => sourceCounts.set(l.source || 'Unknown', (sourceCounts.get(l.source || 'Unknown') || 0) + 1));
  const topSource = Array.from(sourceCounts.entries()).sort((a, b) => b[1] - a[1])[0];
  if (topSource && topSource[1] > 0) {
    insights.push({
      title: `Most new leads came from ${topSource[0]}`,
      detail: `${topSource[1]} of ${total} leads (${Math.round((topSource[1] / total) * 100)}%) came from ${topSource[0]}. Double down there and consider a retargeting campaign for the same audience.`,
      severity: 'green',
      suggestedAction: `Increase activity on ${topSource[0]} and reuse the messaging that worked best there.`,
      marketingIdea: `Post a short course teaser aimed at the ${topSource[0]} audience with a clear call to action.`,
    });
  }

  if (health.weekendContacts >= 5 && health.weekendSilentRate >= 55) {
    insights.push({
      title: 'Weekend enquiries are not being followed up in time',
      detail: `${health.weekendContacts} leads were first contacted at the weekend and ${health.weekendSilentRate}% never replied. Response speed looks like the bottleneck, not lead quality.`,
      severity: 'orange',
      suggestedAction: 'Move weekend enquiries into a Monday-morning call block, or send a short acknowledgment message the same day.',
      marketingIdea: 'Auto-acknowledgment: "Thanks for your enquiry — a course advisor will call you within 24 hours."',
    });
  }

  if (health.noFollowUp >= 3) {
    insights.push({
      title: `${health.noFollowUp} active leads have no next follow-up`,
      detail: `${health.missingFollowUpRate}% of your active pipeline has no scheduled follow-up, which is the fastest way to lose warm leads. Average follow-ups per lead: ${health.avgFollowUps}.`,
      severity: 'red',
      suggestedAction: 'Use the Notifications page → "Schedule follow-ups" to set dates for the whole forgotten list.',
    });
  }

  const hotUnconverted = leads.filter((l) => !isClosed(l) && (l.interest === 'Hot' || l.status === 'Hot'));
  if (hotUnconverted.length >= 2) {
    const cities = uniq(hotUnconverted.map((l) => l.city).filter(Boolean)).slice(0, 3);
    insights.push({
      title: `${hotUnconverted.length} hot leads are still open`,
      detail: `${hotUnconverted.length} leads are marked hot interest but have not converted${cities.length ? ` — concentrated in ${cities.join(', ')}` : ''}. A fee/discount nudge usually works best at this stage.`,
      severity: 'flame',
      suggestedAction: 'Call the hot list today and send a limited-seat or early-bird offer by WhatsApp.',
      marketingIdea: '"Only a few seats left in this batch — enrolment closes on Friday."',
    });
  }

  if (health.avgOverdueDays >= 3) {
    insights.push({
      title: `Follow-ups run ${health.avgOverdueDays} days late on average`,
      detail: `Across ${leads.length} leads, the average overdue follow-up is ${health.avgOverdueDays} days. Delays beyond 3 days noticeably reduce reply rates.`,
      severity: 'blue',
      suggestedAction: 'Start each day on the Overdue list before working new leads.',
    });
  }

  if (!insights.length) {
    insights.push({
      title: 'Not enough data for trend analysis yet',
      detail: 'Once you have more leads with follow-up dates, My CRM will surface conversion gaps, source performance and follow-up delays here.',
      severity: 'blue',
      suggestedAction: 'Connect your Google Sheet and keep follow-up dates up to date.',
    });
  }

  return {
    summary: `${leads.length} leads analysed. ${health.silentOver7} silent for 7+ days, ${health.noFollowUp} without a next follow-up, ${hotUnconverted.length} hot leads open.`,
    insights: insights.slice(0, 6),
    generatedBy: 'local',
    at: new Date().toISOString(),
  };
}

/* -------------------------------------------------- campaign message -- */

const CAMPAIGN_OPENERS = [
  (course, settings) => `${greeting({ name: settings.recipientName || 'there' }, settings, hashString(course))} `,
  () => 'Hello, ',
];

export function localCampaignMessage({
  course = '',
  audience = 'All leads',
  purpose = 'Reactivation',
  leads = [],
  settings = {},
  variant = 0,
  now = new Date(),
} = {}) {
  const cLabel = course || 'our HSE qualifications';
  const info = courseInfo(course);
  const count = leads.length;
  const hot = leads.filter((l) => l.interest === 'Hot' || l.status === 'Hot').length;
  const city = mostCommon(leads.map((l) => l.city));
  const courseName = cLabel;

  const bodies = {
    Reactivation: [
      `We are opening a new intake for the ${courseName}. If you are still planning to get certified, I can share the new batch dates and the updated fee structure today. Would you like me to send the details?`,
      `It has been a while since you asked about the ${courseName}. The programme has been updated and a new batch is starting soon — reply YES and I will send everything you need to decide.`,
    ],
    'New batch announcement': [
      `The next ${courseName} batch is confirmed and enrolment is now open. ${info?.duration ? `Duration: ${info.duration}. ` : ''}Seats are limited to keep the class size small — shall I reserve one for you?`,
      `New ${courseName} batch starting soon. ${info?.summary || ''} If you want a seat, reply YES and I will send the registration steps.`,
    ],
    'Fee / discount offer': [
      `We are offering a limited discount on the ${courseName} for this intake. If you register this week, the fee is reduced and instalments are available. Would you like the exact figures?`,
      `Special offer on the ${courseName}: early-bird discount for this batch${info?.duration ? ` (${info.duration})` : ''}. Reply and I will send the fee breakdown and payment options.`,
    ],
    'Course information': [
      `Sharing the quick facts on the ${courseName}: ${info?.summary || 'practical, recognised training for HSE professionals.'} ${info?.highlights?.length ? `Highlights: ${info.highlights.join('; ')}. ` : ''}Would you like the full outline and next start date?`,
    ],
    'Reminder to register': [
      `Quick reminder — registration for the ${courseName} closes soon. If you would like me to hold a seat while you finalise, just reply with your preferred batch.`,
    ],
    'Event / webinar invite': [
      `We are hosting a short (30 minute) live session on the ${courseName} where we cover requirements, career outcomes and fees. Would you like me to send the joining link?`,
    ],
  };

  const purposeBodies = bodies[purpose] || bodies.Reactivation;
  const opener = CAMPAIGN_OPENERS[0](course, settings);
  let message = `${opener}${purposeBodies[Math.abs(variant) % purposeBodies.length]}`;

  if (count && (audience.includes('Old') || audience.includes('No-response'))) {
    message += ' This is a one-time message — if the timing is not right just let me know.';
  }
  if (city && audience.includes('city')) {
    message += ` (Many of our students in ${city} have taken this route.)`;
  }
  if (hot >= 3) message += ' Several people in this batch have already confirmed, so early registration is recommended.';

  message = `${message}${signOff(settings)}`;

  return {
    message,
    variants: [
      `${greeting({ name: 'there' }, settings, 1)} new ${courseName} batch dates are out. Reply YES for the schedule, fees and seat availability.${signOff(settings)}`,
    ],
    audience: `${audience}${count ? ` (${count} leads)` : ''}`,
    notes: `Purpose: ${purpose}${hot ? ` · ${hot} hot leads in this audience` : ''}`,
    generatedBy: 'local',
    at: new Date().toISOString(),
  };
}

function mostCommon(list) {
  const counts = new Map();
  list.filter(Boolean).forEach((v) => counts.set(v, (counts.get(v) || 0) + 1));
  const top = Array.from(counts.entries()).sort((a, b) => b[1] - a[1])[0];
  return top ? top[0] : '';
}

/** Local timeline of "what to do today" used when the AI is unavailable. */
export function localDailyPlan(leads, now = new Date()) {
  const overdue = leads.filter((l) => !isClosed(l) && followUpState(l, now).bucket === 'overdue');
  const today = leads.filter((l) => !isClosed(l) && followUpState(l, now).bucket === 'today');
  const plan = [];
  if (overdue.length) {
    plan.push({
      time: 'Morning',
      title: `Clear ${overdue.length} overdue follow-up${overdue.length === 1 ? '' : 's'}`,
      detail: `Start with ${overdue[0].name} — ${Math.abs(followUpState(overdue[0], now).days)} days late.`,
      filter: { bucket: 'overdue', showClosed: true },
    });
  }
  if (today.length) {
    plan.push({
      time: 'Midday',
      title: `Work through ${today.length} follow-up${today.length === 1 ? '' : 's'} due today`,
      detail: 'WhatsApp first, then call anyone who does not reply within a couple of hours.',
      filter: { bucket: 'today', showClosed: true },
    });
  }
  plan.push({
    time: 'Afternoon',
    title: 'Update statuses and set next follow-up dates',
    detail: 'Every lead you touch today should leave the list with a clear next action and date.',
    filter: { bucket: 'none', showClosed: true },
  });
  return { plan, generatedBy: 'local', at: new Date().toISOString() };
}

export { todayISO, addDaysISO, formatDateTime };
