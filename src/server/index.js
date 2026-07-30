import 'dotenv/config';
import express from 'express';
import { createServer } from 'http';
import { WebSocketServer } from 'ws';
import cors from 'cors';
import fs from 'fs/promises';
import pathsRouter from './routes/paths.js';
import runRouter from './routes/run.js';
import uploadsRouter from './routes/uploads.js';
import { listSkus, listPaths, savePath } from './store.js';
import { seedPath } from './seed.js';

const app = express();
const server = createServer(app);

// Attached to the same HTTP server so Vite's proxy forwards /ws without extra config.
const wss = new WebSocketServer({ server, path: '/ws' });

export function broadcast(message) {
  const payload = JSON.stringify(message);
  wss.clients.forEach((client) => {
    if (client.readyState === 1) client.send(payload);
  });
}

wss.on('connection', () => broadcast({ type: 'info', text: 'Connected to Flipkart Lister.' }));

// Only one Playwright run at a time — two runs would fight over the same browser
// profile and the same half-built form.
let activeRun = null;
export const getActiveRun = () => activeRun;
export const setActiveRun = (v) => { activeRun = v; };
export const clearActiveRun = () => { activeRun = null; };

app.use(cors());
app.use(express.json({ limit: '4mb' }));

app.use('/api/paths', pathsRouter);
app.use('/api/run', runRouter);
app.use('/api/uploads', uploadsRouter);
app.get('/api/skus', async (_req, res) => res.json(await listSkus()));
app.get('/api/health', (_req, res) => {
  const key = process.env.GEMINI_API_KEY;
  res.json({
    ok: true,
    activeRun,
    gemini: Boolean(key) && key !== 'your_gemini_api_key_here',
  });
});

// API_PORT, not PORT. Dev-tooling that launches the app (and some hosts) inject
// PORT set to the *web* port — 5174 here — which made the API bind on top of Vite
// and serve requests from whichever socket won. Keeping a distinct name means the
// API port is only ever changed deliberately.
const PORT = process.env.API_PORT || 3002;

// On first boot, seed the Table Cover path from the listing that was built by hand
// so there is something runnable immediately.
async function bootstrap() {
  await fs.mkdir('data', { recursive: true });
  const existing = await listPaths();
  if (!existing.length) {
    await savePath(seedPath.id, seedPath);
    console.log('   Seeded the "PVC Table Cover" path from the verified manual listing.');
  }
}

bootstrap()
  .catch((err) => console.error('Bootstrap failed:', err.message))
  .finally(() => {
    server
      .listen(PORT, () => {
        console.log(`\n✅  Flipkart Lister API on http://localhost:${PORT}`);
        console.log(`   Open the UI at http://localhost:5174\n`);
      })
      // Silent failure here is how a stale server from a previous run ends up
      // serving stale code — say so loudly instead.
      .on('error', (err) => {
        if (err.code === 'EADDRINUSE') {
          console.error(
            `\n❌  Port ${PORT} is already in use — most likely an older Flipkart Lister ` +
              `server is still running. Stop it, then start again.\n`,
          );
          process.exit(1);
        }
        throw err;
      });
  });
