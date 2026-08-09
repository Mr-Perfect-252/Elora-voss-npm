// Phase 3: Knowledge Base. Compiles verified claims into structured markdown and SAVES IT TO DISK.
// This is the durable artifact that survives even if subsequent phases fail.
import { chatWithProvider } from '../groq.js';
import { saveContext } from '../fs/history.js';

const SYSTEM = `You compile a verified knowledge base from cross-checked research. Output strict JSON:
{
  "summary": "2-3 sentence overview",
  "facts": [
    {"claim": "...", "confidence": "high"|"medium"|"low"},
    ...
  ],
  "flagged": ["...", "..."],
  "sources": ["https://...", "..."]
}

Group facts from highest to lowest confidence. Do not duplicate. Be concise — every fact must be a single atomic claim. Sources must be URLs from the provided list only.`;

/** Extract a JSON object from text that may contain surrounding prose. */
function extractJson(text) {
  const m = text.match(/\{[\s\S]*\}/);
  return m ? m[0] : null;
}

/**
 * @param {string} topic
 * @param {{claim:string,confidence:string}[]} claims
 * @param {string[]} flagged
 * @param {{url:string}[]} hits
 * @param {{provider?: string, model?: string}} [llmOpts]
 * @returns {Promise<{summary:string, facts:any[], flagged:string[], sources:string[]}>}
 */
export async function knowledgePhase(topic, claims, flagged, hits, llmOpts = {}) {
  const sources = hits.map((h) => h.url).filter(Boolean);
  const user = `Topic: ${topic}\n\nCross-checked claims:\n${claims.map((c) => `- [${c.confidence.toUpperCase()}] ${c.claim}`).join('\n')}\n\nFlagged / uncertain:\n${flagged.join('\n')}\n\nSources (use only these URLs):\n${sources.join('\n')}`;

  let kb;
  // First attempt with jsonMode
  try {
    const text = await chatWithProvider(SYSTEM, user,
      { temperature: 0.3, maxTokens: 3500, jsonMode: true },
      llmOpts.provider, llmOpts.model
    );
    kb = JSON.parse(text);
  } catch {
    // Retry without jsonMode
    try {
      const text = await chatWithProvider(SYSTEM, user,
        { temperature: 0.3, maxTokens: 3500 },
        llmOpts.provider, llmOpts.model
      );
      const raw = extractJson(text);
      if (raw) kb = JSON.parse(raw);
    } catch { /* fall through */ }
  }

  if (!kb) {
    kb = {
      summary: `Research notes for ${topic}.`,
      facts: claims.map((c) => ({ claim: c.claim, confidence: c.confidence })),
      flagged,
      sources,
    };
  }

  return kb;
}

/**
 * Renders the knowledge base as the spec's markdown shape and writes it to
 * history/context_NNN.md. Called by the agent immediately after knowledgePhase().
 *
 * @param {number} id - run id
 * @param {string} topic
 * @param {ReturnType<typeof knowledgePhase> extends Promise<infer T> ? T : never} kb
 * @returns {string} path to the saved context file
 */
export function saveKnowledgeBase(id, topic, kb) {
  const now = new Date().toISOString();
  const lines = [];
  lines.push(`# Knowledge Base: ${topic}`);
  lines.push(`Generated: ${now}`);
  lines.push('');
  lines.push('## Summary');
  lines.push(kb.summary || '');
  lines.push('');
  lines.push('## Core facts');
  for (const f of kb.facts || []) {
    const tag = `[${(f.confidence || 'medium').toUpperCase()}]`;
    lines.push(`- ${tag} ${f.claim}`);
  }
  lines.push('');
  lines.push('## Flagged / uncertain');
  for (const f of kb.flagged || []) lines.push(`- ${f}`);
  lines.push('');
  lines.push('## Sources');
  for (const s of kb.sources || []) lines.push(`- ${s}`);
  lines.push('');
  const md = lines.join('\n');
  return saveContext(id, topic, md);
}