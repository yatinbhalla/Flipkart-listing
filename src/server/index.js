import 'dotenv/config';
import express from 'express';
import { createServer } from 'http';
import { WebSocketServer } from 'ws';
import cors from 'cors';
import fs from 'fs/promises';
import pathsRouter from './routes/paths.js';
import runRouter from './routes/run.js';
import uploadsRouter from './routes/uploads.js';
import debugRouter from './routes/debug.js';
import sessionRouter from './routes/session.js';
import discoverRouter from './routes/discover.js';
import { setAiRecovery } from '../browser/form.js';
import { recoverClick } from '../ai/recover.js';
import { listSkus, listPaths, savePath } from './store.js';
import { seedPath } from './seed.js';

const app = express();
const server = createServer(app);

// Give the browser layer its AI fallback. Only fires after the deterministic path
// has failed, and only when a Gemini key is configured — the executor works
// without it, just with fewer second chances.
setAiRecovery(recoverClick, (text) => broadcast({ type: 'info', text }));

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
app.use('/api/debug', debugRouter);
app.use('/api/session', sessionRouter);
app.use('/api/discover', discoverRouter);
app.get('/api/skus', async (_req, res) => res.json(await listSkus()));
app.get('/api/health', (_req, res) => {
  const key = process.env.GEMINI_API_KEY;
  res.json({
    ok: true,
    activeRun,
    gemini: Boolean(key) && key !== 'your_gemini_api_key_here',
  });
});

/**
 * Never bind PORT directly. Dev tooling that launches the app injects PORT set to
 * the *web* port, and binding that put the API on top of Vite with requests going to
 * whichever socket won.
 *
 * But ignoring PORT entirely was also wrong: it pinned the API to 3002 while the web
 * port was free to move, so a second copy of the app could not start. So derive it —
 * PORT + 1 when a host assigned one, 3002 otherwise. vite.config.js derives the
 * proxy target the same way; keep the two in step.
 */
const PORT =
  Number(process.env.API_PORT) ||
  (process.env.PORT ? Number(process.env.PORT) + 1 : 3002);

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

// Silent failure here is how a stale server from a previous run ends up serving
// stale code — say so loudly instead. This has to be attached to `wss` as well as
// `server`: ws mirrors every http-server error onto the WebSocketServer, and an
// unhandled 'error' there throws before this handler would otherwise run.
function onListenError(err) {
  if (err.code === 'EADDRINUSE') {
    console.error(
      `\n❌  Port ${PORT} is already in use — most likely an older Flipkart Lister ` +
        `server is still running. Stop it, then start again:\n` +
        `      npx kill-port ${PORT}\n`,
    );
    process.exit(1);
  }
  throw err;
}

server.on('error', onListenError);
wss.on('error', onListenError);

bootstrap()
  .catch((err) => console.error('Bootstrap failed:', err.message))
  .finally(() => {
    server.listen(PORT, () => {
      console.log(`\n✅  Flipkart Lister API on http://localhost:${PORT}`);
      console.log(`   Open the UI at http://localhost:5174\n`);
    });
  });
