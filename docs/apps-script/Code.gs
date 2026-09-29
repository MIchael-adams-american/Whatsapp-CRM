/**
 * My CRM — Google Sheets bridge (Apps Script Web App)
 * ---------------------------------------------------
 * Lets My CRM read a PRIVATE sheet without making it public and without an API key.
 *
 * SETUP (3 minutes)
 *   1. Open your Google Sheet → Extensions → Apps Script.
 *   2. Delete the sample code, paste this file, then Save.
 *   3. Deploy → New deployment → type "Web app".
 *        Execute as:      Me
 *        Who has access:  Anyone
 *      → Deploy → authorise (Advanced → Go to project) → copy the /exec URL.
 *   4. In My CRM: Settings → Google Sheet → Advanced → paste the /exec URL → Connect & Sync.
 *
 * After editing this file you must deploy a NEW VERSION:
 *   Deploy → Manage deployments → Edit → Version: New version → Deploy.
 */

/** Leave '' to read the first tab of the spreadsheet. */
var SHEET_NAME = '';

/** First row that contains your column headers (1 = row 1). */
var HEADER_ROW = 1;

/**
 * Set to true only if you want My CRM's "write back to sheet" feature to work.
 * Writing always requires a confirmation inside My CRM first.
 */
var ALLOW_WRITES = false;

/** Optional shared secret. If set, My CRM must send it as ?token=... (paste it in the URL). */
var TOKEN = '';

/* ------------------------------------------------------------------ GET -- */

function doGet(e) {
  try {
    var params = (e && e.parameter) || {};
    if (!checkToken_(params)) return json_({ ok: false, error: 'Invalid token' });

    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var action = params.action || 'rows';

    if (action === 'meta') {
      return json_({
        ok: true,
        spreadsheet: ss.getName(),
        sheets: ss.getSheets().map(function (sheet) {
          return { name: sheet.getName(), rows: sheet.getLastRow(), columns: sheet.getLastColumn() };
        }),
        headerRow: HEADER_ROW,
        writesAllowed: ALLOW_WRITES,
      });
    }

    var sheet = resolveSheet_(ss, params.sheet);
    var lastRow = sheet.getLastRow();
    var lastColumn = sheet.getLastColumn();
    if (lastRow < HEADER_ROW) return json_({ ok: true, rows: [] });

    var values = sheet
      .getRange(HEADER_ROW, 1, lastRow - HEADER_ROW + 1, lastColumn)
      .getDisplayValues();

    return json_({ ok: true, rows: values, sheet: sheet.getName(), headerRow: HEADER_ROW, writesAllowed: ALLOW_WRITES });
  } catch (error) {
    return json_({ ok: false, error: String(error && error.message ? error.message : error) });
  }
}

/* ----------------------------------------------------------------- POST -- */

function doPost(e) {
  try {
    var body = {};
    if (e && e.postData && e.postData.contents) {
      try { body = JSON.parse(e.postData.contents); } catch (ignore) { body = {}; }
    }
    var params = (e && e.parameter) || {};
    if (!checkToken_(params) && !checkToken_(body)) return json_({ ok: false, error: 'Invalid token' });

    if (body.action === 'updateRow') {
      if (!ALLOW_WRITES) return json_({ ok: false, error: 'Writes are disabled in this deployment.' });
      return updateRow_(body);
    }

    return json_({ ok: false, error: 'Unsupported action: ' + (body.action || 'none') });
  } catch (error) {
    return json_({ ok: false, error: String(error && error.message ? error.message : error) });
  }
}

/**
 * Update a single row.
 * My CRM sends: { action: 'updateRow', sheet, row, values: { "Header name": "new value" } }
 * Only the headers you send are changed; everything else in the row is left alone.
 */
function updateRow_(body) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = resolveSheet_(ss, body.sheet);
  var row = Number(body.row);
  if (!row || row < HEADER_ROW + 1) return json_({ ok: false, error: 'Invalid row number.' });

  var headers = sheet.getRange(HEADER_ROW, 1, 1, sheet.getLastColumn()).getDisplayValues()[0];
  var changed = [];
  var values = body.values || {};

  Object.keys(values).forEach(function (header) {
    var index = headers.indexOf(header);
    if (index >= 0) {
      sheet.getRange(row, index + 1).setValue(values[header]);
      changed.push(header);
    }
  });

  return json_({ ok: true, row: row, changed: changed, rows: rowValues_(sheet) });
}

/* -------------------------------------------------------------- helpers -- */

function resolveSheet_(ss, name) {
  if (name) {
    var found = ss.getSheetByName(name);
    if (found) return found;
  }
  if (SHEET_NAME) {
    var named = ss.getSheetByName(SHEET_NAME);
    if (named) return named;
  }
  return ss.getSheets()[0];
}

function rowValues_(sheet) {
  var lastRow = sheet.getLastRow();
  var lastColumn = sheet.getLastColumn();
  if (lastRow < HEADER_ROW) return [];
  return sheet.getRange(HEADER_ROW, 1, lastRow - HEADER_ROW + 1, lastColumn).getDisplayValues();
}

function checkToken_(params) {
  if (!TOKEN) return true;
  return params && params.token === TOKEN;
}

function json_(payload) {
  return ContentService
    .createTextOutput(JSON.stringify(payload))
    .setMimeType(ContentService.MimeType.JSON);
}
