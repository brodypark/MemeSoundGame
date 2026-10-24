# Sound Merge — CLAUDE.md

## What this is

A browser game. The player uploads or records a short sound (≤ ~2s). The app classifies it with YAMNet, then generates **6 images** of what the sound is (meow → cat) with an image generation API. The 6 images are a "glow-up" ladder: tier 1 is a baby/humble version, tier 6 is the ultimate legendary "mogger" version (meme-style: the cat gets more handsome and powerful every tier). The images then drive a hands-off merge simulation: tier 1 items constantly rain down through a funnel into a big box, bounce around (low gravity, springy), and merge when two of the same tier touch. Each merge moves up a tier, swaps to the next image, and plays the sound at a lower pitch. **6 tiers total, one image per tier.**

The joke: lower pitch = more sigma. A tiny baby cat's high-pitched meow becomes a deep rumble coming from a god-tier handsome cat.

## Stack

- **Frontend:** vanilla JS (ES modules) + Vite. No framework unless it becomes necessary.
- **Physics:** Matter.js
- **Audio:** Web Audio API (`AudioBufferSourceNode.playbackRate` for pitch), `getUserMedia` + `MediaRecorder` for the mic
- **Classification:** YAMNet via TensorFlow.js, runs fully in the browser
- **Image generation:** called only from a serverless function, never from the browser
- **Backend:** one Vercel serverless function (`/api/generate-image`)
- **Hosting:** Vercel, deployed from GitHub

## Project structure

```
sound-merge/
├── CLAUDE.md
├── README.md
├── .gitignore
├── .env.example          # committed, placeholders only
├── .env.local            # NEVER committed, real keys
├── package.json
├── vite.config.js
├── index.html
├── api/
│   └── generate-image.js # serverless function, holds the API key + prompt ladder
├── public/
│   ├── default-sound.wav # fallback sound so the game works with no input
│   └── yamnet_class_map.csv
└── src/
    ├── main.js           # app entry, screen flow
    ├── audio/
    │   ├── record.js     # mic recording, trim to ~2s
    │   ├── upload.js     # file input, decode, trim
    │   ├── classify.js   # YAMNet load + inference
    │   └── playback.js   # play buffer at a given playbackRate
    ├── image/
    │   └── generate.js   # requests all 6 tier images, progress, caching
    ├── game/
    │   ├── game.js       # sim loop: spawning, physics steps, scoring, effects
    │   ├── world.js      # Matter.js setup, funnel + box walls
    │   ├── merge.js      # collision handling + tier logic
    │   ├── tiers.js      # 6 tiers: sizes, pitch rates, border colors
    │   └── render.js     # canvas drawing, images clipped to circles
    └── styles.css
```

## Core flow

1. Player uploads a sound or records one (cap at ~2s, show a waveform or timer).
2. Decode to an `AudioBuffer`, resample to **16 kHz mono** (YAMNet's required input).
3. Run YAMNet, take the top class label + confidence, and use it to pre-fill a "What made this sound?" text box. The player can edit it, and must fill it in when YAMNet only hears a voice. The validated text is the **subject**.
4. Check the cache for that subject. If all 6 tier images are cached, skip to step 7.
5. Request the 6 tier images from `/api/generate-image` (see Image generation). Show a progress UI ("Evolving your cat… 3/6") and ideally reveal each image as it arrives.
6. If any tier fails, use a fallback (emoji or colored blob) for just that tier so the game can still start.
7. Start the simulation: tier 1 items spawn at the top on a timer.
8. Items fall through the funnel → bounce in the box → same-tier collision merges into the next tier, shows the next image, plays the sound at a lower pitch.

## YAMNet notes

- The model is self-hosted in `public/models/yamnet/` (model.json + 4 weight shards, ~16 MB) and loaded with `tf.loadGraphModel('/models/yamnet/model.json')`. The old tfhub.dev URL 404s now; the source is Kaggle (`google/yamnet/tfJs/tfjs/1`). TensorFlow.js is lazy-loaded with a dynamic `import()` so it doesn't slow the first page load.
- `model.predict(waveform)` returns `[scores [frames,521], embeddings, spectrogram]`.
- `yamnet_class_map.csv` uses CRLF line endings; split on `/\r?\n/`.
- Input: 16 kHz mono float32 waveform. Output: scores for 521 classes. Average scores across frames, take argmax.
- Class names come from `yamnet_class_map.csv` (TensorFlow models repo, `research/audioset/yamnet`). Download it into `public/` and parse it on load.
- Sounds under ~1s: pad with silence to ~1s so the model has a full frame.
- Generic results like "Speech", "Music", or "Silence" are likely for odd noises. Handle them gracefully: use a fun fallback subject or ask the player to try again. Show the detected label in the UI so the result feels explained.
- A person imitating an animal ("meow!") classifies as Speech ~97–99% with no animal signal at all; YAMNet files every human voice as speech. That's why the player types the subject. Generic labels (incl. all speech labels) never pre-fill the box.
- Short clips are looped to 1s, not silence-padded: padding scored "Silence" ~50% and drowned out the real label.
- `src/audio/subject.js` maps animal-sound labels to the animal ("Meow" → "cat") and holds the subject validation rules the server must mirror.
- Run classification once per sound, not per merge.

## Image generation (6-stage glow-up ladder)

- Provider: **Google Gemini** (`gemini-3.1-flash-lite-image`, cheapest/fastest, ~$0.034/image, no free tier for images) via the stable `models/{model}:generateContent` REST endpoint with `responseModalities: ['IMAGE']`. Key goes in the `x-goog-api-key` header, never the URL. Safety blocks come back as HTTP 200 with `promptFeedback.blockReason` or an `IMAGE_SAFETY`-style `finishReason`. Keep provider, model name and size in env vars so they can be swapped without code changes. Check current docs for the best model/params rather than assuming.
- **6 images per sound, one per tier.** Tier 1 = humblest/youngest, tier 6 = peak legendary mogger.
- **Prompt ladder lives on the server.** The client sends only `{ subject, tier }` (tier is an integer 1–6). `subject` is the player's short description (2–50 chars, letters/numbers/spaces/`-`/`'` only, lowercased). The server re-validates both and drops the subject into fixed templates; the player only ever fills the `{subject}` slot, never writes a prompt. The provider's own moderation still applies.
- Two ladders, chosen server-side from the subject:
  - **Living things** (subject contains a word from a small server-side animal/person word list: cat, dog, bird, cow, horse, frog, guy, etc.): baby → glow-up.
  - **Everything else** (water, applause, car, bell, etc.): humble/plain → epic/legendary glow-up of the same object.

  Living-things ladder (replace `{subject}`):
  1. `a tiny adorable baby {subject}, cute and fluffy, big eyes`
  2. `a cute young {subject}, playful and cheerful`
  3. `a cool teenage {subject}, confident look, slightly stylish`
  4. `a handsome adult {subject}, sharp features, impressive presence`
  5. `an extremely handsome, muscular {subject} wearing sunglasses, intense confident gaze`
  6. `the ultimate legendary sigma {subject}, absurdly handsome, godlike aura, glowing, dramatic lighting, over-the-top meme "mogger" energy`

  Object ladder: same idea, e.g. 1 = small plain version, 3 = shiny and stylish, 6 = epic legendary glowing god-tier version.

  All prompts share a suffix: `centered subject, full body or full object visible, simple background, no text, no watermark` (Gemini has no transparent-background option, so the suffix asks for a plain solid white background and images fill the whole circle).
- **Consistency:** the 6 images should look like the same character. Best option: generate tier 1 first, then use the provider's image edit/reference-image endpoint to produce tiers 2–6 from it (if supported and affordable). Fallback: prompt-only with the same `{subject}` wording and style suffix. Start with prompt-only, upgrade to reference-image if the results look inconsistent.
- Smallest size the provider allows (Gemini `imageSize: '1K'` = 1024×1024; the lite model only supports 1K), square `aspectRatio: '1:1'`. Images are clipped to circles in-game anyway.
- **Cost:** this is 6 API calls per new sound, so cost control matters:
  - **Cache by subject** (all 6 images per normalized subject), in localStorage and/or server-side storage. "cat" is generated once ever, then reused. Free text means fewer cache hits than fixed labels, so the rate limits matter more.
  - Rate limit counts a *set* of 6 as one generation. Cap sets per IP per hour/day.
  - Optional: a global daily cap on total images generated; return a friendly "come back tomorrow" when hit.
- Fire the 6 requests in parallel (or tier 1 first, then 2–6 in parallel if using reference images). Show per-tier progress. Retry a failed tier once, then use the fallback visual for that tier.

## Game design

- **6 tiers.** Tier N + Tier N → Tier N+1. Tier 6 does not merge further (pops with a big flourish; maybe bonus points).
- Tier sizes grow roughly 1.35–1.5× per tier. Define everything in `tiers.js` so it's easy to tune.
- Pitch per tier: `playbackRate = 2 ** (-semitones / 12)`, dropping ~4 semitones per tier (tier 1 = original, tier 6 ≈ 20 semitones lower). Tune by ear so tier 6 is a deep rumble.
- Each tier has a colored border (e.g. baby pink → gold → glowing rainbow for tier 6) so progress reads at a glance.
- It's a simulation, not a game: no aiming, no game over. Tier 1s auto-spawn at random x along the top (~1.2s interval, paused above an item cap), slide through a funnel, and merge only once below the funnel neck (so big merged items can't jam it). A Reset button clears the box.
- Physics feel: low gravity (0.1) and springy items/walls (high restitution, very low air drag). Tune in `world.js` / `game.js`.
- Only play sounds on a merge (not on spawn). Throttle if many merges happen at once.
- Mobile-friendly: canvas scales to viewport.
- Browsers block audio until a user gesture. Create/resume the `AudioContext` on the first click/tap.
- Optional fun: a small "evolution chart" along the side showing all 6 images in order, so players see the glow-up they're working toward.

## SECRETS AND SECURITY (read this before touching git)

- **The API key lives only in `.env.local` locally and in Vercel environment variables in production.** It is only ever read inside `api/generate-image.js`.
- **Never** put the key in frontend code, `index.html`, `vite.config.js`, anything prefixed `VITE_`, or anything bundled to the browser. `VITE_*` variables are public.
- **Never** commit `.env`, `.env.local`, or any file with a real key. Commit `.env.example` with placeholder values only.
- **Never** print, log, or echo the key in terminal output, code comments, or error messages.
- Before every commit: run `git status` and `git diff --staged` and confirm no secrets or `.env*` files (other than `.env.example`) are staged. Do **not** use `git add .` blindly; stage files deliberately.
- If a key is ever committed or pasted somewhere public: **revoke and rotate it immediately** at the provider dashboard. Removing it in a later commit does not remove it from git history.
- Set a **hard monthly spend limit** in the image provider's dashboard. With 6 images per new sound, this matters more.
- The serverless function should: validate input (`subject` must be a 2–50 char string matching the same allowlist as `src/audio/subject.js`; `tier` must be an integer 1–6), reject everything else, build the prompt server-side, fix model/size/quality server-side (never trust client-supplied params), and apply rate limiting per IP plus a global daily cap.
- The deployed API route must not be a free open proxy: it only accepts `{ subject, tier }` and always uses server-side-fixed settings.

### `.gitignore` (create first, before the first commit)

```
node_modules/
dist/
.env
.env.local
.env.*.local
.vercel/
.DS_Store
*.log
```

### `.env.example` (committed)

```
# Copy to .env.local and fill in real values. NEVER commit .env.local.
IMAGE_API_KEY=your-key-here
IMAGE_PROVIDER=gemini
IMAGE_MODEL=gemini-3.1-flash-lite-image
IMAGE_SIZE=1K
MAX_SETS_PER_IP_PER_HOUR=3
MAX_IMAGES_PER_DAY=300
```

## Git and GitHub workflow

- Repo name: `sound-merge` (or similar). Create it on GitHub (public is fine as long as no secrets are in it).
- First-time setup:
  1. `git init`
  2. Create `.gitignore` and `.env.example` **before** the first commit.
  3. `git add` the files deliberately, `git status` to verify no `.env.local`, then `git commit -m "Initial commit"`.
  4. Create the GitHub repo (`gh repo create sound-merge --public --source=. --remote=origin`, or create it on github.com and add the remote), then `git push -u origin main`.
- Work in small commits with clear messages (`Add YAMNet classification`, `Implement 6-tier merging`). Use short-lived branches for bigger features (`feature/mic-recording`) and merge to `main` when it works.
- Never force-push to `main`.
- Enable GitHub **secret scanning / push protection** in the repo's Security settings.
- Deploy: connect the GitHub repo to Vercel, add the env vars in the Vercel project settings (not in the repo), and let pushes to `main` auto-deploy.

## Build plan (do in order; each phase should end with something playable/testable)

**Phase 0: Setup**
- `git init`, `.gitignore`, `.env.example`, Vite project, README, first commit, GitHub repo pushed.

**Phase 1: The game with fake input**
- Matter.js funnel + box, auto-spawning items, merge logic, **6 tiers**, canvas rendering.
- Use 6 placeholder visuals (e.g. a row of emoji or colored circles of increasing size) and `public/default-sound.wav`.
- Pitch-shifted merge sounds working across all 6 tiers.

**Phase 2: Sound input**
- File upload (decode, trim to ~2s) and mic recording (permission handling, countdown, trim).
- Playback preview so the player hears what they submitted.

**Phase 3: YAMNet classification**
- Load model + class map, resample to 16 kHz mono, classify, show label + confidence.
- Handle low-confidence/generic labels.
- "What made this sound?" text box, pre-filled from YAMNet, validated before starting.

**Phase 4: Image generation (6-stage ladder)**
- `api/generate-image.js`: validate `{ subject, tier }`, build the server-side prompt from the baby→mogger ladder, fixed server-side params, rate limiting + daily cap.
- Frontend: request all 6 tiers, per-tier progress UI, retry once, per-tier fallback visual, cache all 6 by subject.
- Wire the 6 images into the 6 tiers in the game.
- Local dev: `npm run dev` runs `api/generate-image.js` as Vite dev middleware (see `vite.config.js`), reading `.env.local` server-side only. `vercel dev` also works once the project is linked.
- Test with a few subjects (cat, dog, water) and check the glow-up reads clearly and the character stays consistent. If not, switch to the reference-image approach.

**Phase 5: Polish**
- Reveal animation showing the 6-image evolution before the game starts, merge effects (pop, particles), tier-6 flourish, score, game over + restart, evolution chart sidebar, mobile layout, "try another sound" button.

**Phase 6: Deploy**
- Vercel + env vars, test on a phone (mic permissions require HTTPS), set the provider spend limit, confirm secret scanning is on.

## Code style and working rules

- Always give complete, working files, not snippets.
- Keep modules small and single-purpose; no dependencies beyond Matter.js, TensorFlow.js, and Vite unless justified.
- Prefer plain, readable code over clever code; comment the non-obvious parts (resampling, pitch math, merge edge cases, prompt ladder).
- Handle errors visibly in the UI (mic denied, unsupported file, classification failed, generation failed), never silent failures.
- Before saying a phase is done, run it (`npm run dev` / `vercel dev`) and confirm it actually works.
- Ask before adding a new dependency, changing the stack, or doing anything that touches billing or secrets.
