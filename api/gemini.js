/**
 * My CRM — Vercel serverless AI proxy (Node runtime).
 *
 * Keeps the Gemini API key on the server so it never reaches the browser.
 *
 * Setup:
 *   1. Vercel → Project → Settings → Environment Variables:
 *        GEMINI_API_KEY         = AIza…
 *        GEMINI_ALLOWED_ORIGIN  = https://your-app.vercel.app   (optional but recommended)
 *   2. Redeploy. The endpoint is https://your-app.vercel.app/api/gemini
 *   3. In My CRM: Settings → AI & Gemini → Serverless AI proxy URL → that URL.
 *
 * Mirrors netlify/functions/gemini.mjs: same request body, same { text } response.
 */

const DEFAULT_MODEL = 'gemini-2.0-flash';
const API_BASE = 'https://generativelanguage.googleapis.com/v1beta/models';
const MAX_PROMPT_CHARS = 20000;
const MAX_OUTPUT_TOKENS = 4096;
const MODEL_PATTERN = /^[a-z0-9.\-]{3,60}$/i;
const ALLOWED_MODELS = new Set([
  'gemini-2.0-flash', 'gemini-2.0-flash-001', 'gemini-2.0-flash-lite',
  'gemini-2.5-flash', 'gemini-2.5-flash-lite', 'gemini-2.5-pro',
  'gemini-flash-latest', 'gemini-pro-latest',
]);

function cors(origin) {
  const allowed = process.env.GEMINI_ALLOWED_ORIGIN || '';
  return {
    'Access-Control-Allow-Origin': allowed ? (origin === allowed ? origin : allowed) : (origin || '*'),
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    Vary: 'Origin',
  };
}

function clamp(value, min, max) {
  const n = Number(value);
  if (!Number.isFinite(n)) return min;
  return Math.min(max, Math.max(min, n));
}

export default async function handler(req, res) {
  const origin = req.headers.origin || '';
  for (const [key, value] of Object.entries(cors(origin))) res.setHeader(key, value);

  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed. Use POST.' });

  const apiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: 'The server is missing the GEMINI_API_KEY environment variable.' });
  }

  const body = typeof req.body === 'string' ? safeParse(req.body) : (req.body || {});
  if (!body || typeof body !== 'object') return res.status(400).json({ error: 'Request body must be JSON.' });

  const model = String(body.model || DEFAULT_MODEL);
  if (!MODEL_PATTERN.test(model) || (!ALLOWED_MODELS.has(model) && process.env.GEMINI_ALLOW_UNLISTED_MODELS !== '1')) {
    return res.status(400).json({ error: `Model "${model}" is not allowed by this proxy.` });
  }

  const contents = body.contents || (body.prompt
    ? [{ role: 'user', parts: [{ text: String(body.prompt) }] }]
    : null);
  if (!contents) return res.status(400).json({ error: 'Request must include "contents" or "prompt".' });

  const size = JSON.stringify(contents).length;
  if (size > MAX_PROMPT_CHARS) {
    return res.status(413).json({ error: `Prompt too large (${size} chars, limit ${MAX_PROMPT_CHARS}).` });
  }

  const generationConfig = {
    ...(body.generationConfig || {}),
    temperature: clamp(body.generationConfig?.temperature ?? body.temperature ?? 0.7, 0, 2),
    maxOutputTokens: Math.min(body.generationConfig?.maxOutputTokens ?? body.maxOutputTokens ?? 1500, MAX_OUTPUT_TOKENS),
  };
  const systemInstruction = body.systemInstruction
    || (body.systemPrompt ? { parts: [{ text: String(body.systemPrompt) }] } : null);

  try {
    const response = await fetch(`${API_BASE}/${encodeURIComponent(model)}:generateContent`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
      body: JSON.stringify({ contents, generationConfig, ...(systemInstruction ? { systemInstruction } : {}) }),
    });

    const text = await response.text();
    const data = safeParse(text);

    if (!response.ok) {
      return res.status(response.status).json({
        error: data?.error?.message || `Gemini returned HTTP ${response.status}`,
        detail: data?.error || null,
      });
    }

    const parts = data?.candidates?.[0]?.content?.parts || [];
    const outText = parts.map((p) => p?.text || '').join('');
    return res.status(200).json({ text: outText, model, usage: data?.usageMetadata || null, raw: data });
  } catch (error) {
    return res.status(502).json({ error: `Could not reach Gemini: ${error.message}` });
  }
}

function safeParse(text) {
  try { return JSON.parse(text); } catch { return null; }
}

export const config = { api: { bodyParser: { sizeLimit: '1mb' } } };
