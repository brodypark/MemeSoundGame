import { getAudioContext } from './playback.js';
import { prepareSound } from './trim.js';

const MAX_FILE_MB = 20;

// File from an <input type="file"> -> trimmed mono AudioBuffer.
// Throws errors with messages meant to be shown to the player.
export async function loadSoundFile(file) {
  // Some browsers report an empty type for .m4a etc., so only reject when
  // the type is known and clearly not audio/video.
  if (file.type && !/^(audio|video)\//.test(file.type)) {
    throw new Error(`"${file.name}" isn't an audio file.`);
  }
  if (file.size > MAX_FILE_MB * 1024 * 1024) {
    throw new Error(`That file is over ${MAX_FILE_MB} MB. Try a shorter clip.`);
  }

  let decoded;
  try {
    decoded = await getAudioContext().decodeAudioData(await file.arrayBuffer());
  } catch {
    throw new Error(`Couldn't read "${file.name}". Try an MP3, WAV, M4A or OGG file.`);
  }
  return prepareSound(decoded);
}
