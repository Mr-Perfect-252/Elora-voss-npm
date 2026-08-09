// Phase 6: Illustrate. Picks 3-5 moments in the article, fetches image URLs, inlines <img> tags.
//
// Provider selection (in order of preference, then capability):
//   1. IMAGE_PROVIDER preference: "unsplash" | "pexels" | "wikipedia"
//   2. If a key is missing for the requested provider, fall through the chain
//      unsplash → pexels → wikipedia until one returns a hit.
//   3. If everything returns nothing, the article is published without images.
import { chatWithProvider, activeProvider } from '../groq.js';
import { unsplashSearch, unsplashTrackDownload, hasUnsplashKey } from '../images/unsplash.js';
import { pexelsSearch, hasPexelsKey } from '../images/pexels.js';
import { wikipediaSearch } from '../images/wikipedia.js';

const SYSTEM = `You are an art director for narrative nonfiction. Given an article, identify 3 to 5 specific moments where an image would deepen the reader's experience. For each moment, output a short visual search query (2-5 words, concrete noun phrase, no abstract concepts).

Return strict JSON: { "moments": [ { "after_paragraph": <1-based paragraph index>, "query": "..." } ] }

Rules:
- 3 <= number of moments <= 5
- Queries are concrete visual subjects (e.g., "particle collision", "sleeping brain", "milky way stars")
- No abstract queries ("truth", "existence", "meaning")
- Place each moment where the article reaches a visual pivot, not in transitions`;

const VALID_PROVIDERS = new Set(['unsplash', 'pexels', 'wikipedia']);

/**
 * Resolve the user's preference and the keys actually configured.
 * Returns the chain of providers we'll try, in order, skipping ones without keys.
 */
function resolveProviderChain(providerPref) {
  const pref = String(providerPref || 'unsplash').toLowerCase();
  const want = VALID_PROVIDERS.has(pref) ? pref : 'unsplash';
  // The user explicitly chose a provider — try it first, even without a key
  // (Wikipedia needs none). Then fall back to any provider that does have a key.
  const chain = [];
  if (want === 'unsplash') {
    chain.push({ id: 'unsplash', fn: unsplashSearch, hasKey: hasUnsplashKey() });
    chain.push({ id: 'pexels', fn: pexelsSearch, hasKey: hasPexelsKey() });
    chain.push({ id: 'wikipedia', fn: wikipediaSearch, hasKey: true });
  } else if (want === 'pexels') {
    chain.push({ id: 'pexels', fn: pexelsSearch, hasKey: hasPexelsKey() });
    chain.push({ id: 'unsplash', fn: unsplashSearch, hasKey: hasUnsplashKey() });
    chain.push({ id: 'wikipedia', fn: wikipediaSearch, hasKey: true });
  } else {
    // wikipedia
    chain.push({ id: 'wikipedia', fn: wikipediaSearch, hasKey: true });
    chain.push({ id: 'unsplash', fn: unsplashSearch, hasKey: hasUnsplashKey() });
    chain.push({ id: 'pexels', fn: pexelsSearch, hasKey: hasPexelsKey() });
  }
  return chain.filter((p) => p.hasKey);
}

/**
 * Try providers in order until one returns a result for this query.
 * Returns { img, provider } or null.
 */
async function fetchWithFallback(query, chain, providersTried) {
  for (const p of chain) {
    try {
      const res = await p.fn(query, 1);
      if (res && res[0] && res[0].url) {
        providersTried.add(p.id);
        return { img: { ...res[0], query, provider: p.id }, provider: p.id };
      }
    } catch (err) {
      // Soft-fail; try the next provider.
      providersTried.add(`${p.id}(error)`);
    }
  }
  return null;
}

/**
 * @param {string} article
 * @param {string} providerPref - "unsplash" | "pexels" | "wikipedia" from preferences
 * @param {{provider?: string, model?: string}} [llmOpts]
 * @returns {Promise<{images: any[], article: string, providersUsed: string[]}>}
 */
export async function illustratePhase(article, providerPref = 'unsplash', llmOpts = {}) {
  const chain = resolveProviderChain(providerPref);
  if (chain.length === 0) {
    process.stdout.write('[6/6] No image provider keys configured and no keyless provider available — skipping images.\n');
    return { images: [], article, providersUsed: [] };
  }

  const providerLabel = chain.map((p) => p.id).join(' → ');
  process.stdout.write(`[6/6] Image providers: ${providerLabel}\n`);
  process.stdout.write(`[6/6] LLM provider: ${activeProvider()}\n`);

  const paragraphs = article.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);
  const numbered = paragraphs.map((p, i) => `[${i + 1}] ${p}`).join('\n\n');

  const text = await chatWithProvider(
    SYSTEM,
    `Article paragraphs (numbered):\n\n${numbered}`,
    { temperature: 0.5, maxTokens: 600, jsonMode: true },
    llmOpts.provider, llmOpts.model
  );

  let moments = [];
  try {
    const parsed = JSON.parse(text);
    moments = Array.isArray(parsed.moments) ? parsed.moments.slice(0, 5) : [];
  } catch {
    return { images: [], article, providersUsed: [] };
  }
  if (moments.length < 3) {
    return { images: [], article, providersUsed: [] };
  }

  const images = [];
  const providersUsed = new Set();
  for (const m of moments) {
    process.stdout.write(`[6/6]   "${m.query}"\n`);
    const got = await fetchWithFallback(m.query, chain, providersUsed);
    if (got) {
      images.push(got.img);
      // Best-effort Unsplash download tracking (compliance with their guidelines).
      if (got.provider === 'unsplash' && got.img.photoId) {
        unsplashTrackDownload(got.img.photoId).catch(() => {});
      }
    }
  }

  process.stdout.write(`[6/6] Inserted ${images.length} of ${moments.length} images. Sources: ${[...providersUsed].join(', ') || 'none'}\n`);

  // Inline <img> tags at the chosen paragraph indices.
  const idxMap = new Map();
  moments.forEach((m, i) => {
    if (images[i]) idxMap.set(m.after_paragraph, images[i]);
  });

  const newParagraphs = paragraphs.map((p, i) => {
    const idx = i + 1;
    if (idxMap.has(idx)) {
      const img = idxMap.get(idx);
      return `${p}\n\n<img src="${img.url}" alt="${img.alt}" />`;
    }
    return p;
  });

  return {
    images,
    article: newParagraphs.join('\n\n'),
    providersUsed: [...providersUsed],
  };
}