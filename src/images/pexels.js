// Pexels image search. Free for limited use; production use requires a PEXELS_API_KEY.
// Returns the same shape as the Unsplash and Wikipedia providers.
import { getKey } from '../config.js';

const ENDPOINT = 'https://api.pexels.com/v1/search';

/**
 * @param {string} query
 * @param {number} [count=1]
 * @returns {Promise<{url:string,alt:string,photographer?:string,photographerUrl?:string,license?:string,photoId?:string}[]>}
 */
export async function pexelsSearch(query, count = 1) {
  const apiKey = getKey('pexels');
  if (!apiKey) return [];

  const url = new URL(ENDPOINT);
  url.searchParams.set('query', query);
  url.searchParams.set('per_page', String(count));
  url.searchParams.set('orientation', 'landscape');

  const res = await fetch(url, { headers: { Authorization: apiKey } });
  if (!res.ok) return [];
  const data = await res.json();
  return (data.photos || []).map((photo) => ({
    url: photo.src?.large || photo.src?.medium || '',
    alt: photo.alt || query,
    photographer: photo.photographer || '',
    photographerUrl: photo.photographer_url || '',
    license: 'Pexels',
    photoId: photo.id ? String(photo.id) : '',
    sourcePage: photo.url || '',
  }));
}

/** True when a Pexels API key is configured. */
export function hasPexelsKey() {
  return Boolean(getKey('pexels'));
}