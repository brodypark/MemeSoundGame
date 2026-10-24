import { defineConfig } from 'vite';

// No env vars are exposed to the client here on purpose.
// The image API key is only read server-side in api/generate-image.js.
export default defineConfig({
  server: {
    port: 5173,
  },
});
