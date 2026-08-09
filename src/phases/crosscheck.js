// Phase 2: Cross-check. Annotates each claim with confidence (HIGH / MEDIUM / LOW).
import { chatWithProvider } from '../groq.js';

const SYSTEM = `You are a meticulous fact-checker. Given a block of research notes, extract each distinct factual claim and assign a confidence label:
- [HIGH]   — well-supported by multiple authoritative sources, mainstream scientific consensus
- [MEDIUM] — supported by some sources but limited or contested in places
- [LOW]    — speculative, single-source, fringe, or contradicted by other sources

Output JSON with this exact shape:
{
  "claims": [
    {"claim": "...", "confidence": "high"},
    ...
  ],
  "flagged": ["..."]
}

Output ONLY valid JSON. No prose around it.`;

/** Extract a JSON object from text that may contain surrounding prose. */
function extractJson(text) {
  const m = text.match(/\{[\s\S]*\}/);
  return m ? m[0] : null;
}

/**
 * @param {string} notes - raw research notes from search phase
 * @param {any[]} hits - source hits (for cross-reference)
 * @param {{provider?: string, model?: string}} [llmOpts]
 * @returns {Promise<{claims:{claim:string,confidence:"high"|"medium"|"low"}[], flagged:string[]}>}
 */
export async function crosscheckPhase(notes, hits, llmOpts = {}) {
  const sourcesBlock = hits.map((h, i) => `[${i + 1}] ${h.title} — ${h.url}`).join('\n');
  const user = `Research notes:\n${notes}\n\nSources:\n${sourcesBlock}`;

  // First attempt with jsonMode
  let text = await chatWithProvider(SYSTEM, user,
    { temperature: 0.2, maxTokens: 3000, jsonMode: true },
    llmOpts.provider, llmOpts.model
  );
  try {
    const parsed = JSON.parse(text);
    return {
      claims: Array.isArray(parsed.claims) ? parsed.claims : [],
      flagged: Array.isArray(parsed.flagged) ? parsed.flagged : [],
    };
  } catch {
    // Retry without jsonMode — some models output prose despite the flag
    try {
      text = await chatWithProvider(SYSTEM, user,
        { temperature: 0.2, maxTokens: 3000 },
        llmOpts.provider, llmOpts.model
      );
      const raw = extractJson(text);
      if (raw) {
        const parsed = JSON.parse(raw);
        return {
          claims: Array.isArray(parsed.claims) ? parsed.claims : [],
          flagged: Array.isArray(parsed.flagged) ? parsed.flagged : [],
        };
      }
    } catch { /* fall through */ }
    return { claims: [], flagged: ['Cross-check failed to parse'] };
  }
}