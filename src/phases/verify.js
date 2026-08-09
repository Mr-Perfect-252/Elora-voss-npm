// Phase 4: Verify. Self-check the knowledge base for contradictions and unsupported claims.
import { chatWithProvider } from '../groq.js';

const SYSTEM = `You verify a knowledge base. Look for:
1. Internal contradictions (two facts that cannot both be true)
2. Facts that lack sources or are unsupported by the listed sources
3. Speculative claims that should be moved to "flagged"

Return strict JSON:
{
  "cleaned_facts": [...same shape as input facts array...],
  "flagged_additions": ["...", "..."],
  "removed": ["...", "..."]
}

Be conservative — only remove a claim if it is clearly contradicted or unsupportable. Otherwise keep it.`;

/** Extract a JSON object from text that may contain surrounding prose. */
function extractJson(text) {
  const m = text.match(/\{[\s\S]*\}/);
  return m ? m[0] : null;
}

/**
 * @param {{summary:string, facts:any[], flagged:string[], sources:string[]}} kb
 * @param {{provider?: string, model?: string}} [llmOpts]
 * @returns {Promise<{summary:string, facts:any[], flagged:string[], sources:string[]}>}
 */
export async function verifyPhase(kb, llmOpts = {}) {
  const user = `Knowledge base to verify:\n${JSON.stringify(kb, null, 2)}`;

  // First attempt with jsonMode
  try {
    const text = await chatWithProvider(SYSTEM, user,
      { temperature: 0.2, maxTokens: 3000, jsonMode: true },
      llmOpts.provider, llmOpts.model
    );
    const parsed = JSON.parse(text);
    return {
      summary: kb.summary,
      facts: Array.isArray(parsed.cleaned_facts) && parsed.cleaned_facts.length > 0 ? parsed.cleaned_facts : kb.facts,
      flagged: [...(kb.flagged || []), ...(parsed.flagged_additions || [])],
      sources: kb.sources || [],
    };
  } catch {
    // Retry without jsonMode
    try {
      const text = await chatWithProvider(SYSTEM, user,
        { temperature: 0.2, maxTokens: 3000 },
        llmOpts.provider, llmOpts.model
      );
      const raw = extractJson(text);
      if (raw) {
        const parsed = JSON.parse(raw);
        return {
          summary: kb.summary,
          facts: Array.isArray(parsed.cleaned_facts) && parsed.cleaned_facts.length > 0 ? parsed.cleaned_facts : kb.facts,
          flagged: [...(kb.flagged || []), ...(parsed.flagged_additions || [])],
          sources: kb.sources || [],
        };
      }
    } catch { /* fall through */ }
    return kb; // verification is best-effort; never destroy the KB on parse error
  }
}