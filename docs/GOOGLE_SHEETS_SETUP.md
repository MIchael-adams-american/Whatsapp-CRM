# Connecting My CRM to Google Sheets

My CRM can read your leads in three ways. Try them in this order — most people are done in a
minute with method 1, and only need method 3 if the sheet must stay private.

---

## Method 1 — Share the sheet as "Anyone with the link" (fastest)

1. Open your sheet in Google Sheets.
2. Click **Share** (top right).
3. Under **General access**, choose **Anyone with the link** and set the role to **Viewer**.
4. Click **Copy link**.
5. In My CRM: **Settings → Google Sheet**, paste the link, and press **Connect & Sync**.

That is it. My CRM reads the sheet as CSV through Google's public export endpoint — no API key,
no password, nothing to install.

> Anyone who has that link can view your sheet. If that is not acceptable, use method 3.

---

## Method 2 — Public sheet + a Google Sheets API key (alternative)

Only useful if the gviz endpoint is blocked on your network.

1. Go to <https://console.cloud.google.com/apis/credentials>.
2. **Create credentials → API key**.
3. Enable **Google Sheets API** for the project (<https://console.cloud.google.com/apis/library/sheets.googleapis.com>).
4. In My CRM: **Settings → Google Sheet → Advanced**, paste the key and connect.

The key is stored in your browser and only works against sheets that are already public.

---

## Method 3 — Private sheet via Apps Script (recommended for business data)

Your sheet stays private. The script runs inside your own Google account and answers My CRM's
requests. Nothing is exposed publicly and no API key is needed.

### Step 1 — Add the script

1. Open your sheet.
2. **Extensions → Apps Script**.
3. Delete everything in the editor and paste the code from
   [`apps-script/Code.gs`](apps-script/Code.gs) in this repository.
4. (Optional) Set `SHEET_NAME` at the top to the tab you want to expose. Leave it `''` to read
   the first tab. If you also want My CRM to be able to write a lead's row back, set
   `ALLOW_WRITES = true`.

### Step 2 — Deploy it

1. Click **Deploy → New deployment**.
2. Select type **Web app**.
3. Set **Execute as: Me** and **Who has access: Anyone**.
4. Click **Deploy**, authorise the script (Google will warn that the app is unverified —
   choose **Advanced → Go to project (unsafe)**; it is your own script).
5. Copy the **Web app URL** — it ends with `/exec`.

### Step 3 — Connect it in My CRM

1. **Settings → Google Sheet → Advanced: private sheets**.
2. Paste the `/exec` URL into **Apps Script Web App URL**.
3. Leave the normal sheet link blank (or paste it too — My CRM prefers Apps Script when both
   are configured, and uses the link only as a fallback).
4. Press **Connect & Sync**.

### If you edit the script later

Apps Script requires a **new deployment version** for changes to take effect
(**Deploy → Manage deployments → Edit → Version: New version → Deploy**).

---

## Recommended sheet structure

Only **Name** is required. Everything else is mapped automatically, and any column order works.

| Column | CRM field | Notes |
|---|---|---|
| `Name` / `Full Name` | Lead Name | Required |
| `Phone` / `Contact Number` / `Mobile` | Phone | |
| `WhatsApp` | WhatsApp | Defaults to the phone number if blank |
| `Email` | Email | |
| `Course` / `Interested Course` | Course | Match the course names used in My CRM for cleaner insights |
| `City` | City | |
| `Source` / `Lead Source` | Source | Facebook, Instagram, WhatsApp, Website, Google, Referral… |
| `Status` | Status | New · Contacted · Interested · Follow-up · Hot · Converted · Not Interested · Lost |
| `Interest` / `Interest Level` | Interest | Cold · Warm · Hot |
| `Last Contact` | Last Contact | Date |
| `Next Follow-up` / `Follow Up Date` | Next Follow-up | Date — this drives the whole follow-up engine |
| `Notes` / `Remarks` | Notes | Free text |
| `Assigned To` | Assigned To | Team member name |
| `Follow-ups` | Follow-ups | Number of attempts |
| `Last Response` | Last Response | What the lead said last |

**Date formats accepted:** `05/09/2026` (day-first), `2026-09-05`, `5 Sep 2026`, `5-Jan-26`,
spreadsheet serial numbers, and the words `today`, `yesterday`, `tomorrow`. Unparseable dates
are ignored rather than breaking the import.

**Extra columns** you keep for your own purposes are preserved and shown in the lead profile —
My CRM never discards data it does not understand.

**Headers not in row 1?** Set **Header row number** in Settings → Google Sheet (for example
`3` if rows 1–2 are titles).

---

## Column mapping

After the first successful sync, every column in your sheet appears in
**Settings → Google Sheet → Column mapping**, pre-filled with My CRM's best guess:

| CRM field | Detected from the sheet |
|---|---|
| CRM *Lead Name* | Sheet column `Full Name` |
| CRM *Phone* | Sheet column `Contact Number` |
| CRM *Course* | Sheet column `Interested Course` |
| CRM *Next Follow-up* | Sheet column `Follow Up Date` |

Change any dropdown and press **Save mapping**. **Re-detect automatically** clears your manual
mapping and lets My CRM guess again on the next sync.

Press **Preview sheet & columns** to see the detected mapping, warnings and the first rows
before importing anything.

---

## Syncing

* **Sync Now** (sidebar, dashboard, alerts, or Settings) pulls the latest rows.
* My CRM reports exactly what changed: *"2 new · 1 updated · 15 unchanged (18 leads in the sheet)"*.
* **Auto-sync** (Settings → Google Sheet → Sync behaviour) refreshes every 5/15/30/60 minutes
  while the app is open, and skips while you are offline or the tab is hidden.
* **Change detection:** each row is hashed. Unchanged rows are skipped, so AI analysis is not
  re-run and no quota is wasted.
* **Merging is one-way by default.** The sheet owns the columns it defines; notes, timelines
  and AI suggestions created in My CRM stay on your device. Leads you add manually in My CRM
  are never deleted by a sync.
* **Safety net:** if a sync suddenly stops finding a large part of your leads (wrong tab or
  range), My CRM keeps them on your device and warns you instead of deleting them.

### Writing back to the sheet (optional, off by default)

Off unless you turn it on: **Settings → Google Sheet → Sync behaviour → Allow writing changes
back to the sheet**. It requires

* an Apps Script URL with `ALLOW_WRITES = true`, and
* a confirmation dialog **every single time** a cell is about to change.

My CRM never modifies your spreadsheet silently.

---

## Troubleshooting

| Symptom | Fix |
|---|---|
| *"Google refused to share this sheet"* | The sheet is private. Set sharing to **Anyone with the link – Viewer**, or use the Apps Script method. |
| *"The sheet could not be found"* | The link is for a different spreadsheet, or the file was deleted/moved. |
| *"Received an HTML login page instead of CSV"* | You are signed into multiple Google accounts; the export hit a login page. Use a private/incognito window, or the Apps Script method. |
| *"No header row was found"* | Increase **Header row number** in Settings → Google Sheet. |
| Dates import as blanks | The column is not a real date. Format it as a date in Sheets, or use `2026-09-05`. |
| Wrong tab imported | Set **Tab / sheet name**, or copy that tab's `gid` from its URL into the sheet link (`…edit#gid=123456`). |
| Leads appear twice | Duplicates are matched on the phone number (ignoring `+`, spaces, dashes and leading zeros). If a lead has no phone, matching falls back to email, then name+course+city. |
| Changes in the sheet do not appear | Press **Sync Now** — auto-sync is off by default, and it only runs while My CRM is open. |

Need the whole flow again? **Settings → Google Sheet → Import / connect wizard** does
share-check, header-row detection, mapping and import in one dialog.
