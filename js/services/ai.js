/**
 * High-level AI features (Gemini + local fallback).
 *
 * Design rules:
 *  - Only the minimum lead data is sent (section 20) — no full sheet dumps.
 *  - Results are cached and keyed by the lead signature, so nothing is
 *    re-analysed until the lead actually changes (section 27).
 *  - Every function resolves with { ok, data, source, error } and never throws,
 *    so a broken API key or a quota error can never break the CRM (section 26).
 */

import { COURSE_INFO, courseInfo } from '../config.js';
import { formatDate, relativeDayLabel, todayISO } from '../lib/date.js';
import { truncate } from '../lib/utils.js';
import { followUpState, daysSinceContact, hasReplied } from '../domain/followup.js';
import { computePriority } from '../domain/priority.js';
import { compactSummaryText, marketingSnapshot } from '../domain/analytics.js';
import { localDailySummary } from '../domain/notifications.js';
import { generateContent, extractJson, AiError, isConfigured, aiStatus, isOffline, testConnection } from './gemini.js';
import * as local from './local-ai.js';

const SYSTEM_INSTRUCTION = `You are the sales assistant inside "My CRM", used by a training institute that sells health & safety certifications (IOSH, NVQ, OTHM, ISO, CFPS, OSHA).

You behave like an experienced, practical sales consultant, not a chatbot:
- Be specific and concise. No filler, no markdown headings, no emojis in generated client messages.
- Write client messages the way a real human advisor writes on WhatsApp: warm, short, professional, one clear call to action.
- Use British English. Use the lead's first name naturally.
- Never invent discounts, guaranteed outcomes, accreditation claims or dates that were not provided.
- If information is missing, work with what you have instead of asking the user for more data.`;

/* ---------------------------------------------------------- payloads -- */

/** Deliberately small, privacy-aware view of a lead. */
export function minimalLeadPayload(lead, settings = {}) {
  const minimal = settings.aiMinimalPayload !== false;
  const displayName = minimal ? shortenName(lead.name) : lead.name;
  const state = followUpState(lead);
  const since = daysSinceContact(lead);
  return {
    name: displayName,
    course: lead.course || '(not specified)',
    status: lead.status,
    interest: lead.interest,
    city: lead.city || undefined,
    source: lead.source || undefined,
    lastContact: lead.lastContact ? `${formatDate(lead.lastContact)} (${relativeDayLabel(lead.lastContact).toLowerCase()})` : 'never contacted',
    daysSinceLastContact: since === null ? undefined : since,
    nextFollowUp: lead.nextFollowUp ? `${formatDate(lead.nextFollowUp)} (${relativeDayLabel(lead.nextFollowUp).toLowerCase()})` : 'not scheduled',
    followUpStatus: state.bucket,
    followUpsMade: lead.followUpCount,
    lastResponse: hasReplied(lead) ? truncate(lead.lastResponse, 140) : 'no reply yet',
    notes: lead.notes ? truncate(lead.notes, 300) : undefined,
    crmPriority: `${computePriority(lead).label} (${computePriority(lead).score}/100)`,
  };
}

function shortenName(name) {
  const parts = String(name || '').trim().split(/\s+/);
  if (parts.length < 2) return parts[0] || '';
  return `${parts[0]} ${parts[parts.length - 1][0]}.`;
}

function leadFacts(lead, settings = {}) {
  const info = courseInfo(lead.course);
  const business = settings.businessName ? `Institute: ${settings.businessName}.` : '';
  return `Lead data (JSON):\n${JSON.stringify(minimalLeadPayload(lead, settings), null, 2)}\n\nCourse reference: ${info ? info.summary : 'no standard course matched'}${info?.duration ? ` Duration: ${info.duration}.` : ''}${info?.highlights?.length ? ` Selling points: ${info.highlights.join('; ')}.` : ''} ${business}`;
}

/* ------------------------------------------------------------ cache -- */

function cacheGet(key, { force = false } = {}) {
  if (force) return null;
  return null; // replaced below by the stateful wrapper
}

/** Cache helpers are injected by aiService so this module stays testable. */
export const cacheApi = {
  get: () => null,
  set: () => {},
  enabled: () => true,
};

function readCache(key) {
  if (!cacheApi.enabled()) return null;
  return cacheApi.get(key);
}

function writeCache(key, value) {
  if (!cacheApi.enabled()) return;
  cacheApi.set(key, value);
}

function cacheKey(parts) {
  return parts.filter(Boolean).join(':');
}

/* --------------------------------------------------- lead analysis -- */

const ANALYSIS_SCHEMA = {
  type: 'object',
  properties: {
    status: { type: 'string', enum: ['New', 'Contacted', 'Interested', 'Follow-up', 'Hot', 'Converted', 'Not Interested', 'Lost'] },
    interest: { type: 'string', enum: ['Cold', 'Warm', 'Hot'] },
    priority: { type: 'string', enum: ['Very High', 'High', 'Medium', 'Low', 'Minimal'] },
    recommendedAction: { type: 'string' },
    actionType: { type: 'string', enum: ['call', 'whatsapp', 'course_details', 'fee_details', 'reminder', 'follow_later', 'converted', 'lost', 'none'] },
    suggestedFollowUpDate: { type: 'string' },
    reason: { type: 'string' },
    communicationApproach: { type: 'string' },
  },
  required: ['priority', 'recommendedAction', 'actionType', 'suggestedFollowUpDate', 'reason', 'communicationApproach'],
};

export async function analyzeLead(lead, { settings = {}, force = false, now = new Date() } = {}) {
  const key = cacheKey(['analysis', lead.id, lead.signature, settings.geminiModel]);

  if (!isConfigured(settings) || isOffline()) {
    const localResult = local.localAnalysis(lead, now);
    return { ok: true, data: localResult, source: 'local', cached: false, reason: isOffline() ? 'offline' : 'no-key' };
  }

  const cached = readCache(key);
  if (cached) return { ok: true, data: cached, source: 'cache', cached: true };

  const prompt = `${leadFacts(lead, settings)}

Task: analyse this single lead for a sales advisor and return JSON with:
- status: the CRM status that best matches the evidence
- interest: Cold, Warm or Hot based on the evidence, not on the current label if the evidence disagrees
- priority: Very High, High, Medium, Low or Minimal
- recommendedAction: one concrete sentence describing exactly what the advisor should do next
- actionType: the channel/action (call, whatsapp, course_details, fee_details, reminder, follow_later, converted, lost, none)
- suggestedFollowUpDate: ISO date (YYYY-MM-DD) for the next follow-up, today is ${todayISO(now)}
- reason: 1-2 sentences citing the specific evidence (dates, silence, replies)
- communicationApproach: how to open the conversation and what to emphasise

Return JSON only.`;

  try {
    const { text, model } = await generateContent({
      prompt,
      systemInstruction: SYSTEM_INSTRUCTION,
      responseSchema: ANALYSIS_SCHEMA,
      temperature: 0.4,
      maxOutputTokens: 700,
      settings,
    });
    const parsed = extractJson(text);
    if (!parsed) throw new AiError('parse', 'Gemini returned an unreadable analysis.');
    const data = {
      status: parsed.status || lead.status,
      interest: parsed.interest || lead.interest,
      priority: parsed.priority || computePriority(lead, now).label,
      recommendedAction: parsed.recommendedAction || '',
      actionType: parsed.actionType || 'whatsapp',
      suggestedFollowUpDate: /^\d{4}-\d{2}-\d{2}$/.test(parsed.suggestedFollowUpDate || '') ? parsed.suggestedFollowUpDate : local.localAnalysis(lead, now).suggestedFollowUpDate,
      reason: parsed.reason || '',
      communicationApproach: parsed.communicationApproach || '',
      generatedBy: 'gemini',
      model,
      at: new Date().toISOString(),
    };
    writeCache(key, data);
    return { ok: true, data, source: 'gemini', cached: false };
  } catch (error) {
    const localResult = local.localAnalysis(lead, now);
    return { ok: true, data: localResult, source: 'local', cached: false, error: error instanceof AiError ? error : new AiError('server', 'AI request failed.'), reason: 'ai-error' };
  }
}

/** Bulk analysis used by "Analyze with AI" in bulk contexts (bounded). */
export async function analyzeLeads(leads, { settings = {}, limit = 12, onProgress = null } = {}) {
  const target = leads.slice(0, limit);
  const results = [];
  for (let i = 0; i < target.length; i += 1) {
    const result = await analyzeLead(target[i], { settings });
    results.push({ leadId: target[i].id, ...result });
    if (onProgress) onProgress(i + 1, target.length);
    // Gentle pacing keeps us inside the free-tier rate limit.
    if (i < target.length - 1) await new Promise((r) => setTimeout(r, 350));
  }
  return results;
}

/* -------------------------------------------------- message writing -- */

const MESSAGE_SCHEMA = {
  type: 'object',
  properties: {
    message: { type: 'string' },
    notes: { type: 'string' },
  },
  required: ['message'],
};

const STYLE_BRIEF = {
  friendly: 'warm and friendly, like a helpful advisor who remembers them',
  professional: 'polished, formal and businesslike, suitable for email or a corporate WhatsApp',
  short: 'very short WhatsApp message, maximum 2 sentences, no fluff',
  followup: 'a clear follow-up after no reply, referencing when you last spoke',
  reminder: 'a gentle reminder of the next step with a reason to act now',
  promotional: 'promotional but not pushy: highlight the upcoming batch, seats and any course benefits',
  reengagement: 're-engage an old enquiry that went quiet a while ago, acknowledging the gap',
  final: 'a polite final follow-up that gives the lead an easy way to close the conversation',
};

export async function generateMessage(lead, { style = 'friendly', settings = {}, force = false, variant = 0, instruction = '', now = new Date() } = {}) {
  const key = cacheKey(['message', lead.id, lead.signature, style, variant]);
  if (!isConfigured(settings) || isOffline()) {
    return { ok: true, data: local.localMessage(lead, { style, settings, variant, now }), source: 'local', cached: false };
  }

  const cached = readCache(key);
  if (cached && !force) return { ok: true, data: cached, source: 'cache', cached: true };

  const prompt = `${leadFacts(lead, settings)}
Follow-up style: ${STYLE_BRIEF[style] || STYLE_BRIEF.friendly}${instruction ? `\nExtra instruction from the sales advisor: ${instruction}` : ''}

Task: write ONE follow-up message that the advisor can send to this lead as-is (WhatsApp or email). Requirements:
- 35 to 90 words, plain text, no markdown, no emojis, no bullet points.
- Greet the lead by first name, reference the specific course, and mention the relevant previous interaction or silence.
- One clear, easy call to action (for example offering batch dates, fee details, a short call).
- Sound like a real person. Never say "As an AI" or "I hope this email finds you well" style boilerplate unless the professional style is requested.
- Sign off with the advisor name if provided, otherwise no signature.
Return JSON: {"message": "...", "notes": "one short line explaining the approach for the CRM record"}`;

  try {
    const { text, model } = await generateContent({
      prompt,
      systemInstruction: SYSTEM_INSTRUCTION,
      responseSchema: MESSAGE_SCHEMA,
      temperature: 0.85,
      maxOutputTokens: 500,
      settings,
    });
    const parsed = extractJson(text);
    if (!parsed?.message) throw new AiError('parse', 'Gemini returned an unreadable message.');
    const data = {
      message: String(parsed.message).trim(),
      notes: parsed.notes ? String(parsed.notes).trim() : `Style: ${style}`,
      style,
      variant,
      generatedBy: 'gemini',
      model,
      at: new Date().toISOString(),
    };
    writeCache(key, data);
    return { ok: true, data, source: 'gemini', cached: false };
  } catch (error) {
    const fallback = local.localMessage(lead, { style, settings, variant, now });
    return { ok: true, data: fallback, source: 'local', cached: false, error: error instanceof AiError ? error : null };
  }
}

const REFINE_BRIEF = {
  shorter: 'Rewrite it to be shorter (maximum 2 short sentences) while keeping the same offer.',
  professional: 'Rewrite it to sound more professional and polished while keeping the warm human tone and the same offer.',
};

/** "Make Shorter" / "Make More Professional". */
export async function refineMessage(message, mode, lead, { settings = {}, now = new Date() } = {}) {
  const brief = REFINE_BRIEF[mode] || REFINE_BRIEF.shorter;
  if (!isConfigured(settings) || isOffline()) {
    return { ok: true, data: { message: local.localRefine(message, mode, lead, { settings, now }), notes: `Adjusted locally (${mode})`, generatedBy: 'local' }, source: 'local' };
  }
  const prompt = `Existing follow-up message for ${lead.name} (${lead.course || 'course not specified'}):\n"""${message}"""\n\nTask: ${brief}\nKeep the greeting, the course reference and the call to action. Plain text only. Return JSON: {"message": "..."}`;
  try {
    const { text } = await generateContent({
      prompt,
      systemInstruction: SYSTEM_INSTRUCTION,
      responseSchema: MESSAGE_SCHEMA,
      temperature: 0.6,
      maxOutputTokens: 400,
      settings,
    });
    const parsed = extractJson(text);
    if (!parsed?.message) throw new AiError('parse', 'Unreadable response.');
    return { ok: true, data: { message: String(parsed.message).trim(), notes: `Adjusted with AI (${mode})`, generatedBy: 'gemini' }, source: 'gemini' };
  } catch (error) {
    return {
      ok: true,
      data: { message: local.localRefine(message, mode, lead, { settings, now }), notes: `Adjusted locally (${mode}) — AI unavailable`, generatedBy: 'local' },
      source: 'local',
      error: error instanceof AiError ? error : null,
    };
  }
}

/* ---------------------------------------------------- daily summary -- */

const SUMMARY_SCHEMA = {
  type: 'object',
  properties: {
    headline: { type: 'string' },
    summary: { type: 'string' },
    priorities: { type: 'array', items: { type: 'string' } },
    risks: { type: 'array', items: { type: 'string' } },
    quickWins: { type: 'array', items: { type: 'string' } },
  },
  required: ['headline', 'summary'],
};

export async function dailySummary(leads, { settings = {}, force = false, now = new Date() } = {}) {
  const localResult = local.localSummary(leads, now);
  const key = cacheKey(['daily', todayISO(now), leads.length, hashLeads(leads)]);

  if (!isConfigured(settings) || isOffline()) {
    return { ok: true, data: localResult, source: 'local', cached: false };
  }
  const cached = readCache(key);
  if (cached && !force) return { ok: true, data: cached, source: 'cache', cached: true };

  const top = topLeadsForPrompt(leads, settings, 6, now);
  const prompt = `Today is ${todayISO(now)}. Here is the situation for the sales advisor's CRM.

Aggregate summary (already computed by the CRM, do not recalculate):
${localResult.summary}

Highest priority leads (JSON, minimum fields only):
${JSON.stringify(top, null, 2)}

Task: write a short daily briefing. 
- headline: maximum 12 words, the single most important thing today.
- summary: 3-5 sentences, addressing the advisor directly ("you"), naming the most important lead and course, and giving a clear order of work.
- priorities: up to 4 short action lines, most urgent first.
- risks: up to 2 short lines about leads that may be lost if not handled today.
- quickWins: up to 2 short lines about easy wins (replies waiting, hot leads ready to convert).
Return JSON only.`;

  try {
    const { text, model } = await generateContent({
      prompt,
      systemInstruction: SYSTEM_INSTRUCTION,
      responseSchema: SUMMARY_SCHEMA,
      temperature: 0.5,
      maxOutputTokens: 900,
      settings,
    });
    const parsed = extractJson(text);
    if (!parsed?.summary) throw new AiError('parse', 'Unreadable daily summary.');
    const data = {
      ...localResult,
      headline: parsed.headline || localResult.headline,
      summary: parsed.summary,
      priorities: Array.isArray(parsed.priorities) ? parsed.priorities.slice(0, 4) : [],
      risks: Array.isArray(parsed.risks) ? parsed.risks.slice(0, 2) : [],
      quickWins: Array.isArray(parsed.quickWins) ? parsed.quickWins.slice(0, 2) : [],
      generatedBy: 'gemini',
      model,
      at: new Date().toISOString(),
    };
    writeCache(key, data);
    return { ok: true, data, source: 'gemini', cached: false };
  } catch (error) {
    return { ok: true, data: localResult, source: 'local', cached: false, error: error instanceof AiError ? error : null };
  }
}

/* ------------------------------------------------ marketing insights -- */

const INSIGHTS_SCHEMA = {
  type: 'object',
  properties: {
    summary: { type: 'string' },
    insights: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          title: { type: 'string' },
          detail: { type: 'string' },
          severity: { type: 'string', enum: ['red', 'orange', 'flame', 'green', 'blue'] },
          suggestedAction: { type: 'string' },
          marketingIdea: { type: 'string' },
          course: { type: 'string' },
        },
        required: ['title', 'detail', 'suggestedAction'],
      },
    },
  },
  required: ['summary', 'insights'],
};

export async function marketingInsights(leads, { settings = {}, force = false, now = new Date() } = {}) {
  const snapshot = marketingSnapshot(leads, now);
  const localResult = local.localMarketingInsights(leads, now);
  const key = cacheKey(['insights', leads.length, hashLeads(leads)]);

  if (!isConfigured(settings) || isOffline()) {
    return { ok: true, data: localResult, source: 'local', cached: false };
  }
  const cached = readCache(key);
  if (cached && !force) return { ok: true, data: cached, source: 'cache', cached: true };

  const prompt = `Aggregate lead data for a health & safety training institute (no personal data, numbers only):
${compactSummaryText(snapshot)}

Task: act as a marketing analyst for this training business. Identify what is working, what is leaking, and what to do about it.
- summary: 2 sentences describing the overall picture.
- insights: 4-6 items. Each needs:
  - title: short and specific, mention the course or source where relevant (e.g. "IOSH leads are not converting")
  - detail: 1-2 sentences with the actual numbers from the data above
  - severity: red (urgent leak), orange (needs attention), flame (hot opportunity), green (positive), blue (informational)
  - suggestedAction: one concrete action for the sales team
  - marketingIdea: an optional ready-to-use short WhatsApp campaign line (only when a campaign makes sense)
  - course: the course this insight relates to, if any
Only use numbers that appear in the data. Return JSON only.`;

  try {
    const { text, model } = await generateContent({
      prompt,
      systemInstruction: SYSTEM_INSTRUCTION,
      responseSchema: INSIGHTS_SCHEMA,
      temperature: 0.55,
      maxOutputTokens: 1400,
      settings,
    });
    const parsed = extractJson(text);
    if (!parsed?.insights?.length) throw new AiError('parse', 'Unreadable insights.');
    const data = {
      summary: parsed.summary || localResult.summary,
      insights: parsed.insights.slice(0, 8).map((i) => ({
        title: i.title || 'Insight',
        detail: i.detail || '',
        severity: ['red', 'orange', 'flame', 'green', 'blue'].includes(i.severity) ? i.severity : 'blue',
        suggestedAction: i.suggestedAction || '',
        marketingIdea: i.marketingIdea || '',
        course: i.course || '',
      })),
      generatedBy: 'gemini',
      model,
      at: new Date().toISOString(),
      snapshot,
    };
    writeCache(key, data);
    return { ok: true, data, source: 'gemini', cached: false };
  } catch (error) {
    return { ok: true, data: { ...localResult, snapshot }, source: 'local', cached: false, error: error instanceof AiError ? error : null };
  }
}

/* ------------------------------------------------------- campaigns -- */

const CAMPAIGN_SCHEMA = {
  type: 'object',
  properties: {
    message: { type: 'string' },
    variants: { type: 'array', items: { type: 'string' } },
    notes: { type: 'string' },
  },
  required: ['message'],
};

export async function campaignMessage({
  course = '',
  audience = 'All leads',
  purpose = 'Reactivation',
  leads = [],
  settings = {},
  variant = 0,
  now = new Date(),
} = {}) {
  const fallback = local.localCampaignMessage({ course, audience, purpose, leads, settings, variant, now });
  if (!isConfigured(settings) || isOffline()) {
    return { ok: true, data: fallback, source: 'local', cached: false };
  }

  const sampleNotes = leads
    .filter((l) => l.notes)
    .slice(0, 3)
    .map((l) => `- ${l.status}, ${l.interest} interest${l.notes ? `: "${truncate(l.notes, 90)}"` : ''}`)
    .join('\n');

  const info = courseInfo(course);
  const prompt = `Campaign brief for a health & safety training institute.
Course: ${course || 'general HSE training'}
${info ? `Course summary: ${info.summary}${info.duration ? ` Duration: ${info.duration}.` : ''}${info.highlights?.length ? ` Selling points: ${info.highlights.join('; ')}.` : ''}` : ''}
Audience: ${audience} (${leads.length} leads)
Purpose: ${purpose}
Audience notes sample:
${sampleNotes || '- no notes available'}
${settings.senderName ? `Sender name: ${settings.senderName}` : ''}${settings.businessName ? `\nInstitute: ${settings.businessName}` : ''}

Task: write a short WhatsApp marketing message ready to broadcast.
- 40 to 80 words, plain text, no emojis, no markdown.
- Lead with the reason to act now, mention the course, and include one clear call to action.
- Also provide 2 shorter alternative variants.
- notes: one line on timing or targeting advice for the CRM record.
Return JSON: {"message": "...", "variants": ["...", "..."], "notes": "..."}`;

  try {
    const { text, model } = await generateContent({
      prompt,
      systemInstruction: SYSTEM_INSTRUCTION,
      responseSchema: CAMPAIGN_SCHEMA,
      temperature: 0.85,
      maxOutputTokens: 700,
      settings,
    });
    const parsed = extractJson(text);
    if (!parsed?.message) throw new AiError('parse', 'Unreadable campaign message.');
    const data = {
      message: String(parsed.message).trim(),
      variants: Array.isArray(parsed.variants) ? parsed.variants.slice(0, 3).map((v) => String(v).trim()).filter(Boolean) : [],
      notes: parsed.notes || `Purpose: ${purpose}`,
      audience: `${audience} (${leads.length} leads)`,
      generatedBy: 'gemini',
      model,
      at: new Date().toISOString(),
    };
    return { ok: true, data, source: 'gemini', cached: false };
  } catch (error) {
    return { ok: true, data: fallback, source: 'local', cached: false, error: error instanceof AiError ? error : null };
  }
}

/** Suggested campaign for a course (used by notification quick actions). */
export function defaultCampaignForCourse(course, leads = []) {
  const audience = course
    ? leads.filter((l) => l.course === course).length
    : leads.length;
  return {
    course,
    audience: course ? 'Old interested leads' : 'All leads',
    purpose: 'Reactivation',
    leadCount: audience,
  };
}

/* --------------------------------------------------------------- util -- */

function topLeadsForPrompt(leads, settings, limit, now) {
  return leads
    .filter((l) => !['Converted', 'Lost', 'Not Interested'].includes(l.status))
    .map((lead) => ({ lead, priority: computePriority(lead, now) }))
    .sort((a, b) => b.priority.score - a.priority.score)
    .slice(0, limit)
    .map(({ lead }) => minimalLeadPayload(lead, settings));
}

function hashLeads(leads) {
  // Cheap signature of the dataset: enough to invalidate the cache when data changes.
  return leads
    .map((l) => l.signature || l.id)
    .join('|')
    .split('')
    .reduce((acc, ch) => ((acc * 31 + ch.charCodeAt(0)) >>> 0), 7)
    .toString(36);
}

export { aiStatus, isConfigured, testConnection, isOffline, COURSE_INFO };
export { cacheGet };
