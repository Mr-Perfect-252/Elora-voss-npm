# elora-voss

[![npm version](https://img.shields.io/badge/npm-v0.4.0-blue)](https://www.npmjs.com/package/elora-voss)
[![node](https://img.shields.io/badge/node-%E2%89%A518-green)](https://nodejs.org)
[![license](https://img.shields.io/badge/license-MIT-purple)](./LICENSE)
[![made with](https://img.shields.io/badge/UI-chalk%20%2B%20ora%20%2B%20inquirer-cyan)](https://github.com/chalk/chalk)

> A research and authoring agent. Searches the web, builds a verified knowledge base, writes publication-quality narrative articles — from your terminal.

```bash
npm install -g elora-voss
elora-voss init
elora-voss set-key groq YOUR_KEY
elora-voss research "why the universe should not exist"
```

`elora-voss` is a small CLI that runs a six-phase pipeline against the open web and a frontier LLM. It is opinionated about the output: long-form, flowing prose in the spirit of magazine features, with inline images, a verifiable knowledge base, and a per-run history you can audit.

The first-run experience is fully interactive: a banner, a workspace wizard, a masked key prompt, and a live progress view as the pipeline runs.

## Table of contents

- [Why elora-voss](#why-elora-voss)
- [Quickstart (60 seconds)](#quickstart-60-seconds)
- [What it does in 30 seconds](#what-it-does-in-30-seconds)
- [Commands](#commands)
- [Workspace](#workspace)
- [Pipeline](#pipeline)
- [Providers](#providers)
- [Tuning your output](#tuning-your-output)
- [Troubleshooting](./TROUBLESHOOTING.md)
- [Examples](./EXAMPLES.md)
- [Architecture](./ARCHITECTURE.md)
- [License](#license)

## Why elora-voss

- **Verifiable, not hallucinated.** Every claim in the final article is anchored to a hit in the search phase and graded HIGH / MEDIUM / LOW by a critic pass. The full knowledge base is written to `history/context_NNN.md` for every run.
- **Magazine-feature prose, not bullet points.** The writer phase produces flowing narrative with a hook, a middle, and a closing that gives the reader something to carry.
- **Terminal-native.** Big ASCII banner, framed panels, live spinners that update with in-place stats (hits, claims, sources, word count), and interactive wizards for setup. No browser, no Electron, no web UI.
- **Bring your own key, your own model.** Groq (default, free) or OpenRouter (any frontier model). Wikipedia, Unsplash, Pexels, or no images at all.
- **Zero telemetry.** The CLI makes outbound calls only to the providers you configure. No analytics, no phone-home.

## Quickstart (60 seconds)

```bash
# 1. Install once (registers `elora-voss` as a global command)
npm install -g elora-voss

# 2. From any project folder, set it up
elora-voss init
elora-voss set-key groq YOUR_KEY

# 3. Run your first research article
elora-voss research "what makes cicadas synchronise their life cycles"

# 4. Read it
cat output.txt
```

> **Tip:** after `npm install -g elora-voss`, the `elora-voss` command is on
> your PATH. You do **not** need `node bin/elora-voss.js …` — that is the
> internal path npm uses to wire the global command, not something you type.
> Use `elora-voss --help` to see every command.

The first run shows a banner, a startup status box, and then six live spinners as the pipeline executes:

```
███████╗██╗      ██████╗ ██████╗  █████╗      ██╗   ██╗ ██████╗ ███████╗███████╗
██╔════╝██║     ██╔═══██╗██╔══██╗██╔══██╗     ██║   ██║██╔═══██╗██╔════╝██╔════╝
...
  research and writing, terminal-native.  · v0.4.0

╭ status ╮
│ workspace  ready                              │
│ cwd        /Users/you/notes                   │
│ llm        groq · llama-3.3-70b-versatile     │
│ keys       groq, unsplash                     │
│ images     unsplash                           │
╰───────────────────────────────────────────────╯

  [1/6] ✓ Searching the web 8.2s · duckduckgo · 12 hits
  [2/6] ✓ Cross-checking facts 6.1s · 8 claims · 1 flagged
  [3/6] ✓ Building knowledge base 4.7s · saved → ./history/context_001.md
  [4/6] ✓ Verifying knowledge base 3.3s · 9 facts after verification
  [5/6] ✓ Writing article 18.4s · 1018 words
  [6/6] ✓ Finding images 9.2s · 4 of 4 inserted
```

## What it does in 30 seconds

```
   ┌─────────┐    ┌────────────┐    ┌────────────┐    ┌──────────┐
   │ Search  │ →  │ Cross-check│ →  │ Knowledge  │ →  │  Verify  │
   │ web for │    │ facts w/   │    │ base (KB)  │    │  KB for  │
   │ topic   │    │ critic LLM │    │  + save    │    │ contrad. │
   └─────────┘    └────────────┘    └────────────┘    └──────────┘
                                                            │
                                                            ▼
   ┌─────────┐    ┌────────────┐    ┌────────────────────────────┐
   │ history │ ←  │ Illustrate │ ←  │ Write narrative article    │
   │ (CSV,   │    │ (3-5 imgs) │    │ from KB + preferences      │
   │  KB)    │    │            │    │                            │
   └─────────┘    └────────────┘    └────────────────────────────┘
```

See [ARCHITECTURE.md](./ARCHITECTURE.md) for the data flow, file responsibilities, and provider matrix.

## Commands

| Command                                          | What it does                                                                                |
| ------------------------------------------------ | ------------------------------------------------------------------------------------------- |
| `elora-voss init`                                | Create local workspace files. Interactive by default. Pass `--no-wizard` to skip prompts.   |
| `elora-voss set-key <provider> [key]`            | Save an API key. `provider` ∈ `groq \| openrouter \| tavily \| unsplash \| pexels`. If `key` is omitted and stdout is a TTY, prompts with a masked input. |
| `elora-voss keys`                                | Show which API keys are saved, with masked display.                                         |
| `elora-voss set-max-results <n>`                 | Set Tavily `max_results` (1-20, default 15).                                                |
| `elora-voss research "<topic>"`                  | Run the full six-phase pipeline.                                                            |
| `elora-voss history`                             | List past research runs as a boxed table.                                                   |
| `elora-voss last`                                | Print the most recent article inside a framed panel.                                        |
| `elora-voss preferences [--editor]`              | Edit preferences interactively. Pass `--editor` (or run non-interactively) to open `$EDITOR`. |
| `elora-voss --version`                           | Show installed version.                                                                     |
| `elora-voss --help`                              | Show usage.                                                                                 |

### Non-interactive mode

Every interactive flow has a non-interactive escape hatch — useful for CI, scripts, and SSH sessions where stdout is not a TTY:

| Flow                    | Non-interactive path                                             |
| ----------------------- | ---------------------------------------------------------------- |
| `elora-voss init`       | `elora-voss init --no-wizard` — creates files silently.          |
| `elora-voss set-key`    | Pass the key as the second arg: `elora-voss set-key groq gsk_…` |
| `elora-voss preferences`| `elora-voss preferences --editor` — opens `$EDITOR` instead.     |

The CLI auto-detects when stdout is not a TTY and silently downgrades — so piping `elora-voss history | cat` gives you a clean text table, never ANSI escape codes.

## Workspace

After `elora-voss init`:

```
./elora-voss/                  (or your chosen cwd)
├── config              API keys (KEY=VALUE)
├── preferences.txt     personalisation settings
├── topics.csv          research history
├── output.txt          most recent article (always)
└── history/
    ├── context_NNN.md  verified knowledge base from run N
    └── output_NNN.md   article from run N
```

The CLI operates on the current working directory. Run `elora-voss init` once per project folder.

## Pipeline

Six phases, run sequentially:

1. **Search** — DuckDuckGo (default) or Tavily. Returns 10–15 hits with snippets.
2. **Cross-check** — A critic LLM pass labels every claim HIGH / MEDIUM / LOW.
3. **Knowledge base** — Compiles a structured markdown KB. **Saved to disk before phase 4** so it survives if the writer fails.
4. **Verify** — Removes contradictions, moves speculative claims to "flagged".
5. **Write** — Narrative article, 800–1200 words by default, no headers, with a hook and a closing.
6. **Illustrate** — 3–5 inline images, picked by an art-director LLM call. Skipped if `INCLUDE_IMAGES=false`.

## Providers

### LLM (`MODEL_PROVIDER`)

| Provider    | Key command                                  | Default model               |
| ----------- | -------------------------------------------- | --------------------------- |
| `groq`      | `elora-voss set-key groq YOUR_KEY`           | `llama-3.3-70b-versatile`   |
| `openrouter`| `elora-voss set-key openrouter YOUR_KEY`     | `anthropic/claude-3.5-sonnet` |

Set `MODEL_PROVIDER` in `preferences.txt`. Optional `GROQ_MODEL` / `OPENROUTER_MODEL` overrides.

### Search (`--search`, picked automatically)

- **DuckDuckGo** — default, no key, occasionally rate-limited.
- **Tavily** — used as a fallback when DuckDuckGo returns nothing. Requires a key.

### Images (`IMAGE_PROVIDER`)

| Provider    | Key required | Notes                                                                |
| ----------- | ------------ | -------------------------------------------------------------------- |
| `unsplash`  | yes (free)   | via the official `unsplash-js` SDK, with a REST fallback built-in    |
| `pexels`    | yes (free)   | Pexels REST API                                                      |
| `wikipedia` | **no**       | Wikimedia Commons + Wikipedia lead images, fully open-source          |

The illustrator tries the preferred provider first, then falls through the remaining configured providers until one returns a hit. Use `IMAGE_PROVIDER=wikipedia` to skip the API-key requirement entirely.

## Tuning your output

Edit `./preferences.txt` directly, or run `elora-voss preferences` for the interactive editor. Every key is optional and falls back to a sensible default:

```
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
```

The interactive editor exposes the most-edited knobs (TONE, LENGTH, STYLE, AUDIENCE, NICHE, IMAGE_PROVIDER) as radio lists, with current values pre-selected. Anything not in the editor is left untouched.

## License

MIT
