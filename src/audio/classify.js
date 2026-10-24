// YAMNet sound classification, fully in the browser.
//
// The model is self-hosted in public/models/yamnet (the old tfhub.dev URL
// now 404s). TensorFlow.js is loaded with a dynamic import so its ~1 MB of
// JS, and the ~16 MB of weights, only download once the player picks a sound.

const MODEL_URL = '/models/yamnet/model.json';
const CLASS_MAP_URL = '/yamnet_class_map.csv';
const SAMPLE_RATE = 16000; // YAMNet only accepts 16 kHz mono
const MIN_SAMPLES = SAMPLE_RATE; // stretch short sounds to 1s so there's a full frame
const LOW_CONFIDENCE = 0.15;
const SEARCH_DEPTH = 30; // how far down the ranking to look for a specific label
const MIN_SPECIFIC = 0.01; // a specific label below this is just noise

// Labels that say more about the recording than about what made the sound.
// We skip past these to the first specific label when there is one.
// Speech labels are here because a person imitating an animal ("meow!")
// scores as Speech first; the animal label, if any, is further down.
const GENERIC_LABELS = new Set([
  'Speech',
  'Child speech, kid speaking',
  'Conversation',
  'Narration, monologue',
  'Babbling',
  'Speech synthesizer',
  'Music',
  'Silence',
  'Noise',
  'Static',
  'White noise',
  'Pink noise',
  'Environmental noise',
  'Sound effect',
  'Hum',
  'Echo',
  'Reverberation',
  'Inside, small room',
  'Inside, large room or hall',
  'Inside, public space',
  'Outside, urban or manmade',
  'Outside, rural or natural',
]);

let modelPromise = null;
let classNamesPromise = null;

// Parse yamnet_class_map.csv: "index,mid,display_name", where display_name
// may be quoted because it contains commas ("Child speech, kid speaking").
async function loadClassNames() {
  const res = await fetch(CLASS_MAP_URL);
  if (!res.ok) throw new Error(`class map ${res.status}`);
  const names = [];
  // The upstream file uses CRLF line endings.
  for (const line of (await res.text()).trim().split(/\r?\n/).slice(1)) {
    const [, index, name] = line.match(/^(\d+),[^,]*,(.*)$/) || [];
    if (index !== undefined) names[Number(index)] = name.replace(/^"|"$/g, '');
  }
  return names;
}

async function loadModel() {
  const tf = await import('@tensorflow/tfjs');
  await tf.ready();
  const model = await tf.loadGraphModel(MODEL_URL);
  return { tf, model };
}

// Starts loading everything; safe to call repeatedly. A failed load is
// forgotten so the next call retries instead of returning the same error.
export function loadClassifier() {
  modelPromise ??= loadModel().catch((err) => {
    modelPromise = null;
    throw err;
  });
  classNamesPromise ??= loadClassNames().catch((err) => {
    classNamesPromise = null;
    throw err;
  });
  return Promise.all([modelPromise, classNamesPromise]);
}

// Resample with an OfflineAudioContext running at 16 kHz: the browser does
// proper filtered resampling and downmixes to its single output channel.
async function toMono16k(buffer) {
  const length = Math.ceil(buffer.duration * SAMPLE_RATE);
  const offline = new OfflineAudioContext(1, length, SAMPLE_RATE);
  const source = offline.createBufferSource();
  source.buffer = buffer;
  source.connect(offline.destination);
  source.start();
  const samples = (await offline.startRendering()).getChannelData(0);
  if (samples.length >= MIN_SAMPLES) return samples;

  // Too short for a full frame: loop the sound rather than padding with
  // silence. Silence padding makes YAMNet score "Silence" ~50% on short
  // clips and drowns out the real label.
  const looped = new Float32Array(MIN_SAMPLES);
  for (let i = 0; i < MIN_SAMPLES; i++) looped[i] = samples[i % samples.length];
  return looped;
}

// Returns { label, score, generic, lowConfidence, top } where `top` is the
// 5 best { label, score } pairs. Throws with a player-facing message.
export async function classifySound(buffer) {
  let tf, model, names;
  try {
    [{ tf, model }, names] = await loadClassifier();
  } catch (err) {
    throw new Error(`Couldn't load the sound recognizer (${err.message}).`);
  }

  try {
    const samples = await toMono16k(buffer);

    // YAMNet outputs [scores, embeddings, spectrogram]; scores is
    // [frames, 521], one row per ~0.48s hop. Average over frames.
    const meanScores = tf.tidy(() => {
      const outputs = model.predict(tf.tensor1d(samples));
      const scores = Array.isArray(outputs) ? outputs[0] : outputs;
      return scores.mean(0);
    });
    const scores = await meanScores.data();
    meanScores.dispose();

    const ranked = [...scores.keys()]
      .sort((a, b) => scores[b] - scores[a])
      .slice(0, SEARCH_DEPTH)
      .map((i) => ({ label: names[i], score: scores[i] }));

    // Prefer the best specific label, even well behind a generic one: for an
    // imitated "woof" the Dog label might only be a few percent under Speech.
    const specific = ranked.find((t) => !GENERIC_LABELS.has(t.label) && t.score >= MIN_SPECIFIC);
    const best = specific || ranked[0];
    return {
      label: best.label,
      score: best.score,
      generic: !specific,
      lowConfidence: best.score < LOW_CONFIDENCE,
      top: ranked.slice(0, 5),
    };
  } catch (err) {
    throw new Error(`Couldn't recognize that sound (${err.message}).`);
  }
}
