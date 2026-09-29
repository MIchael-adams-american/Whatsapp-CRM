# My CRM

**A simple, AI-powered lead management and follow-up CRM for leads stored in Google Sheets.**

My CRM turns a plain spreadsheet into a dashboard that answers one question every morning:

> **Who do I need to contact today — and what should I say?**

No build step, no server, no database. It is a static web app that runs entirely in your
browser, reads your Google Sheet, and uses Google Gemini (with a built-in offline fallback)
as a sales assistant.

---

## What it does

| | |
|---|---|
| **Dashboard** | Calls today, follow-ups today, overdue, hot leads, new leads, no-response leads — each tile is clickable. |
| **Notifications & AI insights** | 🔴 3 follow-ups are overdue · 🟠 5 leads need follow-up today · 🔥 4 hot leads require attention · ⚠️ Ali has not replied for 8 days · 💡 NVQ leads never followed up · 📈 IOSH leads increased this week. Every alert opens the exact list of leads. |
| **Leads** | Table on desktop, cards on mobile. Filter by status, course, city, interest, source, follow-up date, last contacted and assigned person. Full text search plus smart keywords (`overdue`, `hot`, `today`, `no response`…). |
| **Lead profile** | Lead information, follow-up information, notes, activity timeline, AI recommendation, AI message generator, "what should I do next?" actions. |
| **AI Lead Analysis** | Current status, interest level, follow-up priority, recommended next action, suggested follow-up date, reason, and communication approach. |
| **AI Message Generator** | 8 styles (Friendly, Professional, Short WhatsApp, Follow-up, Reminder, Promotional, Re-engagement, Final follow-up) with **Copy Message**, **Regenerate**, **Make Shorter**, **Make More Professional** and **Send on WhatsApp**. |
| **Follow-ups** | Overdue / Today / Tomorrow / This week / Upcoming / No follow-up, plus a month calendar with per-day counts. |
| **Automatic follow-up intelligence** | Detects leads that were contacted but have no next follow-up ("⚠️ Follow-up Missing" → **Schedule Follow-up**). |
| **Daily AI Summary** | "Today you have 7 follow-ups. 3 are overdue. 2 leads are highly interested…" generated from your data, not from a full sheet dump. |
| **AI Marketing Insights** | Course/source/trend analysis: "Many leads are interested in IOSH but are not converting", "Your follow-up delay is high for leads contacted on weekends". |
| **Campaigns** | Pick course + audience + purpose → generate a WhatsApp campaign message with copy and per-lead send links. |
| **Demo mode** | 18 realistic sample leads covering every state, so the UI can be tested without connecting anything. |

### Priority is rule-based first, AI second

Every lead gets an explainable priority score (0–100) computed from interest level, status,
days since last contact, follow-up date, previous response, course interest, number of
follow-ups and whether the lead previously asked for information. The AI may add colour, but
it never silently overrides the CRM rules.

---

## Quick start

### Option A — open it locally (30 seconds)

```bash
git clone <your-repo-url> my-crm
cd my-crm
npx serve . -l 4173     # or: python3 -m http.server 4173
# open http://localhost:4173
```

My CRM boots into **demo mode** with 18 sample leads. Click around; nothing is connected yet.

> ES modules require the app to be served over `http://` — opening `index.html` directly from
> the file system will not work.

### Option B — deploy it (2 minutes)

| Host | What to do |
|---|---|
| **Netlify** | Drag the folder onto app.netlify.com/drop, or connect the repo — `netlify.toml` is already configured (publish directory `.`, no build command). |
| **Vercel** | `vercel --prod` (or import the repo). `vercel.json` is included; no build step. |
| **GitHub Pages** | Settings → Pages → Deploy from branch → root. Everything is relative-path based, so it works from a subfolder. |
| **Any static host** | Upload the folder. There is no backend to configure. |

Then:

1. **Settings → Google Sheet** → paste your sheet link → **Connect & Sync**
   (or upload a CSV, or keep using demo data).
2. **Settings → AI & Gemini** → paste a free Gemini API key → **Save & test connection**.
3. Press `/` anywhere to search, and start with the **Overdue** tile.

Full walkthroughs: [`docs/GOOGLE_SHEETS_SETUP.md`](docs/GOOGLE_SHEETS_SETUP.md) ·
[`docs/GEMINI_API_KEY.md`](docs/GEMINI_API_KEY.md) ·
[`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md) ·
[`docs/PRIVACY_AND_SECURITY.md`](docs/PRIVACY_AND_SECURITY.md)

---

## Google Sheet structure

Only **Name** is essential. Any column order works; My CRM maps the columns automatically and
remembers your corrections. This is the recommended layout:

| Name | Phone | WhatsApp | Email | Course | City | Source | Status | Interest | Last Contact | Next Follow-up | Notes | Assigned To | Follow-ups | Last Response |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Ahmed Raza | +92 300 1234567 | +92 300 1234567 | ahmed@example.com | NVQ Level 6 Diploma in OHS | Karachi | Facebook | Hot | Hot | 01/09/2026 | 05/09/2026 | Asked for fees | Ahmed | 3 | Send fee details |

* Dates can be `05/09/2026` (day-first), `2026-09-05` or `5 Sep 2026`.
* Statuses: New · Contacted · Interested · Follow-up · Hot · Converted · Not Interested · Lost
* Interest: Cold · Warm · Hot
* Extra columns are preserved (shown in the lead profile), never discarded.
* Download the example file: **Settings → Data & privacy → Download the demo sheet template**.

**Private sheets are supported** — use the Google Apps Script method in
[`docs/GOOGLE_SHEETS_SETUP.md`](docs/GOOGLE_SHEETS_SETUP.md) (3-minute copy/paste setup,
no API key, sheet stays private).

---

## Architecture

```
my-crm/
├── index.html                  # app shell (no build step)
├── css/styles.css              # design system: #2BAE66 / #FCF6F5, responsive
├── js/
│   ├── app.js                  # bootstrap: store → router → views, global search, auto-sync
│   ├── config.js               # statuses, courses, CRM fields, message styles, actions
│   ├── router.js               # hash router (#/leads?bucket=overdue …)
│   ├── lib/                    # date.js · utils.js · store.js · dom.js · bus.js
│   ├── domain/                 # pure business logic
│   │   ├── model.js            #   lead shape, normalisation, validation
│   │   ├── followup.js         #   overdue/today/upcoming + forgotten-lead detection
│   │   ├── priority.js         #   rule-based 0–100 priority score with reasons
│   │   ├── filters.js          #   one filter model + smart search keywords
│   │   ├── notifications.js    #   alert rules + local daily summary
│   │   ├── analytics.js        #   aggregates for insights (no personal data)
│   │   └── audience.js         #   campaign audience definitions
│   ├── services/               # side effects & integrations
│   │   ├── sheets.js           #   gviz → Sheets API → Apps Script adapters
│   │   ├── mapping.js          #   smart column mapping
│   │   ├── gemini.js           #   Gemini REST client + friendly error codes
│   │   ├── local-ai.js         #   offline equivalent of every AI feature
│   │   ├── ai.js               #   analysis, messages, summaries, campaigns + caching
│   │   └── actions.js          #   shared write operations (single mutation path)
│   ├── ui/                     # kit.js (toasts/modals/drawers) · components.js
│   ├── views/                  # dashboard · leads · lead-profile · followups ·
│   │                           # notifications · insights · campaigns · settings · lead-form
│   └── data/demo-data.js       # 18 realistic demo leads
├── docs/                       # setup, API key, deployment, privacy guides
│   └── apps-script/Code.gs     # private-sheet bridge (paste into Apps Script)
├── netlify/functions/gemini.mjs# optional serverless AI proxy (keeps the key server-side)
├── api/gemini.js               # same proxy for Vercel
└── tests/                      # logic + browser workflow tests
```

**Extension points for later** (WhatsApp Business API, email, Supabase/Firebase, auth, teams):
every read goes through `lib/store.js` + `services/actions.js`, every integration sits behind
`services/*`, and views never touch storage or the network directly. Swapping the
localStorage store for Supabase is a change in two files.

---

## Testing

```bash
node tests/run-tests.mjs   # 52 logic tests: dates, follow-ups, priority, filters, mapping, AI fallbacks
node tests/dom.test.mjs    # 35 browser workflow tests (needs jsdom: npm i --no-save jsdom)
```

The browser suite boots the real `index.html`, loads the demo data and walks through every
main workflow: dashboard, search, filters, calendar, bulk scheduling, lead profile, AI
message generation, copy, refinement, validation, sheet import (mocked), auth-style errors,
quota errors and unreadable data.

---

## Using it well

* **Start the day on the Dashboard.** Overdue first, then today's list, then new leads.
* **Rate interest honestly.** Priority, notifications and AI advice all key off it.
* **Always leave a next follow-up date.** The "Follow-up missing" panel will nag you otherwise —
  or use **Schedule follow-ups** to assign dates in one click.
* **Generate the message, then send it from your own WhatsApp.** My CRM never messages anyone
  on your behalf.
* **Sync rather than re-import** so notes, timelines and AI suggestions on this device survive.

## Privacy in one paragraph

Your leads, notes, API key and AI cache live in **your browser only**. There is no My CRM
server. Only single leads (trimmed to the fields the AI actually needs, names shortened to
"First L.") and aggregate counts are ever sent to Gemini — never your sheet, never your
contact list, never your customer conversations. **Settings → Data & privacy** exports a
backup and removes everything on demand.

## Roadmap (intentionally not built yet)

WhatsApp Business API automation · email integration · multi-user login & team assignment ·
Supabase/Firebase sync · sales pipeline view · AI call notes & conversation analysis ·
Google Calendar reminders.

## Licence

MIT — see the repository for details.
