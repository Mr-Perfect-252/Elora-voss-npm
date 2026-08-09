// Phase 5: Write. Reads KB + preferences, writes a narrative article to spec's quality standard.
import { chatWithProvider } from '../groq.js';

// The "quality bar" passage from the spec, embedded directly so the model has a single concrete target.
const QUALITY_BAR = `For every billion particles of antimatter born in the Big Bang, there were a billion and one particles of matter. That single extra particle — one in a billion — is the reason you exist. The reason anything exists. The universe is the leftover from an almost perfect catastrophe.`;

const SYSTEM = `You are a writer of narrative nonfiction. You write magazine-feature prose, not listicles, not structured breakdowns, not bullet summaries.

Every article you write must:
- Open with a hook — a striking fact, a contradiction, or a reframe that earns the next sentence
- Flow without headers — the writing carries the reader, not navigation labels
- Earn every claim — facts are explained and connected, not dropped
- Close with meaning — the last paragraph gives the reader something to carry

Style reference (use for TONE and RHETORICAL SHAPE only — your article is about the TOPIC given below, never about this passage):

"${QUALITY_BAR}"

You will be given:
- TOPIC — the subject your article is about
- KNOWLEDGE BASE — verified facts you may use
- PREFERENCES — tone, length, audience, etc.

HARD RULES:
1. Your article is about the TOPIC. Every paragraph must be on-topic.
2. Use ONLY facts from the KNOWLEDGE BASE. Do not introduce outside facts, inventions, or unrelated subjects to pad length.
3. If the knowledge base feels thin, go deeper on the existing facts (concrete examples, causal chains, vivid scene-setting) — never change the subject.
4. Markdown, no headings — pure flowing prose. First paragraph is a hook about the TOPIC. Last paragraph gives the reader something to carry.
5. Hit the minimum word count by going wider and deeper on what you have. Going under the count OR drifting off-topic is failure.

Output ONLY the article body. No preamble, no title, no metadata.`;

/**
 * Extract numeric floor from a LENGTH string like "long-form (800-1200 words)" or "1200 words".
 * @param {string} lengthStr
 * @returns {number}
 */
function lengthFloor(lengthStr) {
  const m = String(lengthStr || '').match(/(\d{3,4})/);
  return m ? parseInt(m[1], 10) : 800;
}

/**
 * @param {string} topic
 * @param {object} kb - verified knowledge base
 * @param {Record<string,string>} prefs
 * @param {{provider?: string, model?: string}} [llmOpts]
 * @returns {Promise<string>}
 */
export async function writePhase(topic, kb, prefs, llmOpts = {}) {
  const floor = lengthFloor(prefs.LENGTH);
  const prefsBlock = Object.entries(prefs).map(([k, v]) => `${k}: ${v}`).join('\n');
  const kbBlock = `Summary:\n${kb.summary}\n\nFacts:\n${kb.facts.map((f) => `- [${(f.confidence || 'medium').toUpperCase()}] ${f.claim}`).join('\n')}\n\nFlagged / uncertain:\n${kb.flagged.join('\n') || '(none)'}\n\nSources:\n${kb.sources.join('\n')}`;

  const user = `Topic: ${topic}\n\nPreferences:\n${prefsBlock}\n\nKnowledge base:\n${kbBlock}\n\nMinimum word count: ${floor}. Write the full article now.`;

  let article = await chatWithProvider(SYSTEM, user,
    { temperature: 0.85, maxTokens: 4000 },
    llmOpts.provider, llmOpts.model
  );

  // Enforce minimum word count by asking for expansion if we're short.
  const countWords = (s) => s.trim().split(/\s+/).filter(Boolean).length;
  let attempts = 0;
  while (countWords(article) < floor && attempts < 2) {
    const expand = await chatWithProvider(
      SYSTEM,
      `Topic (your article must stay on this subject): ${topic}\n\n` +
      `Knowledge base (your ONLY source of facts — do not introduce outside topics):\n${kbBlock}\n\n` +
      `The article below is ${countWords(article)} words. The minimum is ${floor}. ` +
      `Expand it by deepening the existing facts — concrete examples, causal chains, vivid scene-setting. ` +
      `Do not change the subject, do not introduce new topics. Output the full revised article — no preamble.`,
      { temperature: 0.85, maxTokens: 4000 },
      llmOpts.provider, llmOpts.model
    );
    article = expand;
    attempts++;
  }
  return article.trim();
}