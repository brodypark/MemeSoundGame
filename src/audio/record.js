import { getAudioContext } from './playback.js';
import { prepareSound, MAX_SECONDS } from './trim.js';

const COUNTDOWN_FROM = 3;
// Record a little longer than we keep: leading silence gets trimmed off,
// so the player has some slack if they start late.
const RECORD_MS = (MAX_SECONDS + 0.5) * 1000;

function micErrorMessage(err) {
  switch (err?.name) {
    case 'NotAllowedError':
    case 'SecurityError':
      return "Microphone access was blocked. Allow it in your browser's site settings, or upload a file instead.";
    case 'NotFoundError':
    case 'OverconstrainedError':
      return 'No microphone found. Plug one in, or upload a file instead.';
    case 'NotReadableError':
      return 'Your microphone is busy in another app. Close it and try again.';
    default:
      return `Couldn't start recording (${err?.message || err}).`;
  }
}

// Asks for the mic, counts down, records, and resolves with a trimmed mono
// AudioBuffer. Returns { result, stop } so the UI can end recording early.
//   onCountdown(n)       called with 3, 2, 1
//   onProgress(fraction) called while recording, 0 -> 1
export function startRecording({ onCountdown, onProgress }) {
  let stopEarly = () => {};

  const result = (async () => {
    if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
      throw new Error('Recording needs a secure page (https or localhost). Upload a file instead.');
    }
    if (typeof MediaRecorder === 'undefined') {
      throw new Error("This browser can't record audio. Upload a file instead.");
    }

    let stream;
    try {
      // Turn off voice processing: noise suppression would eat a meow or a bark.
      stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
      });
    } catch (err) {
      throw new Error(micErrorMessage(err));
    }

    try {
      for (let n = COUNTDOWN_FROM; n > 0; n--) {
        onCountdown(n);
        await new Promise((r) => setTimeout(r, 1000));
      }

      const recorder = new MediaRecorder(stream);
      const chunks = [];
      recorder.ondataavailable = (e) => e.data.size && chunks.push(e.data);
      const stopped = new Promise((resolve, reject) => {
        recorder.onstop = resolve;
        recorder.onerror = (e) => reject(e.error || new Error('Recording failed.'));
      });

      const startedAt = performance.now();
      recorder.start();
      const tick = setInterval(() => {
        const fraction = Math.min(1, (performance.now() - startedAt) / RECORD_MS);
        onProgress(fraction);
        if (fraction >= 1) stopEarly();
      }, 50);
      stopEarly = () => recorder.state === 'recording' && recorder.stop();

      await stopped;
      clearInterval(tick);

      const blob = new Blob(chunks, { type: recorder.mimeType });
      const decoded = await getAudioContext().decodeAudioData(await blob.arrayBuffer());
      return prepareSound(decoded);
    } finally {
      // Release the mic so the browser's recording indicator goes away.
      stream.getTracks().forEach((t) => t.stop());
    }
  })();

  return { result, stop: () => stopEarly() };
}
