// Phase 1: Search. Returns raw research notes (search hits + free-form LLM summary).
import { duckduckgoSearch } from '../search/duckduckgo.js';
import { tavilySearch } from '../search/tavily.js';
import { getKey } from '../config.js';
import { chatWithProvider } from '../groq.js';

/**
 * @param {string} topic
 * @param {{provider?: string, model?: string}} [llmOpts]
 * @returns {Promise<{provider: "duckduckgo"|"tavily", hits: any[], notes: string}>}
 */
export async function searchPhase(topic, llmOpts = {}) {
  let provider = 'duckduckgo';
  let hits = await duckduckgoSearch(topic, 10);
  if (hits.length === 0 && getKey('tavily')) {
    provider = 'tavily';
    hits = await tavilySearch(topic);
  }

  process.stdout.write(`[search] provider=${provider} hits=${hits.length}\n`);

  const systemPrompt = `You are a research assistant. Given a topic and a list of web search hits, produce concise research notes covering: (1) what is known / consensus, (2) what is recent or newly discovered, (3) what is contested or uncertain. Be factual. Do not invent sources. Cite hits by [N] where N is the hit number.`;
  const userPrompt = `Topic: ${topic}\n\nHits:\n${hits.map((h, i) => `[${i + 1}] ${h.title} — ${h.url}\n${h.snippet}`).join('\n\n')}`;

  const notes = await chatWithProvider(systemPrompt, userPrompt,
    { temperature: 0.4, maxTokens: 3000 },
    llmOpts.provider, llmOpts.model
  );

  return { provider, hits, notes };
}