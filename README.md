# Sound Merge

A browser game: record or upload a short sound, the app figures out what it is (YAMNet), generates a 6-stage "glow-up" of that thing, and you play a Suika-style merge game with it. Every merge goes up a tier and plays the sound lower. Lower pitch = more sigma.

## Run locally

```bash
npm install
npm run dev
```

Once the image API exists (Phase 4), use `vercel dev` instead so `/api/generate-image` runs locally.

## Environment variables

Copy `.env.example` to `.env.local` and fill in real values. `.env.local` is gitignored and must never be committed. The API key is read only by the serverless function, never by frontend code.

## Stack

Vanilla JS + Vite, Matter.js, Web Audio API, YAMNet via TensorFlow.js, one Vercel serverless function for image generation.
