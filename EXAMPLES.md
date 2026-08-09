# Examples

Five worked examples, plus one "tuning the output" walkthrough. Each example shows the topic you pass to `elora-voss research`, the kind of article that comes out, and a few hints on which preferences to use.

> **Note:** the final article text below is *illustrative* — the actual output depends on the model and the live web. The structure, length, and tone are what the pipeline targets.

---

## 1. Cosmology

```
elora-voss research "why the universe should not exist, but does"
```

Suggested preferences:

```
TONE=intelligent and narrative, like a magazine feature
LENGTH=long-form (800-1200 words)
AUDIENCE=curious general readers with no specialist knowledge
NICHE=physics and cosmology
```

The hook the pipeline aims for, paraphrasing the writer's prompt:

> For every billion particles of antimatter born in the Big Bang, there were a billion and one particles of matter. That single extra particle — one in a billion — is the reason you exist.

Subsequent sections build a causal chain from baryogenesis through CP violation, with the knowledge base anchoring each step to a search hit graded HIGH or MEDIUM.

---

## 2. A historical figure

```
elora-voss research "Ada Lovelace and the dream of a thinking machine"
```

Suggested preferences:

```
TONE=essayistic, with the voice of a personal essayist
LENGTH=deep-dive (1200-1800 words)
STYLE=profile / portrait
NICHE=history of computing
AUDIENCE=curious general readers
```

A "profile" run pulls biographical anchors from the search hits, then layers a causal narrative: Babbage's Difference Engine → her translation of Menabrea → the famous "Note G" → the prophetic framing of computation as symbol manipulation rather than mere number-crunching.

---

## 3. A tech trend

```
elora-voss research "why RAG is winning the enterprise AI race"
```

Suggested preferences:

```
TONE=lucid, almost conversational — explanatory without being chatty
LENGTH=medium (500-800 words)
NICHE=AI and ML in production
AUDIENCE=engineers and technical product managers
```

A medium-length piece frames retrieval-augmented generation not as a clever trick but as a pragmatic answer to a boring problem: enterprise knowledge is fragmented, changeable, and permissioned, and fine-tuning isn't an answer. Each fact is anchored to a search hit (vendor blog posts, analyst reports, recent papers).

---

## 4. A niche hobby

```
elora-voss research "the subculture of competitive powerlifting meets"
```

Suggested preferences:

```
TONE=playful but rigorous — long-form science journalism
LENGTH=medium (500-800 words)
NICHE=sports and culture
AUDIENCE=curious general readers
```

A 600-word piece that opens with the smell of ammonia and the sound of plates clanging, then layers in the cultural logic of the sport — weight classes, federations, the etiquette of loading — anchored in a handful of community sources.

---

## 5. A how-to

```
elora-voss research "how to start a sourdough starter from scratch"
```

Suggested preferences:

```
TONE=playful but rigorous — long-form science journalism
LENGTH=medium (500-800 words)
STYLE=explainer
NICHE=cooking and food science
AUDIENCE=beginners with no prior baking experience
```

The pipeline produces a flowing explainer that ties flour choice → wild yeast → hydration → discard → first rise, never dropping into a bulleted recipe. The hook lands on the first sentence and the closing is the moment you smell the first rise.

---

## 6. Tuning the output

Same topic, three very different reads.

### Strictly technical, long-form

```
TONE=formal, academic-leaning, with careful hedging
LENGTH=deep-dive (1200-1800 words)
STYLE=reported piece
AUDIENCE=domain practitioners
```

Output: dense, hedged, full of qualifying clauses. Each fact is anchored. The closing is a sober summary, not an aphorism.

### Magazine feature

```
TONE=intelligent and narrative, like a magazine feature
LENGTH=long-form (800-1200 words)
STYLE=editorial essay
AUDIENCE=curious general readers
```

Output: hook-driven, character-led, with a closing that hands the reader something to carry.

### Quick explainer

```
TONE=lucid, almost conversational — explanatory without being chatty
LENGTH=short (300-500 words)
STYLE=explainer
AUDIENCE=complete beginners
```

Output: tight, plain, hook in the first sentence, knowledge base facts dropped naturally into the prose, no jargon that isn't immediately defined.

---

## Verifying a run

After any research run, the knowledge base is in `history/context_NNN.md`:

```bash
# Read the verified facts the writer saw
cat history/context_001.md

# Read the final article
cat output.txt
```

The KB file is the audit trail. The article file is the output. Both are dated and stored in `./history/`.
