/** Shared constants: statuses, interest levels, courses, message styles, CRM fields. */

export const APP_NAME = 'My CRM';
export const APP_TAGLINE = 'Lead & Follow-up Manager';

export const LEAD_STATUSES = [
  'New', 'Contacted', 'Interested', 'Follow-up', 'Hot', 'Converted', 'Not Interested', 'Lost',
];

export const INTEREST_LEVELS = ['Cold', 'Warm', 'Hot'];

export const SOURCES = ['Facebook', 'Instagram', 'WhatsApp', 'Website', 'Google', 'Referral', 'Walk-in', 'LinkedIn', 'TikTok', 'Other'];

export const COURSES = [
  'IOSH Managing Safely',
  'NVQ Level 6 Diploma in OHS',
  'OTHM Level 6 OHS',
  'ISO 45001',
  'ISO 14001',
  'CFPS',
  'OSHA',
];

/** Message styles offered in the AI message generator. */
export const MESSAGE_STYLES = [
  { id: 'friendly', label: 'Friendly', hint: 'Warm, human, conversational' },
  { id: 'professional', label: 'Professional', hint: 'Polished and businesslike' },
  { id: 'short', label: 'Short WhatsApp', hint: '2–3 lines, instant-read' },
  { id: 'followup', label: 'Follow-up', hint: 'Nudge after no reply' },
  { id: 'reminder', label: 'Reminder', hint: 'Gentle reminder of next step' },
  { id: 'promotional', label: 'Promotional', hint: 'Highlights batch, offer, seats' },
  { id: 'reengagement', label: 'Re-engagement', hint: 'Revives an old inquiry' },
  { id: 'final', label: 'Final follow-up', hint: 'Last polite check-in' },
];

export const CAMPAIGN_PURPOSES = [
  'Reactivation',
  'New batch announcement',
  'Fee / discount offer',
  'Course information',
  'Reminder to register',
  'Event / webinar invite',
];

export const CAMPAIGN_AUDIENCES = [
  'All leads',
  'Old interested leads',
  'Not-converted leads',
  'New leads',
  'Hot leads',
  'No-response leads',
  'Specific course leads',
  'Specific city leads',
];

/** "What should I do next?" action vocabulary (section 9). */
export const NEXT_ACTIONS = [
  { id: 'call', label: 'Call', icon: 'i-phone', status: 'Contacted', channel: 'call' },
  { id: 'whatsapp', label: 'WhatsApp', icon: 'i-chat', status: 'Contacted', channel: 'whatsapp' },
  { id: 'course_details', label: 'Send Course Details', icon: 'i-sheet', status: 'Interested', channel: 'whatsapp' },
  { id: 'fee_details', label: 'Send Fee Details', icon: 'i-sheet', status: 'Interested', channel: 'whatsapp' },
  { id: 'reminder', label: 'Send Reminder', icon: 'i-bell', status: 'Follow-up', channel: 'whatsapp' },
  { id: 'follow_later', label: 'Follow Up Later', icon: 'i-clock', status: 'Follow-up', channel: null },
  { id: 'converted', label: 'Mark as Converted', icon: 'i-check', status: 'Converted', channel: null },
  { id: 'lost', label: 'Mark as Lost', icon: 'i-close', status: 'Lost', channel: null },
];

export const ACTION_BY_ID = NEXT_ACTIONS.reduce((acc, a) => { acc[a.id] = a; return acc; }, {});

/**
 * CRM fields — the canonical shape of a lead. `keys` are extra header names the
 * smart column mapper looks for (all matched case/punctuation-insensitively).
 */
export const CRM_FIELDS = [
  { key: 'name', label: 'Lead Name', required: true, type: 'text', aliases: ['name', 'full name', 'fullname', 'lead name', 'client name', 'customer name', 'contact name'] },
  { key: 'phone', label: 'Phone', required: false, type: 'tel', aliases: ['phone', 'phone number', 'contact number', 'contact no', 'mobile', 'mobile number', 'cell', 'telephone'] },
  { key: 'whatsapp', label: 'WhatsApp', required: false, type: 'tel', aliases: ['whatsapp', 'whatsapp number', 'whats app', 'wa number', 'whats app number'] },
  { key: 'email', label: 'Email', required: false, type: 'email', aliases: ['email', 'email address', 'e mail', 'mail'] },
  { key: 'course', label: 'Course', required: false, type: 'text', aliases: ['course', 'interested course', 'course interest', 'program', 'programme', 'qualification', 'course name'] },
  { key: 'city', label: 'City', required: false, type: 'text', aliases: ['city', 'location', 'area', 'town', 'region'] },
  { key: 'source', label: 'Source', required: false, type: 'text', aliases: ['source', 'lead source', 'channel', 'platform', 'campaign source', 'referred by'] },
  { key: 'status', label: 'Status', required: false, type: 'text', aliases: ['status', 'lead status', 'stage', 'current status'] },
  { key: 'interest', label: 'Interest', required: false, type: 'text', aliases: ['interest', 'interest level', 'priority', 'rating', 'temperature'] },
  { key: 'lastContact', label: 'Last Contact', required: false, type: 'date', aliases: ['last contact', 'last contacted', 'last contact date', 'last contacted on', 'last call', 'last touch'] },
  { key: 'nextFollowUp', label: 'Next Follow-up', required: false, type: 'date', aliases: ['next follow up', 'next followup', 'follow up', 'follow up date', 'followup date', 'next call', 'next contact date', 'reminder date'] },
  { key: 'notes', label: 'Notes', required: false, type: 'text', aliases: ['notes', 'note', 'remarks', 'comments', 'comment', 'details', 'description'] },
  { key: 'assignedTo', label: 'Assigned To', required: false, type: 'text', aliases: ['assigned to', 'assigned', 'owner', 'sales rep', 'agent', 'handled by', 'team member'] },
  { key: 'followUpCount', label: 'Follow-ups', required: false, type: 'number', aliases: ['follow ups', 'followups', 'no of follow ups', 'number of follow ups', 'attempts', 'contact attempts'] },
  { key: 'lastResponse', label: 'Last Response', required: false, type: 'text', aliases: ['last response', 'response', 'reply', 'last reply', 'lead response'] },
];

export const MAPPABLE_FIELDS = CRM_FIELDS.map((f) => ({ key: f.key, label: f.label, required: !!f.required }));

/** Fields sent to the AI — deliberately minimal (data-privacy section 20). */
export const AI_FIELDS = ['name', 'course', 'status', 'interest', 'city', 'source', 'lastContact', 'nextFollowUp', 'followUpCount', 'lastResponse', 'notes'];

export const PRIORITY_LEVELS = [
  { id: 'very-high', label: 'Very High', rank: 5, tone: 'red' },
  { id: 'high', label: 'High', rank: 4, tone: 'orange' },
  { id: 'medium', label: 'Medium', rank: 3, tone: 'blue' },
  { id: 'low', label: 'Low', rank: 2, tone: 'green' },
  { id: 'minimal', label: 'Minimal', rank: 1, tone: 'grey' },
];

export const PRIORITY_BY_ID = PRIORITY_LEVELS.reduce((acc, p) => { acc[p.id] = p; return acc; }, {});

export const STATUS_TONE = {
  New: 'blue',
  Contacted: 'blue',
  Interested: 'orange',
  'Follow-up': 'orange',
  Hot: 'flame',
  Converted: 'green',
  'Not Interested': 'grey',
  Lost: 'grey',
};

export const INTEREST_TONE = { Cold: 'grey', Warm: 'orange', Hot: 'flame' };

/** Sorts offered on the Leads page. */
export const LEAD_SORTS = [
  { id: 'priority', label: 'Priority (highest first)' },
  { id: 'nextFollowUp', label: 'Next follow-up (soonest first)' },
  { id: 'lastContact', label: 'Last contact (oldest first)' },
  { id: 'name', label: 'Name (A–Z)' },
  { id: 'created', label: 'Recently added' },
  { id: 'course', label: 'Course' },
  { id: 'status', label: 'Status' },
];

export const COURSE_INFO = {
  'IOSH Managing Safely': {
    summary: '3-day IOSH Managing Safely certification for managers and supervisors responsible for health & safety.',
    duration: '3 days',
    highlights: ['Recognised IOSH certificate', 'Risk assessment focus', 'Ideal for site supervisors and managers'],
  },
  'NVQ Level 6 Diploma in OHS': {
    summary: 'Competency-based NVQ Level 6 Diploma in Occupational Health and Safety, assessed in the workplace.',
    duration: '6–12 months (workplace based)',
    highlights: ['No written exams', 'GradIOSH eligibility route', 'Portfolio-based assessment'],
  },
  'OTHM Level 6 OHS': {
    summary: 'OTHM Level 6 Diploma in Occupational Health and Safety — regulated qualification with written assignments.',
    duration: '9–12 months',
    highlights: ['Regulated qualification', 'Progression to Level 7', 'Blended / online delivery'],
  },
  'ISO 45001': {
    summary: 'ISO 45001 Occupational Health & Safety Management System lead auditor / implementation training.',
    duration: '5 days (lead auditor)',
    highlights: ['Audit planning & reporting', 'Management system requirements', 'Internal auditor option available'],
  },
  'ISO 14001': {
    summary: 'ISO 14001 Environmental Management System training for HSE and sustainability professionals.',
    duration: '3–5 days',
    highlights: ['Environmental aspects & impacts', 'Compliance obligations', 'Certified auditor pathway'],
  },
  CFPS: {
    summary: 'Certified Fire Protection Specialist — fire safety design, protection systems and code application.',
    duration: 'Self-paced + exam',
    highlights: ['Fire protection systems', 'NFPA-based syllabus', 'Exam preparation support'],
  },
  OSHA: {
    summary: 'OSHA General Industry / Construction safety training covering US workplace safety standards.',
    duration: '10–30 hours',
    highlights: ['OSHA compliance essentials', 'Hazard identification', 'Certificate on completion'],
  },
};

export function courseInfo(course) {
  if (!course) return null;
  const exact = COURSE_INFO[course];
  if (exact) return { name: course, ...exact };
  const fuzzyKey = Object.keys(COURSE_INFO).find((k) => k.toLowerCase() === String(course).toLowerCase()
    || k.toLowerCase().includes(String(course).toLowerCase())
    || String(course).toLowerCase().includes(k.toLowerCase()));
  if (fuzzyKey) return { name: course, ...COURSE_INFO[fuzzyKey] };
  return { name: course, summary: `Training programme: ${course}`, duration: '', highlights: [] };
}

/** Default lead object used to keep every record the same shape. */
export const EMPTY_LEAD = {
  id: '',
  name: '',
  phone: '',
  whatsapp: '',
  email: '',
  course: '',
  city: '',
  source: '',
  status: 'New',
  interest: 'Cold',
  lastContact: '',
  nextFollowUp: '',
  notes: '',
  assignedTo: '',
  followUpCount: 0,
  lastResponse: '',
  createdAt: '',
  updatedAt: '',
  timeline: [],
  aiSuggest: null,
  sheetRow: null,
  extra: {},
};
