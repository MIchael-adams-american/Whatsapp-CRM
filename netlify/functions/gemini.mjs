/**
 * My CRM — Netlify serverless AI proxy.
 *
 * Keeps the Gemini API key on the server so it never reaches the browser.
 *
 * Setup:
 *   1. Netlify → Site configuration → Environment variables:
 *        GEMINI_API_KEY          = AIza…
 *        GEMINI_ALLOWED_ORIGIN   = https://your-site.netlify.app   (optional but recommended)
 *   2. Redeploy. The endpoint is /api/gemini (see netlify.toml redirect).
 *   3. In My CRM: Settings → AI & Gemini → Serverless AI proxy URL → https://your-site/api/gemini
 *
 * Accepts either the body My CRM sends:
 *   { model, contents, systemInstruction, generationConfig }
 * or a simplified one:
 *   { prompt, systemInstruction, model, temperature, maxOutputTokens }
 * and always answers { text } (plus the raw Gemini payload).
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

function corsHeaders(origin) {
  const allowed = process.env.GEMINI_ALLOWED_ORIGIN || '';
  const allowOrigin = allowed
    ? (origin === allowed ? origin : allowed)
    : (origin || '*');
  return {
    'Access-Control-Allow-Origin': allowOrigin,
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Content-Type': 'application/json',
    Vary: 'Origin',
  };
}

function json(body, status, origin) {
  return new Response(JSON.stringify(body), { status, headers: corsHeaders(origin) });
}

export default async function handler(request) {
  const origin = request.headers.get('origin') || '';

  if (request.method === 'OPTIONS') {
    return new Response('', { status: 204, headers: corsHeaders(origin) });
  }
  if (request.method !== 'POST') {
    return json({ error: 'Method not allowed. Use POST.' }, 405, origin);
  }

  const apiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;
  if (!apiKey) {
    return json({ error: 'The server is missing the GEMINI_API_KEY environment variable.' }, 500, origin);
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'Request body must be JSON.' }, 400, origin);
  }

  const model = String(body.model || DEFAULT_MODEL);
  if (!MODEL_PATTERN.test(model) || (!ALLOWED_MODELS.has(model) && process.env.GEMINI_ALLOW_UNLISTED_MODELS !== '1')) {
    return json({ error: `Model "${model}" is not allowed by this proxy.` }, 400, origin);
  }

  const contents = body.contents || (body.prompt
    ? [{ role: 'user', parts: [{ text: String(body.prompt) }] }]
    : null);

  if (!contents) {
    return json({ error: 'Request must include "contents" or "prompt".' }, 400, origin);
  }

  const promptLength = JSON.stringify(contents).length;
  if (promptLength > MAX_PROMPT_CHARS) {
    return json({ error: `Prompt too large (${promptLength} chars, limit ${MAX_PROMPT_CHARS}).` }, 413, origin);
  }

  const generationConfig = {
    ...(body.generationConfig || {}),
    temperature: clamp(body.generationConfig?.temperature ?? body.temperature ?? 0.7, 0, 2),
    maxOutputTokens: Math.min(body.generationConfig?.maxOutputTokens ?? body.maxOutputTokens ?? 1500, MAX_OUTPUT_TOKENS),
  };

  const systemInstruction = body.systemInstruction
    || (body.systemPrompt ? { parts: [{ text: String(body.systemPrompt) }] } : null);

  const payload = {
    contents,
    generationConfig,
    ...(systemInstruction ? { systemInstruction } : {}),
  };

  try {
    const response = await fetch(`${API_BASE}/${encodeURIComponent(model)}:generateContent`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
      body: JSON.stringify(payload),
    });

    const text = await response.text();
    let data;
    try { data = JSON.parse(text); } catch { data = null; }

    if (!response.ok) {
      const message = data?.error?.message || `Gemini returned HTTP ${response.status}`;
      return json({ error: message, status: response.status, detail: data?.error || null }, response.status, origin);
    }

    const parts = data?.candidates?.[0]?.content?.parts || [];
    const outText = parts.map((p) => p?.text || '').join('');
    return json({ text: outText, model, usage: data?.usageMetadata || null, raw: data }, 200, origin);
  } catch (error) {
    return json({ error: `Could not reach Gemini: ${error.message}` }, 502, origin);
  }
}

function clamp(value, min, max) {
  const n = Number(value);
  if (!Number.isFinite(n)) return min;
  return Math.min(max, Math.max(min, n));
}

export const config = { path: '/api/gemini' };
