// Unit test: pure functions (workspace, history, config) without network calls.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, rmSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { tmpdir } from 'node:os';

const SCRATCH = resolve(tmpdir(), `elora-voss-test-${Date.now()}`);
mkdirSync(SCRATCH, { recursive: true });
process.chdir(SCRATCH);

// workspace
const {
  workspaceInit,
  readPreferences,
  appendTopic,
  workspaceDir,
} = await import('../src/fs/workspace.js');

test('workspaceInit creates the full directory tree', () => {
  const out = workspaceInit();
  assert.ok(existsSync(workspaceDir()), 'workspace dir created');
  assert.ok(out.preferencesFile.endsWith('preferences.txt'));
  assert.ok(out.topicsFile.endsWith('topics.csv'));
});

test('readPreferences returns defaults when fresh', () => {
  const prefs = readPreferences();
  assert.equal(prefs.TONE, 'intelligent and narrative, like a magazine feature');
  assert.equal(prefs.LANGUAGE, 'English');
  assert.equal(prefs.INCLUDE_IMAGES, 'true');
});

test('appendTopic writes a valid CSV row', () => {
  appendTopic({ id: 1, topic: 'a, with comma', ranAt: '2026-01-01T00:00:00Z', wordCount: 100, contextFile: 'context_001.md', outputFile: 'output_001.md', modelProvider: 'groq', imageProvider: 'unsplash', imageProvidersUsed: 'unsplash' });
  appendTopic({ id: 2, topic: 'b "with quote"', ranAt: '2026-01-01T00:00:00Z', wordCount: 200, contextFile: 'context_002.md', outputFile: 'output_002.md', modelProvider: 'openrouter', imageProvider: 'wikipedia', imageProvidersUsed: 'wikipedia,unsplash' });
  const raw = readFileSync(resolve(workspaceDir(), 'topics.csv'), 'utf8');
  assert.ok(raw.includes('"a, with comma"'), 'commas in topic are quoted');
  assert.ok(raw.includes('"b ""with quote"""'), 'quotes in topic are escaped');
});

// history
const { nextId, saveContext, saveOutput, listHistory, outputFile, contextFile } = await import('../src/fs/history.js');

test('nextId starts at 1 on a fresh csv', () => {
  // csv was just populated above; nextId should be 3
  assert.equal(nextId(), 3);
});

test('contextFile / outputFile use 3-digit padding', () => {
  assert.equal(contextFile(1), 'context_001.md');
  assert.equal(contextFile(42), 'context_042.md');
  assert.equal(outputFile(123), 'output_123.md');
});

test('saveContext writes to history/', () => {
  const p = saveContext(1, 'topic', '# KB body');
  assert.ok(existsSync(p), 'context file exists on disk');
  assert.equal(readFileSync(p, 'utf8'), '# KB body');
});

test('saveOutput writes both history/ copy and output.txt', () => {
  const out = saveOutput(1, 'topic', 'article body');
  assert.ok(existsSync(out.historyPath), 'history copy exists');
  assert.ok(existsSync(out.latestPath), 'output.txt exists');
  assert.equal(readFileSync(out.latestPath, 'utf8'), 'article body');
});

test('listHistory parses CSV with quoted fields', () => {
  const rows = listHistory();
  assert.equal(rows.length, 2);
  assert.equal(rows[0].topic, 'a, with comma');
  assert.equal(rows[1].topic, 'b "with quote"');
  assert.equal(rows[0].word_count, 100);
  assert.equal(rows[0].model_provider, 'groq');
  assert.equal(rows[1].model_provider, 'openrouter');
  assert.equal(rows[1].image_providers_used, 'wikipedia,unsplash');
});

// config
const { getKey, setKey, listKeys } = await import('../src/config.js');

test('setKey then getKey round-trips', () => {
  setKey('groq', 'KEY1');
  assert.equal(getKey('groq'), 'KEY1');
});

test('setKey overwrites existing key without duplicating', () => {
  setKey('groq', 'KEY2');
  setKey('tavily', 'TAVILY1');
  const keys = listKeys();
  assert.equal(keys.groq, 'KEY2');
  assert.equal(keys.tavily, 'TAVILY1');
  // make sure no duplicate groq line
  const raw = readFileSync(resolve('./elora-voss/config'), 'utf8');
  const matches = raw.match(/^groq=/gm) || [];
  assert.equal(matches.length, 1);
});

test('getKey returns null for unset key', () => {
  assert.equal(getKey('unsplash'), null);
});

// cleanup
rmSync(SCRATCH, { recursive: true, force: true });
