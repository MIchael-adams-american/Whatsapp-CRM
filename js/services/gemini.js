/**
 * Gemini API client.
 *
 * Two modes:
 *  1. Direct browser call with a user-supplied API key (fine for an MVP used by
 *     one person on one machine, NOT recommended for production — see the
 *     Settings page and docs/PRIVACY_AND_SECURITY.md).
 *  2. Optional serverless proxy (`aiProxyUrl`) which keeps the key on the server.
 *
 * Every failure is mapped to a friendly, actionable error code so the CRM can
 * keep working when the AI is unavailable (section 15 / 26).
 */

const API_BASE = 'https://generativelanguage.googleapis.com/v1beta/models';
const DEFAULT_TIMEOUT = 45000;

export class AiError extends Error {
  constructor(code, message, { retryable = false, status = 0, detail = '' } = {}) {
    super(message);
    this.name = 'AiError';
    this.code = code;
    this.friendly = message;
    this.retryable = retryable;
    this.status = status;
    this.detail = detail;
  }
}

const ERROR_MESSAGES = {
  'no-key': 'No Gemini API key configured. Add one in Settings → AI, or keep using local (offline) suggestions.',
  'invalid-key': 'Your Gemini API key was rejected. Check the key in Settings → AI — it should start with "AIza".',
  'key-restricted': 'This API key is not allowed to use the Gemini API. Create a new key in Google AI Studio and enable the Generative Language API.',
  'rate-limit': 'Gemini is rate limiting requests right now. Wait a few seconds and try again.',
  quota: 'Your Gemini API quota is used up. Add billing to your Google AI Studio project or try again later — the CRM keeps working without AI.',
  blocked: 'Gemini declined to answer this request (safety filter). Try rephrasing the request.',
  network: 'Could not reach Gemini. Check your internet connection — your CRM data is safe and unaffected.',
  timeout: 'Gemini took too long to respond. Please try again.',
  server: 'Gemini is temporarily unavailable. Please try again in a moment.',
  'bad-request': 'Gemini rejected the request format. If this keeps happening, reset the AI settings in Settings → AI.',
  parse: 'Gemini returned a response that could not be read. Please try again.',
  offline: 'You appear to be offline. AI features are unavailable until you reconnect.',
  proxy: 'The AI proxy endpoint did not respond correctly. Check the proxy URL in Settings → AI.',
};

function aiError(code, extra = {}) {
  return new AiError(code, ERROR_MESSAGES[code] || 'AI request failed.', extra);
}

/** True when the browser reports no network. */
export function isOffline() {
  return typeof navigator !== 'undefined' && navigator.onLine === false;
}

export function isConfigured(settings = {}) {
  return Boolean((settings.aiProxyUrl || '').trim() || (settings.geminiApiKey || '').trim());
}

export function aiStatus(settings = {}) {
  if (!isConfigured(settings)) {
    return {
      ok: false,
      code: 'no-key',
      label: 'AI off — using built-in suggestions',
      hint: 'Add a Gemini API key in Settings → AI to unlock live AI analysis and messages.',
    };
  }
  if (isOffline()) {
    return { ok: false, code: 'offline', label: 'Offline — built-in suggestions active', hint: ERROR_MESSAGES.offline };
  }
  const usingProxy = Boolean((settings.aiProxyUrl || '').trim());
  return {
    ok: true,
    code: 'ready',
    label: usingProxy ? `AI ready (proxy · ${settings.geminiModel || 'gemini-2.0-flash'})` : `AI ready (${settings.geminiModel || 'gemini-2.0-flash'})`,
    hint: usingProxy
      ? 'Requests are sent through your own proxy endpoint — the API key never reaches the browser.'
      : 'Requests go directly from this browser to Google using your locally stored key.',
  };
}

/**
 * Send one prompt to Gemini and return the raw text response.
 * @returns {Promise<{text:string, model:string, usage:object|null}>}
 */
export async function generateContent({
  prompt,
  systemInstruction = '',
  responseSchema = null,
  temperature = 0.7,
  maxOutputTokens = 1500,
  settings = {},
  signal = null,
} = {}) {
  if (isOffline()) throw aiError('offline');

  const model = (settings.geminiModel || 'gemini-2.0-flash').trim();
  const proxyUrl = (settings.aiProxyUrl || '').trim();
  const apiKey = (settings.geminiApiKey || '').trim();

  if (!proxyUrl && !apiKey) throw aiError('no-key');

  const payload = {
    model,
    contents: [{ role: 'user', parts: [{ text: prompt }] }],
    generationConfig: {
      temperature,
      maxOutputTokens,
      responseMimeType: responseSchema ? 'application/json' : 'text/plain',
      ...(responseSchema ? { responseSchema } : {}),
    },
  };
  if (systemInstruction) {
    payload.systemInstruction = { parts: [{ text: systemInstruction }] };
  }

  const target = proxyUrl
    ? { url: proxyUrl, headers: { 'Content-Type': 'application/json' } }
    : { url: `${API_BASE}/${encodeURIComponent(model)}:generateContent`, headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey } };

  const body = proxyUrl ? JSON.stringify(payload) : JSON.stringify({
    contents: payload.contents,
    generationConfig: payload.generationConfig,
    ...(payload.systemInstruction ? { systemInstruction: payload.systemInstruction } : {}),
  });

  let lastError = null;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const response = await fetchWithTimeout(target.url, {
        method: 'POST',
        headers: target.headers,
        body,
        signal,
      }, DEFAULT_TIMEOUT);

      const text = await response.text();
      const json = safeJson(text);

      if (!response.ok) {
        throw mapHttpError(response, json);
      }

      if (!json) throw aiError('parse', { status: response.status, detail: text.slice(0, 300) });

      if (proxyUrl && typeof json.text === 'string') {
        return { text: json.text, model, usage: json.usage || null };
      }

      const candidate = Array.isArray(json.candidates) ? json.candidates[0] : null;
      const parts = candidate?.content?.parts || [];
      const outText = parts.map((p) => p?.text || '').join('').trim();

      if (!outText) {
        if (candidate?.finishReason === 'SAFETY' || json.promptFeedback?.blockReason) throw aiError('blocked');
        throw aiError('parse', { detail: JSON.stringify(json).slice(0, 300) });
      }

      if (candidate?.finishReason === 'SAFETY') throw aiError('blocked');

      return { text: outText, model, usage: json.usageMetadata || null };
    } catch (error) {
      lastError = normalizeError(error);
      const canRetry = lastError.retryable && attempt === 0;
      if (!canRetry) break;
      await sleep(800 + attempt * 700);
    }
  }

  throw lastError || aiError('server');
}

function mapHttpError(response, json) {
  const status = response.status;
  const apiMessage = json?.error?.message || '';
  const reason = json?.error?.status || '';

  if (status === 400) {
    if (/API key not valid|API_KEY_INVALID/i.test(apiMessage)) return aiError('invalid-key', { status, detail: apiMessage });
    return aiError('bad-request', { status, detail: apiMessage });
  }
  if (status === 401 || status === 403) {
    if (/API key not valid|API_KEY_INVALID/i.test(apiMessage)) return aiError('invalid-key', { status, detail: apiMessage });
    if (/PERMISSION_DENIED|has not been used|disabled/i.test(apiMessage + reason)) return aiError('key-restricted', { status, detail: apiMessage });
    return aiError('key-restricted', { status, detail: apiMessage });
  }
  if (status === 404) return aiError('bad-request', { status, detail: `Model not found: ${apiMessage}` });
  if (status === 429) {
    if (/quota|RESOURCE_EXHAUSTED/i.test(apiMessage + reason) && /per day|daily/i.test(apiMessage)) {
      return aiError('quota', { status, detail: apiMessage });
    }
    return aiError('rate-limit', { status, retryable: true, detail: apiMessage });
  }
  if (status >= 500) return aiError('server', { status, retryable: true, detail: apiMessage });
  return aiError('server', { status, retryable: true, detail: apiMessage });
}

function normalizeError(error) {
  if (error instanceof AiError) return error;
  if (error?.name === 'AbortError') return aiError('timeout', { retryable: true });
  if (error instanceof TypeError) return aiError('network', { retryable: true, detail: error.message });
  return aiError('server', { retryable: true, detail: String(error?.message || error) });
}

async function fetchWithTimeout(url, options, timeout) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  const external = options.signal;
  const onExternalAbort = () => controller.abort();
  if (external) {
    if (external.aborted) controller.abort();
    else external.addEventListener('abort', onExternalAbort, { once: true });
  }
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
    if (external) external.removeEventListener('abort', onExternalAbort);
  }
}

function safeJson(text) {
  try { return JSON.parse(text); } catch { return null; }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Extract a JSON object from a model response, tolerating markdown fences and
 * surrounding prose.
 */
export function extractJson(text) {
  if (!text) return null;
  const trimmed = String(text).trim();

  const direct = safeJson(trimmed);
  if (direct && typeof direct === 'object') return direct;

  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced) {
    const inner = safeJson(fenced[1].trim());
    if (inner && typeof inner === 'object') return inner;
  }

  const start = trimmed.indexOf('{');
  const end = trimmed.lastIndexOf('}');
  if (start !== -1 && end > start) {
    const candidate = safeJson(trimmed.slice(start, end + 1));
    if (candidate && typeof candidate === 'object') return candidate;
  }
  return null;
}

/**
 * Verify a key by asking Gemini for a tiny response.
 * @returns {Promise<{ok:boolean, message:string, code?:string}>}
 */
export async function testConnection(settings = {}) {
  try {
    const { text, model } = await generateContent({
      prompt: 'Reply with exactly: OK',
      temperature: 0,
      maxOutputTokens: 12,
      settings,
    });
    return { ok: true, message: `Connected to ${model}. Response: "${text.slice(0, 40)}".` };
  } catch (error) {
    const err = normalizeError(error);
    return { ok: false, code: err.code, message: err.friendly };
  }
}
