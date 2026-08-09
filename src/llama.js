// Local LLM provider. Talks OpenAI-compatible chat completions to any local
// llama.cpp / ollama / LM Studio / vLLM server. No API key required; the
// "key" entry in config is treated as an optional bearer token (most local
// servers don't need one, but some front it with one for auth).
//
// Configure the endpoint via preferences:
//
//   MODEL_PROVIDER=llama
//   LLAMA_BASE_URL=http://127.0.0.1:8080/v1     # default; works for llama.cpp server, LM Studio, vLLM
//   # LLAMA_BASE_URL=http://127.0.0.1:11434/v1  # ollama's OpenAI-compat shim
//   LLAMA_MODEL=llama3.1                       # default; set whatever your server exposes
//
// The model list is fetched live from {LLAMA_BASE_URL}/models (OpenAI-compatible).
// If the server doesn't expose that endpoint, the picker falls back to a
// "type model id manually" entry — and the explicit LLAMA_MODEL is used.
import { getKey } from './config.js';
import { readPreferences } from './fs/workspace.js';

export const DEFAULT_MODEL = 'llama3.1';
export const DEFAULT_BASE_URL = 'http://127.0.0.1:8080/v1';
export const DEFAULT_HOST = '127.0.0.1';
export const DEFAULT_PORT = 8080;

/**
 * @typedef {object} LlamaEndpoint
 * @property {string} host
 * @property {number} port
 * @property {string} baseUrl
 */

/**
 * @param {string} [raw]
 * @returns {{host: string, port: number, baseUrl: string}}
 */
export function parseBaseUrl(raw) {
  const fallback = { host: DEFAULT_HOST, port: DEFAULT_PORT, baseUrl: DEFAULT_BASE_URL };
  if (!raw) return fallback;
  try {
    const u = new URL(raw);
    const port = u.port ? parseInt(u.port, 10) : (u.protocol === 'https:' ? 443 : 80);
    // Always expose the OpenAI-compat /v1 path. llama.cpp / LM Studio / vLLM /
    // ollama all live under /v1 for chat completions.
    const path = u.pathname && u.pathname !== '/' ? u.pathname.replace(/\/+$/, '') : '/v1';
    return {
      host: u.hostname || DEFAULT_HOST,
      port: Number.isFinite(port) ? port : DEFAULT_PORT,
      baseUrl: `${u.protocol}//${u.hostname}${port ? `:${port}` : ''}${path}`,
    };
  } catch {
    return fallback;
  }
}

/**
 * Resolve the configured endpoint, with precedence:
 *   1. llama_base_url in ./config
 *   2. LLAMA_BASE_URL in preferences
 *   3. LLAMA_HOST / LLAMA_PORT in preferences
 *   4. defaults
 * @returns {{host: string, port: number, baseUrl: string}}
 */
export function endpoint() {
  const fromConfig = getKey('llama_base_url');
  if (fromConfig) return parseBaseUrl(fromConfig);
  const prefs = readPreferences();
  if (prefs.LLAMA_BASE_URL) return parseBaseUrl(prefs.LLAMA_BASE_URL);
  if (prefs.LLAMA_HOST || prefs.LLAMA_PORT) {
    const host = (prefs.LLAMA_HOST || DEFAULT_HOST).trim();
    const port = parseInt(String(prefs.LLAMA_PORT || DEFAULT_PORT), 10);
    const safePort = Number.isFinite(port) && port > 0 && port < 65536 ? port : DEFAULT_PORT;
    return { host, port: safePort, baseUrl: `http://${host}:${safePort}/v1` };
  }
  return { host: DEFAULT_HOST, port: DEFAULT_PORT, baseUrl: DEFAULT_BASE_URL };
}

/** @returns {string} the base URL the provider is configured to hit */
export function baseUrl() {
  return endpoint().baseUrl;
}

/**
 * @param {string} systemPrompt
 * @param {string} userPrompt
 * @param {object} [opts]
 * @param {string} [opts.model]
 * @param {number} [opts.temperature]
 * @param {number} [opts.maxTokens]
 * @param {boolean} [opts.jsonMode]
 * @returns {Promise<string>}
 */
export async function chat(systemPrompt, userPrompt, opts = {}) {
  const prefs = readPreferences();
  const model = opts.model || prefs.LLAMA_MODEL || DEFAULT_MODEL;
  const url = `${baseUrl()}/chat/completions`;

  const messages = [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: userPrompt },
  ];

  const body = {
    model,
    messages,
    temperature: opts.temperature ?? 0.7,
    max_tokens: opts.maxTokens ?? 4096,
  };
  if (opts.jsonMode) body.response_format = { type: 'json_object' };

  const headers = { 'Content-Type': 'application/json' };
  const apiKey = getKey('llama');
  if (apiKey) headers.Authorization = `Bearer ${apiKey}`;

  let res;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    });
  } catch (err) {
    throw new Error(
      `could not reach local llama at ${url}\n` +
      `  ${err && err.message ? err.message : String(err)}\n` +
      `  Is your local server running? ` +
      `(llama.cpp: ./server -m model.gguf --port 8080, ` +
      `ollama: ollama serve, ` +
      `LM Studio: enable the local server in the Developer tab)\n` +
      `  To change the URL, set LLAMA_BASE_URL in preferences.txt ` +
      `or run: elora-voss preferences`
    );
  }

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`local llama ${res.status} at ${url}: ${text.slice(0, 300)}`);
  }

  const data = await res.json();
  return data.choices?.[0]?.message?.content ?? '';
}

/** @returns {string} */
export function defaultModel() {
  const m = readPreferences().LLAMA_MODEL;
  return m || DEFAULT_MODEL;
}

/**
 * Fetch available models from the local server's OpenAI-compatible /models endpoint.
 * Returns [] if the server doesn't expose it (older llama.cpp server). The
 * wizard handles the empty list gracefully via its "type manually" path.
 * @returns {Promise<Array<{id: string, name: string}>>}
 */
export async function listModels() {
  const url = `${baseUrl()}/models`;
  const headers = {};
  const apiKey = getKey('llama');
  if (apiKey) headers.Authorization = `Bearer ${apiKey}`;

  let res;
  try {
    res = await fetch(url, { headers });
  } catch (err) {
    throw new Error(
      `could not reach local llama at ${url}\n` +
      `  ${err && err.message ? err.message : String(err)}\n` +
      `  Is your local server running? ` +
      `(llama.cpp: ./server -m model.gguf --port 8080, ` +
      `ollama: ollama serve, ` +
      `LM Studio: enable the local server in the Developer tab)\n` +
      `  To change the URL, set LLAMA_BASE_URL in preferences.txt ` +
      `or run: elora-voss preferences`
    );
  }
  if (!res.ok) {
    throw new Error(`local llama models ${res.status} at ${url}: ${(await res.text()).slice(0, 200)}`);
  }
  const data = await res.json();
  return (data.data || []).map((m) => ({
    id: m.id,
    name: m.id,
  })).sort((a, b) => a.id.localeCompare(b.id));
}

/**
 * Quick reachability check used by `elora-voss doctor`. Hits /models and
 * returns a short status string.
 * @returns {Promise<string>}
 */
export async function ping() {
  const models = await listModels();
  return `local llama reachable · ${baseUrl()} · ${models.length} model${models.length === 1 ? '' : 's'}`;
}
