// Web Audio playback. Pitch is changed with playbackRate, which also changes
// duration: a deep tier-6 merge is slower and longer. That's the joke.

let audioContext = null;
let master = null;

export function getAudioContext() {
  if (!audioContext) {
    audioContext = new (window.AudioContext || window.webkitAudioContext)();
    // Everything goes through one gentle compressor so a pile of overlapping
    // merges (and the louder deep tiers) can't clip.
    master = audioContext.createDynamicsCompressor();
    master.threshold.value = -12;
    master.ratio.value = 4;
    master.connect(audioContext.destination);
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

// Voice management. Low-tier merges happen constantly and deep ones rarely,
// so first-come-first-served would let the small sounds hog every slot and
// bury the payoff. Instead each sound has a priority (the tier):
// - the min-gap throttle is per priority, so a burst of tier 2s can't block
//   a tier 5 that lands 20ms later;
// - when all voices are busy, a new sound steals the lowest-priority voice
//   if it outranks it, otherwise it's dropped;
// - while a higher-priority voice plays, lower ones are ducked (sidechain
//   style) so the deep rumble sits on top of the chatter.
const MIN_GAP_MS = 60;
const MAX_VOICES = 6;
const DUCK_GAIN = 0.35; // how loud outranked voices get while ducked
const DUCK_TIME = 0.05; // seconds, time constant of the duck/unduck ramp
const lastPlayAt = new Map(); // priority -> performance.now()
const voices = []; // { source, duck, priority }

// Re-aim every voice's duck gain at the current top priority.
function updateDucking() {
  const ctx = getAudioContext();
  const top = Math.max(-Infinity, ...voices.map((v) => v.priority));
  for (const v of voices) {
    const target = v.priority < top ? DUCK_GAIN : 1;
    v.duck.gain.setTargetAtTime(target, ctx.currentTime, DUCK_TIME);
  }
}

function removeVoice(voice) {
  const i = voices.indexOf(voice);
  if (i === -1) return;
  voices.splice(i, 1);
  updateDucking();
}

// Fade out quickly instead of cutting, which would click.
function stealVoice(voice) {
  const ctx = getAudioContext();
  voice.duck.gain.setTargetAtTime(0, ctx.currentTime, 0.01);
  voice.source.stop(ctx.currentTime + 0.05);
  removeVoice(voice);
}

export function playBuffer(buffer, { rate = 1, gain = 1, priority = 0 } = {}) {
  if (!buffer) return;
  const ctx = getAudioContext();
  if (ctx.state !== 'running') return;

  const now = performance.now();
  if (now - (lastPlayAt.get(priority) ?? -Infinity) < MIN_GAP_MS) return;

  if (voices.length >= MAX_VOICES) {
    const weakest = voices.reduce((a, b) => (b.priority < a.priority ? b : a));
    if (weakest.priority >= priority) return;
    stealVoice(weakest);
  }
  lastPlayAt.set(priority, now);

  const source = ctx.createBufferSource();
  source.buffer = buffer;
  source.playbackRate.value = rate;

  const volume = ctx.createGain();
  volume.gain.value = gain;
  // Start already ducked if something deeper is playing, so it doesn't
  // blip in at full volume before the ramp catches it.
  const duck = ctx.createGain();
  const top = Math.max(-Infinity, ...voices.map((v) => v.priority));
  duck.gain.value = priority < top ? DUCK_GAIN : 1;

  source.connect(volume).connect(duck).connect(master);
  const voice = { source, duck, priority };
  voices.push(voice);
  source.onended = () => removeVoice(voice);
  updateDucking();
  source.start();
}
