// App entry and screen flow:
//   pick a sound (record / upload / default) -> preview it -> simulation.
// "New sound" in the header goes back to the picker.
// Classification and image generation get added in later phases.
import { createGame } from './game/game.js';
import { createPlaceholderVisuals } from './game/render.js';
import { loadSound, unlockAudio, playBuffer } from './audio/playback.js';
import { startRecording } from './audio/record.js';
import { loadSoundFile } from './audio/upload.js';
import { drawWaveform } from './audio/waveform.js';

const app = document.querySelector('#app');

app.innerHTML = `
  <header class="hud">
    <span class="title">Sound Merge</span>
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
const sections = { pick: $('#pick'), recording: $('#recording'), preview: $('#preview') };

const visuals = createPlaceholderVisuals();
let sound = null; // the AudioBuffer the player picked
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
async function pickSound(label, getBuffer) {
  if (busy) return;
  busy = true;
  showError('');
  await tryUnlockAudio();
  try {
    sound = await getBuffer();
    showPreview(label);
  } catch (err) {
    showSection('pick');
    showError(err.message);
  } finally {
    busy = false;
  }
}

function showPreview(label) {
  showSection('preview');
  drawWaveform($('#waveform'), sound);
  $('#preview-meta').textContent = `${label} · ${sound.duration.toFixed(1)}s`;
  playBuffer(sound);
}

function showPicker() {
  game?.destroy();
  game = null;
  resetButton.hidden = true;
  newSoundButton.hidden = true;
  scoreEl.textContent = '0';
  showError('');
  showSection(sound ? 'preview' : 'pick');
  overlay.hidden = false;
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
$('#default-btn').addEventListener('click', () => pickSound('Default meow', () => loadSound('/default-sound.wav')));

// --- Preview
$('#play-btn').addEventListener('click', async () => {
  await tryUnlockAudio();
  playBuffer(sound);
});
$('#start-btn').addEventListener('click', async () => {
  await tryUnlockAudio();
  startGame();
});
$('#redo-btn').addEventListener('click', () => {
  showError('');
  showSection('pick');
});

// --- Header
resetButton.addEventListener('click', startGame);
newSoundButton.addEventListener('click', showPicker);

showSection('pick');
