# Privacy & security

Lead data is private business data. This page explains exactly what My CRM stores, what leaves
your browser, and how to remove everything.

---

## 1. Where your data lives

There is **no My CRM server**. When you deploy this app you are hosting static files; all data
stays in the browser that uses it.

| Data | Stored where | Cleared by |
|---|---|---|
| Leads, notes, timelines, AI suggestions | `localStorage` (`mycrm.v1.leads`) | Settings → Data & privacy → *Delete all leads* |
| Google Sheet connection + column mapping | `localStorage` (`mycrm.v1.sheet`) | *Disconnect sheet* / *Remove stored configuration* |
| Gemini API key, model, your name/institute | `localStorage` (`mycrm.v1.settings`) | *Remove key* / *Remove stored configuration* |
| AI cache (analyses, messages, summaries) | `localStorage` (`mycrm.v1.aiCache`) | *Clear AI cache* / *Remove stored configuration* |
| Activity log (last 50 app events, in memory) | `sessionStorage`-style memory | Closing the tab |

No cookies, no analytics, no tracking pixels, no third-party scripts. The only external
requests My CRM makes are:

1. **Google Sheets** — `docs.google.com` (gviz CSV) and `sheets.googleapis.com` (API) when you
   connect a sheet, and your own Apps Script URL if you use that method.
2. **Google Gemini** — `generativelanguage.googleapis.com` when you ask for AI output, or your
   own proxy endpoint if you configured one.

You can verify this yourself: open the browser's Network tab.

---

## 2. What is shared with the AI

My CRM deliberately **never sends your dataset**. It sends only what a single request needs:

| Request | Sent |
|---|---|
| Lead analysis | One lead, trimmed to: shortened name, course, status, interest, city, source, last-contact wording, days since contact, next follow-up wording, follow-up status, follow-up count, last response (max 140 chars), notes (max 300 chars). |
| Message generation / refinement | The same lead fields plus your style choice and the current draft. |
| Daily summary | Overdue/due-today counts, totals, and up to 6 highest-priority leads in the trimmed form above. |
| Marketing insights | **Aggregate counts only**: totals, conversion rate, per-course totals, source mix, follow-up delays. No names, numbers or emails. |
| Campaign messages | Course name/details, audience size and audience type. |

**Never sent:** your spreadsheet, phone numbers, email addresses, full contact lists,
passwords, API keys, other leads' data, or any data at all when you are not using an AI feature.

The **"Send the minimum lead data to the AI"** setting (on by default) shortens `Ali Hassan` to
`Ali H.` and trims long notes. Turn it off only if you want the AI to see full names.

Caching means the same lead is not sent twice: analyses and messages are keyed by a signature of
the lead's fields, so nothing is re-sent until the lead actually changes.

---

## 3. API keys

**Do not hard-code keys.** My CRM never ships with a key, and the tests assert that no key-like
string exists in the source.

**Browser-side keys (MVP default).** The key you paste into Settings is stored in
`localStorage` and sent directly to Google in an `x-goog-api-key` header. This is acceptable
when you are the only user of that browser profile. It is **not** safe on a shared machine or a
publicly shared deployment, because anything in `localStorage` can be read by whoever has
access to the browser.

**Server-side keys (recommended for anything shared).** Deploy the included proxy and put the
key in an environment variable:

* Netlify → `netlify/functions/gemini.mjs` (route `/api/gemini`)
* Vercel → `api/gemini.js` (route `/api/gemini`)

Then set **Settings → AI & Gemini → Serverless AI proxy URL**. The browser stops handling the
key entirely. See [`GEMINI_API_KEY.md`](GEMINI_API_KEY.md) §5.

**If a key leaks:** delete it in Google AI Studio / Google Cloud and create a new one. Nothing
in My CRM needs to change except the value you paste.

---

## 4. Google Sheet sharing

Method 1 (public link) makes your sheet readable by anyone who has the URL — convenient, but not
appropriate for customer data you consider confidential. Method 3 (Apps Script) keeps the sheet
private: only your own Google account can read it, and My CRM talks to your script instead.

> **Do not** share a sheet publicly if it contains payment details, identity documents or
> anything regulated. Use the Apps Script method.

Row-level data you import lands in the browser cache, so use a device you control, and use
**Remove stored configuration** before handing a device to somebody else.

---

## 5. Logging and errors

* Errors are logged to your own browser console (`[my crm] …`). Nothing is sent anywhere.
* The friendly error messages shown in the UI never include lead details, only the type of
  problem ("Google refused to share this sheet", "Your Gemini API key was rejected").
* The AI cache stores generated text (messages/analyses) in `localStorage`. It can contain lead
  names, so clear it before sharing a device.
* No customer information is written to any URL, query string or referrer.

---

## 6. Removing your data

**Settings → Data & privacy:**

* **Export all data (JSON backup)** — downloads settings, sheet configuration and every lead
  (the API key is replaced with `***REDACTED***` in the export).
* **Export leads as CSV** — spreadsheet-friendly copy of your leads.
* **Load demo data** — replaces the local list with 18 sample leads.
* **Delete all leads on this device** — clears leads only.
* **Clear AI cache** (Settings → AI & Gemini) — removes cached AI text.
* **Disconnect Google Sheet & remove stored configuration** — removes *everything* My CRM
  stored: leads, settings, key, cache and the sheet connection. Nothing survives except files
  you exported.

Removing data in My CRM never touches your Google Sheet.

---

## 7. Security notes for reviewers

* All user-supplied content is written through `textContent` / `createElement` — there is no
  `innerHTML` with lead data anywhere in the codebase, so a hostile cell in your sheet cannot
  inject script.
* The app sends `X-Content-Type-Options: nosniff` and `Referrer-Policy: strict-origin-when-cross-origin`
  headers on Netlify (see `netlify.toml`) and Vercel (`vercel.json`).
* The optional proxy validates the model, caps prompt and `maxOutputTokens` sizes, restricts
  CORS to your own origin, and never echoes the API key.
* No dependency supply chain: the application has zero runtime npm dependencies.

Report a security issue by opening an issue in the repository — please avoid posting
reproduction data that contains real customer information.
