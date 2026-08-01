import express from 'express';
import { broadcast } from '../index.js';
import { getSession } from '../../browser/session.js';

const router = express.Router();

/**
 * POST /api/session/login — open Chromium and wait for the seller to sign in.
 *
 * Signing in is a one-time setup step, not part of listing. Doing it inside a run
 * means a failed login surfaces as a confusing mid-form selector error; doing it
 * here makes the session an explicit precondition you can verify before committing
 * to a 50-listing batch.
 */
router.post('/login', async (_req, res) => {
  const log = (text) => broadcast({ type: 'info', text });
  res.json({ started: true });
  try {
    await getSession(log);
    broadcast({ type: 'success', text: 'Signed in. The session is saved for future runs.' });
  } catch (err) {
    broadcast({ type: 'error', text: err.message });
  }
});

/** GET /api/session — is the saved browser session currently usable? */
router.get('/', async (_req, res) => {
  try {
    const { page } = await getSession(() => {});
    res.json({ signedIn: true, url: page.url() });
  } catch (err) {
    res.status(200).json({ signedIn: false, error: err.message });
  }
});

export default router;
