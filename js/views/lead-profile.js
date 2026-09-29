/**
 * Lead Profile (sections 6-9).
 *
 * Everything about one lead: details, follow-up information, AI analysis,
 * AI message generator with refinement, "what should I do next?" actions,
 * notes and the activity timeline. Rendered inside the shared drawer.
 */

import { el } from '../lib/dom.js';
import { openDrawer, updateDrawer, closeDrawer, drawerIsOpen, notify, confirmDialog, promptDialog, withBusy } from '../ui/kit.js';
import {
  statusBadge, interestBadge, priorityBadge, followUpBadge, timelineList,
  copyButton, aiSourceNote, icon,
} from '../ui/components.js';
import { formatDate, relativeDayLabel, todayISO, addDaysISO } from '../lib/date.js';
import { MESSAGE_STYLES, NEXT_ACTIONS, courseInfo } from '../config.js';
import { whatsappLink, telLink, mailtoLink } from '../lib/utils.js';
import { computePriority } from '../domain/priority.js';
import { followUpState, daysSinceContact } from '../domain/followup.js';
import { localNextAction, suggestFollowUpDate } from '../domain/notifications.js';
import { analyzeLead, generateMessage, refineMessage, aiStatus } from '../services/ai.js';
import {
  addNote, applySuggestion, logContact, scheduleFollowUp,
  setStatus, storeAiSuggestion, leadById,
} from '../services/actions.js';
import { store, patchLead } from '../lib/store.js';
import { EVENTS, on } from '../lib/bus.js';
import { openLeadForm } from './lead-form.js';

const state = {
  leadId: null,
  style: 'friendly',
  message: '',
  messageMeta: '',
  variant: 0,
  analysis: null,
  analysisSource: null,
  busy: { analysis: false, message: false },
};

/** Open the profile drawer for a lead. */
export function openLeadProfile(leadId) {
  const lead = leadById(leadId);
  if (!lead) {
    notify.warn('That lead could not be found. It may have been deleted.');
    return;
  }
  state.leadId = leadId;
  state.analysis = lead.aiSuggest || null;
  state.analysisSource = lead.aiSuggest ? { source: lead.aiSuggest.generatedBy === 'gemini' ? 'gemini' : 'local' } : null;
  state.message = '';
  state.messageMeta = '';
  state.style = 'friendly';
  state.variant = 0;

  // Note: no onClose handler here — swapping the drawer triggers the previous
  // drawer's close, which would otherwise wipe the id of the lead we just opened.
  openDrawer({
    title: lead.name,
    subtitle: buildSubtitle(lead),
    content: buildContent(lead),
  });
}

/** Re-render the drawer for the current lead (after any data change). */
function rerender() {
  if (!state.leadId || !drawerIsOpen()) return;
  const lead = leadById(state.leadId);
  if (!lead) {
    closeDrawer();
    return;
  }
  updateDrawer({
    title: lead.name,
    subtitle: buildSubtitle(lead),
    content: buildContent(lead),
  });
}

function buildSubtitle(lead) {
  const bits = [lead.course || 'Course not specified'];
  if (lead.city) bits.push(lead.city);
  if (lead.assignedTo) bits.push(`Assigned to ${lead.assignedTo}`);
  return bits.join(' · ');
}

function buildContent(lead) {
  const now = new Date();
  const priority = computePriority(lead, now);
  const container = el('div');

  container.appendChild(headerActions(lead, priority));
  container.appendChild(leadInfoSection(lead));
  container.appendChild(followUpSection(lead, now));
  container.appendChild(aiRecommendationSection(lead, priority));
  container.appendChild(messageGeneratorSection(lead));
  container.appendChild(nextActionSection(lead));
  container.appendChild(notesSection(lead));
  container.appendChild(timelineSection(lead));

  return container;
}

/* ------------------------------------------------------------- header -- */

function headerActions(lead, priority) {
  const wrap = el('div', { class: 'drawer__section' });

  wrap.appendChild(el('div', { class: 'row', style: { marginBottom: '10px' } }, [
    statusBadge(lead.status),
    interestBadge(lead.interest),
    priorityBadge(priority, { showReason: true }),
    followUpBadge(lead),
  ]));

  const actions = el('div', { class: 'btn-group' });
  if (lead.phone || lead.whatsapp) {
    actions.appendChild(el('a', {
      class: 'btn btn--primary btn--sm',
      href: telLink(lead.phone || lead.whatsapp),
      onclick: () => { logContact(lead.id, { type: 'call_made' }); notify.info(`Call logged for ${lead.name}.`); },
    }, [icon('i-phone'), el('span', { text: 'Call' })]));
  }
  if (lead.whatsapp || lead.phone) {
    actions.appendChild(el('a', {
      class: 'btn btn--outline btn--sm',
      href: whatsappLink(lead.whatsapp || lead.phone),
      target: '_blank',
      rel: 'noopener',
      onclick: () => { logContact(lead.id, { type: 'message_sent' }); },
    }, [icon('i-chat'), el('span', { text: 'WhatsApp' })]));
  }
  if (lead.email) {
    actions.appendChild(el('a', {
      class: 'btn btn--outline btn--sm',
      href: mailtoLink(lead.email, `${lead.course || 'Your enquiry'} — My CRM`),
    }, [icon('i-mail'), el('span', { text: 'Email' })]));
  }
  actions.appendChild(el('button', {
    class: 'btn btn--outline btn--sm',
    type: 'button',
    onclick: () => openLeadForm({ lead, onSaved: () => rerender() }),
  }, [icon('i-edit'), el('span', { text: 'Edit' })]));
  wrap.appendChild(actions);

  if (priority.reasons.length) {
    wrap.appendChild(el('p', { class: 'small muted', style: { marginTop: '10px' } }, [
      el('strong', { text: 'Why this priority: ' }),
      el('span', { text: priority.reasons.join(' · ') }),
    ]));
  }
  return wrap;
}

/* --------------------------------------------------------------- info -- */

function leadInfoSection(lead) {
  const info = courseInfo(lead.course);
  const dl = el('dl', { class: 'def-list' }, [
    dt('Phone'), dd(lead.phone || '—'),
    dt('WhatsApp'), dd(lead.whatsapp || '—'),
    dt('Email'), dd(lead.email || '—'),
    dt('City'), dd(lead.city || '—'),
    dt('Course'), dd(lead.course || '—'),
    dt('Source'), dd(lead.source || '—'),
    dt('Status'), dd(statusBadge(lead.status)),
    dt('Interest level'), dd(interestBadge(lead.interest)),
    dt('Assigned to'), dd(lead.assignedTo || 'Unassigned'),
    dt('Added'), dd(lead.createdAt ? formatDate(lead.createdAt) : '—'),
  ]);

  return el('section', { class: 'drawer__section' }, [
    el('h3', {}, [icon('i-user'), el('span', { text: 'Lead information' })]),
    dl,
    info?.summary ? el('p', { class: 'small muted', style: { marginTop: '10px' } }, [
      el('strong', { text: 'About the course: ' }), el('span', { text: info.summary }),
    ]) : null,
  ]);
}

function dt(text) { return el('dt', { text }); }
function dd(content) {
  return el('dd', {}, [typeof content === 'string' ? document.createTextNode(content) : content]);
}

/* ----------------------------------------------------------- follow-up -- */

function followUpSection(lead, now) {
  const state0 = followUpState(lead, now);
  const since = daysSinceContact(lead, now);
  const nextInput = el('input', {
    type: 'date',
    value: lead.nextFollowUp || '',
    'aria-label': 'Next follow-up date',
  });

  const quick = el('div', { class: 'btn-group', style: { marginTop: '8px' } }, [
    quickDate('Today', todayISO(), lead, nextInput),
    quickDate('Tomorrow', addDaysISO(todayISO(), 1), lead, nextInput),
    quickDate('+3 days', addDaysISO(todayISO(), 3), lead, nextInput),
    quickDate('+1 week', addDaysISO(todayISO(), 7), lead, nextInput),
  ]);

  const saveButton = el('button', {
    class: 'btn btn--sm btn--primary',
    type: 'button',
    text: 'Save date',
    onclick: async (event) => {
      if (!nextInput.value) { notify.warn('Pick a date first.'); return; }
      await withBusy(event.currentTarget, 'Saving…', async () => {
        scheduleFollowUp(lead.id, nextInput.value);
        notify.success(`Follow-up set for ${formatDate(nextInput.value)}.`);
        rerender();
      });
    },
  });

  const logRow = el('div', { class: 'btn-group', style: { marginTop: '10px' } }, [
    el('button', { class: 'btn btn--sm btn--outline', type: 'button', text: 'Log a call', onclick: () => logContact(lead.id, { type: 'call_made' }) && notify.success('Call logged.') }),
    el('button', { class: 'btn btn--sm btn--outline', type: 'button', text: 'Log a message', onclick: () => logContact(lead.id, { type: 'message_sent' }) && notify.success('Message logged.') }),
    el('button', {
      class: 'btn btn--sm btn--outline',
      type: 'button',
      text: 'Lead replied',
      onclick: async () => {
        const reply = await promptDialog({
          title: `${lead.name} replied`,
          label: 'What did they say?',
          placeholder: 'e.g. "Please send the fee details"',
          multiline: true,
          confirmLabel: 'Save reply',
        });
        if (reply === null) return;
        const shouldPromote = ['New', 'Contacted'].includes(lead.status);
        logContact(lead.id, {
          type: 'replied',
          status: shouldPromote ? 'Interested' : '',
          nextFollowUp: lead.nextFollowUp || suggestFollowUpDate(lead),
        });
        patchLead(lead.id, { lastResponse: reply || 'Replied' });
        logContactNote(lead.id, reply);
        notify.success('Reply recorded — a follow-up date was suggested.');
        rerender();
      },
    }),
  ]);

  return el('section', { class: 'drawer__section' }, [
    el('h3', {}, [icon('i-calendar'), el('span', { text: 'Follow-up information' })]),
    el('dl', { class: 'def-list' }, [
      dt('Last contact'), dd(lead.lastContact
        ? `${formatDate(lead.lastContact)} (${relativeDayLabel(lead.lastContact, now).toLowerCase()})`
        : el('span', { class: 'muted', text: 'Never contacted' })),
      dt('Next follow-up'), dd(lead.nextFollowUp
        ? `${formatDate(lead.nextFollowUp)} (${relativeDayLabel(lead.nextFollowUp, now).toLowerCase()})`
        : el('span', { class: 'muted', text: 'Not scheduled' })),
      dt('Follow-up status'), dd(followUpBadge(lead, now)),
      dt('Follow-ups made'), dd(String(lead.followUpCount || 0)),
      dt('Last response'), dd(lead.lastResponse || el('span', { class: 'muted', text: 'No reply recorded' })),
      dt('Days since contact'), dd(since === null ? '—' : `${since} days`),
    ]),
    el('p', { class: 'small muted', style: { marginTop: '10px' }, text: state0.bucket === 'none'
      ? 'No follow-up is scheduled for this lead. Set a date so it never gets forgotten.'
      : state0.label }),
    el('div', { class: 'field', style: { marginTop: '10px', maxWidth: '260px' } }, [
      el('label', { text: 'Set or change the next follow-up' }),
      nextInput,
    ]),
    quick,
    logRow,
    el('div', { style: { marginTop: '8px' } }, [saveButton]),
  ]);
}

function quickDate(label, iso, lead, input) {
  return el('button', {
    class: 'btn btn--xs btn--outline',
    type: 'button',
    text: label,
    onclick: () => {
      input.value = iso;
      scheduleFollowUp(lead.id, iso);
      notify.success(`Follow-up set for ${formatDate(iso)}.`);
      rerender();
    },
  });
}

/* ---------------------------------------------------- AI recommendation -- */

function aiRecommendationSection(lead, priority) {
  const status = aiStatus(currentSettings());
  const wrap = el('section', { class: 'drawer__section' });

  wrap.appendChild(el('h3', {}, [icon('i-sparkles'), el('span', { text: 'AI recommendation' })]));

  if (state.busy.analysis) {
    wrap.appendChild(el('p', { class: 'muted small', text: 'Analysing this lead…' }));
  }

  const analysis = state.analysis;
  if (analysis) {
    wrap.appendChild(el('div', { class: 'ai-block ai-block--accent' }, [
      el('div', { class: 'ai-block__label', text: 'Recommended action' }),
      el('p', { class: 'ai-reco', text: analysis.recommendedAction || 'No recommendation available.' }),
      el('div', { class: 'kv-inline', style: { marginTop: '10px' } }, [
        el('span', {}, [el('strong', { text: 'Priority: ' }), el('span', { text: `${analysis.priority}${analysis.priorityScore ? ` (${analysis.priorityScore}/100)` : ''}` })]),
        analysis.suggestedFollowUpDate ? el('span', {}, [el('strong', { text: 'Suggested follow-up: ' }), el('span', { text: formatDate(analysis.suggestedFollowUpDate) })]) : null,
        analysis.status ? el('span', {}, [el('strong', { text: 'Suggested status: ' }), el('span', { text: analysis.status })]) : null,
        analysis.interest ? el('span', {}, [el('strong', { text: 'Suggested interest: ' }), el('span', { text: analysis.interest })]) : null,
      ]),
      analysis.reason ? el('p', { class: 'small', style: { marginTop: '10px' } }, [
        el('strong', { text: 'Why: ' }), el('span', { text: analysis.reason }),
      ]) : null,
      analysis.communicationApproach ? el('p', { class: 'small', style: { marginTop: '6px' } }, [
        el('strong', { text: 'How to approach: ' }), el('span', { text: analysis.communicationApproach }),
      ]) : null,
      el('div', { class: 'btn-group', style: { marginTop: '12px' } }, [
        analysis.suggestedFollowUpDate || analysis.status ? el('button', {
          class: 'btn btn--sm btn--primary',
          type: 'button',
          text: 'Apply suggestion',
          onclick: () => {
            applySuggestion(lead.id, analysis);
            notify.success('Suggestion applied to this lead.');
            rerender();
          },
        }) : null,
        el('button', {
          class: 'btn btn--sm btn--outline',
          type: 'button',
          onclick: (event) => runAnalysis(event.currentTarget),
        }, [icon('i-refresh'), el('span', { text: 'Re-analyse' })]),
      ]),
    ]));
    if (state.analysisSource) wrap.appendChild(el('div', { style: { marginTop: '8px' } }, [aiSourceNote(state.analysisSource)]));
  } else {
    wrap.appendChild(el('p', { class: 'small muted', text: 'Let My CRM weigh the dates, replies and course interest and tell you what to do next.' }));
  }

  if (!analysis || !state.busy.analysis) {
    wrap.appendChild(el('div', { class: 'btn-group', style: { marginTop: '10px' } }, [
      el('button', {
        class: 'btn btn--sm btn--primary',
        type: 'button',
        onclick: (event) => runAnalysis(event.currentTarget),
      }, [icon('i-wand'), el('span', { text: analysis ? 'Analyse again' : 'Analyse with AI' })]),
    ]));
  }

  if (!status.ok) {
    wrap.appendChild(el('p', { class: 'field__hint', style: { marginTop: '8px' }, text: `${status.label}. ${status.hint}` }));
  }

  return wrap;
}

async function runAnalysis(button) {
  const lead = leadById(state.leadId);
  if (!lead) return;
  state.busy.analysis = true;
  rerender();
  try {
    const settings = currentSettings();
    const result = await analyzeLead(lead, { settings, force: true });
    state.analysis = result.data;
    state.analysisSource = { source: result.source, error: result.error };
    storeAiSuggestion(lead.id, result.data);
    if (result.error) notify.warn(result.error.friendly, { title: 'AI unavailable — used built-in analysis' });
  } catch (error) {
    notify.error('AI analysis failed. The built-in rules are still available.');
    state.analysis = null;
  } finally {
    state.busy.analysis = false;
    rerender();
  }
}

/* ---------------------------------------------------- message generator -- */

function messageGeneratorSection(lead) {
  const wrap = el('section', { class: 'drawer__section' });
  wrap.appendChild(el('h3', {}, [icon('i-chat'), el('span', { text: 'Generate AI message' })]));

  const styleRow = el('div', { class: 'chips', style: { marginBottom: '12px' } });
  for (const style of MESSAGE_STYLES) {
    styleRow.appendChild(el('button', {
      class: `chip ${state.style === style.id ? 'is-active' : ''}`.trim(),
      type: 'button',
      title: style.hint,
      text: style.label,
      onclick: () => {
        state.style = style.id;
        state.message = '';
        rerender();
      },
    }));
  }
  wrap.appendChild(styleRow);

  const output = el('div');
  if (state.busy.message) {
    output.appendChild(el('div', { class: 'message-box message-box--plain' }, [el('span', { class: 'muted', text: 'Writing a message in your selected style…' })]));
  } else if (state.message) {
    output.appendChild(el('div', { class: 'message-box' }, [
      el('div', { text: state.message }),
      el('div', { class: 'message-box__meta' }, [
        el('span', { text: state.messageMeta || 'Generated message' }),
      ]),
    ]));

    output.appendChild(el('div', { class: 'btn-group', style: { marginTop: '10px' } }, [
      copyButton(() => state.message, { label: 'Copy Message' }),
      el('button', {
        class: 'btn btn--sm btn--outline',
        type: 'button',
        text: 'Regenerate',
        onclick: (event) => runGenerate(event.currentTarget, { regen: true }),
      }, [icon('i-refresh'), el('span', { text: 'Regenerate' })]),
      el('button', {
        class: 'btn btn--sm btn--outline',
        type: 'button',
        text: 'Make Shorter',
        onclick: (event) => runRefine(event.currentTarget, 'shorter'),
      }),
      el('button', {
        class: 'btn btn--sm btn--outline',
        type: 'button',
        text: 'Make More Professional',
        onclick: (event) => runRefine(event.currentTarget, 'professional'),
      }),
      (lead.whatsapp || lead.phone) ? el('a', {
        class: 'btn btn--sm btn--primary',
        href: whatsappLink(lead.whatsapp || lead.phone, state.message, ''),
        target: '_blank',
        rel: 'noopener',
        text: 'Send on WhatsApp',
        onclick: () => {
          logContact(lead.id, { type: 'message_sent' });
          notify.success('Marked as sent in the timeline.');
        },
      }) : null,
      el('button', {
        class: 'btn btn--sm btn--outline',
        type: 'button',
        text: 'Copy & log as sent',
        onclick: () => {
          logContact(lead.id, { type: 'message_sent', note: '' });
          notify.success('Message logged against this lead.');
          rerender();
        },
      }),
    ]));
  } else {
    output.appendChild(el('p', { class: 'small muted', text: 'Pick a style, then generate a message using this lead\'s name, course, last contact, status and notes.' }));
  }
  wrap.appendChild(output);

  if (!state.message && !state.busy.message) {
    wrap.appendChild(el('div', { class: 'btn-group', style: { marginTop: '10px' } }, [
      el('button', {
        class: 'btn btn--sm btn--primary',
        type: 'button',
        onclick: (event) => runGenerate(event.currentTarget),
      }, [icon('i-wand'), el('span', { text: 'Generate AI Message' })]),
    ]));
  }

  return wrap;
}

async function runGenerate(button, { regen = false } = {}) {
  const lead = leadById(state.leadId);
  if (!lead) return;
  state.busy.message = true;
  if (regen) state.variant += 1;
  rerender();
  try {
    const result = await generateMessage(lead, {
      style: state.style,
      settings: currentSettings(),
      variant: state.variant,
      force: regen,
    });
    state.message = result.data.message;
    state.messageMeta = result.source === 'gemini'
      ? `Generated by Gemini · ${styleLabel(state.style)}`
      : `Built-in message · ${styleLabel(state.style)}${result.error ? ' (AI unavailable)' : ''}`;
    if (result.error) notify.warn(result.error.friendly, { title: 'Used the built-in message writer' });
  } catch (error) {
    notify.error('Could not generate a message right now.');
  } finally {
    state.busy.message = false;
    rerender();
  }
}

async function runRefine(button, mode) {
  const lead = leadById(state.leadId);
  if (!lead || !state.message) return;
  await withBusy(button, 'Adjusting…', async () => {
    try {
      const result = await refineMessage(state.message, mode, lead, { settings: currentSettings() });
      state.message = result.data.message;
      state.messageMeta = `${result.data.notes || 'Adjusted'}${result.source === 'gemini' ? ' · Gemini' : ''}`;
      notify.success(mode === 'shorter' ? 'Message shortened.' : 'Message made more professional.');
    } catch {
      notify.error('Could not adjust the message.');
    }
    rerender();
  });
}

function styleLabel(id) {
  return (MESSAGE_STYLES.find((s) => s.id === id) || { label: id }).label;
}

/* ------------------------------------------------------- next actions -- */

function nextActionSection(lead) {
  const suggestion = localNextAction(lead);
  const wrap = el('section', { class: 'drawer__section' });

  wrap.appendChild(el('h3', {}, [icon('i-check'), el('span', { text: 'What should I do next?' })]));
  wrap.appendChild(el('div', { class: 'ai-block' }, [
    el('p', { text: suggestion.reason }),
    el('div', { class: 'kv-inline', style: { marginTop: '8px' } }, [
      el('span', {}, [el('strong', { text: 'Suggested action: ' }), el('span', { text: suggestion.label })]),
      el('span', {}, [el('strong', { text: 'Priority: ' }), el('span', { text: suggestion.priority.label })]),
      suggestion.suggestedDate ? el('span', {}, [el('strong', { text: 'Suggested date: ' }), el('span', { text: formatDate(suggestion.suggestedDate) })]) : null,
    ]),
  ]));

  const actionRow = el('div', { class: 'btn-group', style: { marginTop: '12px' } });
  for (const action of NEXT_ACTIONS) {
    actionRow.appendChild(actionButton(lead, action, suggestion));
  }
  wrap.appendChild(actionRow);
  return wrap;
}

function actionButton(lead, action, suggestion) {
  const isSuggested = suggestion.actionType === action.id;
  return el('button', {
    class: `btn btn--sm ${isSuggested ? 'btn--primary' : 'btn--outline'}`,
    type: 'button',
    title: isSuggested ? 'Recommended next step' : action.label,
    onclick: () => runAction(lead, action),
  }, [icon(action.icon), el('span', { text: action.label })]);
}

function runAction(lead, action) {
  switch (action.id) {
    case 'call':
      logContact(lead.id, { type: 'call_made' });
      if (lead.phone || lead.whatsapp) window.location.href = telLink(lead.phone || lead.whatsapp);
      notify.success('Call logged. A next follow-up date was suggested if none existed.');
      rerender();
      return;
    case 'whatsapp':
      logContact(lead.id, { type: 'message_sent' });
      if (lead.whatsapp || lead.phone) {
        const text = state.message || `Hello ${String(lead.name).split(' ')[0]}, following up about the ${lead.course || 'course'}. Would you like the details?`;
        window.open(whatsappLink(lead.whatsapp || lead.phone, text), '_blank', 'noopener');
      }
      notify.success('WhatsApp opened and the message logged.');
      rerender();
      return;
    case 'course_details':
    case 'fee_details':
      logContact(lead.id, { type: 'message_sent', status: 'Interested', note: action.label });
      notify.success(`${action.label} logged — status set to Interested.`);
      rerender();
      return;
    case 'reminder':
      logContact(lead.id, { type: 'message_sent', status: 'Follow-up' });
      notify.success('Reminder logged.');
      rerender();
      return;
    case 'follow_later': {
      const iso = suggestion.suggestedDate || addDaysISO(todayISO(), 3);
      scheduleFollowUp(lead.id, iso);
      setStatus(lead.id, 'Follow-up');
      notify.success(`Follow-up scheduled for ${formatDate(iso)}.`);
      rerender();
      return;
    }
    case 'converted':
      setStatus(lead.id, 'Converted', { interest: 'Hot' });
      notify.success(`${lead.name} marked as converted. 🎉`);
      rerender();
      return;
    case 'lost':
      setStatus(lead.id, 'Lost');
      notify.success(`${lead.name} marked as lost.`);
      rerender();
      return;
    default:
      notify.info('No action taken.');
  }
}

/* ---------------------------------------------------------------- notes -- */

function notesSection(lead) {
  const wrap = el('section', { class: 'drawer__section' });
  wrap.appendChild(el('h3', {}, [icon('i-edit'), el('span', { text: 'Notes' })]));

  const notes = String(lead.notes || '').split('\n').map((line) => line.trim()).filter(Boolean);
  if (!notes.length) {
    wrap.appendChild(el('p', { class: 'small muted', text: 'No notes yet. Add context that will help the next conversation.' }));
  } else {
    const list = el('div', { class: 'stack' });
    for (const note of notes.slice(-6)) {
      list.appendChild(el('div', { class: 'note' }, [el('div', { class: 'note__body', text: note })]));
    }
    wrap.appendChild(list);
  }

  const input = el('textarea', {
    placeholder: 'Add a note, e.g. "Prefers a weekend batch, asked about instalments"',
    'aria-label': 'New note',
    style: { minHeight: '70px', marginTop: '10px' },
  });
  const save = el('button', {
    class: 'btn btn--sm btn--primary',
    type: 'button',
    text: 'Add note',
    onclick: () => {
      if (!input.value.trim()) { notify.warn('Write something first.'); return; }
      addNote(lead.id, input.value.trim());
      notify.success('Note added.');
      rerender();
    },
  });
  wrap.appendChild(el('div', { style: { marginTop: '10px' } }, [input, el('div', { style: { marginTop: '8px' } }, [save])]));
  return wrap;
}

/* ------------------------------------------------------------- timeline -- */

function timelineSection(lead) {
  const wrap = el('section', { class: 'drawer__section' });
  wrap.appendChild(el('h3', {}, [icon('i-clock'), el('span', { text: 'Activity timeline' })]));
  if (!lead.timeline?.length) {
    wrap.appendChild(el('p', { class: 'small muted', text: 'No activity recorded yet.' }));
  } else {
    wrap.appendChild(timelineList(lead.timeline));
  }
  return wrap;
}

/* ---------------------------------------------------------------- misc -- */

function currentSettings() {
  return store.get('settings') || {};
}

/** Add the reply text to the notes so it is visible in the profile. */
function logContactNote(leadId, reply) {
  if (!reply) return;
  const lead = leadById(leadId);
  if (!lead) return;
  const line = `${new Date().toLocaleDateString()} — Lead replied: ${reply}`;
  patchLead(leadId, { notes: lead.notes ? `${lead.notes}\n${line}` : line });
}

/** Subscribe to lead updates so the profile stays fresh. */
export function initLeadProfile() {
  on(EVENTS.LEAD_UPDATED, ({ leadId }) => {
    if (state.leadId && leadId === state.leadId) rerender();
  });
}
