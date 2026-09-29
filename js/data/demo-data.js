/**
 * Demo mode data (section 25).
 *
 * The sample leads are generated from a *sheet-shaped* table so the demo runs
 * through exactly the same import path as a real Google Sheet (including the
 * d/m/Y date format people actually use). Dates are relative to today, so the
 * dashboard always demonstrates overdue, due-today, upcoming, hot and
 * no-response states.
 */

import { addDaysISO, todayISO, formatDate } from '../lib/date.js';
import { rowsToObjects, objectsToCSV, uid } from '../lib/utils.js';
import { rowsToLeads } from '../services/mapping.js';
import { normalizeLead } from '../domain/model.js';

/** The recommended Google Sheet structure (section 13). */
export const DEMO_HEADERS = [
  'Name', 'Phone', 'WhatsApp', 'Email', 'Course', 'City', 'Source', 'Status',
  'Interest', 'Last Contact', 'Next Follow-up', 'Notes', 'Assigned To',
  'Follow-ups', 'Last Response',
];

function d(iso) {
  // Sheets in the demo use d/m/Y, the most common format users paste in.
  if (!iso) return '';
  const [y, m, day] = iso.split('-');
  return `${day}/${m}/${y}`;
}

/**
 * Rows describing the demo leads. `offset` values are days from today
 * (negative = in the past).
 */
const DEMO_ROWS_SPEC = [
  {
    name: 'Ahmed Raza', phone: '+92 300 1234567', whatsapp: '+92 300 1234567', email: 'ahmed.raza@example.com',
    course: 'NVQ Level 6 Diploma in OHS', city: 'Karachi', source: 'Facebook', status: 'Hot', interest: 'Hot',
    lastContact: -7, nextFollowUp: -3, notes: 'Asked for fee structure and instalment plan. Wants to start after Eid.',
    assignedTo: 'Sales — Ahmed', followUps: 3, response: 'Send me the fee details please',
    created: -24,
  },
  {
    name: 'Ali Hassan', phone: '+92 321 7654321', whatsapp: '+92 321 7654321', email: 'ali.hassan@example.com',
    course: 'NVQ Level 6 Diploma in OHS', city: 'Lahore', source: 'WhatsApp', status: 'Interested', interest: 'Warm',
    lastContact: -6, nextFollowUp: 0, notes: 'Interested in the NVQ Level 6 route. Works as a site supervisor.',
    assignedTo: 'Sales — Ahmed', followUps: 2, response: '',
    created: -19,
  },
  {
    name: 'Fatima Noor', phone: '+92 333 1122334', whatsapp: '+92 333 1122334', email: 'fatima.noor@example.com',
    course: 'IOSH Managing Safely', city: 'Islamabad', source: 'Website', status: 'Interested', interest: 'Warm',
    lastContact: -2, nextFollowUp: 0, notes: 'HR manager, needs IOSH for her team of 6. Asked for group discount.',
    assignedTo: 'Sales — Sana', followUps: 2, response: 'Yes please share the group rates',
    created: -14,
  },
  {
    name: 'Bilal Ahmed', phone: '+92 345 9988776', whatsapp: '+92 345 9988776', email: '',
    course: 'OTHM Level 6 OHS', city: 'Rawalpindi', source: 'Instagram', status: 'Contacted', interest: 'Warm',
    lastContact: -9, nextFollowUp: -1, notes: 'Asked about online delivery and exam pattern.',
    assignedTo: 'Sales — Ahmed', followUps: 1, response: '',
    created: -13,
  },
  {
    name: 'Sana Malik', phone: '+92 302 4455667', whatsapp: '+92 302 4455667', email: 'sana.malik@example.com',
    course: 'ISO 45001', city: 'Karachi', source: 'LinkedIn', status: 'Hot', interest: 'Hot',
    lastContact: -1, nextFollowUp: 1, notes: 'Company is paying — needs the lead auditor course before their audit in November.',
    assignedTo: 'Sales — Sana', followUps: 4, response: 'Please reserve my seat for the next batch',
    created: -10,
  },
  {
    name: 'Usman Tariq', phone: '+92 311 2233445', whatsapp: '+92 311 2233445', email: 'usman.tariq@example.com',
    course: 'ISO 14001', city: 'Faisalabad', source: 'Google', status: 'New', interest: 'Cold',
    lastContact: '', nextFollowUp: '', notes: 'Came through the website form on Sunday evening.',
    assignedTo: '', followUps: 0, response: '',
    created: -3,
  },
  {
    name: 'Hina Shah', phone: '+92 322 5566778', whatsapp: '+92 322 5566778', email: 'hina.shah@example.com',
    course: 'CFPS', city: 'Lahore', source: 'Facebook', status: 'Follow-up', interest: 'Warm',
    lastContact: -12, nextFollowUp: -5, notes: 'Working in fire safety. Needs CFPS for a promotion.',
    assignedTo: 'Sales — Sana', followUps: 2, response: '',
    created: -30,
  },
  {
    name: 'Imran Khan', phone: '+92 300 6677889', whatsapp: '+92 300 6677889', email: '',
    course: 'OSHA', city: 'Peshawar', source: 'Referral', status: 'Not Interested', interest: 'Cold',
    lastContact: -15, nextFollowUp: '', notes: 'Budget issue for now — asked to be contacted next quarter.',
    assignedTo: 'Sales — Ahmed', followUps: 2, response: 'Not right now, maybe next quarter',
    created: -35,
  },
  {
    name: 'Zainab Iqbal', phone: '+92 335 7788990', whatsapp: '+92 335 7788990', email: 'zainab.iqbal@example.com',
    course: 'NVQ Level 6 Diploma in OHS', city: 'Dubai', source: 'Instagram', status: 'Converted', interest: 'Hot',
    lastContact: -4, nextFollowUp: '', notes: 'Enrolled in the October batch. Payment received in full.',
    assignedTo: 'Sales — Sana', followUps: 5, response: 'Payment sent, please confirm',
    created: -40,
  },
  {
    name: 'Kamran Sheikh', phone: '+92 301 8899001', whatsapp: '+92 301 8899001', email: 'kamran.sheikh@example.com',
    course: 'IOSH Managing Safely', city: 'Multan', source: 'WhatsApp', status: 'Contacted', interest: 'Warm',
    lastContact: -9, nextFollowUp: '', notes: 'Wanted the course outline. No reply after that.',
    assignedTo: 'Sales — Ahmed', followUps: 1, response: '',
    created: -11,
  },
  {
    name: 'Ayesha Siddiqui', phone: '+92 336 9900112', whatsapp: '+92 336 9900112', email: 'ayesha.s@example.com',
    course: 'ISO 45001', city: 'Islamabad', source: 'Google', status: 'Interested', interest: 'Warm',
    lastContact: -3, nextFollowUp: 4, notes: 'Comparing ISO 45001 with NVQ. Send comparison sheet.',
    assignedTo: 'Sales — Sana', followUps: 2, response: 'Which one is better for my career?',
    created: -8,
  },
  {
    name: 'Danish Ali', phone: '+92 313 1122334', whatsapp: '+92 313 1122334', email: '',
    course: 'OTHM Level 6 OHS', city: 'Karachi', source: 'Facebook', status: 'Contacted', interest: 'Cold',
    lastContact: -21, nextFollowUp: '', notes: 'Enquiry from an old campaign, never followed up.',
    assignedTo: '', followUps: 0, response: '',
    created: -46,
  },
  {
    name: 'Maria Yousuf', phone: '+92 344 1231234', whatsapp: '+92 344 1231234', email: 'maria.yousuf@example.com',
    course: 'ISO 14001', city: 'Lahore', source: 'LinkedIn', status: 'Interested', interest: 'Warm',
    lastContact: -2, nextFollowUp: 2, notes: 'Sustainability officer. Needs the certificate before December.',
    assignedTo: 'Sales — Ahmed', followUps: 2, response: 'Please send the schedule',
    created: -12,
  },
  {
    name: 'Hassan Raza', phone: '+92 305 5556667', whatsapp: '+92 305 5556667', email: '',
    course: 'NVQ Level 6 Diploma in OHS', city: 'Sialkot', source: 'Facebook', status: 'Contacted', interest: 'Warm',
    lastContact: -13, nextFollowUp: '', notes: 'Sent NVQ details, no follow-up planned.',
    assignedTo: 'Sales — Ahmed', followUps: 1, response: '',
    created: -18,
  },
  {
    name: 'Nida Farooq', phone: '+92 331 2223334', whatsapp: '+92 331 2223334', email: 'nida.farooq@example.com',
    course: 'CFPS', city: 'Karachi', source: 'Website', status: 'New', interest: 'Cold',
    lastContact: '', nextFollowUp: '', notes: 'Downloaded the CFPS brochure from the website today.',
    assignedTo: '', followUps: 0, response: '',
    created: 0,
  },
  {
    name: 'Tariq Mehmood', phone: '+92 300 4445556', whatsapp: '+92 300 4445556', email: 'tariq.m@example.com',
    course: 'OSHA', city: 'Doha', source: 'Referral', status: 'Lost', interest: 'Cold',
    lastContact: -26, nextFollowUp: '', notes: 'Already did OSHA with another institute.',
    assignedTo: 'Sales — Sana', followUps: 3, response: 'Already completed with someone else',
    created: -50,
  },
  {
    name: 'Sameer Abbas', phone: '+92 320 7778889', whatsapp: '+92 320 7778889', email: 'sameer.abbas@example.com',
    course: 'IOSH Managing Safely', city: 'Karachi', source: 'Instagram', status: 'Hot', interest: 'Hot',
    lastContact: -5, nextFollowUp: -2, notes: 'Wants to join this month. Asked if weekend batch is available.',
    assignedTo: 'Sales — Ahmed', followUps: 2, response: 'Do you have a weekend batch?',
    created: -16,
  },
  {
    name: 'Rabia Khan', phone: '+92 334 8889990', whatsapp: '+92 334 8889990', email: 'rabia.khan@example.com',
    course: 'NVQ Level 6 Diploma in OHS', city: 'Manchester', source: 'Google', status: 'Interested', interest: 'Warm',
    lastContact: -4, nextFollowUp: 6, notes: 'Based in the UK, needs the NVQ for GradIOSH.',
    assignedTo: 'Sales — Sana', followUps: 1, response: 'Is this accepted for GradIOSH?',
    created: -9,
  },
];

/** Build the demo table: header row + one row per lead, formatted like a sheet. */
export function buildDemoRows(now = new Date()) {
  const rows = [DEMO_HEADERS.slice()];
  for (const spec of DEMO_ROWS_SPEC) {
    rows.push([
      spec.name,
      spec.phone,
      spec.whatsapp,
      spec.email,
      spec.course,
      spec.city,
      spec.source,
      spec.status,
      spec.interest,
      spec.lastContact === '' || spec.lastContact === undefined ? '' : d(addDaysISO(todayISO(now), spec.lastContact)),
      spec.nextFollowUp === '' || spec.nextFollowUp === undefined ? '' : d(addDaysISO(todayISO(now), spec.nextFollowUp)),
      spec.notes,
      spec.assignedTo,
      String(spec.followUps || 0),
      spec.response || '',
    ]);
  }
  return rows;
}

/** Column mapping for the demo table (mirrors what auto-mapping would produce). */
export const DEMO_MAPPING = {
  name: 'Name',
  phone: 'Phone',
  whatsapp: 'WhatsApp',
  email: 'Email',
  course: 'Course',
  city: 'City',
  source: 'Source',
  status: 'Status',
  interest: 'Interest',
  lastContact: 'Last Contact',
  nextFollowUp: 'Next Follow-up',
  notes: 'Notes',
  assignedTo: 'Assigned To',
  followUpCount: 'Follow-ups',
  lastResponse: 'Last Response',
};

/** The last 7 days as a readable list (used in a couple of demo activities). */
function dayOffsetISO(offset, now = new Date()) {
  return addDaysISO(todayISO(now), offset);
}

/** Rich activity timeline for each demo lead, so the profile page looks real. */
function buildTimeline(spec, now = new Date()) {
  const events = [];
  const push = (type, daysAgo, text, meta) => {
    const at = daysAgo >= 0
      ? `${dayOffsetISO(-daysAgo, now)}T09:15:00.000Z`
      : `${dayOffsetISO(daysAgo, now)}T09:15:00.000Z`;
    events.push({ id: uid('ev'), type, at, text, meta: meta || null });
  };

  push('created', -(spec.created ?? 10), 'Lead created from sheet import');
  if (spec.lastContact !== '' && spec.lastContact !== undefined) {
    const contacts = Math.max(1, spec.followUps || 1);
    for (let i = contacts; i >= 1; i -= 1) {
      const when = spec.lastContact - (i - 1) * 3;
      const channel = i % 2 === 0 ? 'message_sent' : 'call_made';
      push(channel, -Math.max(0, when), channel === 'call_made'
        ? `Call made to ${spec.name.split(' ')[0]}`
        : `WhatsApp message sent to ${spec.name.split(' ')[0]}`);
    }
  }
  if (spec.response) {
    push('replied', -Math.max(0, (spec.lastContact ?? 0)), `Lead replied: "${spec.response}"`);
  }
  if (spec.nextFollowUp !== '' && spec.nextFollowUp !== undefined) {
    const when = spec.nextFollowUp < 0 ? spec.nextFollowUp : spec.nextFollowUp - 3;
    push('follow_up_scheduled', -Math.max(0, when), `Follow-up scheduled for ${formatDate(addDaysISO(todayISO(now), spec.nextFollowUp))}`);
  }
  if (spec.status && spec.status !== 'New') {
    push('status_changed', -Math.max(1, Math.round((spec.created ?? 10) / 2)),
      `Status changed to ${spec.status}`);
  }
  if (spec.notes) {
    push('note_added', -Math.max(1, Math.abs(spec.lastContact ?? 2)), `Note: ${spec.notes}`);
  }
  return events.sort((a, b) => String(a.at).localeCompare(String(b.at)));
}

/**
 * The demo lead list. Runs the sheet rows through the real importer, then adds
 * timelines so every profile page is fully populated.
 */
export function buildDemoLeads(now = new Date()) {
  const rows = buildDemoRows(now);
  const { records } = rowsToObjects(rows);
  const imported = rowsToLeads(records, DEMO_MAPPING, { headerOffset: 1 });

  return imported.map((lead, index) => {
    const spec = DEMO_ROWS_SPEC[index];
    const createdAt = spec.created === 0
      ? new Date().toISOString()
      : `${addDaysISO(todayISO(now), spec.created ?? -14)}T08:30:00.000Z`;
    return normalizeLead({
      ...lead,
      createdAt,
      updatedAt: new Date().toISOString(),
      timeline: [
        { id: uid('ev'), type: 'created', at: createdAt, text: 'Lead created (imported from Google Sheet)' },
        ...buildTimeline(spec, now),
      ],
      aiSuggest: null,
    });
  });
}

/** CSV text for the demo table — offered as a downloadable example sheet. */
export function demoSheetCsv(now = new Date()) {
  const rows = buildDemoRows(now);
  const { headers, records } = rowsToObjects(rows);
  return objectsToCSV(records, headers);
}

export const DEMO_LEAD_COUNT = DEMO_ROWS_SPEC.length;
