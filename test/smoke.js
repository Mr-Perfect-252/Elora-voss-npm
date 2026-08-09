// Smoke test: run all simple CLI commands (no API key required) and verify
// the workspace, history, config, and preferences machinery is wired up.
//
// Usage:  node test/smoke.js
//         npm run smoke

import { existsSync, readFileSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PKG_ROOT = resolve(__dirname, '..');
const BIN = resolve(PKG_ROOT, 'bin', 'elora-voss.js');

const SCRATCH = resolve(PKG_ROOT, '.smoke');
const WS = resolve(SCRATCH, 'elora-voss');
const HISTORY = resolve(WS, 'history');

function run(args, opts = {}) {
  return spawnSync(process.execPath, [BIN, ...args], {
    cwd: SCRATCH,
    encoding: 'utf8',
    ...opts,
  });
}

let failed = 0;
function assert(cond, label) {
  if (cond) {
    console.log(`  ok   ${label}`);
  } else {
    console.error(`  FAIL ${label}`);
    failed++;
  }
}

function reset() {
  if (existsSync(SCRATCH)) rmSync(SCRATCH, { recursive: true, force: true });
  mkdirSync(SCRATCH, { recursive: true });
}

console.log('elora-voss smoke test');
console.log('---------------------');

reset();

// 1. --version
let r = run(['--version']);
assert(r.status === 0, 'elora-voss --version exits 0');
assert(/^\d+\.\d+\.\d+/.test(r.stdout.trim()), 'version string printed');

// 2. --help
r = run(['--help']);
assert(r.status === 0, 'elora-voss --help exits 0');
assert(r.stdout.includes('init') && r.stdout.includes('research'), 'help lists init and research');

// 3. unknown command
r = run(['bogus']);
assert(r.status !== 0, 'unknown command exits non-zero');

// 4. init
r = run(['init']);
assert(r.status === 0, 'elora-voss init exits 0');
assert(existsSync(resolve(WS, 'preferences.txt')), 'preferences.txt created');
assert(existsSync(resolve(WS, 'topics.csv')), 'topics.csv created');
assert(existsSync(resolve(WS, 'output.txt')), 'output.txt created');
assert(existsSync(HISTORY), 'history/ created');

// 5. preferences file is valid key=value
const prefs = readFileSync(resolve(WS, 'preferences.txt'), 'utf8');
assert(/TONE=/.test(prefs), 'preferences.txt has TONE=');
assert(/LENGTH=/.test(prefs), 'preferences.txt has LENGTH=');

// 6. topics.csv has header
const topics = readFileSync(resolve(WS, 'topics.csv'), 'utf8');
assert(topics.startsWith('id,topic,'), 'topics.csv has expected header');

// 7. set-key
r = run(['set-key', 'groq', 'TEST_GROQ_KEY']);
assert(r.status === 0, 'set-key groq exits 0');
const cfg = readFileSync(resolve(WS, 'config'), 'utf8');
assert(cfg.includes('groq=TEST_GROQ_KEY'), 'config file contains groq key');

// 8. set-key replaces existing key
r = run(['set-key', 'groq', 'NEW_KEY']);
const cfg2 = readFileSync(resolve(WS, 'config'), 'utf8');
const matches = cfg2.match(/^groq=/gm) || [];
assert(matches.length === 1, 'set-key replaces (does not duplicate) key');
assert(cfg2.includes('groq=NEW_KEY'), 'config has new value');

// 9. set-key rejects unknown provider
r = run(['set-key', 'openai', 'x']);
assert(r.status !== 0, 'set-key rejects unknown provider');

// 9b. set-key accepts openrouter
r = run(['set-key', 'openrouter', 'TEST_OR_KEY']);
assert(r.status === 0, 'set-key openrouter exits 0');
const cfgOr = readFileSync(resolve(WS, 'config'), 'utf8');
assert(cfgOr.includes('openrouter=TEST_OR_KEY'), 'config file contains openrouter key');

// 9c. set-key accepts pexels
r = run(['set-key', 'pexels', 'TEST_PEXELS_KEY']);
assert(r.status === 0, 'set-key pexels exits 0');

// 10. set-key requires both args
r = run(['set-key', 'groq']);
assert(r.status !== 0, 'set-key with no key exits non-zero');

// 11. history on empty workspace
r = run(['history']);
assert(r.status === 0, 'history on empty workspace exits 0');
assert(/No research runs yet/.test(r.stdout), 'history prints empty-state message');

// 12. last on empty workspace
r = run(['last']);
assert(r.status === 0, 'last on empty workspace exits 0');
assert(/No output yet/.test(r.stdout), 'last prints empty-state message');

// 13. research with no groq key configured → first reset so there's no key
reset();
r = run(['init']);
r = run(['research', 'test topic']);
assert(r.status !== 0, 'research with no groq key exits non-zero');
assert(/Groq API key/.test(r.stderr), 'research error mentions Groq key');

// Cleanup
if (existsSync(SCRATCH)) rmSync(SCRATCH, { recursive: true, force: true });

console.log('---------------------');
if (failed > 0) {
  console.error(`${failed} check(s) failed`);
  process.exit(1);
}
console.log('all checks passed');
