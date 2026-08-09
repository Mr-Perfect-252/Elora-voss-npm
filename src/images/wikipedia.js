// Wikipedia / Wikimedia Commons image search. Open-source provider — no API key needed.
//
// Wikimedia requires a descriptive User-Agent on every request, so we always send one.
// Hotlinking uploads from upload.wikimedia.org is allowed under the Commons license terms.
//
// Strategy:
//   1. Search Wikimedia Commons for files matching the query (namespace 6 = File:).
//   2. Resolve each hit to its imageinfo (URL + extmetadata for caption/credit).
//   3. Filter to landscape-friendly files (jpg/jpeg/png/svg, width >= 800).
//
// If Commons returns nothing, fall back to Wikipedia article lead images via
// the `pageimages` prop on the article API.
import { getKey } from '../config.js';

const COMMONS_ENDPOINT = 'https://commons.wikimedia.org/w/api.php';
const WIKI_ENDPOINT = 'https://en.wikipedia.org/w/api.php';

const USER_AGENT = 'elora-voss/0.2 (https://github.com/elora-voss/elora-voss) Node fetch';

// Some queries are abstract — only return hits for queries that look like a
// concrete noun phrase (>= 2 chars, no abstract stop words).
function isConcreteQuery(q) {
  if (!q) return false;
  const s = String(q).trim();
  if (s.length < 2) return false;
  const blocked = /^(truth|meaning|existence|consciousness|reality|time|space|love|fear|hope)$/i;
  return !blocked.test(s);
}

async function commonsSearch(query, count) {
  const url = new URL(COMMONS_ENDPOINT);
  url.searchParams.set('action', 'query');
  url.searchParams.set('generator', 'search');
  url.searchParams.set('gsrsearch', query);
  url.searchParams.set('gsrnamespace', '6'); // File: namespace
  url.searchParams.set('gsrlimit', String(Math.min(count * 3, 15)));
  url.searchParams.set('prop', 'imageinfo');
  url.searchParams.set('iiprop', 'url|extmetadata|mime|size');
  url.searchParams.set('iiurlwidth', '1600');
  url.searchParams.set('format', 'json');
  url.searchParams.set('origin', '*');

  const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT } });
  if (!res.ok) return [];
  const data = await res.json();
  const pages = Object.values(data.query?.pages || {});
  const out = [];
  for (const page of pages) {
    const ii = page.imageinfo?.[0];
    if (!ii) continue;
    // Skip non-image files (e.g. .pdf, .svg that may not render well)
    const mime = ii.mime || '';
    if (!/^image\/(jpeg|png|jpg|webp)$/i.test(mime)) continue;
    // Skip tiny images — we want landscape quality.
    if (ii.width && ii.width < 800) continue;
    const meta = ii.extmetadata || {};
    const caption = stripHtml(meta.ImageDescription?.value) || stripHtml(meta.ObjectName?.value) || query;
    const artist = stripHtml(meta.Artist?.value) || '';
    const licenseShort = meta.LicenseShortName?.value || 'CC';
    out.push({
      url: ii.url || ii.thumburl || '',
      alt: caption,
      photographer: artist,
      photographerUrl: meta.CreditUrl?.value || meta.ArtistUrl?.value || '',
      license: licenseShort,
      sourcePage: page.title ? `https://commons.wikimedia.org/wiki/${encodeURIComponent(page.title)}` : '',
      photoId: page.pageid ? String(page.pageid) : '',
    });
  }
  return out.slice(0, count);
}

async function wikipediaLeadImage(query, count) {
  // Use the Wikipedia search API to find an article, then pull its lead image.
  const search = new URL(WIKI_ENDPOINT);
  search.searchParams.set('action', 'query');
  search.searchParams.set('list', 'search');
  search.searchParams.set('srsearch', query);
  search.searchParams.set('srlimit', String(count));
  search.searchParams.set('format', 'json');
  search.searchParams.set('origin', '*');

  const sRes = await fetch(search, { headers: { 'User-Agent': USER_AGENT } });
  if (!sRes.ok) return [];
  const sData = await sRes.json();
  const titles = (sData.query?.search || []).map((r) => r.title).filter(Boolean).slice(0, count);
  if (titles.length === 0) return [];

  const img = new URL(WIKI_ENDPOINT);
  img.searchParams.set('action', 'query');
  img.searchParams.set('prop', 'pageimages');
  img.searchParams.set('piprop', 'original|thumbnail');
  img.searchParams.set('pithumbsize', '1600');
  img.searchParams.set('titles', titles.join('|'));
  img.searchParams.set('format', 'json');
  img.searchParams.set('origin', '*');

  const iRes = await fetch(img, { headers: { 'User-Agent': USER_AGENT } });
  if (!iRes.ok) return [];
  const iData = await iRes.json();
  const pages = Object.values(iData.query?.pages || {});
  const out = [];
  for (const p of pages) {
    const src = p.original?.source || p.thumbnail?.source;
    if (!src) continue;
    out.push({
      url: src,
      alt: p.title || query,
      photographer: '',
      photographerUrl: '',
      license: 'CC',
      sourcePage: p.title ? `https://en.wikipedia.org/wiki/${encodeURIComponent(p.title.replace(/ /g, '_'))}` : '',
      photoId: p.pageid ? String(p.pageid) : '',
    });
  }
  return out.slice(0, count);
}

/**
 * @param {string} query
 * @param {number} [count=1]
 * @returns {Promise<{url:string,alt:string,photographer?:string,photographerUrl?:string,license?:string,sourcePage?:string,photoId?:string}[]>}
 */
export async function wikipediaSearch(query, count = 1) {
  if (!isConcreteQuery(query)) return [];
  try {
    const commons = await commonsSearch(query, count);
    if (commons.length > 0) return commons;
    // Fallback to Wikipedia lead images if Commons has no good hit.
    return await wikipediaLeadImage(query, count);
  } catch {
    return [];
  }
}

/** Always returns true — Wikipedia has no API key requirement. */
export function hasWikipediaKey() {
  // Kept for symmetry with other providers; key is optional (none required).
  return Boolean(getKey('wikipedia'));
}

function stripHtml(s) {
  if (!s) return '';
  return String(s)
    .replace(/<[^>]+>/g, '')
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .trim();
}