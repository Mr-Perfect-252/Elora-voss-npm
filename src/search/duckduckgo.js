// DuckDuckGo search provider. No API key required.
// duck-duck-scrape's safeSearch expects UPPERCASE enum ("STRICT" | "MODERATE" | "OFF").
// Passing lowercase throws "moderate is an invalid safe search type!".
import { search as ddgSearch } from 'duck-duck-scrape';

const VALID_SAFE_SEARCH = new Set(['STRICT', 'MODERATE', 'OFF']);

function isAnomaly(msg) {
  return typeof msg === 'string' && /anomali/i.test(msg);
}

/**
 * @param {string} query
 * @param {number} [maxResults=10]
 * @returns {Promise<{title:string,url:string,snippet:string}[]>}
 */
export async function duckduckgoSearch(query, maxResults = 10) {
  const safeSearch = 'MODERATE';
  if (!VALID_SAFE_SEARCH.has(safeSearch)) {
    process.stderr.write(`[search] Invalid safeSearch value: ${safeSearch}\n`);
    return [];
  }
  let res;
  try {
    res = await ddgSearch(query, { safeSearch });
  } catch (err) {
    const msg = err && err.message ? err.message : String(err);
    if (isAnomaly(msg)) {
      // DDG rate-limited us. Expected — search.js handles the fallback.
      process.stdout.write(`[search] DDG rate-limited; falling back.\n`);
    } else {
      process.stderr.write(`[search] DuckDuckGo failed: ${msg}\n`);
    }
    return [];
  }
  if (!res) {
    process.stdout.write(`[search] DuckDuckGo returned no response.\n`);
    return [];
  }
  if (!res.results || res.results.length === 0) {
    process.stdout.write(`[search] DuckDuckGo returned 0 hits for "${query}".\n`);
    return [];
  }
  return res.results.slice(0, maxResults).map((r) => ({
    title: r.title || '',
    url: r.url || r.href || '',
    snippet: r.description || r.snippet || '',
  }));
}