/**
 * Date utilities — all CRM date logic lives here.
 *
 * Rules followed throughout My CRM:
 *  - Dates are compared as *calendar dates* (no time, no timezone drift).
 *  - Internal canonical format is an ISO date string: "YYYY-MM-DD".
 *  - Anything unparseable returns "" (never throws), so a bad cell in a Google
 *    Sheet can never break the dashboard.
 */

const MS_PER_DAY = 86400000;

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July',
  'August', 'September', 'October', 'November', 'December'];
const MONTHS_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const DAYS_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export const MONTH_NAMES = MONTHS;
export const MONTH_NAMES_SHORT = MONTHS_SHORT;
export const WEEKDAY_NAMES_SHORT = DAYS_SHORT;

/** Strip the time component so two dates on the same day are always equal. */
export function dateOnly(d) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

/** Today as a Date at local midnight. */
export function today(now = new Date()) {
  return dateOnly(now);
}

export function isLeapYear(year) {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

export function daysInMonth(year, month /* 1-12 */) {
  return [31, isLeapYear(year) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1];
}

/** Date -> "YYYY-MM-DD" (local calendar date). */
export function toISODate(value) {
  if (!value) return '';
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value.trim())) return value.trim();
  const d = parseDateValue(value);
  if (!d) return '';
  return isoFromParts(d.getFullYear(), d.getMonth() + 1, d.getDate());
}

export function isoFromParts(year, month, day) {
  const y = String(year).padStart(4, '0');
  const m = String(month).padStart(2, '0');
  const d = String(day).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/** Today's ISO date. */
export function todayISO(now = new Date()) {
  return toISODate(now);
}

/** Full timestamp "YYYY-MM-DDTHH:mm:ss.sssZ" — used for activity log entries. */
export function nowISO(now = new Date()) {
  return now.toISOString();
}

/**
 * Parse the many shapes a date can arrive in from a Google Sheet, a CSV import
 * or a form field. Returns a Date at local midnight, or null when unusable.
 */
export function parseDateValue(value) {
  if (value === null || value === undefined) return null;

  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : dateOnly(value);
  }

  if (typeof value === 'number' && Number.isFinite(value)) {
    // Excel / Google Sheets serial date (days since 1899-12-30).
    if (value > 20000 && value < 60000) {
      const ms = Math.round(value) * MS_PER_DAY + Date.UTC(1899, 11, 30);
      const d = new Date(ms);
      return new Date(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
    }
    // Unix epoch seconds / milliseconds.
    if (value > 1e12) return dateOnly(new Date(value));
    if (value > 1e9) return dateOnly(new Date(value * 1000));
    return null;
  }

  const raw = String(value).trim();
  if (!raw) return null;

  const low = raw.toLowerCase();
  if (low === 'today' || low === 'now') return today();
  if (low === 'yesterday') return addDays(today(), -1);
  if (low === 'tomorrow') return addDays(today(), 1);

  // ISO date or datetime: 2025-01-05 or 2025-01-05T10:00:00Z
  let m = raw.match(/^(\d{4})-(\d{1,2})-(\d{1,2})(?:[T ].*)?$/);
  if (m) {
    const [, y, mo, d] = m;
    return safeParts(+y, +mo, +d);
  }

  // ISO with slashes: 2025/01/05
  m = raw.match(/^(\d{4})\/(\d{1,2})\/(\d{1,2})$/);
  if (m) return safeParts(+m[1], +m[2], +m[3]);

  // 05/01/2025, 5-1-25, 5.1.2025  (day-first assumed, month-first when day > 12)
  m = raw.match(/^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{2,4})$/);
  if (m) {
    let day = +m[1];
    let month = +m[2];
    const year = normalizeYear(+m[3]);
    if (month > 12 && day <= 12) { const t = day; day = month; month = t; }
    return safeParts(year, month, day);
  }

  // 5 Jan 2025 / 5 January 2025 / 05-Jan-25
  m = raw.match(/^(\d{1,2})[\s\-.]*([A-Za-z]{3,})[\s\-.,]*(\d{2,4})?$/);
  if (m) {
    const month = monthFromName(m[2]);
    if (month) return safeParts(normalizeYear(m[3] ? +m[3] : today().getFullYear()), month, +m[1]);
  }

  // Jan 5, 2025 / January 5 2025
  m = raw.match(/^([A-Za-z]{3,})[\s\-.]*(\d{1,2})(?:st|nd|rd|th)?[\s,]*(\d{2,4})?$/);
  if (m) {
    const month = monthFromName(m[1]);
    if (month) return safeParts(normalizeYear(m[3] ? +m[3] : today().getFullYear()), month, +m[2]);
  }

  // Last resort: let the engine try (handles "Mon Jan 05 2025 10:00:00 GMT+0500").
  const parsed = new Date(raw);
  if (!Number.isNaN(parsed.getTime()) && /\d{4}/.test(raw)) return dateOnly(parsed);

  return null;
}

function safeParts(year, month, day) {
  if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day)) return null;
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  const d = new Date(year, month - 1, day);
  // Reject overflow such as 31/02/2025 (JS would roll it into March).
  if (d.getMonth() !== month - 1 || d.getDate() !== day) return null;
  return d;
}

function normalizeYear(y) {
  if (y >= 100) return y;
  // Two-digit year: 00-69 -> 2000s, 70-99 -> 1900s (matches common spreadsheet behaviour)
  return y <= 69 ? 2000 + y : 1900 + y;
}

function monthFromName(name) {
  const n = String(name).slice(0, 3).toLowerCase();
  const idx = MONTHS_SHORT.findIndex((mo) => mo.toLowerCase() === n);
  return idx >= 0 ? idx + 1 : 0;
}

export function isValidDate(value) {
  return parseDateValue(value) !== null;
}

/** True when the string is already a canonical ISO date. */
export function isISO(value) {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value);
}

export function addDays(date, amount) {
  const base = date instanceof Date ? dateOnly(date) : parseDateValue(date);
  if (!base) return null;
  return new Date(base.getFullYear(), base.getMonth(), base.getDate() + Number(amount || 0));
}

export function addDaysISO(iso, amount) {
  const d = addDays(iso, amount);
  return d ? toISODate(d) : '';
}

/** Whole days from `fromISO` to `toISO` (positive when `to` is later). */
export function daysBetween(fromISO, toISO) {
  const a = parseDateValue(fromISO);
  const b = parseDateValue(toISO);
  if (!a || !b) return null;
  return Math.round((b.getTime() - a.getTime()) / MS_PER_DAY);
}

/** Whole days from today to the given date: 0 = today, negative = past. */
export function daysFromToday(iso, now = new Date()) {
  return daysBetween(todayISO(now), iso);
}

export function isPast(iso, now = new Date()) {
  const d = daysFromToday(iso, now);
  return d !== null && d < 0;
}

export function isToday(iso, now = new Date()) {
  return iso !== '' && iso === todayISO(now);
}

export function formatDate(value, style = 'medium') {
  const d = parseDateValue(value);
  if (!d) return '';
  const day = d.getDate();
  const monthLong = MONTHS[d.getMonth()];
  const monthShort = MONTHS_SHORT[d.getMonth()];
  const year = d.getFullYear();
  const weekday = DAYS_SHORT[d.getDay()];
  if (style === 'short') return `${day} ${monthShort}`;
  if (style === 'long') return `${weekday}, ${day} ${monthLong} ${year}`;
  if (style === 'weekday') return `${weekday} ${day} ${monthShort}`;
  if (style === 'month') return `${monthLong} ${year}`;
  return `${day} ${monthShort} ${year}`;
}

export function formatDateTime(value) {
  const d = value instanceof Date ? value : new Date(value);
  if (!(d instanceof Date) || Number.isNaN(d.getTime())) return '';
  const time = d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  return `${formatDate(d)} · ${time}`;
}

/** "Today", "Tomorrow", "Yesterday", "in 4 days", "9 days ago". */
export function relativeDayLabel(iso, now = new Date()) {
  const diff = daysFromToday(iso, now);
  if (diff === null) return '';
  if (diff === 0) return 'Today';
  if (diff === 1) return 'Tomorrow';
  if (diff === -1) return 'Yesterday';
  if (diff > 1) return `in ${diff} days`;
  return `${Math.abs(diff)} days ago`;
}

/** Compact distance for badges: "3d overdue", "Due today", "in 2d". */
export function shortDistanceLabel(iso, now = new Date()) {
  const diff = daysFromToday(iso, now);
  if (diff === null) return '';
  if (diff === 0) return 'Due today';
  if (diff === 1) return 'Due tomorrow';
  if (diff < 0) return `${Math.abs(diff)}d overdue`;
  return `in ${diff}d`;
}

export function isWeekend(value) {
  const d = parseDateValue(value);
  if (!d) return false;
  const day = d.getDay();
  return day === 0 || day === 6;
}

export function greeting(now = new Date()) {
  const h = now.getHours();
  if (h < 12) return 'Good morning';
  if (h < 17) return 'Good afternoon';
  return 'Good evening';
}

/** Start (Sunday) of the week containing the date. */
export function startOfWeek(value, now = new Date()) {
  const d = parseDateValue(value) || today(now);
  return addDays(d, -d.getDay());
}

export function startOfMonth(year, month /* 1-12 */) {
  return safeParts(year, month, 1);
}

/**
 * Month grid used by the follow-up calendar.
 * Returns an array of weeks; each week is 7 day objects { iso, day, inMonth }.
 */
export function monthGrid(year, month /* 1-12 */) {
  const first = new Date(year, month - 1, 1);
  const leading = first.getDay(); // Sunday-first grid
  const start = new Date(year, month - 1, 1 - leading);
  const weeks = [];
  let cursor = start;
  for (let w = 0; w < 6; w += 1) {
    const week = [];
    for (let d = 0; d < 7; d += 1) {
      week.push({
        iso: toISODate(cursor),
        day: cursor.getDate(),
        inMonth: cursor.getMonth() === month - 1,
      });
      cursor = addDays(cursor, 1);
    }
    weeks.push(week);
    // Stop after a week that already ran past the end of the month.
    if (cursor.getMonth() !== month - 1 && cursor > new Date(year, month - 1, daysInMonth(year, month))) break;
  }
  return weeks;
}

/** Inclusive date range as an array of ISO dates. */
export function dateRange(startISO, endISO) {
  const out = [];
  let cursor = parseDateValue(startISO);
  const end = parseDateValue(endISO);
  if (!cursor || !end) return out;
  let guard = 0;
  while (cursor <= end && guard < 1000) {
    out.push(toISODate(cursor));
    cursor = addDays(cursor, 1);
    guard += 1;
  }
  return out;
}

/** Human friendly "Today, 1:42 PM" style label for the sync timestamp. */
export function friendlyTimestamp(isoDateTime, now = new Date()) {
  if (!isoDateTime) return '';
  const d = new Date(isoDateTime);
  if (Number.isNaN(d.getTime())) return '';
  const time = d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  const dayDiff = daysBetween(todayISO(now), toISODate(d));
  if (dayDiff === 0) return `Today, ${time}`;
  if (dayDiff === -1) return `Yesterday, ${time}`;
  return `${formatDate(d)} · ${time}`;
}
