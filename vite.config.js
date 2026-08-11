import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

/**
 * Ports are derived so two copies of this app can run side by side.
 *
 * Defaults stay 5174 (web) and 3002 (API) — 5173/3001 belong to the Meesho lister.
 * When a host assigns a web port via PORT, the API follows at PORT + 1 and the proxy
 * targets it. Pinning the API to 3002 while letting the web port move is what made a
 * second instance collide: the web server found a free port and the API did not.
 *
 * Both files derive this the same way; keep src/server/index.js in step.
 */
const webPort = Number(process.env.PORT) || 5174;
const apiPort =
  Number(process.env.API_PORT) || (process.env.PORT ? webPort + 1 : 3002);

export default defineConfig({
  plugins: [react()],
  server: {
    port: webPort,
    proxy: {
      '/api': `http://localhost:${apiPort}`,
      '/ws': { target: `ws://localhost:${apiPort}`, ws: true },
    },
  },
});
