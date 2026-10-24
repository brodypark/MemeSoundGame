# Sound Merge

A browser game: record or upload a short sound, the app figures out what it is (YAMNet), generates a 6-stage "glow-up" of that thing, and you play a Suika-style merge game with it. Every merge goes up a tier and plays the sound lower. Lower pitch = more sigma.

## Run locally

```bash
npm install
npm run dev
```

`npm run dev` also runs `/api/generate-image` locally. To run the production server instead:

```bash
npm run build
npm start   # http://localhost:3000
```

## Deploy

Hosted on Render as one Node web service (`render.yaml`): it builds with Vite, then `server.js` serves `dist/` and the image API. Set `IMAGE_API_KEY` in the Render dashboard; pushes to `main` auto-deploy.

## Environment variables

Copy `.env.example` to `.env.local` and fill in real values. `.env.local` is gitignored and must never be committed. The API key is read only by `api/generate-image.js` on the server, never by frontend code.

## Stack

Vanilla JS + Vite, Matter.js, Web Audio API, YAMNet via TensorFlow.js, a tiny Node server (`server.js`) on Render for image generation.
