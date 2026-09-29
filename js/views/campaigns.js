/**
 * Campaigns (section 19): pick a course, audience and purpose, then generate a
 * ready-to-send WhatsApp marketing message. Nothing is sent automatically —
 * the user copies the message or opens WhatsApp per lead.
 */

import { el, clear } from '../lib/dom.js';
import { notify, withBusy } from '../ui/kit.js';
import { icon, copyButton, statTile, badge, aiSourceNote } from '../ui/components.js';
import { CAMPAIGN_AUDIENCES, CAMPAIGN_PURPOSES, COURSES } from '../config.js';
import { campaignMessage, isConfigured } from '../services/ai.js';
import { currentLeads } from '../services/actions.js';
import { store } from '../lib/store.js';
import { EVENTS, emit } from '../lib/bus.js';
import { buildAudience, describeAudience } from '../domain/audience.js';
import { whatsappLink } from '../lib/utils.js';
import { openLeadProfile } from './lead-profile.js';

const state = {
  course: '',
  audience: 'All leads',
  purpose: 'Reactivation',
  city: '',
  status: '',
  message: '',
  variants: [],
  notes: '',
  source: null,
  loading: false,
  error: null,
  variant: 0,
};

export function renderCampaigns(root, { query = {} } = {}) {
  if (query.course !== undefined) state.course = query.course;
  if (query.audience) state.audience = query.audience;

  const leads = currentLeads();
  const audience = buildAudience(leads, { course: state.course, audience: state.audience, city: state.city, status: state.status });
  const cities = Array.from(new Set(leads.map((l) => l.city).filter(Boolean))).sort();

  const wrap = el('div');

  wrap.appendChild(el('section', { class: 'section' }, [
    el('div', { class: 'row row--between' }, [
      el('div', {}, [
        el('h1', { text: 'Campaigns', style: { fontSize: '1.3rem' } }),
        el('p', { class: 'muted', text: 'Generate a short WhatsApp campaign for a group of leads, then send it from your own WhatsApp.' }),
      ]),
      badge('Nothing is sent automatically', 'outline'),
    ]),
  ]));

  wrap.appendChild(builderPanel(leads, cities, audience));
  wrap.appendChild(resultPanel(audience));
  wrap.appendChild(audiencePanel(audience));

  clear(root);
  root.appendChild(wrap);
}

/* ------------------------------------------------------------- builder -- */

function builderPanel(leads, cities, audience) {
  const panel = el('section', { class: 'panel section' });
  panel.appendChild(el('div', { class: 'panel__head' }, [
    el('h2', {}, [icon('i-megaphone'), el('span', { text: 'Campaign brief' })]),
  ]));

  const select = (label, value, options, onChange) => {
    const node = el('select', { 'aria-label': label, onchange: (event) => { onChange(event.target.value); emit(EVENTS.VIEW_REFRESH); } });
    for (const [val, text] of options) {
      node.appendChild(el('option', { value: val, text, selected: String(value) === String(val) }));
    }
    return el('div', { class: 'field' }, [el('label', { text: label }), node]);
  };

  const body = el('div', { class: 'panel__body' }, [
    el('div', { class: 'filter-grid' }, [
      select('Course', state.course, [['', 'Any course']].concat(COURSES.map((c) => [c, c])), (v) => { state.course = v; state.message = ''; }),
      select('Audience', state.audience, CAMPAIGN_AUDIENCES.map((a) => [a, a]), (v) => { state.audience = v; state.message = ''; }),
      select('Message purpose', state.purpose, CAMPAIGN_PURPOSES.map((p) => [p, p]), (v) => { state.purpose = v; state.message = ''; }),
      select('City (optional)', state.city, [['', 'All cities']].concat(cities.map((c) => [c, c])), (v) => { state.city = v; }),
      select('Status (optional)', state.status, [['', 'Any status'], ['New', 'New'], ['Contacted', 'Contacted'], ['Interested', 'Interested'], ['Follow-up', 'Follow-up'], ['Hot', 'Hot'], ['Not Interested', 'Not Interested']], (v) => { state.status = v; }),
    ]),
    el('div', { class: 'row', style: { marginTop: '14px' } }, [
      statTile({ value: audience.length, label: 'Leads in this audience', hint: describeAudience(state), tone: audience.length ? 'green' : 'orange' }),
      el('div', { class: 'grow' }, [
        el('p', { class: 'small muted', text: 'The message is written for this audience using your course details and the median situation of the group. You can edit it before sending.' }),
      ]),
    ]),
    el('div', { class: 'btn-group', style: { marginTop: '14px' } }, [
      el('button', {
        class: 'btn btn--primary',
        type: 'button',
        disabled: !audience.length,
        onclick: (event) => generateMessage(event.currentTarget, audience),
      }, [icon('i-wand'), el('span', { text: state.message ? 'Regenerate message' : 'Generate Campaign Message' })]),
      el('a', { class: 'btn btn--outline', href: '#/insights', text: 'See AI marketing insights' }),
    ]),
  ]);

  panel.appendChild(body);
  return panel;
}

async function generateMessage(button, audience) {
  state.loading = true;
  state.variant += 1;
  emit(EVENTS.VIEW_REFRESH);
  try {
    const result = await campaignMessage({
      course: state.course,
      audience: state.audience,
      purpose: state.purpose,
      leads: audience,
      settings: store.get('settings'),
      variant: state.variant,
    });
    state.message = result.data.message;
    state.variants = result.data.variants || [];
    state.notes = result.data.notes || '';
    state.source = { source: result.source, error: result.error };
    state.error = result.error || null;
    if (result.error) notify.warn(result.error.friendly, { title: 'Used the built-in campaign writer' });
    else notify.success('Campaign message ready.');
  } catch (error) {
    state.error = { friendly: 'Could not generate a campaign message.' };
    notify.error('Could not generate a campaign message right now.');
  } finally {
    state.loading = false;
    emit(EVENTS.VIEW_REFRESH);
  }
}

/* -------------------------------------------------------------- result -- */

function resultPanel(audience) {
  const panel = el('section', { class: 'panel section' });
  panel.appendChild(el('div', { class: 'panel__head' }, [
    el('h2', {}, [icon('i-chat'), el('span', { text: 'Campaign message' })]),
  ]));

  const body = el('div', { class: 'panel__body' });

  if (state.loading) {
    body.appendChild(el('p', { class: 'muted', text: 'Writing your campaign message…' }));
  } else if (state.message) {
    body.appendChild(el('div', { class: 'message-box' }, [el('div', { text: state.message })]));
    body.appendChild(el('div', { class: 'btn-group', style: { marginTop: '12px' } }, [
      copyButton(() => state.message, { label: 'Copy Message', class: 'btn btn--primary btn--sm' }),
      el('button', {
        class: 'btn btn--sm btn--outline',
        type: 'button',
        onclick: (event) => generateMessage(event.currentTarget, audience),
      }, [icon('i-refresh'), el('span', { text: 'Regenerate' })]),
      copyButton(() => `${state.message}\n\n${describeAudience(state)}`, { label: 'Copy with audience note' }),
    ]));

    if (state.variants.length) {
      body.appendChild(el('div', { style: { marginTop: '16px' } }, [
        el('div', { class: 'ai-block__label', text: 'Shorter alternatives' }),
        el('div', { class: 'stack' }, state.variants.map((variant) => el('div', { class: 'message-box message-box--plain' }, [
          el('div', { text: variant }),
          el('div', { class: 'message-box__meta' }, [copyButton(() => variant, { label: 'Copy', class: 'btn btn--xs btn--outline' })]),
        ]))),
      ]));
    }

    if (state.notes) body.appendChild(el('p', { class: 'small muted', style: { marginTop: '10px' }, text: state.notes }));
    if (state.source) body.appendChild(el('div', { style: { marginTop: '8px' } }, [aiSourceNote(state.source)]));
  } else {
    body.appendChild(el('p', { class: 'muted', text: 'Choose a course, audience and purpose above, then generate a message. It will be 40–80 words, ready for WhatsApp.' }));
    if (!isConfigured(store.get('settings'))) {
      body.appendChild(el('p', { class: 'field__hint', text: 'No Gemini key configured — the built-in writer creates the message locally. Add a key in Settings → AI for live AI copywriting.' }));
    }
  }

  panel.appendChild(body);
  return panel;
}

/* ------------------------------------------------------------ audience -- */

function audiencePanel(audience) {
  const panel = el('section', { class: 'panel section' });
  panel.appendChild(el('div', { class: 'panel__head' }, [
    el('h2', {}, [icon('i-leads'), el('span', { text: 'Who will receive this' })]),
    el('span', { class: 'badge badge--outline', text: String(audience.length) }),
    el('span', { class: 'spacer' }),
    el('a', { class: 'small', href: '#/leads', text: 'Open in Leads' }),
  ]));

  if (!audience.length) {
    panel.appendChild(el('div', { class: 'empty' }, [
      el('p', { text: 'No leads match this audience. Try a different course, status or city.' }),
    ]));
    return panel;
  }

  const list = el('div');
  for (const lead of audience.slice(0, 12)) {
    list.appendChild(el('div', { class: 'fu-item' }, [
      el('span', { class: 'fu-item__main' }, [
        el('button', { class: 'name-link', type: 'button', text: lead.name, onclick: () => openLeadProfile(lead.id) }),
        el('span', { class: 'cell__sub', text: [lead.course, lead.status, lead.city].filter(Boolean).join(' · ') }),
      ]),
      (lead.whatsapp || lead.phone) ? el('a', {
        class: 'btn btn--xs btn--primary',
        href: whatsappLink(lead.whatsapp || lead.phone, state.message || ''),
        target: '_blank',
        rel: 'noopener',
        text: state.message ? 'Send' : 'Open chat',
      }) : badge('No number', 'outline'),
    ]));
  }
  panel.appendChild(list);

  if (audience.length > 12) {
    panel.appendChild(el('div', { class: 'panel__foot small muted' }, [
      el('span', { text: `${audience.length - 12} more leads in this audience — open the Leads page to see them all.` }),
    ]));
  }
  return panel;
}

export { state as campaignState };
