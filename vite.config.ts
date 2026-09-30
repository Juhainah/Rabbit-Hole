import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

const API_PORT = Number(process.env.API_PORT ?? 8787);

export default defineConfig({
  plugins: [react(), tailwindcss()],
  // Keep Vite's cache out of the project: OneDrive locks files while syncing,
  // which crashed the dev server when it rebuilt the cache.
  cacheDir: join(tmpdir(), 'rabbit-hole-vite'),
  server: {
    port: 5173,
    proxy: {
      '/api': { target: `http://127.0.0.1:${API_PORT}`, changeOrigin: true },
    },
  },
});
