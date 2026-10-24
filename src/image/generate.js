// Gets the 6 tier images for a subject: from the cache if we've made them
// before, otherwise from /api/generate-image (all 6 in parallel, each retried
// once). A tier that still fails comes back as null so the caller can use a
// fallback visual for just that tier.

import { TIER_COUNT } from '../game/tiers.js';

const CACHE_NAME = 'tier-images-v1';
const REQUEST_TIMEOUT_MS = 120_000;

// Images are cached with the Cache API (much more room than localStorage),
// keyed by a fake URL per subject + tier. Any cache failure just means no
// caching; it never breaks generation.
function cacheKey(subject, tier) {
  return `/__tier-images/${encodeURIComponent(subject)}/${tier}`;
}

async function openCache() {
  try {
    return await caches.open(CACHE_NAME);
  } catch {
    return null;
  }
}

class GenerationError extends Error {
  constructor(message, { retryable }) {
    super(message);
    this.retryable = retryable;
  }
}

async function requestTier(subject, tier) {
  let res;
  try {
    res = await fetch('/api/generate-image', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ subject, tier }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch {
    throw new GenerationError("Couldn't reach the image server.", { retryable: true });
  }
  if (!res.ok) {
    const message = await res
      .json()
      .then((j) => j.error)
      .catch(() => null);
    // 4xx (bad subject, rate limited, refused by moderation) won't fix itself.
    throw new GenerationError(message || `Image request failed (${res.status}).`, { retryable: res.status >= 500 });
  }
  return res.blob();
}

async function requestWithRetry(subject, tier) {
  try {
    return await requestTier(subject, tier);
  } catch (err) {
    if (!err.retryable) throw err;
    return requestTier(subject, tier);
  }
}

// onTier({ tier, image, error }) fires as each tier finishes, so the UI can
// reveal images as they arrive. Resolves with { images, errors } where
// images[i] is an ImageBitmap or null (failed) for tier i + 1.
export async function getTierImages(subject, onTier) {
  const cache = await openCache();

  const jobs = Array.from({ length: TIER_COUNT }, async (_, i) => {
    const tier = i + 1;
    const key = cacheKey(subject, tier);
    try {
      let blob = await cache
        ?.match(key)
        .then((r) => r?.blob())
        .catch(() => null);
      if (!blob) {
        blob = await requestWithRetry(subject, tier);
        cache?.put(key, new Response(blob, { headers: { 'Content-Type': blob.type } })).catch(() => {});
      }
      const image = await createImageBitmap(blob);
      onTier({ tier, image, error: null });
      return { image, error: null };
    } catch (err) {
      onTier({ tier, image: null, error: err.message });
      return { image: null, error: err.message };
    }
  });

  const results = await Promise.all(jobs);
  return { images: results.map((r) => r.image), errors: results.map((r) => r.error).filter(Boolean) };
}
