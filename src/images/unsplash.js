// Unsplash image search using the official unsplash-js SDK (v8, openapi-fetch).
// If the SDK call fails for any reason, falls back to the raw REST endpoint so the
// agent always has a working image pipeline.
import { createApi } from 'unsplash-js';
import { getKey } from '../config.js';

let _client = null;

function client() {
  if (_client) return _client;
  const accessKey = getKey('unsplash');
  if (!accessKey) return null;
  _client = createApi({ accessKey });
  return _client;
}

/**
 * @param {string} query
 * @param {number} [count=1]
 * @returns {Promise<{url:string,alt:string,photographer?:string,photographerUrl?:string,downloadLocation?:string,photoId?:string}[]>}
 */
export async function unsplashSearch(query, count = 1) {
  const accessKey = getKey('unsplash');
  if (!accessKey) return [];

  // Try the SDK first.
  try {
    const sdk = client();
    if (sdk) {
      const result = await sdk.GET('/search/photos', {
        params: {
          query: {
            query,
            per_page: count,
            orientation: 'landscape',
            content_filter: 'high',
          },
        },
      });
      if (!result.error && result.data) {
        const photos = result.data.results || [];
        if (photos.length > 0) {
          return photos.map((photo) => ({
            url: photo.urls?.regular || photo.urls?.small || '',
            alt: photo.alt_description || query,
            photographer: photo.user?.name,
            photographerUrl: photo.user?.links?.html,
            downloadLocation: photo.links?.download_location,
            photoId: photo.id,
          }));
        }
      }
      // If SDK returned no results, fall through to REST to be safe.
    }
  } catch {
    // SDK blew up — try REST fallback below.
  }

  // REST fallback. Same endpoint, raw fetch, no openapi-fetch involvement.
  return unsplashSearchRest(query, count, accessKey);
}

async function unsplashSearchRest(query, count, accessKey) {
  const url = new URL('https://api.unsplash.com/search/photos');
  url.searchParams.set('query', query);
  url.searchParams.set('per_page', String(count));
  url.searchParams.set('orientation', 'landscape');
  url.searchParams.set('content_filter', 'high');

  const res = await fetch(url, {
    headers: {
      Authorization: `Client-ID ${accessKey}`,
      'Accept-Version': 'v1',
    },
  });
  if (!res.ok) return [];
  const data = await res.json();
  const photos = data.results || [];
  return photos.map((photo) => ({
    url: photo.urls?.regular || photo.urls?.small || '',
    alt: photo.alt_description || query,
    photographer: photo.user?.name,
    photographerUrl: photo.user?.links?.html,
    downloadLocation: photo.links?.download_location,
    photoId: photo.id,
  }));
}

/**
 * Fire Unsplash's required download-tracking endpoint for a photo. Per the
 * Unsplash API guidelines, hotlinking an image should trigger this call. Safe
 * to call multiple times; failures are non-fatal (best-effort tracking).
 * @param {string} photoId - the photo.id slug (e.g. "mtNweauBsMQ")
 */
export async function unsplashTrackDownload(photoId) {
  if (!photoId) return;
  const sdk = client();
  if (!sdk) return;
  try {
    await sdk.GET('/photos/{id}/download', {
      params: { path: { id: photoId } },
    });
  } catch {
    // non-fatal — best-effort tracking
  }
}

/** True when an Unsplash access key is configured. */
export function hasUnsplashKey() {
  return Boolean(getKey('unsplash'));
}