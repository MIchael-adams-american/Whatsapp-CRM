/**
 * My CRM — logic test suite (no browser required).
 * Run with:  node tests/run-tests.mjs
 *
 * Covers the parts that must never be wrong: date parsing, follow-up buckets,
 * priority ordering, filters + smart search, column mapping, sheet merging,
 * notifications and the local (offline) AI fallbacks.
 */

import assert from 'node:assert/strict';
import process from 'node:process';

let passed = 0;
const failures = [];
const only = process.argv[2];

function test(name, fn) {
  if (only && !name.toLowerCase().includes(only.toLowerCase())) return;
  try {
    fn();
    passed += 1;
    console.log(`  ✓ ${name}`);
  } catch (error) {
    failures.push({ name, error });
    console.log(`  ✗ ${name}\n      ${error.message}`);
  }
}

async function testAsync(name, fn) {
  if (only && !name.toLowerCase().includes(only.toLowerCase())) return;
  try {
    await fn();
    passed += 1;
    console.log(`  ✓ ${name}`);
  } catch (error) {
    failures.push({ name, error });
    console.log(`  ✗ ${name}\n      ${error.message}`);
  }
}

function section(title) {
  console.log(`\n${title}`);
}

/* ------------------------------------------------------------- helpers -- */

const { addDaysISO, todayISO, toISODate, parseDateValue, daysFromToday, formatDate, monthGrid, relativeDayLabel } =
  await import('../js/lib/date.js');
const { parseCSV, rowsToObjects, objectsToCSV, parseSheetUrl, normalizePhone, whatsappLink, hashString } =
  await import('../js/lib/utils.js');
const { normalizeLead, createLead, validateLeadInput, mergeLead, distinctValues } = await import('../js/domain/model.js');
const { followUpState, countByBucket, findForgottenLeads, findSilentLeads, hasReplied, leadsByBucket } =
  await import('../js/domain/followup.js');
const { computePriority, rankLeads } = await import('../js/domain/priority.js');
const { applyFilters, EMPTY_FILTERS, parseSmartQuery, QUICK_FILTERS } = await import('../js/domain/filters.js');
const { buildNotifications, localNextAction, localDailySummary } = await import('../js/domain/notifications.js');
const { overviewStats, marketingSnapshot, compactSummaryText, coursePerformance } = await import('../js/domain/analytics.js');
const { autoMapColumns, rowsToLeads, analyseSheet } = await import('../js/services/mapping.js');
const { mergeSheetLeads, describeSync, buildGvizUrl, buildValuesUrl, SheetError } = await import('../js/services/sheets.js');
const { buildAudience } = await import('../js/domain/audience.js');
const local = await import('../js/services/local-ai.js');
const { buildDemoLeads, DEMO_HEADERS, DEMO_LEAD_COUNT, demoSheetCsv } = await import('../js/data/demo-data.js');
const { buildGvizUrl: gviz } = await import('../js/services/sheets.js');

const TODAY = todayISO();
const demo = buildDemoLeads();

/* ---------------------------------------------------------------- dates -- */

section('Date handling');

test('parses ISO, day-first and long-form dates', () => {
  assert.equal(toISODate('2026-09-05'), '2026-09-05');
  assert.equal(toISODate('05/09/2026'), '2026-09-05', 'dd/mm/yyyy is day-first');
  assert.equal(toISODate('5/9/26'), '2026-09-05');
  assert.equal(toISODate('13/02/2026'), '2026-02-13', 'day > 12 forces day-first');
  assert.equal(toISODate('09/13/2026'), '2026-09-13', 'month-first when day > 12');
  assert.equal(toISODate('5 Jan 2026'), '2026-01-05');
  assert.equal(toISODate('January 5, 2026'), '2026-01-05');
  assert.equal(toISODate('today'), TODAY);
  assert.equal(toISODate(''), '');
  assert.equal(toISODate('not a date'), '');
  assert.equal(toISODate('31/02/2026'), '', 'impossible dates are rejected');
});

test('handles spreadsheet serial numbers', () => {
  const iso = toISODate(46000);
  assert.ok(/^\d{4}-\d{2}-\d{2}$/.test(iso), `expected a date, got ${iso}`);
});

test('day maths is calendar-accurate', () => {
  assert.equal(addDaysISO(TODAY, 7), toISODate(new Date(new Date(`${TODAY}T00:00:00`).getTime() + 7 * 86400000)));
  assert.equal(daysFromToday(addDaysISO(TODAY, -3)), -3);
  assert.equal(daysFromToday(TODAY), 0);
  assert.equal(daysFromToday(addDaysISO(TODAY, 5)), 5);
});

test('relative labels read naturally', () => {
  assert.equal(relativeDayLabel(TODAY), 'Today');
  assert.equal(relativeDayLabel(addDaysISO(TODAY, -1)), 'Yesterday');
  assert.equal(relativeDayLabel(addDaysISO(TODAY, 1)), 'Tomorrow');
  assert.equal(relativeDayLabel(addDaysISO(TODAY, 4)), 'in 4 days');
});

test('month grid always produces whole weeks', () => {
  const grid = monthGrid(2026, 2);
  assert.ok(grid.length >= 4 && grid.length <= 6);
  grid.forEach((week) => assert.equal(week.length, 7));
});

/* ------------------------------------------------------------ follow-ups -- */

section('Follow-up engine');

const baseLead = (over = {}) => normalizeLead({ name: 'Test Lead', phone: '+9200000000', ...over });

test('buckets overdue / today / future / none', () => {
  assert.equal(followUpState(baseLead({ nextFollowUp: addDaysISO(TODAY, -3) })).bucket, 'overdue');
  assert.equal(followUpState(baseLead({ nextFollowUp: TODAY })).bucket, 'today');
  assert.equal(followUpState(baseLead({ nextFollowUp: addDaysISO(TODAY, 1) })).bucket, 'tomorrow');
  assert.equal(followUpState(baseLead({ nextFollowUp: addDaysISO(TODAY, 3) })).bucket, 'week');
  assert.equal(followUpState(baseLead({ nextFollowUp: addDaysISO(TODAY, 30) })).bucket, 'upcoming');
  assert.equal(followUpState(baseLead()).bucket, 'none');
});

test('overdue label states the delay', () => {
  const state = followUpState(baseLead({ nextFollowUp: addDaysISO(TODAY, -4) }));
  assert.equal(state.label, 'Overdue by 4 days');
  assert.equal(state.tone, 'red');
});

test('closed leads are excluded from working buckets', () => {
  const leads = [
    baseLead({ name: 'Open', nextFollowUp: addDaysISO(TODAY, -1) }),
    baseLead({ name: 'Won', status: 'Converted', nextFollowUp: addDaysISO(TODAY, -1) }),
    baseLead({ name: 'Lost', status: 'Lost', nextFollowUp: addDaysISO(TODAY, -1) }),
  ];
  assert.equal(countByBucket(leads).overdue, 1);
  assert.equal(leadsByBucket(leads, 'overdue').length, 1);
});

test('silent and forgotten leads are detected', () => {
  const silent = baseLead({ lastContact: addDaysISO(TODAY, -8), lastResponse: '' });
  const replied = baseLead({ lastContact: addDaysISO(TODAY, -8), lastResponse: 'Yes send details' });
  assert.equal(findSilentLeads([silent, replied], new Date(), 5).length, 1);
  assert.equal(hasReplied(replied), true);
  assert.equal(hasReplied(baseLead({ lastResponse: 'no reply' })), false);

  const forgotten = baseLead({ lastContact: addDaysISO(TODAY, -9), nextFollowUp: '' });
  const found = findForgottenLeads([forgotten], new Date(), 5);
  assert.equal(found.length, 1);
  assert.equal(found[0].reason, 'no-follow-up');
});

/* -------------------------------------------------------------- priority -- */

section('Priority algorithm');

test('hot + overdue outranks cold + no response', () => {
  const hot = baseLead({ name: 'Hot Lead', interest: 'Hot', status: 'Hot', nextFollowUp: addDaysISO(TODAY, -2), lastContact: addDaysISO(TODAY, -6) });
  const cold = baseLead({ name: 'Cold Lead', interest: 'Cold', status: 'Contacted', lastContact: addDaysISO(TODAY, -30) });
  const hotScore = computePriority(hot).score;
  const coldScore = computePriority(cold).score;
  assert.ok(hotScore > coldScore, `${hotScore} should beat ${coldScore}`);
  assert.ok(['very-high', 'high'].includes(computePriority(hot).level));
});

test('converted leads are closed with no score', () => {
  const converted = baseLead({ status: 'Converted', interest: 'Hot', nextFollowUp: addDaysISO(TODAY, -5) });
  const priority = computePriority(converted);
  assert.equal(priority.closed, true);
  assert.equal(priority.score, 0);
});

test('priority reasons are human-readable', () => {
  const lead = baseLead({ interest: 'Hot', status: 'Interested', nextFollowUp: addDaysISO(TODAY, -3), lastContact: addDaysISO(TODAY, -8) });
  const priority = computePriority(lead);
  assert.ok(priority.reasons.some((r) => /overdue/i.test(r)));
  assert.ok(priority.reasons.some((r) => /hot/i.test(r) || /Interested/i.test(r)));
});

test('ranking returns the most urgent lead first', () => {
  const low = baseLead({ name: 'Low', interest: 'Cold', status: 'New' });
  const high = baseLead({ name: 'High', interest: 'Hot', status: 'Hot', nextFollowUp: addDaysISO(TODAY, -1), lastContact: addDaysISO(TODAY, -4) });
  const ranked = rankLeads([low, high]);
  assert.equal(ranked[0].lead.name, 'High');
});

/* --------------------------------------------------------------- filters -- */

section('Filters & smart search');

const filterLeads = [
  normalizeLead({ name: 'Ahmed Raza', course: 'NVQ Level 6 Diploma in OHS', city: 'Karachi', status: 'Hot', interest: 'Hot', nextFollowUp: addDaysISO(TODAY, -2), lastContact: addDaysISO(TODAY, -7), phone: '111' }),
  normalizeLead({ name: 'Ali Hassan', course: 'IOSH Managing Safely', city: 'Lahore', status: 'Interested', interest: 'Warm', nextFollowUp: TODAY, lastContact: addDaysISO(TODAY, -6), phone: '222' }),
  normalizeLead({ name: 'Zara Khan', course: 'NVQ Level 6 Diploma in OHS', city: 'Lahore', status: 'Converted', interest: 'Hot', phone: '333' }),
];

test('text search matches name, course and city', () => {
  assert.equal(applyFilters(filterLeads, { ...EMPTY_FILTERS, q: 'Ali', showClosed: true }).length, 1);
  assert.equal(applyFilters(filterLeads, { ...EMPTY_FILTERS, q: 'NVQ', showClosed: true }).length, 2);
  assert.equal(applyFilters(filterLeads, { ...EMPTY_FILTERS, q: 'Lahore', showClosed: true }).length, 2);
});

test('smart keywords map to filters', () => {
  assert.equal(applyFilters(filterLeads, { ...EMPTY_FILTERS, q: 'overdue', showClosed: true }).length, 1);
  assert.equal(applyFilters(filterLeads, { ...EMPTY_FILTERS, q: 'hot', showClosed: true }).length, 2);
  assert.equal(applyFilters(filterLeads, { ...EMPTY_FILTERS, q: 'today', showClosed: true }).length, 1);
  const parsed = parseSmartQuery('overdue NVQ');
  assert.equal(parsed.text, 'NVQ');
  assert.equal(parsed.filters.bucket, 'overdue');
});

test('closed leads are hidden unless asked for', () => {
  assert.equal(applyFilters(filterLeads, { ...EMPTY_FILTERS, q: '' }).length, 2);
  assert.equal(applyFilters(filterLeads, { ...EMPTY_FILTERS, status: 'Converted' }).length, 1);
  assert.equal(applyFilters(filterLeads, { ...EMPTY_FILTERS, showClosed: true }).length, 3);
});

test('combined filters narrow results', () => {
  const result = applyFilters(filterLeads, { ...EMPTY_FILTERS, course: 'NVQ Level 6 Diploma in OHS', city: 'Karachi', showClosed: true });
  assert.equal(result.length, 1);
  assert.equal(result[0].name, 'Ahmed Raza');
});

test('quick filters behave', () => {
  assert.equal(applyFilters(filterLeads, QUICK_FILTERS.overdue).length, 1);
  assert.equal(applyFilters(filterLeads, QUICK_FILTERS.hotLeads).length, 2);
  assert.equal(applyFilters(filterLeads, QUICK_FILTERS.todaysFollowUps).length, 1);
});

/* -------------------------------------------------------------- mapping -- */

section('Sheet column mapping');

test('auto-maps friendly column names', () => {
  const headers = ['Full Name', 'Contact Number', 'WhatsApp Number', 'Email Address', 'Interested Course', 'City', 'Lead Source', 'Status', 'Interest Level', 'Last Contact', 'Follow Up Date', 'Remarks'];
  const { mapping, unmapped, missing } = autoMapColumns(headers);
  assert.equal(mapping.name, 'Full Name');
  assert.equal(mapping.phone, 'Contact Number');
  assert.equal(mapping.whatsapp, 'WhatsApp Number');
  assert.equal(mapping.email, 'Email Address');
  assert.equal(mapping.course, 'Interested Course');
  assert.equal(mapping.nextFollowUp, 'Follow Up Date');
  assert.equal(mapping.notes, 'Remarks');
  assert.equal(mapping.status, 'Status');
  assert.equal(unmapped.length, 0);
  assert.ok(!missing.includes('name'));
});

test('saved mapping wins', () => {
  const { mapping } = autoMapColumns(['A', 'B'], { name: 'A', phone: 'B' });
  assert.equal(mapping.name, 'A');
  assert.equal(mapping.phone, 'B');
});

test('rows become leads with parsed dates and unmapped extras kept', () => {
  const headers = ['Full Name', 'Contact Number', 'Interested Course', 'Follow Up Date', 'Budget'];
  const records = [
    { 'Full Name': 'Ahmed Raza', 'Contact Number': '0300-1234567', 'Interested Course': 'NVQ Level 6 Diploma in OHS', 'Follow Up Date': '05/09/2026', Budget: '120000' },
    { 'Full Name': '', 'Contact Number': '', 'Interested Course': '', 'Follow Up Date': '', Budget: '' },
    { 'Full Name': 'No Contact', 'Contact Number': '', 'Interested Course': 'IOSH Managing Safely', 'Follow Up Date': '', Budget: '' },
  ];
  const { mapping } = autoMapColumns(headers);
  const leads = rowsToLeads(records, mapping);
  assert.equal(leads.length, 2, 'completely empty rows are skipped, a named row is kept');
  assert.equal(normalizePhone(leads[1].phone), '', 'the named lead has no phone');
  assert.equal(leads[0].nextFollowUp, '2026-09-05');
  assert.equal(leads[0].extra.Budget, '120000');
  assert.ok(leads[0].id.startsWith('lead_'));
});

test('sheet analysis reports missing columns', () => {
  const analysis = analyseSheet(['Phone', 'Course'], [{ Phone: '123', Course: 'IOSH' }]);
  assert.ok(analysis.warnings.some((w) => /Lead Name/i.test(w.message)));
});

test('CSV round trip', () => {
  const csv = 'Name,Notes\n"Ahmed, Raza","Said ""maybe"" to fees"\n';
  const rows = parseCSV(csv);
  const { headers, records } = rowsToObjects(rows);
  assert.deepEqual(headers, ['Name', 'Notes']);
  assert.equal(records[0].Name, 'Ahmed, Raza');
  assert.equal(records[0].Notes, 'Said "maybe" to fees');
  const back = objectsToCSV(records, headers);
  assert.ok(back.includes('Ahmed, Raza'));
});

/* ---------------------------------------------------------------- sheets -- */

section('Google Sheets helpers');

test('sheet URLs are parsed', () => {
  const parsed = parseSheetUrl('https://docs.google.com/spreadsheets/d/1AbCdEfGhIjKlMnOpQrStUvWxYz1234567890/edit#gid=12345');
  assert.equal(parsed.valid, true);
  assert.equal(parsed.id, '1AbCdEfGhIjKlMnOpQrStUvWxYz1234567890');
  assert.equal(parsed.gid, '12345');
  assert.equal(parseSheetUrl('https://example.com/not-a-sheet').valid, false);
});

test('gviz url carries gid, sheet and range', () => {
  const url = buildGvizUrl({ spreadsheetId: 'ABC', gid: '99', sheetName: 'Leads', range: 'A1:L50' });
  assert.ok(url.includes('/gviz/tq?'));
  assert.ok(url.includes('gid=99'));
  assert.ok(url.includes('tqx=out%3Acsv'));
  assert.ok(url.includes('range=A1%3AL50'));
  const byName = buildGvizUrl({ spreadsheetId: 'ABC', sheetName: 'My Tab' });
  assert.ok(byName.includes('sheet=My+Tab'));
});

test('values url requires a key', () => {
  const url = buildValuesUrl({ spreadsheetId: 'ABC', range: 'Leads!A1:L10', apiKey: 'KEY' });
  assert.ok(url.includes('/v4/spreadsheets/ABC/values/'));
  assert.ok(url.includes('key=KEY'));
});

test('merging a sync keeps timelines and reports changes', () => {
  const existing = [
    normalizeLead({ name: 'Ahmed', phone: '111', status: 'Interested', timeline: [{ type: 'call_made', at: '2026-01-01T00:00:00Z', text: 'Called' }] }),
    normalizeLead({ name: 'Local only', phone: '999', localOnly: true }),
  ];
  const incoming = [
    normalizeLead({ name: 'Ahmed', phone: '111', status: 'Hot' }),
    normalizeLead({ name: 'Brand new', phone: '222' }),
  ];
  const merge = mergeSheetLeads(existing, incoming);
  assert.equal(merge.added.length, 1);
  assert.equal(merge.updated.length, 1);
  assert.equal(merge.leads.length, 3, 'local-only lead survives');
  const ahmed = merge.leads.find((l) => l.name === 'Ahmed');
  assert.equal(ahmed.status, 'Hot');
  assert.ok(ahmed.timeline.some((e) => e.text === 'Called'), 'timeline is preserved');
  assert.ok(describeSync(merge, incoming.length).includes('1 new'));
});

/* ---------------------------------------------------------- notifications -- */

section('Notifications & insights');

test('demo data produces the expected alerts', () => {
  const notifications = buildNotifications(demo, { now: new Date(), source: 'demo' });
  const ids = notifications.map((n) => n.id);
  assert.ok(ids.includes('overdue-followups'), 'overdue alert');
  assert.ok(ids.includes('due-today'), 'due today alert');
  assert.ok(ids.includes('hot-attention'), 'hot alert');
  assert.ok(ids.includes('no-response'), 'no response alert');
  assert.ok(ids.includes('missing-followup'), 'missing follow-up alert');
  notifications.forEach((n) => assert.ok(n.title && n.detail));
});

test('every notification can be drilled into', () => {
  const notifications = buildNotifications(demo, { now: new Date(), source: 'demo' });
  for (const notification of notifications) {
    assert.ok(notification.filter || notification.actions.length || notification.cta,
      `notification "${notification.id}" must be actionable`);
  }
});

test('dismissed notifications stay dismissed', () => {
  const notifications = buildNotifications(demo, { now: new Date(), dismissed: { 'overdue-followups': true } });
  assert.ok(!notifications.map((n) => n.id).includes('overdue-followups'));
});

test('daily summary mentions the workload', () => {
  const summary = localDailySummary(demo, new Date());
  assert.ok(/\d+ follow-up/i.test(summary.summary));
  assert.ok(summary.headline.length > 0);
  assert.equal(summary.generatedBy, 'local');
});

test('next action advice is specific', () => {
  const overdue = demo.find((l) => followUpState(l).bucket === 'overdue');
  const advice = localNextAction(overdue);
  assert.equal(advice.actionType, 'call');
  assert.ok(advice.reason.includes('overdue'));
  const converted = demo.find((l) => l.status === 'Converted');
  assert.equal(localNextAction(converted).actionType, 'none');
});

test('analytics summarise without personal data', () => {
  const snapshot = marketingSnapshot(demo);
  const text = compactSummaryText(snapshot);
  assert.ok(/Totals:/.test(text));
  assert.ok(!demo.some((lead) => text.includes(lead.name)), 'aggregate text must not contain lead names');
  assert.ok(coursePerformance(demo).length > 0);
});

/* ------------------------------------------------------------------ demo -- */

section('Demo data');

test('demo data covers every dashboard state', () => {
  const counts = countByBucket(demo);
  assert.ok(counts.overdue >= 2, 'has overdue leads');
  assert.ok(counts.today >= 1, 'has follow-ups due today');
  assert.ok(counts.week >= 1, 'has follow-ups this week');
  assert.ok(counts.none >= 2, 'has leads without follow-up');
  assert.ok(demo.some((l) => l.interest === 'Hot'), 'has hot leads');
  assert.ok(demo.some((l) => l.status === 'Converted'), 'has a converted lead');
  assert.ok(demo.some((l) => l.status === 'Lost'), 'has a lost lead');
  assert.ok(findSilentLeads(demo, new Date(), 5).length >= 3, 'has silent leads');
  assert.ok(demo.every((l) => l.timeline.length >= 2), 'every lead has a timeline');
  assert.equal(demo.length, DEMO_LEAD_COUNT);
});

test('demo sheet export matches the documented structure', () => {
  const csv = demoSheetCsv();
  const { headers } = rowsToObjects(parseCSV(csv));
  assert.deepEqual(headers, DEMO_HEADERS);
});

/* ------------------------------------------------------------ local AI -- */

section('Built-in (offline) assistant');

test('local message uses the lead name, course and style', () => {
  const lead = demo.find((l) => l.course.includes('NVQ'));
  const { message, generatedBy } = local.localMessage(lead, { style: 'friendly', settings: { senderName: 'Ahmed' } });
  assert.equal(generatedBy, 'local');
  assert.ok(message.includes(lead.name.split(' ')[0]));
  assert.ok(message.includes('NVQ'));
  assert.ok(message.includes('Ahmed'), 'signs with the sender name');
});

test('every message style produces a distinct message', () => {
  const lead = demo[0];
  const styles = ['friendly', 'professional', 'short', 'followup', 'reminder', 'promotional', 'reengagement', 'final'];
  const seen = new Set();
  for (const style of styles) {
    const { message } = local.localMessage(lead, { style });
    assert.ok(message.length > 20, `${style} produced a message`);
    seen.add(message);
  }
  assert.ok(seen.size >= 6, 'styles are not all identical');
});

test('regenerate produces a different message', () => {
  const lead = demo[0];
  const first = local.localMessage(lead, { style: 'friendly', variant: 0 }).message;
  const second = local.localMessage(lead, { style: 'friendly', variant: 1 }).message;
  assert.notEqual(first, second);
});

test('make shorter and more professional work locally', () => {
  const lead = demo[0];
  const long = local.localMessage(lead, { style: 'friendly' }).message;
  const shorter = local.localRefine(long, 'shorter', lead);
  assert.ok(shorter.length <= long.length);
  const professional = local.localRefine('Hi there, want the fees? Thanks', 'professional', lead, { settings: { senderName: 'Ahmed' } });
  assert.ok(/Dear|Kind regards/i.test(professional));
});

test('local analysis matches the AI response shape', () => {
  const lead = demo.find((l) => followUpState(l).bucket === 'overdue');
  const analysis = local.localAnalysis(lead);
  for (const key of ['status', 'interest', 'priority', 'recommendedAction', 'actionType', 'suggestedFollowUpDate', 'reason', 'communicationApproach']) {
    assert.ok(analysis[key] !== undefined, `analysis.${key} present`);
  }
  assert.ok(/^\d{4}-\d{2}-\d{2}$/.test(analysis.suggestedFollowUpDate));
  assert.equal(analysis.generatedBy, 'local');
});

test('local campaign message references course and purpose', () => {
  const audience = buildAudience(demo, { course: 'IOSH Managing Safely', audience: 'Old interested leads' });
  const result = local.localCampaignMessage({
    course: 'IOSH Managing Safely',
    audience: 'Old interested leads',
    purpose: 'Reactivation',
    leads: audience,
  });
  assert.ok(result.message.includes('IOSH Managing Safely'));
  assert.ok(result.message.length > 60);
  assert.ok(result.audience.includes('Old interested leads'));
});

test('gradIOSH style course info is available', () => {
  const info = local.localMarketingInsights(demo);
  assert.ok(Array.isArray(info.insights));
  assert.ok(info.insights.length >= 1);
  info.insights.forEach((i) => assert.ok(i.title && i.detail && i.suggestedAction));
});

/* ------------------------------------------------------------ validation -- */

section('Validation & safety');

test('a lead needs a name and one contact method', () => {
  assert.equal(validateLeadInput({ name: '', phone: '1234567' }).valid, false);
  assert.equal(validateLeadInput({ name: 'Ahmed', phone: '' }).valid, false);
  assert.equal(validateLeadInput({ name: 'Ahmed', phone: '03001234567' }).valid, true);
  assert.equal(validateLeadInput({ name: 'Ahmed', email: 'a@b.com' }).valid, true);
  assert.equal(validateLeadInput({ name: 'Ahmed', email: 'not-an-email' }).valid, false);
  assert.equal(validateLeadInput({ name: 'Ahmed', phone: '03001234567', nextFollowUp: 'tomorrow' }).valid, true);
});

test('bad dates never throw or corrupt a lead', () => {
  const lead = normalizeLead({ name: 'X', nextFollowUp: 'not a date', lastContact: '13/13/2026' });
  assert.equal(lead.nextFollowUp, '');
  assert.equal(lead.lastContact, '');
});

test('missing fields are filled with safe defaults', () => {
  const lead = normalizeLead({});
  assert.equal(lead.status, 'New');
  assert.equal(lead.interest, 'Cold');
  assert.equal(lead.followUpCount, 0);
  assert.ok(Array.isArray(lead.timeline));
  assert.equal(lead.name, 'Unnamed lead');
});

test('lead ids are stable for the same phone number', () => {
  const a = createLead({ name: 'Ahmed Raza', phone: '+92 300 1234567' });
  const b = createLead({ name: 'Ahmed R.', phone: '0092 300 1234567' });
  assert.equal(a.id, b.id, 'the same number written differently must not duplicate the lead');
  const c = createLead({ name: 'Different person', phone: '+92 300 9999999' });
  assert.notEqual(a.id, c.id, 'different numbers stay separate');
});

test('phones normalise and WhatsApp links build', () => {
  assert.equal(normalizePhone('+92 (300) 123-4567'), '+923001234567');
  assert.ok(whatsappLink('0300 1234567', 'Hello', '92').startsWith('https://wa.me/923001234567'));
  assert.ok(whatsappLink('0300 1234567', 'Hi there').includes('text=Hi%20there'));
});

test('merging keeps the existing id and timeline', () => {
  const existing = createLead({ name: 'Ahmed', phone: '03001234567' });
  const merged = mergeLead(existing, normalizeLead({ ...existing, status: 'Hot' }));
  assert.equal(merged.lead.id, existing.id);
  assert.ok(merged.lead.timeline.length >= 1);
  assert.equal(merged.changed, true);
});

/* --------------------------------------------------------------- stats -- */

section('Dashboard statistics');

test('overview numbers add up', () => {
  const stats = overviewStats(demo);
  assert.equal(stats.total, demo.length);
  assert.ok(stats.overdue >= 2);
  assert.ok(stats.hotLeads.length >= 3);
  assert.ok(stats.callsToday >= 1);
  assert.equal(stats.overdueLeads.length, stats.overdue);
});

test('distinct values feed the filter dropdowns', () => {
  const courses = distinctValues(demo, 'course');
  assert.ok(courses.includes('NVQ Level 6 Diploma in OHS'));
  assert.ok(courses.length >= 5);
});

test('hash helper is deterministic', () => {
  assert.equal(hashString('abc'), hashString('abc'));
  assert.notEqual(hashString('abc'), hashString('abd'));
});

test('sheet errors are friendly and coded', () => {
  const error = new SheetError('not-public', 'Share the sheet publicly.');
  assert.equal(error.code, 'not-public');
  assert.ok(error.friendly.includes('Share'));
});

/* --------------------------------------------------------------- report -- */

console.log(`\n${'─'.repeat(56)}`);
if (failures.length) {
  console.log(`${passed} passed, ${failures.length} failed\n`);
  failures.forEach(({ name, error }) => console.log(`  ✗ ${name}\n    ${error.stack?.split('\n').slice(1, 3).join('\n    ') || error.message}`));
  process.exitCode = 1;
} else {
  console.log(`All ${passed} logic tests passed.`);
}
