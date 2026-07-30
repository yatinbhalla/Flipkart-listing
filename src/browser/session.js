import { chromium } from 'playwright';
import path from 'path';
import fs from 'fs/promises';

// WHY a persistent profile dir: cookies, localStorage and IndexedDB all come back
// on the next launch, so you log into Seller Hub once by hand and every later run
// skips authentication entirely. Far simpler than serialising cookies, and it
// survives Flipkart's session-token rotation.
const PROFILE_DIR = path.resolve('data/.browser-profile');
const HUB_URL = 'https://seller.flipkart.com/index.html#dashboard/home-page';
const LOGIN_TIMEOUT_MS = 5 * 60 * 1000;

// Chromium allows only one instance per persistent profile dir, so cache the
// context and reuse it for back-to-back runs.
let _context = null;

async function isLoggedIn(page) {
  await page.waitForLoadState('domcontentloaded').catch(() => {});
  const url = page.url();
  if (!url.includes('seller.flipkart.com')) return false;
  if (/login|signin|auth/i.test(url)) return false;
  // The seller name in the header only renders once authenticated.
  return page.locator('text=/Seller Hub/i').first().isVisible().catch(() => false);
}

/**
 * Launch headed Chromium and make sure we are signed into Seller Hub.
 *
 * Login is deliberately manual-first: Flipkart sends an OTP to the registered
 * phone/email on new sessions, which cannot be automated. We open the page and
 * wait for the user to finish; after that the profile keeps the session alive.
 */
export async function getSession(log = console.log) {
  if (_context) {
    try {
      const page = _context.pages()[0] || (await _context.newPage());
      await page.evaluate(() => 1); // throws if the user closed the browser
      await page.bringToFront().catch(() => {});
      log('✓ Reusing the open browser session — login skipped.');
      return { context: _context, page };
    } catch {
      _context = null; // stale handle, fall through to a fresh launch
    }
  }

  await fs.mkdir(PROFILE_DIR, { recursive: true });
  log('Launching Chromium…');

  let context;
  try {
    context = await chromium.launchPersistentContext(PROFILE_DIR, {
      headless: false,
      viewport: null,
      args: ['--start-maximized', '--disable-blink-features=AutomationControlled'],
    });
  } catch (err) {
    if (/in use|profile|locked|SingletonLock/i.test(String(err.message))) {
      throw new Error(
        'A Chromium window using the saved Flipkart profile is already open. ' +
          'Close it, then run again.',
      );
    }
    throw err;
  }

  _context = context;
  context.on('close', () => { if (_context === context) _context = null; });

  const page = context.pages()[0] || (await context.newPage());
  log('Opening Flipkart Seller Hub…');
  await page.goto(HUB_URL, { waitUntil: 'domcontentloaded' }).catch(() => {});
  await page.waitForTimeout(3000);

  if (await isLoggedIn(page)) {
    log('✓ Already signed in (session restored).');
    return { context, page };
  }

  log('Not signed in. Please log into Seller Hub in the browser window that just opened.');
  log(`Waiting up to ${LOGIN_TIMEOUT_MS / 60000} minutes…`);
  const start = Date.now();
  while (Date.now() - start < LOGIN_TIMEOUT_MS) {
    if (await isLoggedIn(page)) {
      log('✓ Login detected — the session is saved for next time.');
      return { context, page };
    }
    await page.waitForTimeout(2500);
  }
  throw new Error('Timed out waiting for Flipkart login.');
}

export async function closeSession() {
  await _context?.close().catch(() => {});
  _context = null;
}
