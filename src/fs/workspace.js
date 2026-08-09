// Workspace management: files live directly in cwd (./preferences.txt, ./topics.csv,
// ./output.txt, ./config, ./history/). No workspace subfolder.
import { existsSync, mkdirSync, writeFileSync, readFileSync, appendFileSync } from 'node:fs';
import { resolve } from 'node:path';

const HISTORY_DIR = resolve('./history');

const PREFERENCES_FILE = resolve('./preferences.txt');
const TOPICS_FILE = resolve('./topics.csv');
const OUTPUT_FILE = resolve('./output.txt');

const DEFAULT_PREFERENCES = `# elora-voss preferences
# Edit this file to personalise your articles.
# Lines starting with # are comments and are ignored.

TONE=intelligent and narrative, like a magazine feature
LENGTH=long-form (800-1200 words)
NICHE=general science and technology
AUDIENCE=curious general readers with no specialist knowledge
LANGUAGE=English
STYLE=editorial essay
OUTPUT_FORMAT=markdown
INCLUDE_IMAGES=true
MODEL_PROVIDER=groq
IMAGE_PROVIDER=unsplash
# MODE controls how chatty the CLI is.
#   simple   — no per-phase model picker, no preference tuning on init (best for new users)
#   standard — full multi-step preferences wizard + per-phase model picker on research
#   expert   — standard + extra diagnostics in --verbose
MODE=simple
`;

export const MODE_VALUES = ['simple', 'standard', 'expert'];

/**
 * Read the current mode from preferences. Defaults to 'simple' for new users.
 * Falls back to 'simple' if the value is missing or not one of MODE_VALUES.
 * Lazy-initialises the workspace (same as readPreferences).
 * @returns {'simple'|'standard'|'expert'}
 */
export function readMode() {
  const m = String(readPreferences().MODE || 'simple').toLowerCase().trim();
  return MODE_VALUES.includes(m) ? /** @type {any} */ (m) : 'simple';
}

const TOPICS_HEADER = 'id,topic,ran_at,word_count,context_file,output_file,model_provider,image_provider,image_providers_used\n';

export function workspaceInit() {
  if (!existsSync(HISTORY_DIR)) mkdirSync(HISTORY_DIR, { recursive: true });

  if (!existsSync(PREFERENCES_FILE)) writeFileSync(PREFERENCES_FILE, DEFAULT_PREFERENCES, 'utf8');
  if (!existsSync(TOPICS_FILE)) writeFileSync(TOPICS_FILE, TOPICS_HEADER, 'utf8');
  if (!existsSync(OUTPUT_FILE)) writeFileSync(OUTPUT_FILE, '', 'utf8');

  return {
    historyDir: './history/',
    preferencesFile: PREFERENCES_FILE,
    topicsFile: TOPICS_FILE,
    outputFile: OUTPUT_FILE,
  };
}

export function readPreferences() {
  if (!existsSync(PREFERENCES_FILE)) {
    workspaceInit();
  }
  const raw = readFileSync(PREFERENCES_FILE, 'utf8');
  const out = {};
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    const value = trimmed.slice(eq + 1).trim();
    out[key] = value;
  }
  return out;
}

/**
 * Write a key=value preferences file, preserving comment lines and only
 * touching keys that are present in `prefs`. New keys are appended in a
 * stable order. Used by the preferences wizard.
 *
 * @param {Record<string,string>} prefs
 */
export function writePreferences(prefs) {
  const raw = existsSync(PREFERENCES_FILE) ? readFileSync(PREFERENCES_FILE, 'utf8') : DEFAULT_PREFERENCES;
  const lines = raw.split(/\r?\n/);
  const seen = new Set();
  const out = lines.map((line) => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) return line;
    const eq = trimmed.indexOf('=');
    if (eq === -1) return line;
    const key = trimmed.slice(0, eq).trim();
    if (Object.prototype.hasOwnProperty.call(prefs, key)) {
      seen.add(key);
      return `${key}=${prefs[key]}`;
    }
    return line;
  });
  // Append any keys that didn't exist in the file
  for (const [k, v] of Object.entries(prefs)) {
    if (!seen.has(k)) out.push(`${k}=${v}`);
  }
  // Ensure trailing newline, drop the trailing blank if any
  while (out.length && out[out.length - 1] === '') out.pop();
  writeFileSync(PREFERENCES_FILE, out.join('\n') + '\n', 'utf8');
}

export function appendTopic({ id, topic, ranAt, wordCount, contextFile, outputFile, modelProvider, imageProvider, imageProvidersUsed }) {
  // CSV-escape topic (quote if it contains comma, quote, or newline)
  const esc = (s) => {
    const str = String(s ?? '');
    if (/[",\n\r]/.test(str)) return `"${str.replace(/"/g, '""')}"`;
    return str;
  };
  const row = [
    id,
    esc(topic),
    ranAt,
    wordCount,
    esc(contextFile),
    esc(outputFile),
    esc(modelProvider || ''),
    esc(imageProvider || ''),
    esc(imageProvidersUsed || ''),
  ].join(',') + '\n';
  appendFileSync(TOPICS_FILE, row, 'utf8');
}

export const PATHS = {
  HISTORY_DIR,
  PREFERENCES_FILE,
  TOPICS_FILE,
  OUTPUT_FILE,
};