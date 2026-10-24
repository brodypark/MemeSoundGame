// App entry and screen flow. For Phase 1 the flow is just:
// start screen (unlocks audio) -> simulation, with a reset button.
// Sound input, classification and image generation get added in later phases.
import { createGame } from './game/game.js';
import { createPlaceholderVisuals } from './game/render.js';
import { loadSound, unlockAudio } from './audio/playback.js';

const app = document.querySelector('#app');

app.innerHTML = `
  <header class="hud">
    <span class="title">Sound Merge</span>
    <span class="hud-right">
      <span class="score">Score: <strong id="score">0</strong></span>
      <button id="reset" type="button" hidden>Reset</button>
    </span>
  </header>
  <div class="stage">
    <canvas id="game"></canvas>
    <div class="overlay" id="overlay">
      <div class="panel">
        <h1>Sound Merge</h1>
        <p>Things rain into the funnel. Matching ones merge in the box, glow up, and get deeper.</p>
        <p class="error" id="error" hidden></p>
        <button id="overlay-button" type="button">Tap to start</button>
      </div>
    </div>
  </div>
`;

const canvas = document.querySelector('#game');
const scoreEl = document.querySelector('#score');
const overlay = document.querySelector('#overlay');
const resetButton = document.querySelector('#reset');
const overlayButton = document.querySelector('#overlay-button');
const errorEl = document.querySelector('#error');

const visuals = createPlaceholderVisuals();
let sound = null;
let game = null;

// Start decoding right away; it doesn't need the AudioContext to be running.
const soundReady = loadSound('/default-sound.wav')
  .then((buffer) => (sound = buffer))
  .catch((err) => showError(`Sound failed to load, playing silently. (${err.message})`));

function showError(message) {
  errorEl.textContent = message;
  errorEl.hidden = false;
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
}

resetButton.addEventListener('click', startGame);

overlayButton.addEventListener('click', async () => {
  // The click is the user gesture browsers require before audio can play.
  try {
    await unlockAudio();
  } catch (err) {
    showError(`Audio is blocked, playing silently. (${err.message})`);
  }
  await soundReady;
  startGame();
});
