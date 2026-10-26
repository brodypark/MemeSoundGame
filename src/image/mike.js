// Mike mode: a special case that skips classification and image generation
// and uses a real voice clip and photo instead. The photo is a full-body
// cutout (background removed ahead of time, so it's a transparent WebP) and
// every tier shows all of him; tiers differ by size, color and pitch.

import { createFigureVisual } from '../game/render.js';
import { TIER_COUNT } from '../game/tiers.js';
import { loadSound } from '../audio/playback.js';
import { prepareSound } from '../audio/trim.js';

export const MIKE_SUBJECT = 'Mike';

const SOUND_URL = '/mike/voice.mp3';
const PHOTO_URL = '/mike/cutout.webp';

async function loadPhoto() {
  const res = await fetch(PHOTO_URL);
  if (!res.ok) throw new Error(`Could not load Mike's photo (${res.status})`);
  return createImageBitmap(await res.blob());
}

// Resolves with { sound, visuals }: the trimmed voice clip and one visual
// per tier.
export async function loadMike() {
  const [buffer, photo] = await Promise.all([loadSound(SOUND_URL), loadPhoto()]);
  return {
    sound: prepareSound(buffer),
    visuals: Array.from({ length: TIER_COUNT }, (_, i) => createFigureVisual(i + 1, photo)),
  };
}
