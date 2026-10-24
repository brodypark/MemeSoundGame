// App entry and screen flow:
//   pick a sound (record / upload / default) -> preview it -> simulation.
// "New sound" in the header goes back to the picker.
// The preview also runs YAMNet once per sound, shows what it heard, and
// pre-fills the "what made this sound?" box, which the player can edit.
// Then the 6 tier images for that subject are generated (or loaded from
// cache) and shown as an evolution ladder before the simulation starts.
import { createGame } from './game/game.js';
import { createPlaceholderVisuals, createTierVisual } from './game/render.js';
import { getTierImages } from './image/generate.js';
import { TIER_COUNT } from './game/tiers.js';
import { loadSound, unlockAudio, playBuffer } from './audio/playback.js';
import { startRecording } from './audio/record.js';
import { loadSoundFile } from './audio/upload.js';
import { drawWaveform } from './audio/waveform.js';
import { classifySound } from './audio/classify.js';
import { suggestSubject, normalizeSubject, validateSubject, SUBJECT_MAX_LENGTH } from './audio/subject.js';

const app = document.querySelector('#app');

app.innerHTML = `
  <header class="hud">
    <span class="title" id="title">Brainrot with Brody</span>
    <span class="hud-right">
      <span class="score">Score: <strong id="score">0</strong></span>
      <button id="new-sound" type="button" hidden>New sound</button>
      <button id="reset" type="button" hidden>Reset</button>
    </span>
  </header>
  <div class="stage">
    <canvas id="game"></canvas>
    <div class="overlay" id="overlay">
      <div class="panel">
        <h1 class="brand">Brainrot with Brody</h1>

        <section id="pick">
          <p>A sound rains into the flask, merges, glows up, and gets deeper.</p>
          <button id="default-btn" class="primary big" type="button">🐱 Use the default meow</button>
          <p class="or">or use your own sound (2s max)</p>
          <div class="actions small">
            <button id="record-btn" type="button">🎙️ Record</button>
            <button id="upload-btn" type="button">📁 Upload</button>
          </div>
          <input id="file-input" type="file" accept="audio/*,video/*" hidden />
        </section>

        <section id="recording" hidden>
          <p class="status" id="rec-status"></p>
          <div class="progress"><div class="progress-bar" id="rec-bar"></div></div>
          <button id="stop-btn" type="button" hidden>Stop</button>
        </section>

        <section id="preview" hidden>
          <canvas class="waveform" id="waveform"></canvas>
          <p class="meta" id="preview-meta"></p>
          <p class="heard" id="heard" aria-live="polite"></p>
          <form id="subject-form" class="subject" novalidate>
            <label for="subject">What made this sound?</label>
            <input id="subject" type="text" maxlength="${SUBJECT_MAX_LENGTH}" autocomplete="off"
              placeholder="e.g. angry cat, rubber duck" />
            <p class="field-error" id="subject-error" hidden></p>
          </form>
          <div class="actions">
            <button id="play-btn" type="button">▶ Play</button>
            <button id="start-btn" class="primary" type="button">Start</button>
          </div>
          <button id="redo-btn" class="link" type="button">pick a different sound</button>
        </section>

        <section id="generating" hidden>
          <p class="status" id="gen-status" aria-live="polite"></p>
          <div class="ladder" id="ladder"></div>
          <p class="meta" id="gen-note"></p>
          <button id="go-btn" class="primary" type="button" hidden>Let's go</button>
        </section>

        <p class="error" id="error" role="alert" hidden></p>
      </div>
    </div>
  </div>
`;

const $ = (sel) => document.querySelector(sel);
const canvas = $('#game');
const scoreEl = $('#score');
const overlay = $('#overlay');
const resetButton = $('#reset');
const newSoundButton = $('#new-sound');
const errorEl = $('#error');
const titleEl = $('#title');
const subjectInput = $('#subject');
const subjectError = $('#subject-error');
let subjectEdited = false; // once the player types, YAMNet stops overwriting
const sections = {
  pick: $('#pick'),
  recording: $('#recording'),
  preview: $('#preview'),
  generating: $('#generating'),
};

let visuals = createPlaceholderVisuals(); // one drawable per tier
let sound = null; // the AudioBuffer the player picked
let classification = null; // YAMNet result for `sound`, once it's ready
let classifyRun = 0; // bumps per sound, so a slow old result can't win
let subject = ''; // what the images will be of, once the player starts
let game = null;
let previewReady = false; // the default meow skips the preview screen
let imageRun = 0; // bumps per in-game image load, so a stale one can't win
let busy = false; // ignore clicks while recording/decoding

function showSection(name) {
  for (const [key, el] of Object.entries(sections)) el.hidden = key !== name;
}

function showError(message) {
  errorEl.textContent = message;
  errorEl.hidden = !message;
}

// Every button here is a user gesture, so it's a chance to unlock audio.
async function tryUnlockAudio() {
  try {
    await unlockAudio();
  } catch (err) {
    showError(`Audio is blocked in this browser. (${err.message})`);
  }
}

// Runs one way of getting a sound, then hands off to `next` (or shows the
// error).
async function pickSound(getBuffer, next) {
  if (busy) return;
  busy = true;
  showError('');
  await tryUnlockAudio();
  try {
    sound = await getBuffer();
    next();
  } catch (err) {
    showSection('pick');
    showError(err.message);
  } finally {
    busy = false;
  }
}

function showPreview(label) {
  previewReady = true;
  showSection('preview');
  drawWaveform($('#waveform'), sound);
  $('#preview-meta').textContent = `${label} · ${sound.duration.toFixed(1)}s`;
  subjectInput.value = '';
  subjectEdited = false;
  showSubjectError('');
  playBuffer(sound);
  classify();
}

function showSubjectError(message) {
  subjectError.textContent = message;
  subjectError.hidden = !message;
  subjectInput.setAttribute('aria-invalid', message ? 'true' : 'false');
}

const percent = (score) => `${Math.round(score * 100)}%`;

// Classify once per sound, never per merge. Result shows under the waveform.
async function classify() {
  const run = ++classifyRun;
  const heard = $('#heard');
  classification = null;
  heard.className = 'heard';
  heard.textContent = 'Listening… (first time loads the recognizer)';
  try {
    const result = await classifySound(sound);
    if (run !== classifyRun) return;
    classification = result;
    const suggestion = suggestSubject(result);
    if (suggestion && !subjectEdited) subjectInput.value = suggestion;
    if (suggestion) {
      heard.textContent = `Heard: ${result.label} (${percent(result.score)})`;
    } else {
      heard.classList.add('unsure');
      heard.textContent =
        result.label === 'Speech'
          ? 'Heard a human voice. Tell us what you were going for below.'
          : `Not sure (best guess: ${result.label}, ${percent(result.score)}). Describe it below.`;
    }
    heard.title = result.top.map((t) => `${t.label} ${percent(t.score)}`).join('\n');
  } catch (err) {
    if (run !== classifyRun) return;
    heard.classList.add('failed');
    heard.textContent = `${err.message} Describe your sound below instead.`;
  }
}

function showPicker() {
  game?.destroy();
  game = null;
  resetButton.hidden = true;
  newSoundButton.hidden = true;
  scoreEl.textContent = '0';
  titleEl.textContent = 'Brainrot with Brody';
  titleEl.title = '';
  imageRun++; // stop a still-loading default meow from touching the title
  showError('');
  // Back to the preview (not the ladder) so the subject can be changed.
  showSection(previewReady ? 'preview' : 'pick');
  overlay.hidden = false;
}

// Start from the preview: the subject has to be valid first.
function startFromPreview() {
  const value = normalizeSubject(subjectInput.value);
  const problem = validateSubject(value);
  showSubjectError(problem);
  if (problem) {
    subjectInput.focus();
    return;
  }
  subject = value;
  subjectInput.value = value;
  generateImages();
}

// Fetch (or load from cache) the 6 tier images and reveal them one by one.
// Failed tiers keep their placeholder so the simulation can always start.
async function generateImages() {
  showSection('generating');
  const status = $('#gen-status');
  const note = $('#gen-note');
  const goButton = $('#go-btn');
  const ladder = $('#ladder');
  goButton.hidden = true;
  note.textContent = '';

  // One slot per tier, showing the placeholder until its image arrives.
  const slots = [];
  ladder.replaceChildren();
  for (let tier = 1; tier <= TIER_COUNT; tier++) {
    const slot = document.createElement('canvas');
    slot.className = 'slot pending';
    slot.width = slot.height = 128;
    slot.getContext('2d').drawImage(createTierVisual(tier, null), 0, 0, 128, 128);
    ladder.append(slot);
    slots.push(slot);
  }

  let done = 0;
  status.textContent = `Evolving your ${subject}… 0/${TIER_COUNT}`;
  const { images, errors } = await getTierImages(subject, ({ tier, image }) => {
    const slot = slots[tier - 1];
    slot.className = image ? 'slot' : 'slot failed';
    slot.getContext('2d').drawImage(createTierVisual(tier, image), 0, 0, 128, 128);
    status.textContent = `Evolving your ${subject}… ${++done}/${TIER_COUNT}`;
  });

  visuals = images.map((image, i) => createTierVisual(i + 1, image));
  const failed = images.filter((image) => !image).length;
  if (failed === 0) {
    status.textContent = `Behold: the ${subject} glow-up.`;
  } else {
    status.textContent = failed === TIER_COUNT ? 'No glow-up this time.' : `${TIER_COUNT - failed}/${TIER_COUNT} glow-ups made.`;
    // Errors are usually all the same (e.g. rate limit), so show each once.
    note.textContent = `${[...new Set(errors)].join(' ')} Using stand-ins for the missing ones.`;
  }
  goButton.hidden = false;
  goButton.focus();
}

function startGameFromLadder() {
  titleEl.textContent = `Brainrot with Brody · ${subject}`;
  startGame();
}

// The default meow skips the preview and the ladder reveal: we already know
// it's a cat, so start right away with placeholders and swap each tier's
// image in as it arrives (instant once cached). The game draws from the
// `visuals` array every frame, so filling it in place shows up live.
async function startDefault() {
  previewReady = false;
  subject = 'cat';
  visuals = createPlaceholderVisuals();
  const target = visuals;
  const run = ++imageRun;
  const label = `Brainrot with Brody · ${subject}`;
  titleEl.textContent = `${label} (evolving…)`;
  startGame();

  let done = 0;
  const { images, errors } = await getTierImages(subject, ({ tier, image }) => {
    if (image) target[tier - 1] = createTierVisual(tier, image);
    if (run === imageRun) titleEl.textContent = `${label} (evolving ${++done}/${TIER_COUNT}…)`;
  });
  if (run !== imageRun) return;

  const failed = images.filter((image) => !image).length;
  titleEl.textContent = failed ? `${label} (${TIER_COUNT - failed}/${TIER_COUNT} glow-ups)` : label;
  // Errors are usually all the same (e.g. rate limit), so show each once.
  titleEl.title = failed ? `${[...new Set(errors)].join(' ')} Using stand-ins for the missing ones.` : '';
}

function startGame() {
  game?.destroy();
  overlay.hidden = true;
  game = createGame({
    canvas,
    sound,
    visuals,
    onScore: (score) => (scoreEl.textContent = score),
  });
  resetButton.hidden = false;
  newSoundButton.hidden = false;
}

// --- Record
let activeRecording = null;
$('#record-btn').addEventListener('click', () =>
  pickSound(async () => {
    const status = $('#rec-status');
    const bar = $('#rec-bar');
    const stopButton = $('#stop-btn');
    status.textContent = 'Waiting for microphone permission…';
    bar.style.width = '0%';
    stopButton.hidden = true;
    showSection('recording');

    activeRecording = startRecording({
      onCountdown: (n) => (status.textContent = `Get ready… ${n}`),
      onProgress: (fraction) => {
        status.textContent = 'Recording! Make your sound now.';
        stopButton.hidden = false;
        bar.style.width = `${fraction * 100}%`;
      },
    });
    try {
      return await activeRecording.result;
    } finally {
      activeRecording = null;
    }
  }, () => showPreview('Your recording')),
);
$('#stop-btn').addEventListener('click', () => activeRecording?.stop());

// --- Upload
const fileInput = $('#file-input');
$('#upload-btn').addEventListener('click', () => fileInput.click());
fileInput.addEventListener('change', () => {
  const file = fileInput.files[0];
  fileInput.value = ''; // so picking the same file again still fires 'change'
  if (file) pickSound(() => loadSoundFile(file), () => showPreview(file.name));
});

// --- Default: straight to the simulation
$('#default-btn').addEventListener('click', () =>
  pickSound(() => loadSound('/default-sound.mp3'), startDefault),
);

// --- Preview
$('#play-btn').addEventListener('click', async () => {
  await tryUnlockAudio();
  playBuffer(sound);
});
$('#start-btn').addEventListener('click', async () => {
  await tryUnlockAudio();
  startFromPreview();
});
// Enter in the text box starts too.
$('#subject-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  await tryUnlockAudio();
  startFromPreview();
});
subjectInput.addEventListener('input', () => {
  subjectEdited = true;
  if (!subjectError.hidden) showSubjectError(validateSubject(normalizeSubject(subjectInput.value)));
});
$('#redo-btn').addEventListener('click', () => {
  showError('');
  showSection('pick');
});

$('#go-btn').addEventListener('click', async () => {
  await tryUnlockAudio();
  startGameFromLadder();
});

// --- Header
resetButton.addEventListener('click', startGame);
newSoundButton.addEventListener('click', showPicker);

showSection('pick');
