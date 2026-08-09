#!/usr/bin/env node
// elora-voss CLI entry. Dispatches argv to one of:
//   init | set-key <provider> <key> | research <topic...>
//   history | last | preferences | --version | --help
//
// Interactive flows (wizards) take over when:
//   - stdout is a TTY
//   - the user did not pass the raw key value (for set-key)
//   - the user did not pass --no-wizard (for init)
import { readFileSync, existsSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

import chalk from 'chalk';
import boxen from 'boxen';
import inquirer from 'inquirer';

import { workspaceInit, readPreferences, readMode, PATHS, writePreferences } from './fs/workspace.js';
import { listHistory } from './fs/history.js';
import { setKey, getKey, listKeys, getTavilyMaxResults, setTavilyMaxResults } from './config.js';
import { run as runAgent } from './agent.js';
import * as llm from './groq.js';
import * as openrouter from './openrouter.js';
import * as llama from './llama.js';
import { printBanner, printStartupBox, isInteractive, supportsColor } from './ui/banner.js';
import { successPanel, errorPanel, infoPanel, warnPanel, keyValuePanel, tablePanel, examplePanel, doctorReportPanel } from './ui/panels.js';
import { initWizard, setKeyWizard, preferencesWizard, phaseModelPickerWizard, modeWizard, applyMode } from './wizard.js';
import { MODE_VALUES } from './fs/workspace.js';

const { OUTPUT_FILE, PREFERENCES_FILE } = PATHS;

const __dirname = dirname(fileURLToPath(import.meta.url));
const PKG = JSON.parse(readFileSync(resolve(__dirname, '..', 'package.json'), 'utf8'));

const USAGE = `
Usage:
  elora-voss init [--no-wizard]                Create local workspace (interactive by default)
  elora-voss mode [simple|standard|expert]    Show or change the chatty mode
                       [--show]                  Just print the current mode
  elora-voss set-key <provider> [key]          Save an API key (interactive if key is omitted)
                       groq | openrouter | llama | tavily | unsplash | pexels
  elora-voss keys                              Show which API keys are saved
  elora-voss set-max-results <n>               Set Tavily max_results (1-20, default 15)
  elora-voss research "<topic>"                Run the full research + writing pipeline
  elora-voss history                           List past research runs
  elora-voss last                              Print the most recent article
  elora-voss preferences [--editor]            Edit preferences (interactive by default)
  elora-voss view-models <provider>            List available models (openrouter | groq | llama)
  elora-voss doc [topic]                       Show usage + examples (topic: wizard | modes | preferences | troubleshoot)
  elora-voss doctor [--verbose] [--json]       Health check: workspace, keys, live provider reachability
  elora-voss --version                         Show installed version
  elora-voss --help                            Show this help

Modes:
  simple    Default for new users. Hides the per-phase model picker and the
            post-init preferences prompt. Just run: elora-voss research "<topic>"
  standard  Full multi-step preferences wizard and per-phase model picker.
  expert    standard + extra diagnostics in --verbose (timings, per-phase detail).

Providers:
  groq        LLM (default)
  openrouter  LLM via OpenRouter (MODEL_PROVIDER=openrouter)
  llama       Local LLM (llama.cpp / ollama / LM Studio; MODEL_PROVIDER=llama)
  tavily      search (optional, falls back from DuckDuckGo)
  unsplash    article images (optional)
  pexels      article images (optional)
  wikipedia   article images (no key required)
`;

function exit(code, msg) {
  if (msg) process.stderr.write(msg + '\n');
  process.exit(code);
}

async function cmdInit(argv) {
  const noWizard = argv.includes('--no-wizard');
  if (!noWizard && isInteractive()) {
    const r = await initWizard();
    if (r === '__cancel__') {
      // Non-interactive or cancelled; fall back to silent init.
      workspaceInit();
      infoPanel('workspace ready', `Created workspace in ${chalk.cyan(process.cwd())}`);
    }
    return;
  }
  workspaceInit();
  // Simple mode + scripted init: just confirm the path. Avoids spamming
  // "Next: elora-voss set-key ..." when the caller is in a loop or CI.
  if (readMode() === 'simple') {
    infoPanel('workspace ready', chalk.cyan(process.cwd()));
    return;
  }
  infoPanel('workspace ready', [
    `Created workspace in ${chalk.cyan(process.cwd())}`,
    `  ${chalk.dim('preferences.txt')}`,
    `  ${chalk.dim('topics.csv')}`,
    `  ${chalk.dim('output.txt')}`,
    `  ${chalk.dim('history/')}`,
    ``,
    `Next: ${chalk.cyan('elora-voss set-key groq YOUR_KEY')}`,
  ].join('\n'));
}

async function cmdMode(argv) {
  const showOnly = argv.includes('--show');
  const arg = argv.find((a) => !a.startsWith('--'));

  if (showOnly || !isInteractive()) {
    const m = readMode();
    process.stdout.write(`${m}\n`);
    return;
  }

  if (arg) {
    if (!MODE_VALUES.includes(arg)) {
      errorPanel('usage', `Usage: elora-voss mode [${MODE_VALUES.join('|')}] [--show]\nValid modes: ${MODE_VALUES.join(', ')}`);
      exit(1, USAGE);
    }
    applyMode(arg);
    successPanel('mode updated', `${chalk.cyan(arg)} — saved to ${chalk.dim(process.cwd() + '/preferences.txt')}`);
    return;
  }

  // Interactive: launch the wizard
  const chosen = await modeWizard();
  if (chosen === '__cancel__') exit(0);
  applyMode(chosen);
  successPanel('mode updated', `${chalk.cyan(chosen)} — saved to ${chalk.dim(process.cwd() + '/preferences.txt')}`);
}

async function cmdSetKey(argv) {
  const provider = argv[0];
  const key = argv[1];

  if (!provider) {
    errorPanel('usage', 'Usage: elora-voss set-key <provider> [key]');
    exit(1, USAGE);
  }
  const valid = ['groq', 'openrouter', 'llama', 'tavily', 'unsplash', 'pexels'];
  if (!valid.includes(provider)) {
    errorPanel('unknown provider', `"${provider}". Valid: ${valid.join(', ')}`);
    exit(1, USAGE);
  }
  if (!key && isInteractive()) {
    const r = await setKeyWizard(provider);
    if (r === '__cancel__') exit(0);
    return;
  }
  if (!key) {
    errorPanel('usage', 'Usage: elora-voss set-key <provider> <key>');
    exit(1, USAGE);
  }
  setKey(provider, key);
  successPanel('key saved', `${chalk.cyan(provider)} → ${chalk.dim(process.cwd() + '/config')}`);
}

function cmdKeys() {
  const keys = listKeys();
  const providers = [
    { id: 'groq', label: 'LLM (Groq)' },
    { id: 'openrouter', label: 'LLM (OpenRouter)' },
    { id: 'llama', label: `LLM (local · ${llama.baseUrl()})` },
    { id: 'tavily', label: 'search' },
    { id: 'unsplash', label: 'images' },
    { id: 'pexels', label: 'images' },
    { id: 'wikipedia', label: 'images (no key)' },
  ];
  const rows = providers.map(({ id, label }) => {
    const v = keys[id];
    if (v) {
      const masked = v.length <= 8 ? '****' : `${v.slice(0, 4)}…${v.slice(-4)} (len=${v.length})`;
      return [id, label, masked];
    }
    if (id === 'llama') return [id, label, 'no token (optional)'];
    return [id, label, id === 'wikipedia' ? 'no key needed' : 'not set'];
  });
  keyValuePanel(rows.map(([id, label, value]) => [id.padEnd(10), label.padEnd(20), value]), { title: 'API keys' });
  infoPanel('config file', process.cwd() + '/config');
}

function cmdSetMaxResults(argv) {
  const value = argv[0];
  if (!value) exit(1, 'Usage: elora-voss set-max-results <n>');
  const current = getTavilyMaxResults();
  let saved;
  try {
    saved = setTavilyMaxResults(value);
  } catch (err) {
    errorPanel('invalid value', err.message);
    exit(1, USAGE);
  }
  if (saved !== parseInt(value, 10)) {
    warnPanel('clamped', `Requested ${value}; clamped to ${saved} (Tavily max is 20).`);
  }
  successPanel('tavily max_results', `${current} → ${saved}`);
}

function cmdHistory() {
  const rows = listHistory();
  if (rows.length === 0) {
    infoPanel('history', 'No research runs yet. Try: elora-voss research "your topic"');
    return;
  }
  const headers = ['ID', 'TOPIC', 'RAN AT', 'WORDS', 'FILES'];
  const data = rows.map((r) => [
    r.id,
    r.topic.length > 60 ? r.topic.slice(0, 57) + '…' : r.topic,
    r.ran_at,
    String(r.word_count),
    `${r.context_file} / ${r.output_file}`,
  ]);
  tablePanel(headers, data, { title: `history (${rows.length} run${rows.length === 1 ? '' : 's'})` });
}

function cmdLast() {
  if (!existsSync(OUTPUT_FILE)) {
    infoPanel('output', 'No output yet. Run: elora-voss research "<topic>"');
    return;
  }
  const text = readFileSync(OUTPUT_FILE, 'utf8');
  if (!isInteractive() || !supportsColor()) {
    process.stdout.write(text);
    return;
  }
  // Show the most recent article inside a framed panel
  const frame = boxen(text, {
    padding: { top: 0, bottom: 0, left: 1, right: 1 },
    margin: { top: 0, bottom: 1, left: 0, right: 0 },
    borderStyle: 'round',
    borderColor: 'magenta',
    title: ' most recent article ',
    titleAlignment: 'center',
  });
  process.stdout.write(frame + '\n');
}

async function cmdPreferences(argv) {
  const useEditor = argv.includes('--editor') || !isInteractive();
  if (!useEditor && isInteractive()) {
    const r = await preferencesWizard();
    if (r === '__cancel__') exit(0);
    return;
  }
  const path = PREFERENCES_FILE;
  if (!existsSync(path)) {
    errorPanel('not initialised', 'Run: elora-voss init');
    exit(1, USAGE);
  }
  const editor = process.env.VISUAL || process.env.EDITOR || (process.platform === 'win32' ? 'notepad' : 'nano');
  const parts = editor.split(/\s+/);
  const child = spawn(parts[0], [...parts.slice(1), path], { stdio: 'inherit', detached: true });
  child.on('error', (err) => exit(1, `Failed to open editor: ${err.message}`));
  child.unref();
}

async function cmdViewModels(argv) {
  const provider = argv[0];
  if (!provider || !['openrouter', 'groq', 'llama'].includes(provider)) {
    errorPanel('usage', 'Usage: elora-voss view-models <openrouter|groq|llama>');
    exit(1, USAGE);
  }
  if (provider === 'openrouter' && !getKey('openrouter')) {
    errorPanel('missing key', `Set an OpenRouter key first: ${chalk.cyan('elora-voss set-key openrouter')}`);
    exit(1);
  }
  if (provider === 'groq' && !getKey('groq')) {
    errorPanel('missing key', `Set a Groq key first: ${chalk.cyan('elora-voss set-key groq')}`);
    exit(1);
  }
  if (provider === 'llama') {
    infoPanel('local llama', `Querying ${chalk.cyan(llama.baseUrl())}…`);
  }
  try {
    const models = provider === 'openrouter'
      ? await openrouter.listModels()
      : provider === 'llama'
        ? await llama.listModels()
        : await llm.listModels();
    if (models.length === 0) {
      infoPanel('models', `No models returned by ${provider}.`);
      return;
    }
    const headers = ['MODEL ID', ...(provider === 'openrouter' ? ['NAME', 'CONTEXT'] : [])];
    const data = models.map((m) =>
      provider === 'openrouter'
        ? [m.id, m.name, String(m.context_length)]
        : [m.id]
    );
    tablePanel(headers, data, { title: `${provider} models (${models.length})` });
  } catch (err) {
    errorPanel('fetch failed', err.message);
    exit(1);
  }
}

async function cmdResearch(argv) {
  const topic = argv.join(' ').trim();
  if (!topic) {
    errorPanel('usage', 'Usage: elora-voss research "<topic>"');
    exit(1, USAGE);
  }
  const prefs = readPreferences();
  const mode = readMode();
  const modelProvider = String(prefs.MODEL_PROVIDER || 'groq').toLowerCase();
  const needGroq = modelProvider === 'groq';
  const needOpenRouter = modelProvider === 'openrouter';
  const isLlama = modelProvider === 'llama';
  if (needGroq && !getKey('groq')) {
    errorPanel('missing API key', [
      'No Groq key set.',
      `Run: ${chalk.cyan('elora-voss set-key groq YOUR_KEY')}`,
      `(or set ${chalk.cyan('MODEL_PROVIDER=openrouter')} in preferences)`,
    ].join('\n'));
    exit(1, USAGE);
  }
  if (needOpenRouter && !getKey('openrouter')) {
    errorPanel('missing API key', [
      'No OpenRouter key set.',
      `Run: ${chalk.cyan('elora-voss set-key openrouter YOUR_KEY')}`,
    ].join('\n'));
    exit(1, USAGE);
  }
  if (isLlama) {
    // Before the pipeline kicks off, give the user a one-shot chance to point
    // us at the right host:port. This handles the common case of "I started
    // the server on a different port and forgot to run preferences".
    if (isInteractive()) {
      const current = llama.endpoint();
      const presets = [
        { name: `${llama.DEFAULT_HOST}:${llama.DEFAULT_PORT}  (llama.cpp / LM Studio default)`, value: { host: llama.DEFAULT_HOST, port: llama.DEFAULT_PORT } },
        { name: '127.0.0.1:11434  (ollama)', value: { host: '127.0.0.1', port: 11434 } },
        { name: '127.0.0.1:1234   (LM Studio)', value: { host: '127.0.0.1', port: 1234 } },
        { name: '127.0.0.1:5000   (vLLM / custom)', value: { host: '127.0.0.1', port: 5000 } },
        { name: '──────────  or  ──────────', value: '__sep__', disabled: true },
        { name: 'Custom host / port…', value: { host: '__custom__', port: 0 } },
        { name: 'Skip — use current settings', value: { host: '__keep__', port: 0 } },
      ];
      const matchIdx = presets.findIndex((p) => p.value.host === current.host && p.value.port === current.port);
      const { pick } = await inquirer.prompt([
        {
          type: 'list',
          name: 'pick',
          message: `Local llama server — where is it running? (current: ${chalk.cyan(current.host + ':' + current.port)})`,
          choices: presets,
          default: matchIdx >= 0 ? matchIdx : 0,
        },
      ]);
      if (pick && pick.host === '__custom__') {
        const a = await inquirer.prompt([
          { type: 'input', name: 'host', message: 'Host:', default: current.host },
          {
            type: 'input',
            name: 'port',
            message: 'Port:',
            default: String(current.port),
            validate: (v) => {
              const n = parseInt(String(v).trim(), 10);
              if (!Number.isFinite(n) || n < 1 || n > 65535) return 'Port must be a number between 1 and 65535';
              return true;
            },
          },
        ]);
        writePreferences({ LLAMA_HOST: a.host.trim(), LLAMA_PORT: String(parseInt(a.port, 10)), LLAMA_BASE_URL: '' });
      } else if (pick && pick.host !== '__keep__') {
        writePreferences({ LLAMA_HOST: pick.host, LLAMA_PORT: String(pick.port), LLAMA_BASE_URL: '' });
      }
    }
    // Friendly early-warning: if the local server isn't reachable, every phase
    // will surface a fetch error. We still let the run start so the user sees
    // the spinner tick + the real failure.
    infoPanel('local llama', `Using ${chalk.cyan(llama.baseUrl())} · model ${chalk.cyan(prefs.LLAMA_MODEL || llama.DEFAULT_MODEL)}\nMake sure your local server is running (llama.cpp / ollama / LM Studio).`);
  }

  // Per-phase model selection wizard (interactive only).
  // In simple mode this is skipped — new users get the provider's default model
  // for every phase, which is the entire point of simple mode.
  let phaseModels = null;
  if (mode !== 'simple' && isInteractive()) {
    const provider = String(prefs.MODEL_PROVIDER || 'groq').toLowerCase();
    const model = provider === 'openrouter'
      ? (prefs.OPENROUTER_MODEL || 'anthropic/claude-3.5-sonnet')
      : provider === 'llama'
        ? (prefs.LLAMA_MODEL || llama.DEFAULT_MODEL)
        : (prefs.GROQ_MODEL || 'llama-3.3-70b-versatile');

    phaseModels = await phaseModelPickerWizard(provider, model);
    if (phaseModels === '__cancel__') return process.exit(0);

    // Validate that API keys exist for all chosen providers
    // (local llama is exempt — it just needs a reachable base URL).
    const providersUsed = new Set(Object.values(phaseModels).map((c) => c.provider));
    for (const p of providersUsed) {
      if (p === 'llama') continue;
      if (!getKey(p)) {
        errorPanel('missing API key', [
          `Phase model picker selected ${chalk.cyan(p)} but no key is set.`,
          `Run: ${chalk.cyan(`elora-voss set-key ${p} YOUR_KEY`)}`,
        ].join('\n'));
        exit(1, USAGE);
      }
    }
  } else if (mode === 'simple' && process.env.ELORA_VERBOSE) {
    infoPanel('simple mode', 'Using the default model for every phase (no picker).');
  }

  await runAgent(topic, { phaseModels });
}

// ---- doc ----

const DOC_TOPICS = {
  wizard: {
    title: 'wizard',
    body: [
      'Several commands launch an interactive wizard when stdout is a TTY:',
      `  ${chalk.cyan('init')}          creates the workspace, asks which LLM provider to use, prompts for the API key (masked).`,
      `  ${chalk.cyan('set-key <p>')}   prompts for the key with a password field (no echo).`,
      `  ${chalk.cyan('preferences')}   multi-step: TONE, LENGTH, STYLE, audience, language, model provider, image provider, then a live model picker.`,
      `  ${chalk.cyan('mode')}          three-option picker (simple / standard / expert).`,
      `  ${chalk.cyan('research')}      in standard/expert mode, picks a model for each of the 6 pipeline phases.`,
      '',
      'To run any of these non-interactively (CI, scripts), pass the raw arguments:',
      `  ${chalk.cyan('elora-voss set-key groq YOUR_KEY')}`,
      `  ${chalk.cyan('elora-voss init --no-wizard')}`,
      `  ${chalk.cyan('elora-voss preferences --editor')}`,
    ].join('\n'),
  },
  modes: {
    title: 'modes',
    body: [
      'Three modes control how chatty the CLI is. Set with: elora-voss mode [simple|standard|expert]',
      '',
      `${chalk.cyan('simple')}    (default for new users)`,
      '  - Skips the per-phase model picker on research.',
      '  - Skips the "Tune preferences now?" prompt on init.',
      '  - Init in simple mode is quieter (no big "Next: ..." panel).',
      `  ${chalk.dim('Try:')} elora-voss research "your topic"`,
      '',
      `${chalk.cyan('standard')}`,
      '  - Full multi-step preferences wizard.',
      '  - Per-phase model picker (use the same model for all, or pick per phase).',
      '  - Init asks "Tune preferences now?" after creating the workspace.',
      '',
      `${chalk.cyan('expert')}`,
      '  - Same as standard, plus extra diagnostics in --verbose (timings, per-phase detail).',
      `  - ${chalk.dim('Switch with:')} elora-voss mode expert`,
    ].join('\n'),
  },
  preferences: {
    title: 'preferences',
    body: [
      'All keys are in ./preferences.txt. Set with: elora-voss preferences',
      '',
      'MODE              simple | standard | expert. See: elora-voss doc modes',
      'TONE              free-form or a preset (editorial essay, feature article, etc.)',
      'LENGTH            short / medium / long-form / deep-dive',
      'STYLE             editorial essay, feature, explainer, profile, reported',
      'NICHE             your subject area (e.g. "neuroscience and AI")',
      'AUDIENCE          who you are writing for',
      'LANGUAGE          output language (default: English)',
      'INCLUDE_IMAGES    true | false',
      'MODEL_PROVIDER    groq | openrouter | llama',
      'GROQ_MODEL        model id override (default: llama-3.3-70b-versatile)',
      'OPENROUTER_MODEL  model id override (default: anthropic/claude-3.5-sonnet)',
      'LLAMA_MODEL       model id override (default: llama3.1; served by your local llama.cpp/ollama/LM Studio)',
      'LLAMA_HOST        host for local llama (default: 127.0.0.1)',
      'LLAMA_PORT        port for local llama (default: 8080; ollama=11434, LM Studio=1234)',
      'LLAMA_BASE_URL    full URL override (takes precedence over LLAMA_HOST/LLAMA_PORT)',
      'IMAGE_PROVIDER    unsplash | pexels | wikipedia',
      'OUTPUT_FORMAT     markdown (currently the only option)',
    ].join('\n'),
  },
  troubleshoot: {
    title: 'troubleshoot',
    body: [
      'Common errors and how to fix them:',
      '',
      `${chalk.red('"Missing Groq API key"')}`,
      `  Run: ${chalk.cyan('elora-voss set-key groq YOUR_KEY')}`,
      `  Or switch providers: ${chalk.cyan('elora-voss mode')} → standard, then change MODEL_PROVIDER.`,
      '',
      `${chalk.red('"No models returned by groq"')}`,
      `  Verify the key with: ${chalk.cyan('elora-voss doctor')}`,
      `  Your key may be invalid or rate-limited.`,
      '',
      `${chalk.red('"Tavily key not set"')}`,
      '  Tavily is optional. elora-voss falls back to DuckDuckGo. To silence the warning:',
      `  ${chalk.cyan('elora-voss set-key tavily YOUR_KEY')}`,
      '',
      `${chalk.red('"workspace not initialised"')}`,
      `  Run: ${chalk.cyan('elora-voss init')}`,
      '',
      `${chalk.red('Pipeline fails mid-way')}`,
      '  The knowledge base is saved even on failure. Look in ./history/context_NNN.md for the partial run.',
      `  Re-run with: ${chalk.cyan('elora-voss doctor --verbose')} to identify which provider is failing.`,
      '',
      `For a full health check: ${chalk.cyan('elora-voss doctor')}`,
    ].join('\n'),
  },
};

function cmdDoc(argv) {
  const topic = (argv[0] || '').toLowerCase();
  if (topic && !DOC_TOPICS[topic] && topic !== 'help') {
    errorPanel('unknown topic', `"${topic}". Available: ${Object.keys(DOC_TOPICS).join(', ')}`);
    exit(1);
  }
  // Always print the USAGE first — full USAGE + examples was the chosen design.
  process.stdout.write(USAGE);
  if (!topic || topic === 'help') {
    examplePanel('examples', [
      `  ${chalk.cyan('elora-voss init')}`,
      `  ${chalk.cyan('elora-voss set-key groq')}`,
      `  ${chalk.cyan('elora-voss research "Why do octopuses edit their RNA?"')}`,
      `  ${chalk.cyan('elora-voss mode standard')}`,
      `  ${chalk.cyan('elora-voss doctor --verbose')}`,
      '',
      `For more on a specific area:`,
      `  ${chalk.dim('elora-voss doc wizard')}        interactive flows cheatsheet`,
      `  ${chalk.dim('elora-voss doc modes')}         simple / standard / expert`,
      `  ${chalk.dim('elora-voss doc preferences')}   every preference key explained`,
      `  ${chalk.dim('elora-voss doc troubleshoot')}  common errors and fixes`,
    ].join('\n'));
    return;
  }
  const t = DOC_TOPICS[topic];
  examplePanel(t.title, t.body);
}

// ---- doctor ----

async function timed(fn) {
  const t0 = Date.now();
  try {
    const detail = await fn();
    return { status: 'ok', detail, ms: Date.now() - t0 };
  } catch (err) {
    return { status: 'fail', detail: (err && err.message) ? err.message : String(err), ms: Date.now() - t0 };
  }
}

async function checkWorkspace() {
  const files = [
    { label: 'preferences.txt', path: PATHS.PREFERENCES_FILE },
    { label: 'topics.csv', path: PATHS.TOPICS_FILE },
    { label: 'output.txt', path: PATHS.OUTPUT_FILE },
    { label: 'history/', path: PATHS.HISTORY_DIR },
  ];
  const missing = files.filter((f) => !existsSync(f.path)).map((f) => f.label);
  if (missing.length === 0) return 'all workspace files present';
  throw new Error(`missing: ${missing.join(', ')} — run: elora-voss init`);
}

function checkPreferences() {
  const prefs = readPreferences();
  const keys = Object.keys(prefs);
  if (keys.length === 0) throw new Error('preferences.txt is empty');
  const mode = readMode();
  if (!MODE_VALUES.includes(mode)) throw new Error(`MODE="${mode}" is not one of ${MODE_VALUES.join(', ')}`);
  return `${keys.length} keys, MODE=${mode}`;
}

function checkKeys() {
  const keys = listKeys();
  // Local llama is usable with or without a stored token (some servers require
  // a bearer, most don't). Only count the cloud providers as "required".
  const haveLlm = Boolean(keys.groq || keys.openrouter || String(readPreferences().MODEL_PROVIDER || '').toLowerCase() === 'llama');
  if (!haveLlm) throw new Error('no LLM key set (groq, openrouter) and MODEL_PROVIDER is not "llama"');
  const present = Object.keys(keys);
  return `${present.length} set: ${present.join(', ')}`;
}

async function checkLlm(prefs) {
  const provider = String(prefs.MODEL_PROVIDER || (getKey('openrouter') && !getKey('groq') ? 'openrouter' : 'groq')).toLowerCase();
  if (provider === 'openrouter' && !getKey('openrouter')) throw new Error('MODEL_PROVIDER=openrouter but no openrouter key');
  if (provider === 'groq' && !getKey('groq')) throw new Error('MODEL_PROVIDER=groq but no groq key');
  if (provider === 'llama') {
    const models = await llama.listModels();
    if (!models || models.length === 0) throw new Error(`llama returned 0 models from ${llama.baseUrl()}`);
    return `llama reachable · ${llama.baseUrl()} · ${models.length} models`;
  }
  const models = provider === 'openrouter' ? await openrouter.listModels() : await llm.listModels();
  if (!models || models.length === 0) throw new Error(`${provider} returned 0 models`);
  return `${provider} reachable · ${models.length} models`;
}

async function checkSearch(prefs) {
  const provider = String(prefs.SEARCH_PROVIDER || (getKey('tavily') ? 'tavily' : 'duckduckgo')).toLowerCase();
  if (provider === 'tavily') {
    if (!getKey('tavily')) return { status: 'warn', detail: 'tavily selected in preferences but no key set — will fall back to duckduckgo' };
    const res = await fetch('https://api.tavily.com/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ api_key: getKey('tavily'), query: 'ping', max_results: 1 }),
    });
    if (!res.ok) throw new Error(`tavily ${res.status}`);
    return { status: 'ok', detail: 'tavily reachable' };
  }
  // DuckDuckGo: a tiny GET is enough — the real search path uses a library.
  const res = await fetch('https://duckduckgo.com/?q=ping', { redirect: 'follow' });
  if (!res.ok) throw new Error(`duckduckgo ${res.status}`);
  return { status: 'ok', detail: 'duckduckgo reachable' };
}

async function checkImages(prefs) {
  const provider = String(prefs.IMAGE_PROVIDER || 'unsplash').toLowerCase();
  if (provider === 'wikipedia') {
    const res = await fetch('https://en.wikipedia.org/api/rest_v1/page/summary/Test', {
      headers: { 'User-Agent': 'elora-voss/0.4 (doctor)' },
    });
    if (!res.ok) throw new Error(`wikipedia ${res.status}`);
    return { status: 'ok', detail: 'wikipedia reachable' };
  }
  if (provider === 'unsplash') {
    if (!getKey('unsplash')) return { status: 'warn', detail: 'unsplash selected but no key set' };
    const res = await fetch('https://api.unsplash.com/search/photos?query=test&per_page=1', {
      headers: { Authorization: `Client-ID ${getKey('unsplash')}` },
    });
    if (!res.ok) throw new Error(`unsplash ${res.status}`);
    return { status: 'ok', detail: 'unsplash reachable' };
  }
  if (provider === 'pexels') {
    if (!getKey('pexels')) return { status: 'warn', detail: 'pexels selected but no key set' };
    const res = await fetch('https://api.pexels.com/v1/search?query=test&per_page=1', {
      headers: { Authorization: getKey('pexels') },
    });
    if (!res.ok) throw new Error(`pexels ${res.status}`);
    return { status: 'ok', detail: 'pexels reachable' };
  }
  return { status: 'warn', detail: `unknown image provider: ${provider}` };
}

function checkEnvironment() {
  return `node ${process.version}, cwd=${process.cwd()}`;
}

async function cmdDoctor(argv) {
  const verbose = argv.includes('--verbose');
  const asJson = argv.includes('--json');
  const checks = [];
  const prefs = readPreferences();

  // helper: timed with optional ms stamping
  const t = async (name, fn) => {
    const start = Date.now();
    let res;
    try {
      const detail = await fn();
      res = { name, status: 'ok', detail, ms: Date.now() - start };
    } catch (err) {
      res = { name, status: 'fail', detail: (err && err.message) ? err.message : String(err), ms: Date.now() - start };
    }
    if (!verbose) delete res.ms;
    checks.push(res);
  };

  await t('workspace', checkWorkspace);
  t('preferences', checkPreferences);
  t('keys', checkKeys);
  await t('llm', () => checkLlm(prefs));

  // search + images can return warn without being a hard fail
  const tWarn = async (name, fn) => {
    const start = Date.now();
    let res;
    try {
      const r = await fn();
      if (r && typeof r === 'object' && 'status' in r) {
        res = { name, status: r.status, detail: r.detail, ms: Date.now() - start };
      } else {
        res = { name, status: 'ok', detail: String(r), ms: Date.now() - start };
      }
    } catch (err) {
      res = { name, status: 'fail', detail: (err && err.message) ? err.message : String(err), ms: Date.now() - start };
    }
    if (!verbose) delete res.ms;
    checks.push(res);
  };

  await tWarn('search', checkSearch);
  await tWarn('images', () => checkImages(prefs));
  t('environment', checkEnvironment);

  if (asJson) {
    doctorReportPanel(checks, { title: 'doctor', verbose, json: true });
    const failCount = checks.filter((c) => c.status === 'fail').length;
    process.exit(failCount === 0 ? 0 : 1);
    return;
  }

  doctorReportPanel(checks, { title: 'doctor', verbose });
  const failCount = checks.filter((c) => c.status === 'fail').length;
  if (failCount > 0) exit(1);
}

function banner() {
  printBanner(PKG.version);
  if (!isInteractive()) return;
  // Quick post-banner status: cwd + provider + keys (so users see at a glance
  // what state they're in).
  const keys = listKeys();
  const prefs = readPreferences();
  const provider = String(prefs.MODEL_PROVIDER || (keys.openrouter && !keys.groq ? 'openrouter' : 'groq')).toLowerCase();
  const model = provider === 'openrouter'
    ? (prefs.OPENROUTER_MODEL || 'anthropic/claude-3.5-sonnet')
    : provider === 'llama'
      ? (prefs.LLAMA_MODEL || llama.DEFAULT_MODEL)
      : (prefs.GROQ_MODEL || 'llama-3.3-70b-versatile');
  const workspaceState = existsSync(PREFERENCES_FILE) ? 'ready' : 'missing';
  printStartupBox({
    version: PKG.version,
    cwd: process.cwd(),
    workspace: workspaceState,
    mode: readMode(),
    provider,
    model,
    keysConfigured: Object.keys(keys),
    imageProvider: prefs.IMAGE_PROVIDER || 'unsplash',
  });
}



async function main() {
  const argv = process.argv.slice(2);
  const cmd = argv[0];

  if (!cmd || cmd === '--help' || cmd === '-h') {
    banner();
    process.stdout.write(USAGE);
    return;
  }
  if (cmd === '--version' || cmd === '-v') {
    process.stdout.write(`${PKG.version}\n`);
    return;
  }

  banner();
  switch (cmd) {
    case 'init':           return cmdInit(argv.slice(1));
    case 'mode':           return cmdMode(argv.slice(1));
    case 'set-key':        return cmdSetKey(argv.slice(1));
    case 'keys':           return cmdKeys();
    case 'set-max-results': return cmdSetMaxResults(argv.slice(1));
    case 'research':       return cmdResearch(argv.slice(1));
    case 'history':        return cmdHistory();
    case 'last':           return cmdLast();
    case 'preferences':    return cmdPreferences(argv.slice(1));
    case 'view-models':    return cmdViewModels(argv.slice(1));
    case 'doc':            return cmdDoc(argv.slice(1));
    case 'doctor':         return cmdDoctor(argv.slice(1));
    default:
      errorPanel('unknown command', `"${cmd}"`);
      exit(1, USAGE);
  }
}

main().catch((err) => {
  if (err && err.message && /User force closed|Canceled|cancelled/i.test(err.message)) {
    process.exit(130);
  }
  process.stderr.write(`elora-voss: ${err.message}\n`);
  if (err.stack) process.stderr.write(err.stack + '\n');
  process.exit(1);
});
