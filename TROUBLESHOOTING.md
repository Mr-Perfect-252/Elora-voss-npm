# Troubleshooting

Common failure modes, ordered by frequency. Each entry has: symptom → cause → fix.

---

## "I get a Groq 401 / 403"

**Symptom:** research fails at phase 2 (cross-check) with `401` or `403` from `api.groq.com`.

**Cause:** the saved Groq key is invalid, expired, or revoked. (Groq keys start with `gsk_`.)

**Fix:**

```bash
# 1. Confirm the saved key (masked display)
elora-voss keys

# 2. Get a fresh key from https://console.groq.com
# 3. Save it
elora-voss set-key groq
# (masked prompt — paste, hit enter)
```

If you don't want to use Groq, switch providers:

```
# preferences.txt
MODEL_PROVIDER=openrouter
```

…and save an OpenRouter key.

---

## "DuckDuckGo returns 0 hits"

**Symptom:**

```
[1/6] Searching the web... 0 hits
```

…or the search spinner reports zero hits and the pipeline continues with a thin knowledge base.

**Cause:** DuckDuckGo's public endpoint rate-limits unauthenticated requests, especially from cloud IPs.

**Fix:** add Tavily as a fallback. Get a key at [tavily.com](https://tavily.com), then:

```bash
elora-voss set-key tavily
```

The pipeline will use Tavily automatically when DuckDuckGo returns nothing.

---

## "Wikipedia images are wrong / low quality"

**Symptom:** articles come back with images that don't match the topic, or no images at all.

**Cause:** the Wikipedia provider is keyword-based and the art-director LLM occasionally picks abstract queries that Commons can't answer (e.g. "truth", "existence").

**Fix:** switch the image provider. Wikipedia is the no-key default; if you want better results, add a key:

```bash
elora-voss set-key unsplash    # or
elora-voss set-key pexels
```

…and set in `preferences.txt`:

```
IMAGE_PROVIDER=unsplash
```

If you want to keep the no-key setup but tighten the queries, raise `NICHE` to something concrete (`physics`, `history of computing`, `cooking`) — the LLM uses the niche to constrain image queries.

---

## "My preferences aren't taking effect"

**Symptom:** I edited `preferences.txt` and the next run still uses the old values.

**Cause:** most likely the file lives in the wrong directory. The CLI reads from `./preferences.txt` relative to the **current working directory**, not the install location of the package.

**Fix:**

```bash
# Check where the CLI is looking
elora-voss --version   # confirms install
pwd                    # confirms cwd
ls -la preferences.txt # confirms file in cwd
```

Run `elora-voss init` from the directory where you want the workspace, and re-edit `preferences.txt` there.

---

## "Banner doesn't show"

**Symptom:** no ASCII banner on startup.

**Cause:** the banner is suppressed when stdout is not a TTY. The CLI checks `process.stdout.isTTY`, plus three opt-out environment variables: `NO_BANNER`, `NO_COLOR`, `CI`.

**Fix:**

```bash
# Are you piping? Banner will skip.
elora-voss --help | cat    # no banner
elora-voss --help          # banner

# Is CI=1 set?
env | grep CI              # if set, banner suppressed by design

# Disable suppression
NO_BANNER=0 CI= elora-voss --help
```

---

## "Windows: editor doesn't open"

**Symptom:** `elora-voss preferences` errors with `Failed to open editor: …` on Windows.

**Cause:** no `$EDITOR` and no `$VISUAL` set, and the fallback `notepad` isn't on PATH (or isn't where the shell expects).

**Fix:**

```powershell
# PowerShell — set editor once per session
$env:EDITOR = "code"        # or "notepad++", "subl", etc.
elora-voss preferences --editor
```

…or just use the in-app wizard (the default on TTY):

```bash
elora-voss preferences      # interactive
```

---

## "Knowledge base is empty / article drifts off-topic"

**Symptom:** the writer's article introduces facts that aren't in the search hits, or wanders away from the topic.

**Cause:** the cross-check or knowledge-base phase got a malformed JSON response from the LLM. The pipeline is best-effort — it falls back to the raw notes if the JSON parse fails. When the KB is too thin, the writer's "go deeper on existing facts" instruction can sometimes leak outside the topic.

**Fix:**

- Run again — the result is non-deterministic by design (temperature > 0 for the writer).
- Edit the topic to be more specific. `why cicadas synchronise` beats `insects`.
- Drop a strong constraint into `NICHE` (e.g. `NICHE=evolutionary biology`).
- If the issue repeats with the same model, try a different `MODEL_PROVIDER` — different models have different prompt-stability characteristics.

---

## "Pipeline is slow"

**Symptom:** `elora-voss research` takes more than ~60 seconds.

**Cause:** some LLM providers (notably Anthropic on OpenRouter) have high latency on the 8K-output writer call.

**Fix:**

- Drop `LENGTH` to `medium (500-800 words)` — fewer output tokens, faster.
- Use Groq as the default — it's the fastest in this list.
- Lower the Tavily `max_results`:
  ```bash
  elora-voss set-max-results 8
  ```

---

## "Output.txt didn't update"

**Symptom:** I ran a new `research` and `output.txt` still shows the old article.

**Cause:** very unlikely. The pipeline writes `output.txt` at the end of every run. If the run failed in the write phase, the spinner will say "✗ Writing article" and the previous output is preserved.

**Fix:** re-run. If the second run also fails, capture the spinner line and check the error above it.

---

## "I want to wipe and start over"

**Fix:** delete the workspace files manually:

```bash
rm -rf config preferences.txt topics.csv output.txt history/
elora-voss init
```

There is no `elora-voss reset` — explicit is safer than implicit.
