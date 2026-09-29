/** Small shared helpers: text, ids, hashing, CSV, misc. */

/** Escape a value for safe insertion into HTML. */
export function esc(value) {
  if (value === null || value === undefined) return '';
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Escape for use inside an HTML attribute. */
export function escAttr(value) {
  return esc(value).replace(/\n/g, ' ');
}

export function uid(prefix = 'id') {
  const rand = Math.random().toString(36).slice(2, 8);
  return `${prefix}_${Date.now().toString(36)}${rand}`;
}

/** Stable short hash — used for lead signatures and AI cache keys. */
export function hashString(input) {
  const str = String(input ?? '');
  let h1 = 0x811c9dc5;
  let h2 = 0x01000193;
  for (let i = 0; i < str.length; i += 1) {
    const c = str.charCodeAt(i);
    h1 = (h1 ^ c) * 16777619;
    h2 = (h2 + c * (i + 1)) >>> 0;
  }
  return ((h1 >>> 0).toString(36) + (h2 >>> 0).toString(36)).slice(0, 12);
}

export function slugify(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
}

export function debounce(fn, wait = 220) {
  let t = null;
  function debounced(...args) {
    if (t) clearTimeout(t);
    t = setTimeout(() => { t = null; fn.apply(this, args); }, wait);
  }
  /** Run the pending call immediately (used by Enter in the search box). */
  debounced.flush = function flush(...args) {
    if (t) { clearTimeout(t); t = null; }
    fn.apply(this, args);
  };
  debounced.cancel = function cancel() {
    if (t) { clearTimeout(t); t = null; }
  };
  return debounced;
}

export function throttle(fn, wait = 500) {
  let last = 0;
  let timer = null;
  return function throttled(...args) {
    const now = Date.now();
    const remaining = wait - (now - last);
    if (remaining <= 0) {
      last = now;
      fn.apply(this, args);
    } else if (!timer) {
      timer = setTimeout(() => {
        timer = null;
        last = Date.now();
        fn.apply(this, args);
      }, remaining);
    }
  };
}

export function titleCase(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/\b([a-z])/g, (m) => m.toUpperCase())
    .trim();
}

export function truncate(value, max = 120) {
  const s = String(value ?? '');
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}

export function uniq(list) {
  return Array.from(new Set(list));
}

export function groupBy(list, keyFn) {
  const out = new Map();
  for (const item of list) {
    const key = keyFn(item);
    if (!out.has(key)) out.set(key, []);
    out.get(key).push(item);
  }
  return out;
}

export function countBy(list, keyFn) {
  const out = new Map();
  for (const item of list) {
    const key = keyFn(item);
    out.set(key, (out.get(key) || 0) + 1);
  }
  return out;
}

export function sum(list, fn = (x) => x) {
  return list.reduce((acc, item) => acc + (Number(fn(item)) || 0), 0);
}

export function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

export function safeJSONParse(text, fallback = null) {
  try {
    return JSON.parse(text);
  } catch {
    return fallback;
  }
}

export function deepClone(value) {
  if (value === null || typeof value !== 'object') return value;
  if (typeof structuredClone === 'function') {
    try { return structuredClone(value); } catch { /* fall through */ }
  }
  return JSON.parse(JSON.stringify(value));
}

export function emptyToNull(value) {
  if (value === null || value === undefined) return null;
  const s = String(value).trim();
  return s === '' ? null : s;
}

export function pluralize(count, singular, plural) {
  return `${count} ${count === 1 ? singular : (plural || `${singular}s`)}`;
}

export function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Normalise a phone number to a digits-only string (keeps a leading +). */
export function normalizePhone(value) {
  const raw = String(value ?? '').trim();
  if (!raw) return '';
  const plus = raw.trim().startsWith('+');
  const digits = raw.replace(/[^\d]/g, '');
  if (!digits) return '';
  return plus ? `+${digits}` : digits;
}

/** Build a wa.me link from any phone format. Returns '' when unusable. */
export function whatsappLink(phone, message = '', defaultCountryCode = '') {
  let digits = normalizePhone(phone).replace(/\+/g, '');
  if (!digits) return '';
  if (digits.startsWith('00')) digits = digits.slice(2);
  // Local numbers (0XXXXXXXXXX) get the configured country code prefixed.
  if (digits.startsWith('0') && defaultCountryCode) {
    digits = `${String(defaultCountryCode).replace(/\D/g, '')}${digits.replace(/^0+/, '')}`;
  }
  const text = message ? `?text=${encodeURIComponent(message)}` : '';
  return `https://wa.me/${digits}${text}`;
}

export function telLink(phone) {
  const p = normalizePhone(phone);
  return p ? `tel:${p}` : '';
}

export function mailtoLink(email, subject = '', body = '') {
  const e = String(email || '').trim();
  if (!e || !e.includes('@')) return '';
  const params = [];
  if (subject) params.push(`subject=${encodeURIComponent(subject)}`);
  if (body) params.push(`body=${encodeURIComponent(body)}`);
  return `mailto:${e}${params.length ? `?${params.join('&')}` : ''}`;
}

export function initials(name) {
  return String(name || '?')
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0] ? part[0].toUpperCase() : '')
    .join('') || '?';
}

export function downloadTextFile(filename, text, mime = 'text/plain;charset=utf-8') {
  const blob = new Blob([text], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

/** Copy text to the clipboard with a graceful fallback for older browsers. */
export async function copyToClipboard(text) {
  const value = String(text ?? '');
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(value);
      return true;
    }
  } catch {
    /* fall through to the legacy path */
  }
  try {
    const ta = document.createElement('textarea');
    ta.value = value;
    ta.setAttribute('readonly', '');
    ta.style.position = 'fixed';
    ta.style.top = '-1000px';
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand('copy');
    document.body.removeChild(ta);
    return ok;
  } catch {
    return false;
  }
}

/**
 * RFC-4180-ish CSV parser: handles quoted fields, escaped quotes, embedded
 * commas and newlines, CRLF and a UTF-8 BOM.
 */
export function parseCSV(text) {
  const rows = [];
  if (typeof text !== 'string' || !text.length) return rows;
  let source = text.replace(/^\uFEFF/, '');

  let row = [];
  let field = '';
  let inQuotes = false;

  for (let i = 0; i < source.length; i += 1) {
    const char = source[i];

    if (inQuotes) {
      if (char === '"') {
        if (source[i + 1] === '"') { field += '"'; i += 1; } else { inQuotes = false; }
      } else {
        field += char;
      }
      continue;
    }

    if (char === '"') {
      inQuotes = true;
    } else if (char === ',') {
      row.push(field); field = '';
    } else if (char === '\n') {
      row.push(field); field = '';
      rows.push(row); row = [];
    } else if (char === '\r') {
      // ignore — handled by \n
    } else {
      field += char;
    }
  }

  if (field !== '' || row.length) {
    row.push(field);
    rows.push(row);
  }

  return rows.filter((r) => r.some((cell) => String(cell).trim() !== ''));
}

/** Convert rows -> objects using the first row as the header. */
export function rowsToObjects(rows) {
  if (!Array.isArray(rows) || rows.length < 1) return { headers: [], records: [] };
  const headers = rows[0].map((h) => String(h ?? '').trim());
  const records = rows.slice(1).map((cells) => {
    const obj = {};
    headers.forEach((header, index) => {
      obj[header || `Column ${index + 1}`] = cells[index] === undefined ? '' : String(cells[index]).trim();
    });
    return obj;
  });
  return { headers, records };
}

/** Objects -> CSV text (used for exports). */
export function objectsToCSV(objects, headers) {
  if (!Array.isArray(objects) || !objects.length) return '';
  const cols = headers && headers.length ? headers : Object.keys(objects[0]);
  const escapeCell = (value) => {
    const s = value === null || value === undefined ? '' : String(value);
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines = [cols.map(escapeCell).join(',')];
  for (const obj of objects) lines.push(cols.map((c) => escapeCell(obj[c])).join(','));
  return lines.join('\n');
}

/** Try to extract a spreadsheet id + gid from any Google Sheets style URL. */
export function parseSheetUrl(input) {
  const url = String(input || '').trim();
  if (!url) return { id: '', gid: '', valid: false };

  // A bare spreadsheet id
  if (/^[a-zA-Z0-9-_]{20,}$/.test(url) && !url.includes('/')) {
    return { id: url, gid: '', valid: true };
  }

  const idMatch = url.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/) || url.match(/[?&]key=([a-zA-Z0-9-_]+)/);
  const gidMatch = url.match(/[#?&]gid=(\d+)/) || url.match(/[#?&]sheetId=(\d+)/);
  const id = idMatch ? idMatch[1] : '';

  return { id, gid: gidMatch ? gidMatch[1] : '', valid: Boolean(id) };
}

export function formatNumber(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return '0';
  return n.toLocaleString();
}

export function formatBytes(bytes) {
  const n = Number(bytes) || 0;
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(2)} MB`;
}

/** Turn errors / unknowns into a friendly sentence for the UI. */
export function friendlyError(error, fallback = 'Something went wrong. Please try again.') {
  if (!error) return fallback;
  const msg = typeof error === 'string' ? error : (error.message || '');
  if (!msg) return fallback;
  return msg;
}
