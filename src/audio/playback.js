// Web Audio playback. Pitch is changed with playbackRate, which also changes
// duration: a deep tier-6 merge is slower and longer. That's the joke.

let audioContext = null;

export function getAudioContext() {
  if (!audioContext) {
    audioContext = new (window.AudioContext || window.webkitAudioContext)();
  }
  return audioContext;
}

// Browsers keep audio suspended until a user gesture. Call this from a
// click/tap handler.
export async function unlockAudio() {
  const ctx = getAudioContext();
  if (ctx.state === 'suspended') await ctx.resume();
}

export async function loadSound(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Could not load sound (${res.status})`);
  const data = await res.arrayBuffer();
  return getAudioContext().decodeAudioData(data);
}

// Throttle so a chain reaction of merges doesn't become a wall of noise.
const MIN_GAP_MS = 60;
const MAX_VOICES = 6;
let lastPlayAt = 0;
let activeVoices = 0;

export function playBuffer(buffer, { rate = 1, gain = 1 } = {}) {
  if (!buffer) return;
  const ctx = getAudioContext();
  if (ctx.state !== 'running') return;

  const now = performance.now();
  if (now - lastPlayAt < MIN_GAP_MS || activeVoices >= MAX_VOICES) return;
  lastPlayAt = now;

  const source = ctx.createBufferSource();
  source.buffer = buffer;
  source.playbackRate.value = rate;

  const volume = ctx.createGain();
  volume.gain.value = gain;

  source.connect(volume).connect(ctx.destination);
  activeVoices++;
  source.onended = () => activeVoices--;
  source.start();
}
