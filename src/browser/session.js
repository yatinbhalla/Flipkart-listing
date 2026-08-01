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

/**
 * Fill the Seller Hub login form from the environment and submit.
 *
 * Credentials are read from process.env at call time and are never logged, echoed,
 * or persisted anywhere but the browser profile. Flipkart usually follows the
 * password step with an OTP to the registered phone, which cannot be automated —
 * so this is best-effort, and the caller falls back to waiting for the seller to
 * finish by hand.
 */
async function attemptLogin(page, log) {
  const email = process.env.FLIPKART_EMAIL;
  const password = process.env.FLIPKART_PASSWORD;
  if (!email || !password) return false;

  // Get to the login form — the marketing page gates it behind a Login button.
  const loginBtn = page.locator('button:has-text("Login"), a:has-text("Login")').first();
  if (await loginBtn.isVisible().catch(() => false)) {
    await loginBtn.click().catch(() => {});
    await page.waitForTimeout(4000);
  }

  const userField = page
    .locator('input[type="text"]:visible, input[type="email"]:visible, input[type="tel"]:visible')
    .first();
  if (!(await userField.isVisible().catch(() => false))) {
    log('Could not find the login form — finish signing in manually.');
    return false;
  }
  await userField.fill(email).catch(() => {});
  log('Entered the registered email/phone.');

  // Some variants ask for the password only after a Continue step.
  const cont = page.locator('button:has-text("Continue"), button:has-text("Next")').first();
  if (await cont.isVisible().catch(() => false)) {
    await cont.click().catch(() => {});
    await page.waitForTimeout(3000);
  }

  const passField = page.locator('input[type="password"]:visible').first();
  if (await passField.isVisible().catch(() => false)) {
    await passField.fill(password).catch(() => {});
    const submit = page
      .locator('button[type="submit"], button:has-text("Login"), button:has-text("Sign in")')
      .first();
    if (await submit.isVisible().catch(() => false)) {
      await submit.click().catch(() => {});
    }
  } else {
    log('No password field — Flipkart is asking for an OTP. Please complete it in the window.');
    return false;
  }

  await page.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => {});
  await page.waitForTimeout(3000);
  return looksSignedIn(page);
}

/**
 * Is this browser signed into Seller Hub?
 *
 * WHY it is not a text match: the logged-OUT marketing page is titled "Become an
 * Online Seller in India | Flipkart Seller Hub", so checking for the words "Seller
 * Hub" reports true when signed out. That false positive let a whole run proceed
 * unauthenticated against a blank page and fail four steps later with a confusing
 * selector timeout.
 *
 * The reliable signal is the redirect: an unauthenticated request for a dashboard
 * route bounces to `/?referral_url=...`. So we ask for a dashboard route and check
 * we were allowed to stay on it, then confirm the authenticated left-nav rendered.
 */
async function isLoggedIn(page) {
  await page.goto(HUB_URL, { waitUntil: 'domcontentloaded' }).catch(() => {});
  await page.waitForTimeout(4000);
  return looksSignedIn(page);
}

/**
 * Passive version — inspects whatever is on screen without navigating.
 *
 * The polling loop must not re-navigate: reloading every couple of seconds while
 * the seller is typing credentials or an OTP would wipe the form out from under
 * them.
 */
async function looksSignedIn(page) {
  const url = page.url();
  if (/referral_url|\/login|\/signin|\/auth/i.test(url)) return false;
  if (!/index\.html#dashboard/i.test(url)) return false;

  // Must POSITIVELY see the authenticated shell. Earlier versions only ruled out
  // the logged-out URL, which passed mid-redirect and let three whole runs drive a
  // signed-out browser against a blank page.
  return page
    .evaluate(() => {
      const body = (document.body?.innerText || '').trim();
      if (!body) return false; // blank SPA shell — not signed in, just not rendered
      // The public marketing page is the tell-tale of being signed out.
      if (/Become an Online Seller|Start Selling/i.test(document.title + ' ' + body)) return false;
      if ([...document.querySelectorAll('button')].some((b) => /^\s*Login\s*$/i.test(b.innerText || ''))) {
        return false;
      }
      // Dashboard-only navigation.
      return Boolean(document.querySelector('a[href*="#dashboard/listings-management"]'));
    })
    .catch(() => false);
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

  if (await isLoggedIn(page)) {
    log('✓ Already signed in (session restored).');
    return { context, page };
  }

  if (process.env.FLIPKART_EMAIL && process.env.FLIPKART_PASSWORD) {
    log('Not signed in — trying the credentials from .env…');
    if (await attemptLogin(page, log)) {
      log('✓ Signed in automatically. The session is saved for future runs.');
      return { context, page };
    }
  }

  log('⚠ NOT SIGNED IN — log into Seller Hub in the Chromium window that just opened.');
  log(`   The run is paused and will continue by itself once you are in (up to ${LOGIN_TIMEOUT_MS / 60000} min).`);

  const start = Date.now();
  while (Date.now() - start < LOGIN_TIMEOUT_MS) {
    await page.waitForTimeout(2500);
    if (await looksSignedIn(page)) {
      log('✓ Login detected — the session is saved for next time.');
      // Land on a known route before handing the page to the executor.
      await page.goto(HUB_URL, { waitUntil: 'domcontentloaded' }).catch(() => {});
      await page.waitForTimeout(3000);
      return { context, page };
    }
  }
  throw new Error(
    'Timed out waiting for Flipkart login. Sign in once in the Chromium window, then run again — ' +
      'the session is saved after that.',
  );
}

export async function closeSession() {
  await _context?.close().catch(() => {});
  _context = null;
}
