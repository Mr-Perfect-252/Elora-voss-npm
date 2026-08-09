// Tavily search provider. Requires TAVILY API key.
import { getKey, getTavilyMaxResults } from '../config.js';

const ENDPOINT = 'https://api.tavily.com/search';

/**
 * @param {string} query
 * @param {number} [maxResults] - defaults to value configured via `elora-voss set-max-results`, or 15
 * @returns {Promise<{title:string,url:string,snippet:string}[]>}
 */
export async function tavilySearch(query, maxResults) {
  const apiKey = getKey('tavily');
  if (!apiKey) throw new Error('Tavily key not set. Use DuckDuckGo or set: elora-voss set-key tavily YOUR_KEY');

  const limit = Number.isFinite(maxResults) && maxResults > 0 ? maxResults : getTavilyMaxResults();

  const body = {
    api_key: apiKey,
    query,
    max_results: limit,
    search_depth: 'advanced',
    include_answer: false,
  };

  const res = await fetch(ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Tavily ${res.status}: ${text.slice(0, 200)}`);
  }

  const data = await res.json();
  return (data.results || []).map((r) => ({
    title: r.title || '',
    url: r.url || '',
    snippet: r.content || '',
  }));
}