// App entry and screen flow:
//   pick a sound (record / upload / default) -> preview it -> simulation.
// "New sound" in the header goes back to the picker.
// The preview also runs YAMNet once per sound, shows what it heard, and
// pre-fills the "what made this sound?" box, which the player can edit.
// That subject is what Phase 4 will generate images of.
import { createGame } from './game/game.js';
import { createPlaceholderVisuals } from './game/render.js';
import { loadSound, unlockAudio, playBuffer } from './audio/playback.js';
import { startRecording } from './audio/record.js';
import { loadSoundFile } from './audio/upload.js';
import { drawWaveform } from './audio/waveform.js';
import { classifySound } from './audio/classify.js';
import { suggestSubject, normalizeSubject, validateSubject, SUBJECT_MAX_LENGTH } from './audio/subject.js';

const app = document.querySelector('#app');

app.innerHTML = `
  <header class="hud">
    <span class="title" id="title">Sound Merge</span>
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
        <h1>Sound Merge</h1>

        <section id="pick">
          <p>Give it a short sound (2s max). It rains into the funnel, merges, glows up, and gets deeper.</p>
          <div class="actions">
            <button id="record-btn" class="primary" type="button">🎙️ Record</button>
            <button id="upload-btn" type="button">📁 Upload</button>
          </div>
          <input id="file-input" type="file" accept="audio/*,video/*" hidden />
          <button id="default-btn" class="link" type="button">or use the default meow</button>
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
const sections = { pick: $('#pick'), recording: $('#recording'), preview: $('#preview') };

const visuals = createPlaceholderVisuals();
let sound = null; // the AudioBuffer the player picked
let classification = null; // YAMNet result for `sound`, once it's ready
let classifyRun = 0; // bumps per sound, so a slow old result can't win
let subject = ''; // what the images will be of, once the player starts
let game = null;
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

// Runs one way of getting a sound, then shows the preview (or the error).
// `knownSubject` skips YAMNet's suggestion when we already know what it is.
async function pickSound(label, getBuffer, knownSubject = '') {
  if (busy) return;
  busy = true;
  showError('');
  await tryUnlockAudio();
  try {
    sound = await getBuffer();
    showPreview(label, knownSubject);
  } catch (err) {
    showSection('pick');
    showError(err.message);
  } finally {
    busy = false;
  }
}

function showPreview(label, knownSubject) {
  showSection('preview');
  drawWaveform($('#waveform'), sound);
  $('#preview-meta').textContent = `${label} · ${sound.duration.toFixed(1)}s`;
  subjectInput.value = knownSubject;
  subjectEdited = Boolean(knownSubject);
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
  titleEl.textContent = 'Sound Merge';
  showError('');
  showSection(sound ? 'preview' : 'pick');
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
  titleEl.textContent = `Sound Merge · ${subject}`;
  startGame();
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
  pickSound('Your recording', async () => {
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
  }),
);
$('#stop-btn').addEventListener('click', () => activeRecording?.stop());

// --- Upload
const fileInput = $('#file-input');
$('#upload-btn').addEventListener('click', () => fileInput.click());
fileInput.addEventListener('change', () => {
  const file = fileInput.files[0];
  fileInput.value = ''; // so picking the same file again still fires 'change'
  if (file) pickSound(file.name, () => loadSoundFile(file));
});

// --- Default
$('#default-btn').addEventListener('click', () =>
  pickSound('Default meow', () => loadSound('/default-sound.wav'), 'cat'),
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

// --- Header
resetButton.addEventListener('click', startGame);
newSoundButton.addEventListener('click', showPicker);

showSection('pick');
