// OpenRouter LLM provider. OpenAI-compatible chat completions API.
// https://openrouter.ai/api/v1/chat/completions
//
// Set OPENROUTER_API_KEY in config (via `elora-voss set-key openrouter YOUR_KEY`).
// Optionally set OPENROUTER_MODEL in preferences (default: anthropic/claude-3.5-sonnet).
// Optional headers (HTTP-Referer / X-Title) can be set via openrouter_referer /
// openrouter_title config keys, or via the OPENROUTER_HTTP_REFERER / OPENROUTER_TITLE
// environment variables.
import { getKey } from './config.js';

const ENDPOINT = 'https://openrouter.ai/api/v1/chat/completions';
export const DEFAULT_MODEL = 'anthropic/claude-3.5-sonnet';

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
  const apiKey = getKey('openrouter');
  if (!apiKey) {
    throw new Error('Missing OpenRouter API key. Run: elora-voss set-key openrouter YOUR_KEY');
  }

  const messages = [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: userPrompt },
  ];

  const body = {
    model: opts.model || DEFAULT_MODEL,
    messages,
    temperature: opts.temperature ?? 0.7,
    max_tokens: opts.maxTokens ?? 4096,
  };
  if (opts.jsonMode) body.response_format = { type: 'json_object' };

  const headers = {
    Authorization: `Bearer ${apiKey}`,
    'Content-Type': 'application/json',
  };
  const referer = getKey('openrouter_referer') || process.env.OPENROUTER_HTTP_REFERER;
  const title = getKey('openrouter_title') || process.env.OPENROUTER_TITLE || 'elora-voss';
  if (referer) headers['HTTP-Referer'] = referer;
  headers['X-Title'] = title;

  const res = await fetch(ENDPOINT, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`OpenRouter ${res.status}: ${text.slice(0, 300)}`);
  }

  const data = await res.json();
  return data.choices?.[0]?.message?.content ?? '';
}

/** @returns {string} */
export function defaultModel() {
  return DEFAULT_MODEL;
}

const MODELS_ENDPOINT = 'https://openrouter.ai/api/v1/models';

/**
 * Fetch available models from OpenRouter.
 * @returns {Promise<Array<{id: string, name: string, context_length: number}>>}
 */
export async function listModels() {
  const res = await fetch(MODELS_ENDPOINT);
  if (!res.ok) {
    throw new Error(`OpenRouter models ${res.status}: ${(await res.text()).slice(0, 200)}`);
  }
  const data = await res.json();
  return (data.data || []).map((m) => ({
    id: m.id,
    name: m.name || m.id,
    context_length: m.context_length || 0,
  })).sort((a, b) => a.id.localeCompare(b.id));
}