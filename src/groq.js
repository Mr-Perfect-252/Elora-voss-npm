// LLM dispatcher. Picks between Groq, OpenRouter, and a local llama server
// based on the MODEL_PROVIDER preference (defaults to "groq"). All three
// providers expose the same `chat()` shape so the rest of the codebase never
// has to care which one is active.
//
//   elora-voss set-key groq        YOUR_KEY       # Groq (default, cloud, free tier)
//   elora-voss set-key openrouter  YOUR_KEY       # OpenRouter (cloud, many models)
//   elora-voss set-key llama       OPTIONAL_TOKEN # Local llama.cpp / ollama / LM Studio
//
// In preferences.txt:
//
//   MODEL_PROVIDER=groq | openrouter | llama
//   OPENROUTER_MODEL=anthropic/claude-3.5-sonnet   # optional override
//   GROQ_MODEL=llama-3.3-70b-versatile             # optional override
//   LLAMA_BASE_URL=http://127.0.0.1:8080/v1        # optional override
//   LLAMA_MODEL=llama3.1                           # optional override

import Groq from 'groq-sdk';
import { getKey, listKeys } from './config.js';
import { readPreferences } from './fs/workspace.js';
import * as openrouter from './openrouter.js';
import * as llama from './llama.js';

const DEFAULT_GROQ_MODEL = 'llama-3.3-70b-versatile';
const DEFAULT_OPENROUTER_MODEL = openrouter.DEFAULT_MODEL;
const DEFAULT_LLAMA_MODEL = llama.DEFAULT_MODEL;

let _groqClient = null;

function groqClient() {
  if (_groqClient) return _groqClient;
  const key = getKey('groq');
  if (!key) throw new Error('Missing Groq API key. Run: elora-voss set-key groq YOUR_KEY');
  _groqClient = new Groq({ apiKey: key });
  return _groqClient;
}

function pickProvider() {
  const prefs = readPreferences();
  const pref = String(prefs.MODEL_PROVIDER || '').toLowerCase();
  if (pref === 'openrouter') return 'openrouter';
  if (pref === 'llama') return 'llama';
  if (pref === 'groq') return 'groq';
  // Default: prefer OpenRouter if its key is set and groq is not.
  const keys = listKeys();
  if (keys.openrouter && !keys.groq) return 'openrouter';
  return 'groq';
}

function currentProvider() {
  const p = pickProvider();
  if (p === 'openrouter') {
    if (!getKey('openrouter')) {
      throw new Error('MODEL_PROVIDER=openrouter but no openrouter key set. Run: elora-voss set-key openrouter YOUR_KEY');
    }
    return 'openrouter';
  }
  if (p === 'llama') {
    // Local llama needs no key, only a reachable base URL. The actual call
    // will surface a clearer network error if the server isn't running.
    return 'llama';
  }
  if (!getKey('groq')) {
    throw new Error('Missing Groq API key. Run: elora-voss set-key groq YOUR_KEY');
  }
  return 'groq';
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
  const provider = currentProvider();
  if (provider === 'openrouter') {
    const prefs = readPreferences();
    return openrouter.chat(systemPrompt, userPrompt, {
      model: opts.model || prefs.OPENROUTER_MODEL || DEFAULT_OPENROUTER_MODEL,
      temperature: opts.temperature,
      maxTokens: opts.maxTokens,
      jsonMode: opts.jsonMode,
    });
  }
  if (provider === 'llama') {
    const prefs = readPreferences();
    return llama.chat(systemPrompt, userPrompt, {
      model: opts.model || prefs.LLAMA_MODEL || DEFAULT_LLAMA_MODEL,
      temperature: opts.temperature,
      maxTokens: opts.maxTokens,
      jsonMode: opts.jsonMode,
    });
  }
  // Groq path
  const prefs = readPreferences();
  const model = opts.model || prefs.GROQ_MODEL || DEFAULT_GROQ_MODEL;
  const messages = [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: userPrompt },
  ];
  const params = {
    model,
    messages,
    temperature: opts.temperature ?? 0.7,
    max_tokens: opts.maxTokens ?? 4096,
  };
  if (opts.jsonMode) params.response_format = { type: 'json_object' };

  const res = await groqClient().chat.completions.create(params);
  return res.choices?.[0]?.message?.content ?? '';
}

/**
 * Like `chat()` but accepts an explicit provider and model override.
 * When `provider` is falsy, falls back to the default `chat()` behavior.
 * @param {string} systemPrompt
 * @param {string} userPrompt
 * @param {object} [opts]
 * @param {string} [provider] - "groq" | "openrouter" | "llama"
 * @param {string} [model] - model id override
 * @returns {Promise<string>}
 */
export async function chatWithProvider(systemPrompt, userPrompt, opts = {}, provider, model) {
  if (!provider) return chat(systemPrompt, userPrompt, opts);

  if (provider === 'openrouter') {
    if (!getKey('openrouter')) {
      throw new Error('No openrouter key set. Run: elora-voss set-key openrouter YOUR_KEY');
    }
    return openrouter.chat(systemPrompt, userPrompt, {
      model: model || DEFAULT_OPENROUTER_MODEL,
      temperature: opts.temperature,
      maxTokens: opts.maxTokens,
      jsonMode: opts.jsonMode,
    });
  }
  if (provider === 'llama') {
    return llama.chat(systemPrompt, userPrompt, {
      model: model || DEFAULT_LLAMA_MODEL,
      temperature: opts.temperature,
      maxTokens: opts.maxTokens,
      jsonMode: opts.jsonMode,
    });
  }
  // Groq path
  if (!getKey('groq')) {
    throw new Error('Missing Groq API key. Run: elora-voss set-key groq YOUR_KEY');
  }
  const messages = [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: userPrompt },
  ];
  const params = {
    model: model || DEFAULT_GROQ_MODEL,
    messages,
    temperature: opts.temperature ?? 0.7,
    max_tokens: opts.maxTokens ?? 4096,
  };
  if (opts.jsonMode) params.response_format = { type: 'json_object' };
  const res = await groqClient().chat.completions.create(params);
  return res.choices?.[0]?.message?.content ?? '';
}

/** @returns {string} the active provider label ("groq" | "openrouter" | "llama") */
export function activeProvider() {
  try {
    return currentProvider();
  } catch {
    return pickProvider();
  }
}

/** @returns {string} */
export function defaultModel() {
  const p = currentProvider();
  if (p === 'openrouter') return DEFAULT_OPENROUTER_MODEL;
  if (p === 'llama') return DEFAULT_LLAMA_MODEL;
  return DEFAULT_GROQ_MODEL;
}

const GROQ_MODELS_ENDPOINT = 'https://api.groq.com/openai/v1/models';

/**
 * Fetch available models from Groq.
 * @returns {Promise<Array<{id: string, name: string}>>}
 */
export async function listModels() {
  const key = getKey('groq');
  if (!key) throw new Error('Missing Groq API key. Run: elora-voss set-key groq YOUR_KEY');
  const res = await fetch(GROQ_MODELS_ENDPOINT, {
    headers: { Authorization: `Bearer ${key}` },
  });
  if (!res.ok) {
    throw new Error(`Groq models ${res.status}: ${(await res.text()).slice(0, 200)}`);
  }
  const data = await res.json();
  return (data.data || []).map((m) => ({
    id: m.id,
    name: m.id,
  })).sort((a, b) => a.id.localeCompare(b.id));
}