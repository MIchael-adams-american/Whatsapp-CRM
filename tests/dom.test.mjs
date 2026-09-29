/**
 * My CRM — browser workflow test (jsdom).
 * Run with:  node tests/dom.test.mjs
 *
 * Boots the real index.html + application modules in a simulated browser and
 * exercises the main user journeys: dashboard, demo data, search, filters,
 * follow-ups, lead profile, AI message generation, copy, sheet import,
 * notification drill-down and error handling.
 */

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import process from 'node:process';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');

let JSDOM;
try {
  ({ JSDOM } = await import('jsdom'));
} catch {
  try {
    ({ JSDOM } = await import('/tmp/toolcheck/node_modules/jsdom/lib/api.js'));
  } catch (error) {
    console.error('jsdom is not installed. Run: npm install --no-save jsdom');
    process.exit(1);
  }
}

/* ---------------------------------------------------------- environment -- */

const html = await readFile(path.join(root, 'index.html'), 'utf8');
const dom = new JSDOM(html, {
  url: 'https://my-crm.test/',
  pretendToBeVisual: true,
  runScripts: 'outside-only',
});

const { window } = dom;

// Globals the app expects (the browser provides them for real).
function setGlobal(name, value) {
  try {
    global[name] = value;
    if (global[name] !== value) throw new Error('read-only');
  } catch {
    Object.defineProperty(global, name, { value, configurable: true, writable: true });
  }
}

setGlobal('window', window);
setGlobal('document', window.document);
setGlobal('navigator', window.navigator);
setGlobal('localStorage', window.localStorage);
setGlobal('sessionStorage', window.sessionStorage);
setGlobal('location', window.location);
setGlobal('HTMLElement', window.HTMLElement);
setGlobal('Node', window.Node);
setGlobal('Element', window.Element);
setGlobal('Event', window.Event);
setGlobal('CustomEvent', window.CustomEvent);
setGlobal('KeyboardEvent', window.KeyboardEvent);
setGlobal('MouseEvent', window.MouseEvent);
setGlobal('getComputedStyle', window.getComputedStyle);
setGlobal('Blob', window.Blob);
setGlobal('scrollTo', () => {});
setGlobal('alert', () => {});
setGlobal('confirm', () => true);

window.scrollTo = () => {};
window.matchMedia = window.matchMedia || (() => ({
  matches: false, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {},
}));
window.isSecureContext = true;

let clipboardText = '';
Object.defineProperty(window.navigator, 'clipboard', {
  value: {
    writeText: async (text) => { clipboardText = text; },
  },
  configurable: true,
});
if (!window.URL.createObjectURL) window.URL.createObjectURL = () => 'blob:mock';
if (!window.URL.revokeObjectURL) window.URL.revokeObjectURL = () => {};

// Network: default to "offline-ish" refusal so no test accidentally hits the internet.
let fetchHandler = async () => { throw new TypeError('Failed to fetch'); };
const mockFetch = (...args) => fetchHandler(...args);
setGlobal('fetch', mockFetch);
window.fetch = mockFetch;

/* ---------------------------------------------------------------- helpers -- */

const tick = (ms = 0) => new Promise((resolve) => setTimeout(resolve, ms));
const $ = (sel) => window.document.querySelector(sel);
const $$ = (sel) => Array.from(window.document.querySelectorAll(sel));
const text = (sel) => ($(sel) ? $(sel).textContent : '');
const viewText = () => text('#view');

async function go(hash) {
  window.location.hash = hash;
  window.dispatchEvent(new window.HashChangeEvent('hashchange'));
  await tick(30);
}

function click(node) {
  assert.ok(node, 'expected an element to click');
  node.dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true }));
}

const results = [];
async function step(name, fn) {
  try {
    await fn();
    results.push({ name, ok: true });
    console.log(`  ✓ ${name}`);
  } catch (error) {
    results.push({ name, ok: false, error });
    console.log(`  ✗ ${name}\n      ${error.message}`);
  }
}

/* ------------------------------------------------------------------ boot -- */

console.log('\nMy CRM — browser workflow test\n');

const app = await import('../js/app.js');
const { store, storage } = await import('../js/lib/store.js');
const actions = await import('../js/services/actions.js');
const bus = await import('../js/lib/bus.js');
const { computePriority } = await import('../js/domain/priority.js');
const { followUpState } = await import('../js/domain/followup.js');
const { toISODate, addDaysISO, todayISO } = await import('../js/lib/date.js');

app.startApp();
await tick(60);

/* ------------------------------------------------------------ dashboard -- */

await step('app boots and renders the dashboard', () => {
  assert.ok(viewText().includes('Here is what needs your attention today'), 'greeting/summary line present');
  assert.ok(viewText().includes('Calls Today'), 'stat tiles render');
  assert.ok(viewText().includes('Overdue Follow-ups'));
  assert.ok(viewText().includes('Notifications'), 'insights panel renders');
  assert.equal($('#pageTitle').textContent, 'My CRM', 'app header shows "My CRM"');
  assert.ok(/Good (morning|afternoon|evening)/.test(viewText()), 'greeting is time aware');
});

await step('demo data loads automatically on first run', () => {
  const leads = actions.currentLeads();
  assert.equal(leads.length, 18, `expected 18 demo leads, got ${leads.length}`);
  assert.ok(actions.isDemo(), 'source is demo');
  assert.ok(leads.every((l) => l.id && l.signature && Array.isArray(l.timeline)));
});

await step('demo data demonstrates every dashboard state', () => {
  const leads = actions.currentLeads();
  const buckets = leads.map((l) => followUpState(l).bucket);
  assert.ok(buckets.includes('overdue'), 'overdue leads exist');
  assert.ok(buckets.includes('today'), 'due-today leads exist');
  assert.ok(buckets.includes('none'), 'leads without follow-up exist');
  assert.ok(leads.some((l) => l.interest === 'Hot'), 'hot leads exist');
});

await step('priority is computed and explainable', () => {
  const lead = actions.currentLeads().find((l) => followUpState(l).bucket === 'overdue');
  const priority = computePriority(lead);
  assert.ok(priority.score > 0 && priority.score <= 100);
  assert.ok(priority.reasons.length > 0, 'priority reasons are provided');
});

await step('notifications are clickable and drilled into', async () => {
  await go('#/notifications');
  assert.ok(viewText().includes('Notifications'), 'notifications view renders');
  const cards = $$('#view .insight-card');
  assert.ok(cards.length >= 3, `expected several notifications, saw ${cards.length}`);
  assert.ok(viewText().includes('overdue'), 'overdue notification shown');

  // Clicking the primary action of an overdue/urgent alert filters the Leads list.
  const button = $$('#view .insight-card button').find((b) => /show|view/i.test(b.textContent));
  click(button);
  await tick(60);
  assert.ok(window.location.hash.startsWith('#/leads'), `expected the leads route, got ${window.location.hash}`);
  assert.ok(viewText().includes('Overdue') || window.location.hash.includes('bucket=overdue'),
    'the filter follows the notification');
});

/* ---------------------------------------------------------------- leads -- */

await step('leads table and mobile cards render', async () => {
  await go('#/leads');
  const rows = $$('#view .lead-table__row');
  const cards = $$('#view .lead-cards .lead-card');
  assert.ok(rows.length >= 10, `expected table rows, saw ${rows.length}`);
  assert.equal(rows.length, cards.length, 'each row has a mobile card equivalent');
  assert.equal($$('#view .lead-table__head').length, 1, 'table header present');
});

await step('filters narrow the list', async () => {
  await go('#/leads?course=IOSH%20Managing%20Safely');
  const rows = $$('#view .lead-table__row');
  assert.ok(rows.length >= 1 && rows.length < 18, `course filter should narrow results, saw ${rows.length}`);
  assert.ok(viewText().includes('Course: IOSH Managing Safely'), 'filter description shown');

  await go('#/leads?bucket=overdue');
  const overdueRows = $$('#view .lead-table__row');
  assert.ok(overdueRows.length >= 2, 'overdue filter returns leads');
  assert.ok(overdueRows.every((row) => row.classList.contains('is-overdue')), 'rows are marked overdue');
});

await step('global search works from the top bar', async () => {
  await go('#/dashboard');
  const input = $('#globalSearch');
  input.value = 'NVQ';
  input.dispatchEvent(new window.Event('input', { bubbles: true }));
  await tick(400); // debounce + render
  assert.ok(window.location.hash.includes('q=NVQ'), `search updates the route (${window.location.hash})`);
  const rows = $$('#view .lead-table__row');
  assert.ok(rows.length >= 2, 'NVQ leads are found');
  assert.ok(viewText().includes('NVQ'), 'matching lead names/courses shown');
});

await step('smart search keywords filter by follow-up state', async () => {
  await go('#/leads?q=overdue');
  const rows = $$('#view .lead-table__row');
  assert.ok(rows.length >= 2, 'overdue keyword returns rows');
  rows.forEach((row) => assert.ok(row.classList.contains('is-overdue')));
});

await step('no results shows a friendly empty state', async () => {
  await go('#/leads?q=zzzzznotfound');
  assert.equal($$('#view .lead-table__row').length, 0);
  assert.ok(viewText().includes('No leads match these filters'), 'empty state message shown');
});

/* --------------------------------------------------------- lead profile -- */

await step('lead profile opens with all sections', async () => {
  await go('#/leads');
  const nameLink = $('#view .name-link');
  click(nameLink);
  await tick(60);
  const drawer = $('#drawer-root .drawer');
  assert.ok(drawer, 'drawer opened');
  const body = drawer.textContent;
  assert.ok(body.includes('Lead information'), 'lead info section');
  assert.ok(body.includes('Follow-up information'), 'follow-up section');
  assert.ok(body.includes('AI recommendation'), 'AI analysis section');
  assert.ok(body.includes('Generate AI Message'), 'message generator');
  assert.ok(body.includes('What should I do next?'), 'suggested action section');
  assert.ok(body.includes('Activity timeline'), 'timeline section');
});

await step('AI message generation works without an API key', async () => {
  const leadId = store.get('leads')[0]?.id;
  const { openLeadProfile } = await import('../js/views/lead-profile.js');
  openLeadProfile(leadId);
  await tick(40);

  const generate = $$('#drawer-root button').find((b) => b.textContent.includes('Generate AI Message'));
  click(generate);
  await tick(120);

  const box = $('#drawer-root .message-box');
  assert.ok(box, 'a message box appears');
  const message = box.textContent.trim();
  assert.ok(message.length > 40, `message looks real (${message.length} chars)`);
  const lead = store.get('leads').find((l) => l.id === leadId);
  assert.ok(message.includes(lead.name.split(' ')[0]), 'message uses the lead first name');
  assert.ok(/Built-in message|Generated by Gemini/.test($('#drawer-root').textContent), 'source is disclosed');
});

await step('message refinement and copy buttons work', async () => {
  const longer = $('#drawer-root .message-box').textContent;
  const professional = $$('#drawer-root button').find((b) => b.textContent === 'Make More Professional');
  click(professional);
  await tick(120);
  assert.ok($('#drawer-root .message-box').textContent.length > 40, 'rewritten message still present');

  clipboardText = '';
  const copy = $$('#drawer-root button').find((b) => /copy message/i.test(b.textContent));
  click(copy);
  await tick(80);
  assert.ok(clipboardText.length > 40, 'clipboard received the message');
  assert.ok($('#drawer-root .message-box').textContent.length >= longer.length * 0.4, 'message intact');
});

await step('AI analysis can be requested and applied', async () => {
  const analyse = $$('#drawer-root button').find((b) => /Analyse with AI|Analyse again/i.test(b.textContent));
  click(analyse);
  await tick(150);
  const drawer = $('#drawer-root').textContent;
  assert.ok(/Recommended action/.test(drawer), 'recommendation shown');
  assert.ok(/Priority:/.test(drawer), 'priority shown');

  const apply = $$('#drawer-root button').find((b) => b.textContent === 'Apply suggestion');
  if (apply) {
    click(apply);
    await tick(80);
    assert.ok($('#drawer-root').textContent.includes('Follow-up'), 'suggestion applied without error');
  }
});

await step('logging a call updates follow-up state', async () => {
  const before = store.get('leads').find((l) => l.id === store.get('leads')[0].id);
  const logCall = $$('#drawer-root button').find((b) => b.textContent === 'Log a call');
  click(logCall);
  await tick(60);
  const after = store.get('leads').find((l) => l.id === before.id);
  assert.ok(after.followUpCount >= before.followUpCount, 'follow-up count is tracked');
  assert.equal(after.lastContact, todayISO(), 'last contact is today');
  assert.ok(after.timeline.some((e) => e.type === 'call_made'), 'timeline records the call');
});

await step('notes can be added', async () => {
  const textarea = $('#drawer-root textarea[aria-label="New note"]');
  textarea.value = 'Prefers weekend batches';
  const add = $$('#drawer-root button').find((b) => b.textContent === 'Add note');
  click(add);
  await tick(60);
  assert.ok(store.get('leads')[0].notes.includes('Prefers weekend batches'), 'note saved to the lead');
  assert.ok($('#drawer-root').textContent.includes('Prefers weekend batches'), 'note rendered');
});

await step('adding a lead from the form works end to end', async () => {
  const { openLeadForm } = await import('../js/views/lead-form.js');
  openLeadForm({});
  await tick(50);

  $('#lead-name').value = 'Test Lead From UI';
  $('#lead-phone').value = '+92 300 0001112';
  $('#lead-course').value = 'IOSH Managing Safely';
  $('#lead-nextFollowUp').value = addDaysISO(todayISO(), 2);

  const save = $$('#modal-root .modal__foot button').find((b) => b.textContent === 'Add lead');
  click(save);
  await tick(80);

  const created = store.get('leads').find((l) => l.name === 'Test Lead From UI');
  assert.ok(created, 'lead created');
  assert.equal(created.course, 'IOSH Managing Safely');
  assert.equal(created.nextFollowUp, addDaysISO(todayISO(), 2));
  assert.equal($$('#modal-root .modal').length, 0, 'modal closed after saving');
});

await step('validation blocks a lead without contact details', async () => {
  const { openLeadForm } = await import('../js/views/lead-form.js');
  openLeadForm({});
  await tick(50);
  $('#lead-name').value = 'No Contact';
  const save = $$('#modal-root .modal__foot button').find((b) => b.textContent === 'Add lead');
  click(save);
  await tick(60);
  assert.equal($$('#modal-root .modal').length, 1, 'modal stays open');
  assert.ok($('#modal-root .field__error').textContent.length > 10, 'a friendly error is shown');
  assert.ok(!store.get('leads').some((l) => l.name === 'No Contact'), 'invalid lead not stored');
  const cancel = $$('#modal-root .modal__foot button').find((b) => b.textContent === 'Cancel');
  click(cancel);
  await tick(30);
});

/* ------------------------------------------------------------ follow-ups -- */

await step('follow-up calendar renders and selects days', async () => {
  await go('#/followups');
  assert.ok(viewText().includes('Follow-up calendar'), 'calendar present');
  const days = $$('#view .calendar__day');
  assert.ok(days.length >= 28, `calendar days rendered (${days.length})`);
  assert.ok($$('#view .calendar__day.is-today').length === 1, 'today is highlighted');

  const withCount = $$('#view .calendar__day').find((d) => d.querySelector('.calendar__count')?.textContent !== '0');
  if (withCount) {
    click(withCount);
    await tick(50);
    assert.ok(viewText().includes('Follow-ups on'), 'day drill-down shows a list');
  }
});

await step('overdue bucket lists overdue leads', async () => {
  await go('#/followups?preset=overdue');
  assert.ok(viewText().includes('Overdue follow-ups'));
  const items = $$('#view .fu-item');
  assert.ok(items.length >= 2, `overdue items listed (${items.length})`);
});

await step('bulk scheduling fills missing follow-up dates', async () => {
  const missing = actions.currentLeads().filter((l) => !l.nextFollowUp && !['Converted', 'Lost', 'Not Interested'].includes(l.status));
  assert.ok(missing.length > 0, 'there are leads without a follow-up date');
  const result = actions.scheduleBulkFollowUps(missing.map((l) => l.id));
  assert.ok(result.scheduled > 0, 'follow-ups scheduled');
  const stillMissing = actions.currentLeads().filter((l) => missing.some((m) => m.id === l.id) && !l.nextFollowUp);
  assert.equal(stillMissing.length, 0, 'no lead was left without a date');
});

/* ------------------------------------------------------------- insights -- */

await step('AI insights page renders analysis and charts', async () => {
  await go('#/insights');
  assert.ok(viewText().includes('AI Marketing Insights'));
  assert.ok(viewText().includes('Sources'), 'distribution charts render');
  assert.ok(viewText().includes('Course performance'), 'course table renders');
  const analyse = $$('#view button').find((b) => /Analyse my leads|Analyse again/i.test(b.textContent));
  click(analyse);
  await tick(150);
  assert.ok($$('#view .insight-card').length >= 1, 'insights generated');
  assert.ok(viewText().includes('Suggestion'), 'actionable suggestion shown');
});

await step('campaign generator produces a message', async () => {
  await go('#/campaigns?course=IOSH%20Managing%20Safely');
  assert.ok(viewText().includes('Campaign brief'));
  const generate = $$('#view button').find((b) => /Generate Campaign Message/i.test(b.textContent));
  click(generate);
  await tick(150);
  const box = $('#view .message-box');
  assert.ok(box && box.textContent.includes('IOSH'), 'campaign message mentions the course');
  assert.ok($$('#view button').some((b) => /copy/i.test(b.textContent)), 'copy button available');
});

/* ------------------------------------------------------------- settings -- */

await step('settings renders all tabs', async () => {
  await go('#/settings');
  assert.ok(viewText().includes('Google Sheet'));
  await go('#/settings?tab=ai');
  assert.ok(viewText().includes('Gemini API key'));
  assert.ok(viewText().includes('Browser-side keys are an MVP compromise'), 'security warning shown');
  await go('#/settings?tab=privacy');
  assert.ok(viewText().includes('Your data, plainly explained'));
  assert.ok(viewText().includes('remove stored configuration'));
  await go('#/settings?tab=help');
  assert.ok(viewText().includes('Recommended Google Sheet structure'));
  assert.ok(viewText().includes('Troubleshooting'));
});

/* --------------------------------------------------------- sheet import -- */

const CSV = [
  'Full Name,Contact Number,Interested Course,City,Lead Source,Status,Interest,Follow Up Date,Remarks',
  'Bilal Sheikh,0300 1112221,NVQ Level 6 Diploma in OHS,Karachi,Facebook,Interested,Warm,05/09/2026,Asked for fees',
  'Ruqaya Amin,0300 1112222,ISO 45001,Lahore,Google,New,Cold,,Came from website',
].join('\n');

await step('Google Sheet import works (mocked network)', async () => {
  fetchHandler = async (url) => {
    assert.ok(String(url).includes('gviz/tq'), 'the gviz CSV endpoint is used first');
    return {
      ok: true,
      status: 200,
      text: async () => CSV,
    };
  };

  const before = actions.currentLeads().length;
  const { importSheet } = await import('../js/services/sheets.js');
  const { updateSheetConfig } = await import('../js/lib/store.js');
  updateSheetConfig({
    url: 'https://docs.google.com/spreadsheets/d/1AbCdEfGhIjKlMnOpQrStUvWxYz1234567890/edit',
    spreadsheetId: '1AbCdEfGhIjKlMnOpQrStUvWxYz1234567890',
    headerRow: 1,
  });
  const result = await importSheet(store.get('sheet'), { headerRow: 1 });
  assert.equal(result.leads.length, 2, 'two leads parsed from the sheet');
  assert.equal(result.leads[0].nextFollowUp, '2026-09-05', 'd/m/Y dates parsed');
  assert.ok(result.mapping.name === 'Full Name', 'columns auto-mapped');

  const merge = actions.importLeadsFromRows(result.leads, 'sheet');
  assert.equal(merge.added.length, 2, 'two new leads added');
  const current = actions.currentLeads();
  assert.ok(current.some((l) => l.name === 'Bilal Sheikh'), 'sheet lead imported');
  assert.ok(!current.some((l) => l.name === 'Ahmed Raza'), 'demo leads are replaced by real sheet data');
  assert.ok(current.some((l) => l.name === 'Test Lead From UI'), 'manually added CRM leads survive a sync');
  assert.ok(!actions.isDemo(), 'source switched to sheet');
  assert.ok(current.length < before, 'demo rows were replaced, not merged in');
});

await step('sync now records the timestamp and reports changes', async () => {
  const result = await actions.syncFromSheet();
  assert.equal(result.ok, true, 'sync succeeded');
  assert.equal(result.added.length, 0, 'nothing new on the second sync');
  assert.equal(result.unchanged, 2, 'existing rows unchanged');
  assert.ok(store.get('sheet').lastSyncAt, 'last sync timestamp stored');
  assert.ok(store.get('sheet').lastSyncMessage.includes('unchanged'), 'friendly sync message stored');
});

await step('sheet with missing columns imports safely', async () => {
  fetchHandler = async () => ({ ok: true, status: 200, text: async () => 'Full Name,Remarks\nOnly A Name,no contact details here' });
  const { importSheet } = await import('../js/services/sheets.js');
  const result = await importSheet(store.get('sheet'), { headerRow: 1 });
  assert.equal(result.leads.length, 1, 'a named row still imports');
  assert.equal(result.leads[0].phone, '', 'missing phone handled');
  assert.ok(result.analysis.warnings.some((w) => /phone|WhatsApp|email/i.test(w.message)), 'a warning explains the missing contact column');
});

await step('sheet failure shows a friendly error and keeps working', async () => {
  fetchHandler = async () => { throw new TypeError('Failed to fetch'); };
  const result = await actions.syncFromSheet({ silent: true });
  assert.equal(result.ok, false, 'sync reports failure');
  assert.ok(result.error.friendly.length > 10, 'error has a friendly message');
  assert.ok(actions.currentLeads().length > 0, 'leads are still available');
  assert.equal(store.get('sheet').lastSyncStatus, 'error', 'error state recorded');
});

await step('private sheet (403) is explained clearly', async () => {
  fetchHandler = async () => ({ ok: false, status: 403, text: async () => 'Forbidden' });
  const { importSheet } = await import('../js/services/sheets.js');
  let message = '';
  try {
    await importSheet(store.get('sheet'), { headerRow: 1 });
  } catch (error) {
    message = error.friendly || '';
  }
  assert.ok(/share|public|Apps Script/i.test(message), `expected sharing advice, got "${message}"`);
});

/* ------------------------------------------------------- offline & AI off */

await step('invalid AI key is handled gracefully', async () => {
  const { generateMessage, analyzeLead, dailySummary } = await import('../js/services/ai.js');
  const { updateSettings } = await import('../js/lib/store.js');
  updateSettings({ geminiApiKey: 'AIza-invalid-key-for-testing' });

  fetchHandler = async () => ({
    ok: false,
    status: 400,
    text: async () => JSON.stringify({ error: { status: 'INVALID_ARGUMENT', message: 'API key not valid. Please pass a valid API key.' } }),
  });

  const lead = actions.currentLeads()[0];
  const message = await generateMessage(lead, { style: 'friendly', settings: store.get('settings'), force: true });
  assert.equal(message.ok, true, 'the call still resolves');
  assert.equal(message.source, 'local', 'falls back to the built-in writer');
  assert.ok(message.error && /key/i.test(message.error.friendly), 'the key error is explained');
  assert.ok(message.data.message.length > 30, 'a usable message is still produced');

  const analysis = await analyzeLead(lead, { settings: store.get('settings'), force: true });
  assert.equal(analysis.source, 'local');
  assert.ok(analysis.data.recommendedAction.length > 5);

  const summary = await dailySummary(actions.currentLeads(), { settings: store.get('settings'), force: true });
  assert.equal(summary.ok, true);
  assert.ok(summary.data.summary.length > 20, 'a summary exists even when AI fails');

  updateSettings({ geminiApiKey: '' });
});

await step('Gemini is called correctly when a key is present', async () => {
  const { updateSettings } = await import('../js/lib/store.js');
  const { generateMessage } = await import('../js/services/ai.js');
  updateSettings({ geminiApiKey: 'AIza-test-key', geminiModel: 'gemini-2.0-flash' });

  let captured = null;
  fetchHandler = async (url, options = {}) => {
    captured = { url: String(url), options };
    return {
      ok: true,
      status: 200,
      text: async () => JSON.stringify({
        candidates: [{ content: { parts: [{ text: JSON.stringify({ message: 'Assalam o Alaikum Ali, would you like the NVQ Level 6 batch details and fee structure?', notes: 'short and direct' }) }] } }],
        usageMetadata: { totalTokenCount: 42 },
      }),
    };
  };

  const lead = actions.currentLeads().find((l) => l.name.includes('Ali')) || actions.currentLeads()[0];
  const result = await generateMessage(lead, { style: 'friendly', settings: store.get('settings'), force: true });
  assert.equal(result.source, 'gemini', 'the API response is used');
  assert.ok(result.data.message.includes('NVQ'), 'the AI message is returned');
  assert.ok(captured.url.includes('generativelanguage.googleapis.com'), 'correct endpoint');
  assert.ok(captured.url.includes('gemini-2.0-flash'), 'model from settings');
  assert.ok(captured.options.headers['x-goog-api-key'] === 'AIza-test-key', 'key sent in the header, not the URL');
  const body = JSON.parse(captured.options.body);
  assert.ok(body.contents[0].parts[0].text.includes('Lead data'), 'prompt contains lead facts');
  assert.ok(!JSON.stringify(body).includes('Assalam'), 'prompt does not leak the answer');
  updateSettings({ geminiApiKey: '' });
});

await step('browser-side API key is never hard-coded in the source', async () => {
  const files = ['js/services/gemini.js', 'js/services/ai.js', 'js/config.js', 'index.html'];
  for (const file of files) {
    const source = await readFile(path.join(root, file), 'utf8');
    assert.ok(!/AIza[0-9A-Za-z_-]{30,}/.test(source), `${file} must not contain a real key`);
  }
});

/* ----------------------------------------------------- resilience checks -- */

await step('unreadable data cannot break the views', async () => {
  // Inject junk: bad dates, missing names, unknown statuses, non-string fields.
  const { replaceLeads } = await import('../js/lib/store.js');
  const original = store.get('leads');
  replaceLeads([
    { id: 'broken_1', name: '', phone: null, course: 42, nextFollowUp: 'yesterday-ish', lastContact: {}, status: '???', interest: ['Hot'], timeline: 'nope' },
    { id: 'broken_2' },
  ], 'sheet');

  await go('#/dashboard');
  assert.ok(viewText().length > 50, 'dashboard still renders');
  await go('#/leads');
  assert.ok($$('#view .lead-table__row').length >= 1, 'leads view still renders');
  await go('#/followups');
  assert.ok(viewText().includes('calendar') || viewText().includes('Follow-up'), 'follow-ups view still renders');
  await go('#/notifications');
  assert.ok(viewText().length > 50, 'notifications view still renders');
  await go('#/insights');
  assert.ok(viewText().includes('AI Marketing Insights'));

  replaceLeads(original, 'sheet');
  await go('#/dashboard');
});

await step('mobile layout hooks exist', () => {
  assert.ok($('.bottom-nav'), 'bottom navigation present in the DOM');
  assert.ok($$('.bottom-nav a').length >= 5, 'bottom nav links rendered');
  assert.ok($('[data-action="toggle-sidebar"]'), 'mobile menu button present');
  assert.ok($('#sidebar .nav__item.is-active'), 'active nav state is set');
});

await step('data persists to localStorage', async () => {
  const stored = storage.get('leads', []);
  assert.ok(Array.isArray(stored) && stored.length > 0, 'leads persisted');
  assert.ok(storage.get('settings', null), 'settings persisted');
  assert.equal(storage.isPersistent(), true, 'localStorage is available');
});

/* --------------------------------------------------------------- report -- */

const failed = results.filter((r) => !r.ok);
console.log(`\n${'─'.repeat(56)}`);
if (failed.length) {
  console.log(`${results.length - failed.length} passed, ${failed.length} failed\n`);
  failed.forEach((f) => console.log(`  ✗ ${f.name}\n    ${f.error.stack?.split('\n').slice(0, 3).join('\n    ')}`));
  process.exitCode = 1;
} else {
  console.log(`All ${results.length} browser workflow tests passed.`);
}
