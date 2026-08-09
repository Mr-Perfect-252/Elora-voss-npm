# Architecture

What runs where, what each file does, and how data moves through the pipeline.

---

## The pipeline at a glance

```
                  topic
                    │
                    ▼
        ┌───────────────────────┐
   1.   │        Search         │   hits + raw notes
        │  (duckduckgo / tavily)│
        └───────────┬───────────┘
                    │  hits, notes
                    ▼
        ┌───────────────────────┐
   2.   │      Cross-check      │   claims (HIGH/MED/LOW) + flagged
        │    (groq / openrouter)│
        └───────────┬───────────┘
                    │  claims, flagged
                    ▼
        ┌───────────────────────┐
   3.   │    Knowledge base     │   structured KB  ──► history/context_NNN.md   ◄── saved here on purpose
        │    (groq / openrouter)│
        └───────────┬───────────┘
                    │  KB
                    ▼
        ┌───────────────────────┐
   4.   │        Verify         │   cleaned KB (contradictions removed)
        │    (groq / openrouter)│
        └───────────┬───────────┘
                    │  KB
                    ▼
        ┌───────────────────────┐
   5.   │         Write         │   narrative article body
        │    (groq / openrouter)│
        └───────────┬───────────┘
                    │  article
                    ▼
        ┌───────────────────────┐
   6.   │      Illustrate       │   article + 3-5 inline <img> tags
        │  (unsplash/pexels/    │
        │   wikipedia)          │
        └───────────┬───────────┘
                    │
                    ▼
              output.txt  +  history/output_NNN.md
              topics.csv  (appended)
```

The KB is the durable artifact: it lands on disk at the end of phase 3 so a later failure (verify, write, or illustrate) still leaves the user with an auditable research record.

---

## File responsibilities

```
elora-voss/
├── bin/
│   └── elora-voss.js          thin shim — delegates to src/cli.js
└── src/
    ├── cli.js                 argv dispatch; wizard/panel orchestration
    ├── agent.js               runs the six phases in order
    │
    ├── ui/
    │   ├── banner.js          ASCII banner, gradient palette, startup status box
    │   ├── progress.js        ora-based phase spinners with live tick/succeed/fail
    │   └── panels.js          boxen panels (success/error/info/keyValue/table)
    │
    ├── wizard.js              interactive flows: init, set-key, preferences
    │
    ├── fs/
    │   ├── workspace.js       init workspace, read/write preferences.txt, append topics.csv
    │   └── history.js         per-run context_NNN.md / output_NNN.md, nextId, listHistory
    │
    ├── phases/
    │   ├── search.js          1. search the web, return hits + LLM notes
    │   ├── crosscheck.js      2. critic LLM pass — HIGH/MEDIUM/LOW labels
    │   ├── knowledge.js       3. compile structured KB + render to markdown
    │   ├── verify.js          4. self-check KB for contradictions
    │   ├── write.js           5. narrative article to the spec's quality bar
    │   └── illustrate.js      6. pick 3-5 image moments, fetch URLs, inline <img>
    │
    ├── search/
    │   ├── duckduckgo.js      no-key search, rate-limit aware
    │   └── tavily.js          key-required search, deeper results
    │
    ├── images/
    │   ├── unsplash.js        SDK + REST fallback, download-tracking
    │   ├── pexels.js          Pexels REST API
    │   └── wikipedia.js       Wikimedia Commons + Wikipedia lead images (no key)
    │
    ├── groq.js                LLM dispatcher — picks groq vs openrouter
    ├── openrouter.js          OpenRouter LLM provider (OpenAI-compatible REST)
    └── config.js              read/write ./config (API keys + tavily_max_results)
```

---

## Provider matrix

| Capability  | Default          | Fallback chain                                    | Key required |
| ----------- | ---------------- | ------------------------------------------------- | ------------ |
| LLM         | Groq             | OpenRouter                                        | yes (always) |
| Search      | DuckDuckGo       | Tavily (if key set)                               | no (DDG), yes (Tavily) |
| Images      | `IMAGE_PROVIDER` | unsplash → pexels → wikipedia (whichever has key) | depends      |

The LLM dispatcher (`src/groq.js`) is the single decision point. `pickProvider()` reads `MODEL_PROVIDER` from preferences; if unset, it prefers OpenRouter if its key is set and Groq is not, otherwise Groq.

The image illustrator (`src/phases/illustrate.js`) builds a *chain* of providers ordered by user preference, filtered to only those with a key (or no-key for Wikipedia), and walks the chain per query until one returns a hit. So a missing Unsplash key transparently falls through to Pexels, then Wikipedia.

---

## Adding a new LLM provider

1. Create `src/<name>.js` exporting a `chat(systemPrompt, userPrompt, opts)` function with the same shape as `groq.js` and `openrouter.js`.
2. In `src/groq.js`, add a branch in `pickProvider()` and `currentProvider()`, and a delegation in `chat()`.
3. Add a `setKey` validation in `src/config.js` if the provider needs a non-trivial format check.
4. Update `src/wizard.js` to surface the new provider in the setup wizard and `src/cli.js` to validate it in `set-key`.

That's it. No changes needed in the phase modules — they all call `chat()` abstractly.

---

## Adding a new image provider

1. Create `src/images/<name>.js` exporting `<name>Search(query, count)` that returns the standard `[{url, alt, ...}]` shape, and a `has<Key>Key()` function.
2. Add an entry to `VALID_PROVIDERS` in `src/phases/illustrate.js` and a branch in `resolveProviderChain()`.
3. Add the provider to the `IMAGE_PROVIDER` choice list in `src/wizard.js` and the key validation in `src/cli.js`.

---

## Why we use chalk + ora + inquirer

- **chalk** — colours. Universal, no terminal-API gymnastics. Auto-disables on NO_COLOR and on Windows non-TTY.
- **ora** — spinners. Updates a single line in place. We wrap it in `src/ui/progress.js` with a uniform `.tick()` / `.succeed()` / `.fail()` API.
- **inquirer** — interactive prompts. Used only in `src/wizard.js`; the rest of the CLI is happy in non-interactive environments. Provides `password` type with a `*` mask, which is the only safe way to enter a key.
- **boxen** — framed panels. Used in `src/ui/panels.js` for success/error/info/keyValue output.

The acceptance criterion for the dep tree: the CLI must work in CI, in a TTY, and when piped. The `isInteractive()` + `supportsColor()` guards in `src/ui/banner.js` make that automatic.

---

## On-disk layout

```
./                          (cwd, e.g. ~/notes/)
├── config                  KEY=VALUE — API keys + tavily_max_results
├── preferences.txt         KEY=VALUE — runtime preferences
├── topics.csv              CSV — append-only research log
├── output.txt              latest article (overwritten on each run)
└── history/
    ├── context_001.md      KB from run 1
    ├── output_001.md       article from run 1
    ├── context_002.md      KB from run 2
    └── output_002.md       article from run 2
```

`topics.csv` is the index. `history/context_NNN.md` and `history/output_NNN.md` are the per-run payloads. `output.txt` is the convenience pointer to the latest.
