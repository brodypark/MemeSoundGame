// The "subject" is what the images will be of: the player's own description
// of their sound, pre-filled from YAMNet's guess when it has a useful one.
//
// The server (Phase 4) re-validates with the same rules and drops the
// subject into fixed prompt templates, so the player never writes a prompt.

export const SUBJECT_MAX_LENGTH = 50;
const SUBJECT_PATTERN = /^[a-z0-9][a-z0-9 '-]*$/i;

// YAMNet labels for animal *sounds* -> the animal itself, so "Meow" becomes
// "cat" rather than "meow". Anything not listed falls back to the label.
const SOUND_TO_SUBJECT = {
  Cat: 'cat', Meow: 'cat', Purr: 'cat', Hiss: 'cat', Caterwaul: 'cat',
  Dog: 'dog', Bark: 'dog', Yip: 'dog', Howl: 'dog', 'Bow-wow': 'dog', Growling: 'dog', 'Whimper (dog)': 'dog',
  'Cattle, bovinae': 'cow', Moo: 'cow', Cowbell: 'cow',
  Pig: 'pig', Oink: 'pig',
  Horse: 'horse', 'Neigh, whinny': 'horse', 'Clip-clop': 'horse',
  Sheep: 'sheep', Bleat: 'sheep', Goat: 'goat',
  'Chicken, rooster': 'chicken', Cluck: 'chicken', 'Crowing, cock-a-doodle-doo': 'rooster',
  Duck: 'duck', Quack: 'duck', Goose: 'goose', Honk: 'goose', Turkey: 'turkey', Gobble: 'turkey',
  Frog: 'frog', Croak: 'frog',
  Bird: 'bird', 'Bird vocalization, bird call, bird song': 'bird', 'Chirp, tweet': 'bird',
  Squawk: 'bird', Owl: 'owl', Hoot: 'owl', Crow: 'crow', Caw: 'crow', 'Pigeon, dove': 'pigeon', Coo: 'pigeon',
  'Roaring cats (lions, tigers)': 'lion', Roar: 'lion',
  'Bee, wasp, etc.': 'bee', Buzz: 'bee', Mosquito: 'mosquito', 'Fly, housefly': 'fly', Insect: 'bug', Cricket: 'cricket',
  'Rodents, rats, mice': 'mouse', Mouse: 'mouse',
  Snake: 'snake', Rattle: 'rattlesnake', 'Whale vocalization': 'whale',
};

// Returns a suggested subject, or '' when the guess isn't worth pre-filling
// (generic labels like Speech, or low confidence).
export function suggestSubject(classification) {
  if (!classification || classification.generic || classification.lowConfidence) return '';
  const { label } = classification;
  if (SOUND_TO_SUBJECT[label]) return SOUND_TO_SUBJECT[label];
  // "Beep, bleep" -> "beep"; "Whimper (dog)" -> "whimper"
  return label.split(',')[0].replace(/\(.*?\)/g, '').trim().toLowerCase();
}

// Trim, collapse spaces, lowercase. Lowercasing also makes "Cat" and "cat"
// share one image cache entry later.
export function normalizeSubject(text) {
  return text.trim().replace(/\s+/g, ' ').toLowerCase();
}

// Returns an error message for the player, or '' if the subject is fine.
export function validateSubject(subject) {
  if (subject.length < 2) return 'Describe your sound in a word or two, like "angry cat".';
  if (subject.length > SUBJECT_MAX_LENGTH) return `Keep it under ${SUBJECT_MAX_LENGTH} characters.`;
  if (!SUBJECT_PATTERN.test(subject)) return "Use only letters, numbers, spaces, - and '.";
  return '';
}
