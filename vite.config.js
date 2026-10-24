import { defineConfig, loadEnv } from 'vite';

// Runs api/generate-image.js inside the Vite dev server, so `npm run dev`
// has the image API too. In production server.js runs the same file.
//
// Secrets: loadEnv reads .env.local into the *server* process only. Nothing
// here goes into `define`, and none of the keys are VITE_-prefixed, so the
// API key is never bundled into browser code.
function devApi(mode) {
  return {
    name: 'dev-api',
    apply: 'serve',
    configureServer(server) {
      Object.assign(process.env, loadEnv(mode, process.cwd(), ''));
      server.middlewares.use('/api/generate-image', async (req, res) => {
        // Re-import through Vite so edits to the handler apply without a restart.
        const { default: handler } = await server.ssrLoadModule('/api/generate-image.js');
        try {
          await handler(req, res);
        } catch (err) {
          console.error('dev-api: handler crashed:', err.message);
          if (!res.headersSent) {
            res.statusCode = 500;
            res.end(JSON.stringify({ error: 'Server error.' }));
          }
        }
      });
    },
  };
}

export default defineConfig(({ mode }) => ({
  plugins: [devApi(mode)],
  server: {
    port: 5173,
  },
  build: {
    // TensorFlow.js is ~1 MB on its own; it's lazy-loaded, so that's expected.
    chunkSizeWarningLimit: 1200,
  },
}));
