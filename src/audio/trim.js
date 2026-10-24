import { getAudioContext } from './playback.js';

// Turns any decoded sound into what the game wants: mono, leading/trailing
// silence cut off, at most MAX_SECONDS long, peak-normalized, with tiny
// fades so the cut edges don't click.

export const MAX_SECONDS = 2;
const SILENT_PEAK = 0.005; // below this the whole clip counts as silence
const THRESHOLD = 0.05; // fraction of the peak that counts as "sound started"
const PRE_ROLL_S = 0.02; // keep a hair before the first loud sample
const TAIL_S = 0.05; // and a bit after the last one, for the decay
const TARGET_PEAK = 0.9;
const FADE_IN_S = 0.005;
const FADE_OUT_S = 0.03;

export function prepareSound(buffer) {
  const sr = buffer.sampleRate;

  // Mix down to mono by averaging channels.
  const mono = new Float32Array(buffer.length);
  for (let c = 0; c < buffer.numberOfChannels; c++) {
    const data = buffer.getChannelData(c);
    for (let i = 0; i < data.length; i++) mono[i] += data[i] / buffer.numberOfChannels;
  }

  let peak = 0;
  for (const v of mono) peak = Math.max(peak, Math.abs(v));
  if (peak < SILENT_PEAK) {
    throw new Error('That sound is silent. Try again, a bit closer to the mic.');
  }

  // Find where the sound actually starts and ends.
  const threshold = peak * THRESHOLD;
  let first = 0;
  while (Math.abs(mono[first]) < threshold) first++;
  let last = mono.length - 1;
  while (Math.abs(mono[last]) < threshold) last--;

  const start = Math.max(0, first - Math.floor(PRE_ROLL_S * sr));
  const end = Math.min(mono.length, last + Math.floor(TAIL_S * sr), start + Math.floor(MAX_SECONDS * sr));
  const out = mono.slice(start, end);

  // Normalize using the peak of the kept part (the loud bit may have been cut).
  let keptPeak = 0;
  for (const v of out) keptPeak = Math.max(keptPeak, Math.abs(v));
  const gain = TARGET_PEAK / keptPeak;

  const fadeIn = Math.min(out.length, Math.floor(FADE_IN_S * sr));
  const fadeOut = Math.min(out.length, Math.floor(FADE_OUT_S * sr));
  for (let i = 0; i < out.length; i++) {
    let g = gain;
    if (i < fadeIn) g *= i / fadeIn;
    if (i >= out.length - fadeOut) g *= (out.length - 1 - i) / fadeOut;
    out[i] *= g;
  }

  const result = getAudioContext().createBuffer(1, out.length, sr);
  result.copyToChannel(out, 0);
  return result;
}
