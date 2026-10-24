// POST /api/generate-image   body: { subject, tier }
//
// The only place the image API key is used. The client sends just the
// player's subject ("angry cat") and a tier 1-6; everything else (prompt,
// model, size) is fixed here, so this can't be used as an open
// image-generation proxy. Responds with the image bytes (Gemini returns PNG
// or JPEG), or JSON { error } with a player-facing message.
//
// Runs inside server.js in production and as Vite dev middleware locally
// (see vite.config.js), so it only uses plain Node req/res APIs.

import { normalizeSubject, validateSubject } from '../src/audio/subject.js';

const TIER_COUNT = 6;
const MAX_BODY_BYTES = 1024;
const GEMINI_URL = 'https://generativelanguage.googleapis.com/v1beta/models';
// Gemini finish reasons that mean "refused", not "try again".
const SAFETY_FINISH_REASONS = new Set(['SAFETY', 'IMAGE_SAFETY', 'IMAGE_PROHIBITED_CONTENT', 'PROHIBITED_CONTENT', 'BLOCKLIST']);

// --- Prompt ladders --------------------------------------------------------
// Tier 1 is the humblest version, tier 6 the legendary "mogger" version.
// The player's subject only ever fills the {subject} slot.

const LIVING_LADDER = [
  'a tiny adorable baby {subject}, cute and fluffy, big eyes',
  'a cute young {subject}, playful and cheerful',
  'a cool teenage {subject}, confident look, slightly stylish',
  'a handsome adult {subject}, sharp features, impressive presence',
  'an extremely handsome, muscular {subject} wearing sunglasses, intense confident gaze',
  'the ultimate legendary sigma {subject}, absurdly handsome, godlike aura, glowing, dramatic lighting, over-the-top meme "mogger" energy',
];

const OBJECT_LADDER = [
  'a small, plain, ordinary {subject}',
  'a clean, nice-looking {subject}',
  'a shiny, stylish {subject} with cool details',
  'an impressive, premium {subject}, sleek and powerful-looking',
  'an extremely cool, upgraded {subject} with sunglasses and swagger, intense presence',
  'the ultimate legendary sigma {subject}, epic god-tier version, glowing aura, dramatic lighting, over-the-top meme "mogger" energy',
];

// Same style words on every tier so the 6 images look like one character.
const STYLE_SUFFIX =
  'glossy cartoon sticker art style, centered subject, full body or full object visible, ' +
  'on a plain solid white background, no text, no watermark';

// If any word of the subject is one of these, use the living ladder
// (baby -> glow-up). Everything else gets the object ladder.
const LIVING_WORDS = new Set(
  `cat cats kitten kitty dog dogs puppy pup doggo bird birds parrot penguin owl crow pigeon chicken
  rooster hen chick duck goose turkey cow cows bull calf horse pony donkey pig piglet sheep lamb goat
  frog toad lion tiger bear wolf fox monkey ape gorilla chimp elephant mouse rat hamster rabbit bunny
  squirrel snake lizard turtle dinosaur dragon whale dolphin shark fish seal otter bee wasp fly
  mosquito cricket bug insect spider man guy dude bro woman girl boy kid baby person human
  people child grandpa grandma dad mom`.split(/\s+/),
);

// ...unless it's clearly a thing shaped like one ("rubber duck", "toy dog").
const NOT_LIVING_WORDS = new Set('rubber toy plastic robot robotic stuffed plush statue figurine squeaky inflatable cartoon'.split(' '));

function buildPrompt(subject, tier) {
  const words = subject.split(' ').map((word) => word.replace(/'s$/, ''));
  const living = words.some((w) => LIVING_WORDS.has(w)) && !words.some((w) => NOT_LIVING_WORDS.has(w));
  const ladder = living ? LIVING_LADDER : OBJECT_LADDER;
  return `${ladder[tier - 1].replace('{subject}', subject)}, ${STYLE_SUFFIX}`;
}

// --- Rate limiting -----------------------------------------------------------
// In-memory, so it's per server instance and resets when the instance is
// recycled. Good enough for local dev and light use; the provider's hard
// monthly spend limit is the real safety net. A set of 6 images counts as
// one "set" against the per-IP limit.

const HOUR_MS = 60 * 60 * 1000;
const perIp = new Map(); // ip -> timestamps of recent images
let day = '';
let imagesToday = 0;

function intEnv(name, fallback) {
  const n = Number.parseInt(process.env[name], 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

// Returns a player-facing message if this request is over a limit.
function checkLimits(ip) {
  const today = new Date().toISOString().slice(0, 10);
  if (today !== day) {
    day = today;
    imagesToday = 0;
  }
  if (imagesToday >= intEnv('MAX_IMAGES_PER_DAY', 300)) {
    return 'The glow-up machine is out of juice for today. Come back tomorrow!';
  }

  const now = Date.now();
  const recent = (perIp.get(ip) || []).filter((t) => now - t < HOUR_MS);
  if (recent.length >= intEnv('MAX_SETS_PER_IP_PER_HOUR', 3) * TIER_COUNT) {
    return "You've made a lot of glow-ups this hour. Try again in a bit, or reuse a sound you've done before.";
  }
  recent.push(now);
  perIp.set(ip, recent);
  imagesToday++;
  return '';
}

// --- Request handling ------------------------------------------------------------

function sendJson(res, status, body) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(body));
}

// Some hosts pre-parse JSON into req.body; plain Node servers don't.
async function readBody(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  let raw = '';
  for await (const chunk of req) {
    raw += chunk;
    if (raw.length > MAX_BODY_BYTES) throw new Error('too large');
  }
  return JSON.parse(raw);
}

function clientIp(req) {
  const forwarded = req.headers['x-forwarded-for'];
  return (typeof forwarded === 'string' && forwarded.split(',')[0].trim()) || req.socket?.remoteAddress || 'unknown';
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return sendJson(res, 405, { error: 'Method not allowed.' });
  }

  let body;
  try {
    body = await readBody(req);
  } catch {
    return sendJson(res, 400, { error: 'Bad request.' });
  }

  // Validate input: exactly { subject, tier }, nothing else is used.
  const subject = typeof body?.subject === 'string' ? normalizeSubject(body.subject) : '';
  const subjectProblem = validateSubject(subject);
  if (subjectProblem) return sendJson(res, 400, { error: subjectProblem });
  const tier = body?.tier;
  if (!Number.isInteger(tier) || tier < 1 || tier > TIER_COUNT) {
    return sendJson(res, 400, { error: 'Bad tier.' });
  }

  const apiKey = process.env.IMAGE_API_KEY;
  const provider = process.env.IMAGE_PROVIDER || 'gemini';
  if (!apiKey || provider !== 'gemini') {
    // Never echo the key or its absence details beyond this.
    console.error('generate-image: image provider is not configured');
    return sendJson(res, 500, { error: "Image generation isn't set up on the server yet." });
  }

  const limitMessage = checkLimits(clientIp(req));
  if (limitMessage) return sendJson(res, 429, { error: limitMessage });

  const model = process.env.IMAGE_MODEL || 'gemini-3.1-flash-lite-image';
  let upstream;
  try {
    upstream = await fetch(`${GEMINI_URL}/${encodeURIComponent(model)}:generateContent`, {
      method: 'POST',
      // Key goes in a header, not the URL, so it never shows up in URL logs.
      headers: { 'x-goog-api-key': apiKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: buildPrompt(subject, tier) }] }],
        generationConfig: {
          responseModalities: ['IMAGE'],
          imageConfig: { aspectRatio: '1:1', imageSize: process.env.IMAGE_SIZE || '1K' },
        },
      }),
      signal: AbortSignal.timeout(110_000),
    });
  } catch (err) {
    console.error('generate-image: request to provider failed:', err.name);
    return sendJson(res, 502, { error: 'The image service took too long. Try again.' });
  }

  if (!upstream.ok) {
    // Log only the status. Upstream messages never reach logs or users, in
    // case they ever echo request details.
    const status = await upstream
      .json()
      .then((j) => j?.error?.status)
      .catch(() => undefined);
    console.error(`generate-image: provider returned ${upstream.status} (${status || 'no status'})`);
    if (upstream.status === 429) {
      return sendJson(res, 503, { error: 'The image service is busy. Try again in a minute.' });
    }
    return sendJson(res, 502, { error: 'The image service had a problem. Try again.' });
  }

  // A safety block still comes back as 200, with a block/finish reason and
  // no image part.
  const json = await upstream.json();
  const candidate = json?.candidates?.[0];
  const blocked = json?.promptFeedback?.blockReason || SAFETY_FINISH_REASONS.has(candidate?.finishReason);
  if (blocked) {
    console.error(`generate-image: blocked (${json?.promptFeedback?.blockReason || candidate?.finishReason})`);
    return sendJson(res, 422, { error: "The image service won't draw that one. Try describing it differently." });
  }
  const image = candidate?.content?.parts?.map((p) => p.inlineData || p.inline_data).find((d) => d?.data);
  const mimeType = image?.mimeType || image?.mime_type || '';
  if (!image || !mimeType.startsWith('image/')) {
    console.error(`generate-image: no image in response (${candidate?.finishReason || 'no finish reason'})`);
    return sendJson(res, 502, { error: 'The image service sent back nothing. Try again.' });
  }

  res.statusCode = 200;
  res.setHeader('Content-Type', mimeType);
  res.setHeader('Cache-Control', 'no-store');
  res.end(Buffer.from(image.data, 'base64'));
}
