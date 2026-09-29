/**
 * AI Marketing Insights (section 18).
 * Aggregate analysis only — no individual lead data leaves the browser here.
 */

import { el, clear } from '../lib/dom.js';
import { notify, withBusy } from '../ui/kit.js';
import { icon, distributionBars, statTile, badge, aiSourceNote } from '../ui/components.js';
import {
  marketingSnapshot, compactSummaryText, coursePerformance, sourceBreakdown,
  cityBreakdown, interestBreakdown, statusBreakdown, followUpHealth, overviewStats,
} from '../domain/analytics.js';
import { formatDateTime } from '../lib/date.js';
import { marketingInsights, aiStatus } from '../services/ai.js';
import { currentLeads } from '../services/actions.js';
import { store, setAiMeta } from '../lib/store.js';
import { EVENTS, emit } from '../lib/bus.js';
import { navigate } from '../router.js';

let insightState = { data: null, loading: false, error: null, attempted: false };

export function renderInsights(root) {
  const leads = currentLeads();
  const now = new Date();
  const snapshot = marketingSnapshot(leads, now);
  const settings = store.get('settings');
  const status = aiStatus(settings);

  const wrap = el('div');

  wrap.appendChild(el('section', { class: 'section' }, [
    el('div', { class: 'row row--between' }, [
      el('div', {}, [
        el('h1', { text: 'AI Marketing Insights', style: { fontSize: '1.3rem' } }),
        el('p', { class: 'muted', text: 'What your lead data is telling you about courses, channels and follow-up speed.' }),
      ]),
      el('button', {
        class: 'btn btn--sm btn--primary',
        type: 'button',
        onclick: (event) => generate(event.currentTarget, true),
      }, [icon('i-sparkles'), el('span', { text: insightState.data ? 'Analyse again' : 'Analyse my leads' })]),
    ]),
    el('div', { class: 'grid grid--stats', style: { marginTop: '14px' } }, [
      statTile({ value: snapshot.totals.leads, label: 'Total leads' }),
      statTile({ value: snapshot.totals.active, label: 'Active leads', tone: 'green' }),
      statTile({ value: snapshot.totals.converted, label: 'Converted', tone: snapshot.totals.converted ? 'green' : '' }),
      statTile({ value: `${snapshot.totals.conversionRate}%`, label: 'Conversion rate' }),
      statTile({ value: snapshot.totals.hot, label: 'Hot leads', tone: snapshot.totals.hot ? 'flame' : '' }),
      statTile({ value: snapshot.totals.newThisWeek, label: 'New this week', tone: snapshot.totals.newThisWeek ? 'blue' : '' }),
    ]),
  ]));

  wrap.appendChild(insightPanel(status));
  wrap.appendChild(distributionPanel(snapshot, leads, now));
  wrap.appendChild(healthPanel(leads, now));
  wrap.appendChild(coursePanel(leads, now));

  clear(root);
  root.appendChild(wrap);
}

/* ------------------------------------------------------------- insights -- */

function insightPanel(status) {
  const panel = el('section', { class: 'panel section' });

  panel.appendChild(el('div', { class: 'panel__head' }, [
    el('h2', {}, [icon('i-sparkles'), el('span', { text: 'What to do about it' })]),
    el('span', { class: 'spacer' }),
    insightState.data ? el('span', { class: 'small muted', text: `Updated ${formatDateTime(insightState.data.at || new Date().toISOString())}` }) : null,
  ]));

  const body = el('div', { class: 'panel__body' });

  if (insightState.loading) {
    body.appendChild(el('p', { class: 'muted', text: 'Analysing your pipeline…' }));
  } else if (insightState.data?.insights?.length) {
    body.appendChild(el('p', { text: insightState.data.summary, style: { fontWeight: '600' } }));
    const list = el('div', { class: 'stack', style: { marginTop: '12px' } });
    for (const insight of insightState.data.insights) {
      list.appendChild(el('div', { class: `insight-card insight-card--${insight.severity || 'blue'}` }, [
        el('span', { class: 'insight__emoji', text: severityIcon(insight.severity) }),
        el('div', { class: 'grow' }, [
          el('h3', { text: insight.title }),
          el('p', { class: 'small', style: { margin: '6px 0 0', color: 'var(--ink-2)' }, text: insight.detail }),
          insight.suggestedAction ? el('p', { class: 'small', style: { margin: '8px 0 0' } }, [
            el('strong', { text: 'Suggestion: ' }), el('span', { text: insight.suggestedAction }),
          ]) : null,
          insight.marketingIdea ? el('div', { class: 'message-box', style: { marginTop: '10px' } }, [
            el('div', { text: insight.marketingIdea }),
          ]) : null,
          el('div', { class: 'btn-group', style: { marginTop: '10px' } }, [
            el('button', {
              class: 'btn btn--xs btn--primary',
              type: 'button',
              text: 'Generate Campaign Message',
              onclick: () => navigate('campaigns', { query: { course: insight.course || '' } }),
            }),
            insight.course ? el('button', {
              class: 'btn btn--xs btn--outline',
              type: 'button',
              text: `Show ${insight.course} leads`,
              onclick: () => { window.location.hash = `#/leads?course=${encodeURIComponent(insight.course)}`; },
            }) : null,
          ]),
        ]),
      ]));
    }
    body.appendChild(list);
    body.appendChild(el('div', { style: { marginTop: '12px' } }, [
      aiSourceNote({ source: insightState.data.generatedBy === 'gemini' ? 'gemini' : 'local', error: insightState.error }),
    ]));
  } else {
    body.appendChild(el('p', { class: 'muted', text: 'Analyse your leads to see conversion gaps, channel performance, reactivation opportunities and follow-up delays.' }));
    if (!status.ok) body.appendChild(el('p', { class: 'field__hint', text: `${status.label}. ${status.hint}` }));
    body.appendChild(el('p', { class: 'small muted', text: 'Only aggregate numbers (counts, rates, per-course totals) are sent to the AI — never your leads\' names or contact details.' }));
  }

  panel.appendChild(body);
  return panel;
}

async function generate(button, notifyUser) {
  if (insightState.loading) return;
  insightState.loading = true;
  insightState.attempted = true;
  emit(EVENTS.VIEW_REFRESH);
  try {
    const result = await marketingInsights(currentLeads(), { settings: store.get('settings'), force: true });
    insightState.data = result.data;
    insightState.error = result.error || null;
    setAiMeta({ insights: result.data, lastRunAt: new Date().toISOString() });
    if (notifyUser) {
      if (result.error) notify.warn(result.error.friendly, { title: 'Used the built-in analysis' });
      else notify.success('Insights updated.');
    }
  } catch (error) {
    insightState.error = { friendly: 'Could not generate insights.' };
    if (notifyUser) notify.error('Could not generate insights right now.');
  } finally {
    insightState.loading = false;
    emit(EVENTS.VIEW_REFRESH);
  }
}

function severityIcon(severity) {
  return { red: '🔴', orange: '🟠', flame: '🔥', green: '🟢', blue: '🔵' }[severity] || '🔵';
}

/* -------------------------------------------------------- distributions -- */

function distributionPanel(snapshot, leads, now) {
  const panel = el('section', { class: 'panel section' });
  panel.appendChild(el('div', { class: 'panel__head' }, [
    el('h2', {}, [icon('i-chart'), el('span', { text: 'Where your leads come from' })]),
  ]));

  const body = el('div', { class: 'panel__body' });
  body.appendChild(el('div', { class: 'grid grid--2' }, [
    el('div', {}, [
      el('div', { class: 'ai-block__label', text: 'Sources' }),
      distributionBars(sourceBreakdown(leads), { tone: 'orange' }),
    ]),
    el('div', {}, [
      el('div', { class: 'ai-block__label', text: 'Cities' }),
      distributionBars(cityBreakdown(leads)),
    ]),
    el('div', {}, [
      el('div', { class: 'ai-block__label', text: 'Interest level' }),
      distributionBars(interestBreakdown(leads), { tone: 'orange' }),
    ]),
    el('div', {}, [
      el('div', { class: 'ai-block__label', text: 'Status pipeline' }),
      distributionBars(statusBreakdown(leads)),
    ]),
  ]));
  panel.appendChild(body);
  return panel;
}

/* --------------------------------------------------------------- health -- */

function healthPanel(leads, now) {
  const health = followUpHealth(leads, now);
  const stats = overviewStats(leads, now);
  const panel = el('section', { class: 'panel section' });

  panel.appendChild(el('div', { class: 'panel__head' }, [
    el('h2', {}, [icon('i-clock'), el('span', { text: 'Follow-up health' })]),
  ]));

  const body = el('div', { class: 'panel__body' });
  body.appendChild(el('div', { class: 'grid grid--stats' }, [
    statTile({ value: `${health.avgOverdueDays}d`, label: 'Avg. overdue delay', tone: health.avgOverdueDays > 3 ? 'red' : 'green' }),
    statTile({ value: `${health.missingFollowUpRate}%`, label: 'Missing follow-up', tone: health.missingFollowUpRate > 25 ? 'orange' : 'green', hint: `${health.noFollowUp} leads` }),
    statTile({ value: health.silentOver7, label: 'Silent 7+ days', tone: health.silentOver7 ? 'orange' : 'green' }),
    statTile({ value: health.silentOver14, label: 'Silent 14+ days', tone: health.silentOver14 ? 'red' : 'green' }),
    statTile({ value: health.avgFollowUps, label: 'Follow-ups per lead' }),
    statTile({ value: `${health.weekendSilentRate}%`, label: 'Weekend leads unanswered', tone: health.weekendSilentRate > 60 ? 'orange' : '' }),
  ]));

  body.appendChild(el('p', { class: 'small muted', style: { marginTop: '14px' } }, [
    el('span', { text: `${stats.overdue} leads are overdue and ${stats.noFollowUp} active leads have no follow-up date at all. ` }),
    el('span', { text: `Positive replies waiting for action: ${health.positiveResponses}.` }),
  ]));

  panel.appendChild(body);
  return panel;
}

/* --------------------------------------------------------------- courses -- */

function coursePanel(leads, now) {
  const rows = coursePerformance(leads, now);
  const panel = el('section', { class: 'panel section' });

  panel.appendChild(el('div', { class: 'panel__head' }, [
    el('h2', {}, [icon('i-sheet'), el('span', { text: 'Course performance' })]),
    el('span', { class: 'spacer' }),
    badge('Not AI-generated', 'outline'),
  ]));

  if (!rows.length) {
    panel.appendChild(el('div', { class: 'empty' }, [
      el('p', { text: 'No course data yet — import your leads or add a few manually.' }),
    ]));
    return panel;
  }

  const table = el('table', { class: 'simple' }, [
    el('thead', {}, [
      el('tr', {}, [
        el('th', { text: 'Course' }),
        el('th', { text: 'Leads' }),
        el('th', { text: 'Converted' }),
        el('th', { text: 'Open' }),
        el('th', { text: 'Silent 7d+' }),
        el('th', { text: 'Overdue' }),
        el('th', { text: 'Conversion' }),
      ]),
    ]),
    el('tbody', {}, rows.map((row) => el('tr', {}, [
      el('td', { text: row.course }),
      el('td', { text: String(row.total) }),
      el('td', { text: String(row.converted) }),
      el('td', { text: String(row.open) }),
      el('td', { text: String(row.silent) }),
      el('td', { text: String(row.overdue) }),
      el('td', {}, [badge(`${row.conversionRate}%`, row.conversionRate > 0 ? 'green' : 'outline')]),
    ]))),
  ]);

  panel.appendChild(el('div', { class: 'panel__body' }, [el('div', { class: 'table-wrap' }, [table])]));
  return panel;
}

export { generate as generateInsights };
