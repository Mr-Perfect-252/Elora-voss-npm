// Config: read/write API keys in ./config (flat KEY=VALUE, lives in cwd)
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const CONFIG_FILE = resolve('./config');

export function getKey(provider) {
  if (!existsSync(CONFIG_FILE)) return null;
  const raw = readFileSync(CONFIG_FILE, 'utf8');
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    const value = trimmed.slice(eq + 1).trim();
    if (key === provider) return value;
  }
  return null;
}

export function setKey(provider, value) {
  const lines = existsSync(CONFIG_FILE) ? readFileSync(CONFIG_FILE, 'utf8').split(/\r?\n/) : [];
  let found = false;
  const updated = lines.map((line) => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) return line;
    const eq = trimmed.indexOf('=');
    if (eq === -1) return line;
    const key = trimmed.slice(0, eq).trim();
    if (key === provider) {
      found = true;
      return `${key}=${value}`;
    }
    return line;
  });
  if (!found) updated.push(`${provider}=${value}`);
  // Ensure trailing newline
  const out = updated.filter((l, i, arr) => !(l === '' && i === arr.length - 1)).join('\n') + '\n';
  writeFileSync(CONFIG_FILE, out, 'utf8');
  // Verify write: read back and confirm. Catches Windows + symlink cwd mismatches.
  const verify = getKey(provider);
  if (verify !== value) {
    throw new Error(
      `Wrote ${provider} key to ${CONFIG_FILE} but read-back failed.\n` +
      `  expected length=${value.length}, got=${verify === null ? 'null' : `length=${verify.length}`}\n` +
      `  process.cwd()=${process.cwd()}`
    );
  }
}

export function listKeys() {
  if (!existsSync(CONFIG_FILE)) return {};
  const raw = readFileSync(CONFIG_FILE, 'utf8');
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

/** @returns {number} configured max_results for Tavily, default 15 */
export function getTavilyMaxResults() {
  const raw = getKey('tavily_max_results');
  if (!raw) return 15;
  const n = parseInt(raw, 10);
  return Number.isFinite(n) && n > 0 ? n : 15;
}

/**
 * Set max_results for Tavily. Clamped to Tavily's allowed range (1..20).
 * @param {number} value
 */
export function setTavilyMaxResults(value) {
  const n = parseInt(String(value), 10);
  if (!Number.isFinite(n) || n < 1) {
    throw new Error(`max_results must be a positive integer (got ${value})`);
  }
  const clamped = Math.min(n, 20);
  setKey('tavily_max_results', String(clamped));
  return clamped;
}