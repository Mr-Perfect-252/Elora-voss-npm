// Interactive wizards for setup flows: workspace init, API key entry
// (with masked input), and the multi-step preferences editor.
//
// All prompts use inquirer. Keys are entered via inquirer's `password` type
// with a `*` mask so the secret never echoes. Ctrl+C returns null; the CLI
// dispatcher translates that to a clean exit 130.
import inquirer from 'inquirer';
import chalk from 'chalk';

import { workspaceInit, readPreferences, writePreferences, readMode, MODE_VALUES } from './fs/workspace.js';
import { setKey, getKey, listKeys } from './config.js';
import * as llm from './groq.js';
import * as openrouter from './openrouter.js';
import * as llama from './llama.js';
import { printStartupBox, isInteractive, supportsColor } from './ui/banner.js';
import { successPanel, infoPanel, warnPanel, keyValuePanel } from './ui/panels.js';

const PROVIDERS_LLM = [
  { name: 'Groq (free, default)', value: 'groq' },
  { name: 'OpenRouter (paid, many models)', value: 'openrouter' },
  { name: 'Local llama (offline, no key)', value: 'llama' },
];

const PROVIDERS_KEYS = [
  { name: 'groq        — LLM (required for default)', value: 'groq' },
  { name: 'openrouter  — LLM via OpenRouter', value: 'openrouter' },
  { name: 'llama       — local LLM (optional token, base URL in preferences)', value: 'llama' },
  { name: 'tavily      — search (optional)', value: 'tavily' },
  { name: 'unsplash    — article images (optional)', value: 'unsplash' },
  { name: 'pexels      — article images (optional)', value: 'pexels' },
];

const TONE_PRESETS = [
  'intelligent and narrative, like a magazine feature',
  'lucid, almost conversational — explanatory without being chatty',
  'formal, academic-leaning, with careful hedging',
  'playful but rigorous — long-form science journalism',
  'essayistic, with the voice of a personal essayist',
];

const LENGTH_PRESETS = [
  'short (300-500 words)',
  'medium (500-800 words)',
  'long-form (800-1200 words)',
  'deep-dive (1200-1800 words)',
];

const STYLE_PRESETS = [
  'editorial essay',
  'feature article',
  'explainer',
  'profile / portrait',
  'reported piece',
];

const IMAGE_PROVIDERS = [
  { name: 'unsplash (needs API key)', value: 'unsplash' },
  { name: 'pexels (needs API key)', value: 'pexels' },
  { name: 'wikipedia (no key required)', value: 'wikipedia' },
];

const MODE_CHOICES = [
  { name: 'simple   — just run research, no extra questions', value: 'simple' },
  { name: 'standard — walk me through setup and let me pick models per phase', value: 'standard' },
  { name: 'expert   — standard + extra diagnostics in --verbose', value: 'expert' },
];

/**
 * Guard for non-interactive environments. Returns the sentinel '__cancel__'
 * so callers can branch on it without throwing.
 */
async function guardNonInteractive() {
  if (isInteractive()) return null;
  return '__cancel__';
}

/**
 * Persist a mode change. Used by the `mode` subcommand and the preferences wizard.
 * @param {'simple'|'standard'|'expert'} mode
 */
export function applyMode(mode) {
  if (!MODE_VALUES.includes(mode)) {
    throw new Error(`Unknown mode "${mode}". Valid: ${MODE_VALUES.join(', ')}`);
  }
  writePreferences({ MODE: mode });
  return mode;
}

/**
 * Interactive mode picker. Default is the current MODE setting.
 * @returns {Promise<'__cancel__'|'simple'|'standard'|'expert'>}
 */
export async function modeWizard() {
  const guard = await guardNonInteractive();
  if (guard) return guard;

  const cur = readMode();
  const ans = await inquirer.prompt([
    {
      type: 'list',
      name: 'mode',
      message: 'How do you want to use elora-voss?',
      choices: MODE_CHOICES,
      default: cur,
    },
  ]);
  return ans.mode;
}

/**
 * @param {object} [opts]
 * @param {boolean} [opts.skipKey] - if true, do not prompt for the first key
 * @returns {Promise<'__cancel__' | void>}
 */
export async function initWizard(opts = {}) {
  const guard = await guardNonInteractive();
  if (guard) return guard;

  // Read current mode (lazy-initialises the workspace via readPreferences).
  const mode = readMode();
  const isSimple = mode === 'simple';

  infoPanel('workspace init', [
    `Working directory: ${chalk.cyan(process.cwd())}`,
    `Mode: ${chalk.cyan(mode)}`,
    `This will create:`,
    `  ${chalk.dim('preferences.txt')}   personalisation settings`,
    `  ${chalk.dim('topics.csv')}         research history`,
    `  ${chalk.dim('output.txt')}         most recent article`,
    `  ${chalk.dim('history/')}           per-run context + article files`,
  ].join('\n'));

  // In simple mode, the only thing we need confirmation for is "create the
  // workspace here?". Skip the rest of the gatekeeping.
  if (isSimple) {
    workspaceInit();
  } else {
    const { proceed } = await inquirer.prompt([
      {
        type: 'confirm',
        name: 'proceed',
        message: 'Create the workspace here?',
        default: true,
      },
    ]);
    if (!proceed) {
      warnPanel('cancelled', 'Workspace not created.');
      return;
    }
    workspaceInit();
  }

  const keys = listKeys();
  const hasGroq = Boolean(keys.groq);
  const hasOpenRouter = Boolean(keys.openrouter);

  if (!opts.skipKey && !hasGroq && !hasOpenRouter) {
    const { llmChoice } = await inquirer.prompt([
      {
        type: 'list',
        name: 'llmChoice',
        message: 'Which LLM provider would you like to use?',
        choices: PROVIDERS_LLM,
      },
    ]);
    const keyResult = await setKeyWizard(llmChoice);
    if (keyResult === '__cancel__') {
      warnPanel('cancelled', 'Workspace created, but no API key set yet.');
      return;
    }
  }

  // Simple mode: skip the preferences prompt. New users should be able to
  // start a research run with zero further questions.
  if (!isSimple) {
    const { tunePrefs } = await inquirer.prompt([
      {
        type: 'confirm',
        name: 'tunePrefs',
        message: 'Tune preferences now? (TONE, LENGTH, audience…)',
        default: false,
      },
    ]);
    if (tunePrefs) {
      const prefResult = await preferencesWizard();
      if (prefResult === '__cancel__') {
        warnPanel('cancelled', 'Preferences left at defaults.');
      }
    }
  }

  const finalKeys = listKeys();
  const finalPrefs = readPreferences();
  const provider = finalPrefs.MODEL_PROVIDER || (finalKeys.openrouter ? 'openrouter' : 'groq');
  const model = provider === 'openrouter'
    ? (finalPrefs.OPENROUTER_MODEL || 'anthropic/claude-3.5-sonnet')
    : provider === 'llama'
      ? (finalPrefs.LLAMA_MODEL || 'llama3.1')
      : (finalPrefs.GROQ_MODEL || 'llama-3.3-70b-versatile');

  printStartupBox({
    version: '0.4.0',
    cwd: process.cwd(),
    workspace: 'ready',
    provider,
    model,
    mode: readMode(),
    keysConfigured: Object.keys(finalKeys),
    imageProvider: finalPrefs.IMAGE_PROVIDER || 'unsplash',
  });

  successPanel('ready', [
    `Next:`,
    `  ${chalk.cyan('elora-voss research "<your topic>"')}`,
    ``,
    `Switch to a more chatty mode later: ${chalk.dim('elora-voss mode')}`,
    `Need another key later? ${chalk.dim('elora-voss set-key <provider>')}`,
  ].join('\n'));
}

/**
 * Interactive set-key. If `provider` is null, prompts to pick one. Always uses
 * a masked password field for the key.
 *
 * @param {string|null} provider
 * @returns {Promise<'__cancel__' | void>}
 */
export async function setKeyWizard(provider) {
  const guard = await guardNonInteractive();
  if (guard) return guard;

  let chosen = provider;
  if (!chosen) {
    const ans = await inquirer.prompt([
      {
        type: 'list',
        name: 'provider',
        message: 'Which provider do you want to configure?',
        choices: PROVIDERS_KEYS,
        pageSize: 10,
      },
    ]);
    chosen = ans.provider;
  }
  if (!PROVIDERS_KEYS.some((p) => p.value === chosen)) {
    warnPanel('unsupported', `Unknown provider "${chosen}".`);
    return '__cancel__';
  }

  const existing = getKey(chosen);
  const existingDisplay = existing ? maskKey(existing) : chalk.dim('not set');

  const { key } = await inquirer.prompt([
    {
      type: 'password',
      name: 'key',
      message: `Enter ${chalk.cyan(chosen)} key (current: ${existingDisplay}):`,
      mask: '*',
      validate: (v) => {
        if (!v || !v.trim()) return 'Key cannot be empty';
        if (v.trim().length < 8) return 'Key looks too short — paste the full key';
        return true;
      },
    },
  ]);

  const { confirm } = await inquirer.prompt([
    {
      type: 'confirm',
      name: 'confirm',
      message: `Save ${chosen} key to ${chalk.dim(process.cwd() + '/config')}?`,
      default: true,
    },
  ]);
  if (!confirm) {
    warnPanel('cancelled', 'Key not saved.');
    return;
  }

  setKey(chosen, key.trim());
  successPanel('key saved', [
    `${chalk.cyan(chosen)} → ${maskKey(getKey(chosen))}`,
    `config: ${chalk.dim(process.cwd() + '/config')}`,
  ].join('\n'));
}

/**
 * Multi-step preferences editor. Each step shows the current value as the default.
 *
 * @returns {Promise<'__cancel__' | void>}
 */
export async function preferencesWizard() {
  const guard = await guardNonInteractive();
  if (guard) return guard;

  const cur = readPreferences();
  const keys = listKeys();
  const llmChoices = [
    ...PROVIDERS_LLM,
  ];
  // Only offer OpenRouter as a model provider if its key is set; same for Groq.
  // Local llama needs no key — just a reachable base URL — so it's always usable.
  const usable = llmChoices.filter((c) => {
    if (c.value === 'groq') return Boolean(keys.groq);
    if (c.value === 'openrouter') return Boolean(keys.openrouter);
    if (c.value === 'llama') return true;
    return true;
  });

  const imageChoices = IMAGE_PROVIDERS.filter((p) => {
    if (p.value === 'unsplash') return Boolean(keys.unsplash);
    if (p.value === 'pexels') return Boolean(keys.pexels);
    return true; // wikipedia always
  });

  const toneDefault = TONE_PRESETS.includes(cur.TONE) ? cur.TONE : 'custom…';
  const currentMode = readMode();
  const ans = await inquirer.prompt([
    {
      type: 'list',
      name: 'MODE',
      message: 'How do you want to use elora-voss? (mode)',
      choices: MODE_CHOICES,
      default: currentMode,
    },
    {
      type: 'list',
      name: 'TONE',
      message: 'Tone of voice:',
      choices: [
        ...TONE_PRESETS,
        { name: '──────────  or  ──────────', value: '__sep__', disabled: true },
        'custom…',
      ],
      default: toneDefault,
    },
    {
      type: 'list',
      name: 'LENGTH',
      message: 'Article length:',
      choices: LENGTH_PRESETS,
      default: LENGTH_PRESETS.includes(cur.LENGTH) ? cur.LENGTH : 'long-form (800-1200 words)',
    },
    {
      type: 'list',
      name: 'STYLE',
      message: 'Writing style:',
      choices: STYLE_PRESETS,
      default: STYLE_PRESETS.includes(cur.STYLE) ? cur.STYLE : 'editorial essay',
    },
    {
      type: 'input',
      name: 'NICHE',
      message: 'Niche / subject area:',
      default: cur.NICHE || 'general science and technology',
    },
    {
      type: 'input',
      name: 'AUDIENCE',
      message: 'Audience:',
      default: cur.AUDIENCE || 'curious general readers with no specialist knowledge',
    },
    {
      type: 'input',
      name: 'LANGUAGE',
      message: 'Language:',
      default: cur.LANGUAGE || 'English',
    },
    {
      type: 'confirm',
      name: 'INCLUDE_IMAGES',
      message: 'Include inline images in articles?',
      default: String(cur.INCLUDE_IMAGES || 'true').toLowerCase() !== 'false',
    },
    {
      type: 'list',
      name: 'MODEL_PROVIDER',
      message: 'LLM provider:',
      choices: usable.length ? usable : PROVIDERS_LLM,
      default: cur.MODEL_PROVIDER && usable.some((c) => c.value === cur.MODEL_PROVIDER)
        ? cur.MODEL_PROVIDER
        : (keys.openrouter && !keys.groq ? 'openrouter' : 'groq'),
    },
    {
      type: 'list',
      name: 'IMAGE_PROVIDER',
      message: 'Image provider:',
      choices: imageChoices,
      default: cur.IMAGE_PROVIDER && imageChoices.some((c) => c.value === cur.IMAGE_PROVIDER)
        ? cur.IMAGE_PROVIDER
        : (keys.unsplash ? 'unsplash' : keys.pexels ? 'pexels' : 'wikipedia'),
    },
  ]);

  // If TONE was "custom…", prompt for a free-form value.
  if (ans.TONE === 'custom…') {
    const { customTone } = await inquirer.prompt([
      { type: 'input', name: 'customTone', message: 'Describe the tone in your own words:', default: cur.TONE || TONE_PRESETS[0] },
    ]);
    ans.TONE = customTone;
  }

  // Model picker: fetch live models from the chosen provider and let user pick.
  // Skipped in simple mode (new users should not have to pick a model).
  let selectedModel = null;
  if (ans.MODE === 'simple') {
    infoPanel('simple mode', 'Skipping per-phase model picker. The default model for your provider will be used.');
  } else {
    const chosenProvider = ans.MODEL_PROVIDER;
    // Local llama needs no key — only a reachable base URL. Always attempt.
    const needsKey = chosenProvider !== 'llama';
    const hasKey = getKey(chosenProvider);
    if (!needsKey || hasKey) {
      infoPanel('fetching models', `Loading available ${chosenProvider} models…`);
      try {
        const models = chosenProvider === 'openrouter'
          ? await openrouter.listModels()
          : chosenProvider === 'llama'
            ? await llama.listModels()
            : await llm.listModels();
        if (models.length > 0) {
          const currentModel = chosenProvider === 'openrouter'
            ? (cur.OPENROUTER_MODEL || openrouter.DEFAULT_MODEL)
            : chosenProvider === 'llama'
              ? (cur.LLAMA_MODEL || llama.DEFAULT_MODEL)
              : (cur.GROQ_MODEL || 'llama-3.3-70b-versatile');
          const choices = models.map((m) => ({
            name: m.name !== m.id ? `${m.id}  ${chalk.dim('(' + m.name + ')')}` : m.id,
            value: m.id,
          }));
          choices.push(
            { name: '──────────', value: '__sep__', disabled: true },
            { name: 'Type a model ID manually…', value: '__manual__' },
          );
          let defaultIdx = choices.findIndex((c) => c.value === currentModel);
          if (defaultIdx === -1) defaultIdx = 0;
          const { pickedModel } = await inquirer.prompt([
            {
              type: 'list',
              name: 'pickedModel',
              message: `Pick a ${chosenProvider} model:`,
              choices,
              pageSize: 20,
              default: defaultIdx,
            },
          ]);
          if (pickedModel === '__manual__') {
            const { manualModel } = await inquirer.prompt([
              { type: 'input', name: 'manualModel', message: 'Enter model ID:', default: currentModel },
            ]);
            selectedModel = manualModel.trim();
          } else {
            selectedModel = pickedModel;
          }
        } else {
          warnPanel('no models', `${chosenProvider} returned zero models.`);
        }
      } catch (err) {
        warnPanel('fetch failed', `Could not load models: ${err.message}\nKeeping current model setting.`);
      }
    } else {
      warnPanel('no key', `No API key for ${chosenProvider}. Set one with: elora-voss set-key ${chosenProvider}`);
    }
  }

  const next = {
    MODE: ans.MODE,
    TONE: ans.TONE,
    LENGTH: ans.LENGTH,
    STYLE: ans.STYLE,
    NICHE: ans.NICHE,
    AUDIENCE: ans.AUDIENCE,
    LANGUAGE: ans.LANGUAGE,
    INCLUDE_IMAGES: ans.INCLUDE_IMAGES ? 'true' : 'false',
    MODEL_PROVIDER: ans.MODEL_PROVIDER,
    IMAGE_PROVIDER: ans.IMAGE_PROVIDER,
  };
  if (selectedModel) {
    if (ans.MODEL_PROVIDER === 'openrouter') {
      next.OPENROUTER_MODEL = selectedModel;
    } else if (ans.MODEL_PROVIDER === 'llama') {
      next.LLAMA_MODEL = selectedModel;
    } else {
      next.GROQ_MODEL = selectedModel;
    }
  }
  // If the user picked local llama, also offer to confirm/customise the host + port.
  if (ans.MODEL_PROVIDER === 'llama') {
    const current = llama.endpoint();
    const presets = [
      { name: `${llama.DEFAULT_HOST}:${llama.DEFAULT_PORT}  (default — llama.cpp / LM Studio)`, value: { host: llama.DEFAULT_HOST, port: llama.DEFAULT_PORT } },
      { name: '127.0.0.1:11434  (ollama)', value: { host: '127.0.0.1', port: 11434 } },
      { name: '127.0.0.1:1234   (LM Studio default)', value: { host: '127.0.0.1', port: 1234 } },
      { name: '127.0.0.1:5000   (vLLM / custom)', value: { host: '127.0.0.1', port: 5000 } },
    ];

    // If current settings match a preset, use it as the default; otherwise
    // surface a "custom" option.
    const matchIdx = presets.findIndex((p) => p.value.host === current.host && p.value.port === current.port);
    const customValue = { host: '__custom__', port: 0 };
    const choices = [
      ...presets,
      { name: '──────────  or  ──────────', value: '__sep__', disabled: true },
      { name: 'Custom host / port…', value: customValue },
    ];

    const { endpointPick } = await inquirer.prompt([
      {
        type: 'list',
        name: 'endpointPick',
        message: `Where is your local llama server running? (current: ${chalk.cyan(current.host + ':' + current.port)})`,
        choices,
        default: matchIdx >= 0 ? matchIdx : choices.length - 1,
      },
    ]);

    let chosen = endpointPick;
    if (!endpointPick || endpointPick === customValue) {
      const ans2 = await inquirer.prompt([
        {
          type: 'input',
          name: 'host',
          message: 'Host:',
          default: current.host,
        },
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
      chosen = { host: ans2.host.trim(), port: parseInt(ans2.port, 10) };
    }

    // Persist as LLAMA_HOST / LLAMA_PORT (preferred, friendlier in the file)
    // unless the user wants the full base URL form — we always normalise to
    // host+port here so the file stays readable.
    next.LLAMA_HOST = chosen.host;
    next.LLAMA_PORT = String(chosen.port);
    // Clear any stale full-URL entry so the host/port pair wins on next read.
    if (cur.LLAMA_BASE_URL) next.LLAMA_BASE_URL = '';
  }
  writePreferences(next);

  successPanel('preferences saved', `Wrote ${Object.keys(next).length} settings to ${chalk.dim(process.cwd() + '/preferences.txt')}.`);

  if (next.MODE === 'expert') {
    infoPanel('expert mode', 'Timings and per-phase details will be visible with `elora-voss doctor --verbose`.');
  }

  // Echo a small summary table
  keyValuePanel(
    Object.entries(next).map(([k, v]) => [k, v]),
    { title: 'preferences', color: 'cyan' }
  );
}

function maskKey(k) {
  if (!k) return chalk.dim('(empty)');
  if (k.length <= 8) return chalk.dim('****');
  return chalk.dim(`${k.slice(0, 4)}…${k.slice(-4)}`) + chalk.dim(` (len=${k.length})`);
}

const PHASE_DEFS = [
  { key: 'search',     label: '1. Search (research notes)' },
  { key: 'crosscheck', label: '2. Cross-check (fact verification)' },
  { key: 'knowledge',  label: '3. Knowledge base (structured compilation)' },
  { key: 'verify',     label: '4. Verify (self-check KB)' },
  { key: 'write',      label: '5. Write (narrative article)' },
  { key: 'illustrate', label: '6. Illustrate (image placement)' },
];

/**
 * Pick a single provider+model combination interactively.
 * @param {string} defaultProvider
 * @param {string} defaultModel
 * @param {string} [label] - phase label shown in prompt
 * @returns {Promise<{provider: string, model: string}>}
 */
async function pickSingleModel(defaultProvider, defaultModel, label) {
  const keys = listKeys();
  const usable = PROVIDERS_LLM.filter((c) => {
    if (c.value === 'groq') return Boolean(keys.groq);
    if (c.value === 'openrouter') return Boolean(keys.openrouter);
    if (c.value === 'llama') return true; // local, no key
    return true;
  });

  const prefix = label ? `${chalk.bold(label)} — ` : '';

  const { chosenProvider } = await inquirer.prompt([
    {
      type: 'list',
      name: 'chosenProvider',
      message: `${prefix}LLM provider:`,
      choices: usable.length ? usable : PROVIDERS_LLM,
      default: usable.some((c) => c.value === defaultProvider) ? defaultProvider : undefined,
    },
  ]);

  let selectedModel = defaultModel;
  const needsKey = chosenProvider !== 'llama';
  const hasKey = getKey(chosenProvider);
  if (!needsKey || hasKey) {
    try {
      const models = chosenProvider === 'openrouter'
        ? await openrouter.listModels()
        : chosenProvider === 'llama'
          ? await llama.listModels()
          : await llm.listModels();
      if (models.length > 0) {
        const choices = models.map((m) => ({
          name: m.name !== m.id ? `${m.id}  ${chalk.dim('(' + m.name + ')')}` : m.id,
          value: m.id,
        }));
        choices.push(
          { name: '──────────', value: '__sep__', disabled: true },
          { name: 'Type a model ID manually…', value: '__manual__' },
        );
        let defaultIdx = choices.findIndex((c) => c.value === defaultModel);
        if (defaultIdx === -1) defaultIdx = 0;
        const { pickedModel } = await inquirer.prompt([
          {
            type: 'list',
            name: 'pickedModel',
            message: `${prefix}Model:`,
            choices,
            pageSize: 20,
            default: defaultIdx,
          },
        ]);
        if (pickedModel === '__manual__') {
          const { manualModel } = await inquirer.prompt([
            { type: 'input', name: 'manualModel', message: 'Enter model ID:', default: defaultModel },
          ]);
          selectedModel = manualModel.trim();
        } else {
          selectedModel = pickedModel;
        }
      }
    } catch (err) {
      warnPanel('fetch failed', `Could not load models: ${err.message}\nUsing default.`);
    }
  }

  return { provider: chosenProvider, model: selectedModel };
}

/**
 * Pre-pipeline wizard: lets users pick a model for each phase individually,
 * or use the same model for all phases.
 *
 * @param {string} defaultProvider
 * @param {string} defaultModel
 * @returns {Promise<'__cancel__' | Record<string, {provider: string, model: string}>>}
 */
export async function phaseModelPickerWizard(defaultProvider, defaultModel) {
  const guard = await guardNonInteractive();
  if (guard) return guard;

  infoPanel('model selection', [
    'Choose which LLM model to use for each pipeline phase.',
    'Different phases benefit from different models:',
    `  ${chalk.dim('Search/Crosscheck/Verify')} — structured output, lower temperature`,
    `  ${chalk.dim('Write')}                    — creative prose, higher temperature`,
    '',
    `Default: ${chalk.cyan(defaultProvider + '/' + defaultModel)}`,
  ].join('\n'));

  const { useSame } = await inquirer.prompt([
    {
      type: 'confirm',
      name: 'useSame',
      message: 'Use the same model for all phases?',
      default: true,
    },
  ]);

  const config = {};

  if (useSame) {
    const chosen = await pickSingleModel(defaultProvider, defaultModel, 'All phases');
    for (const p of PHASE_DEFS) config[p.key] = chosen;
  } else {
    for (const phase of PHASE_DEFS) {
      config[phase.key] = await pickSingleModel(defaultProvider, defaultModel, phase.label);
    }
  }

  // Summary
  const lines = PHASE_DEFS.map((p) => {
    const c = config[p.key];
    return `  ${chalk.dim(p.label.padEnd(40))} ${chalk.cyan(c.provider + '/' + c.model)}`;
  });
  successPanel('models selected', lines.join('\n'));

  return config;
}

export { PROVIDERS_LLM, PROVIDERS_KEYS, TONE_PRESETS, LENGTH_PRESETS, STYLE_PRESETS };
