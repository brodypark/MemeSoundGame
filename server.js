// Production server (Render web service): serves the Vite build in dist/ and
// routes POST /api/generate-image to the same handler `npm run dev` uses.
//
// Plain node:http, no framework. Env vars (IMAGE_API_KEY etc.) come from the
// host's dashboard; this process is the only place they exist.
//
// Run: npm run build && npm start

import { createServer } from 'node:http';
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { extname, join, normalize, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import generateImage from './api/generate-image.js';

const PORT = Number(process.env.PORT) || 3000;
const DIST = fileURLToPath(new URL('./dist/', import.meta.url));

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.csv': 'text/csv; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.wav': 'audio/wav',
  '.bin': 'application/octet-stream', // YAMNet weight shards
};

// Maps a URL path to a file inside dist/, or null if it would escape dist/
// (e.g. "/../.env.local").
function resolveFile(urlPath) {
  let decoded;
  try {
    decoded = decodeURIComponent(urlPath);
  } catch {
    return null;
  }
  const file = normalize(join(DIST, decoded === '/' ? 'index.html' : decoded));
  return file.startsWith(DIST) || file + sep === DIST ? file : null;
}

async function serveStatic(req, res) {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.writeHead(405, { Allow: 'GET, HEAD' });
    return res.end();
  }

  const file = resolveFile(new URL(req.url, 'http://x').pathname);
  const info = file && (await stat(file).catch(() => null));
  if (!info?.isFile()) {
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    return res.end('Not found');
  }

  // Vite fingerprints everything in /assets/, so those can be cached forever.
  // Everything else (index.html, the model, the sound) must revalidate so a
  // new deploy shows up right away.
  const immutable = file.startsWith(join(DIST, 'assets') + sep);
  res.writeHead(200, {
    'Content-Type': MIME_TYPES[extname(file)] || 'application/octet-stream',
    'Content-Length': info.size,
    'Cache-Control': immutable ? 'public, max-age=31536000, immutable' : 'no-cache',
    'X-Content-Type-Options': 'nosniff',
  });
  if (req.method === 'HEAD') return res.end();
  createReadStream(file).pipe(res);
}

const server = createServer(async (req, res) => {
  try {
    if (new URL(req.url, 'http://x').pathname === '/api/generate-image') {
      return await generateImage(req, res);
    }
    return await serveStatic(req, res);
  } catch (err) {
    console.error('server: request crashed:', err.message);
    if (!res.headersSent) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Server error.' }));
    }
  }
});

server.listen(PORT, () => console.log(`Sound Merge listening on port ${PORT}`));
