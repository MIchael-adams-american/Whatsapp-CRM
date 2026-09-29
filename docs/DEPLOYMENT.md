# Deploying My CRM

My CRM is a **static site**: HTML, CSS and ES modules. There is no build step, no bundler and
no server-side code, so any static host works. Total size is under 300 KB.

```
index.html · css/ · js/ · docs/   →   deploy these
netlify/functions/ · api/         →   optional AI proxy (only if you want the key server-side)
tests/                            →   never deployed
```

---

## Netlify

**Drag & drop (fastest):**

1. Open <https://app.netlify.com/drop>.
2. Drag the project folder onto the page.
3. Done — the site is live on `https://something-random.netlify.app`.

**From Git (recommended):**

1. **Add new site → Import an existing project → GitHub**, pick your repository.
2. Build command: **leave empty**. Publish directory: **`.`** (a dot).
   `netlify.toml` already contains this, so Netlify should detect it automatically.
3. Deploy.

**Optional AI proxy:**

1. **Site configuration → Environment variables → Add**: `GEMINI_API_KEY = AIza…`
2. Optionally `GEMINI_ALLOWED_ORIGIN = https://your-site.netlify.app`.
3. Redeploy. The endpoint is `https://your-site.netlify.app/api/gemini`
   (redirect configured in `netlify.toml` → `netlify/functions/gemini.mjs`).
4. In My CRM: **Settings → AI & Gemini → Serverless AI proxy URL** and paste that URL.

---

## Vercel

**CLI:**

```bash
npm i -g vercel
cd my-crm
vercel            # preview
vercel --prod     # production
```

**Dashboard:** **Add New → Project → Import Git Repository** → Framework preset:
**Other** → Build command: empty → Output directory: `.` → Deploy.

`vercel.json` adds cache headers and clean URLs. The optional proxy lives at `api/gemini.js`
and is served automatically at `https://your-app.vercel.app/api/gemini` — set the
`GEMINI_API_KEY` environment variable to enable it.

---

## GitHub Pages

1. Push the project to GitHub.
2. **Settings → Pages → Build and deployment → Source: Deploy from a branch**,
   branch `main`, folder `/ (root)`, then **Save**.
3. The site appears at `https://<user>.github.io/<repo>/` within a minute.

All asset paths are relative (`./js/app.js`), so it works from a subfolder. The app uses hash
routing (`#/leads?...`), so **no SPA rewrite rules are needed** anywhere.

---

## Any other host

Upload the folder to any static host (Cloudflare Pages, S3 + CloudFront, Firebase Hosting,
Surge, a plain nginx directory…). Requirements:

* Serve `index.html` for the root path.
* Serve `.js` files with a JavaScript MIME type (every modern host does).
* HTTPS is recommended so the clipboard API works without a fallback.

Cloudflare Pages, for example: **Create project → Direct Upload**, drop the folder, deploy.

---

## Local development

```bash
npx serve . -l 4173          # or python3 -m http.server 4173
```

Then open <http://localhost:4173>. Always serve over HTTP — `file://` blocks ES modules.

Editing a file and refreshing is the whole development loop. There is no watcher to run.

### Running the tests before you deploy

```bash
node tests/run-tests.mjs                     # logic (no dependencies)
npm i --no-save jsdom && node tests/dom.test.mjs   # browser workflows
```

Both suites must pass before deploying. They cover the dashboard, search, filters, follow-up
detection, sheet import (mocked), AI fallbacks and error handling.

---

## First-run checklist after deploying

1. Open the site — demo mode loads automatically with 18 sample leads.
2. **Settings → Google Sheet** → paste your sheet link → **Connect & Sync**
   (see [`GOOGLE_SHEETS_SETUP.md`](GOOGLE_SHEETS_SETUP.md); use the Apps Script method if the
   sheet must stay private).
3. **Settings → AI & Gemini** → paste your key → **Save & test connection**
   (see [`GEMINI_API_KEY.md`](GEMINI_API_KEY.md); or deploy the proxy and skip the key).
4. **Settings → AI & Gemini → Your details** → set your name and institute so generated
   messages are signed correctly.
5. Optional: enable **auto-sync** and pick an interval.
6. Bookmark the site on your phone and use **Add to Home Screen** — the layout is fully
   responsive, with a bottom navigation bar on mobile.

---

## Things worth knowing

* **Each browser has its own data.** Leads, settings and the API key live in `localStorage` of
  that specific browser profile. Two devices do not share state — connect the same sheet on
  both, or export a JSON backup (**Settings → Data & privacy**) and keep it safe.
* **Private/incognito windows forget everything** when closed.
* **Updating the app is safe**: leads are stored under the `mycrm.v1.` prefix and survive
  redeploys. Clearing site data in the browser removes them.
* **No environment variables are needed** for the core app.
* **Custom domain:** set it in your host's dashboard; nothing in the app depends on the origin.
