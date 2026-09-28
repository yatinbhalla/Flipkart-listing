import { chromium } from 'playwright';
import path from 'path';
import fs from 'fs/promises';

/**
 * The Meesho supplier panel, signed in and ready.
 *
 * Its own profile directory, separate from the Flipkart one: Chromium allows a
 * single instance per persistent profile, so sharing would mean the two
 * storefronts could never be driven at the same time — and the cookies have
 * nothing to do with each other anyway.
 *
 * One account only, by instruction. The standalone Meesho lister juggles three
 * seller logins; this app drives Yatin's and nothing else, so the credentials come
 * straight from the environment with no account plumbing.
 */
const PROFILE_DIR = path.resolve('data/.meesho-profile');
// supplier.meesho.com/ is a MARKETING page that links to /panel/ — signed in or
// not. Landing there and looking for panel links is how a signed-out browser gets
// mistaken for a signed-in one, so every check below works off the /panel/ path.
// Always enter through the login URL: when the profile still holds a session
// Meesho redirects it straight to the dashboard, and when it does not the form is
// right there. /panel/ on its own is a 404, and the 404 page carries Login links
// whether or not you are signed in — which is precisely the kind of page that
// makes a naive check report success.
const LOGIN_URL = 'https://supplier.meesho.com/panel/v3/new/root/login';
const LOGIN_TIMEOUT_MS = 5 * 60 * 1000;

let _context = null;

/**
 * Is this a signed-in supplier panel?
 *
 * Deliberately a positive test. The obvious version — "the URL does not say
 * /login" — is the same mistake that drove three Flipkart runs against a
 * signed-out browser: a marketing page, an interstitial and an error page all
 * pass it. So a real navigation element of the panel has to be on screen before
 * this returns true.
 */
export async function isLoggedIn(page) {
  await page.waitForLoadState('domcontentloaded').catch(() => {});
  const url = page.url();
  // Must be INSIDE the panel. The marketing root passes a bare hostname test while
  // being the page you see when signed out.
  if (!/supplier\.meesho\.com\/panel\//i.test(url)) return false;
  if (/\/(login|auth|signup)/i.test(url)) return false;

  // Combined with .or(), not by comma-joining. A comma is CSS syntax; Playwright
  // cannot parse "text=..., text=..." as one selector, so the joined form silently
  // matches nothing and reports a signed-in panel as signed out.
  const marker = PANEL_MARKERS.map((sel) => page.locator(sel)).reduce((a, b) => a.or(b));
  return marker
    .first()
    .waitFor({ state: 'visible', timeout: 10000 })
    .then(() => true)
    .catch(() => false);
}

/**
 * Sidebar entries that exist only once signed in. Read off the live panel rather
 * than guessed: the nav is not made of <a href> elements, so text is what there is
 * to match on, and these three words appear nowhere on the marketing site.
 */
const PANEL_MARKERS = ['text=/^Catalog Uploads$/i', 'text=/^Manage Orders$/i'];

/**
 * Fill the login form from the environment and submit.
 *
 * Credentials are read from process.env at call time and never logged, echoed or
 * persisted anywhere but the browser profile. Meesho can answer with an OTP or a
 * captcha, neither of which can be automated, so this is best effort and the
 * caller falls back to waiting for the seller to finish by hand.
 */
async function attemptLogin(page, log) {
  const email = process.env.MEESHO_EMAIL;
  const password = process.env.MEESHO_PASSWORD;
  if (!email || !password) {
    log('No MEESHO_EMAIL / MEESHO_PASSWORD set — finish signing in manually.');
    return false;
  }

  // One form, both fields visible at once — no Continue step to negotiate. Named
  // fields rather than "the first text input", which on this page would be right
  // by luck and on the next redesign wrong by silence.
  const emailField = page.locator('input[name="emailOrPhone"]').first();
  if (!(await emailField.isVisible().catch(() => false))) {
    log('Could not find the login form — finish signing in manually.');
    return false;
  }
  await emailField.fill(email).catch(() => {});
  await page.locator('input[name="password"]').first().fill(password).catch(() => {});
  log('Entered the registered email and password.');

  await page.locator('button:has-text("Log in")').first().click().catch(() => {});
  log('Submitted the login form.');

  await page.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => {});
  return isLoggedIn(page);
}

export async function getMeeshoSession(log = console.log) {
  if (_context) {
    try {
      const page = _context.pages()[0] || (await _context.newPage());
      await page.evaluate(() => 1);
      await page.bringToFront().catch(() => {});
      return { context: _context, page };
    } catch {
      _context = null;
    }
  }

  await fs.mkdir(PROFILE_DIR, { recursive: true });
  log('Launching Chromium for Meesho…');
  try {
    _context = await chromium.launchPersistentContext(PROFILE_DIR, {
      headless: false,
      viewport: null,
      args: ['--start-maximized', '--disable-blink-features=AutomationControlled'],
    });
  } catch (err) {
    if (/in use|profile|locked|SingletonLock/i.test(String(err.message))) {
      throw new Error(
        'A Chromium window is already using the saved Meesho profile. Close it and try again.',
      );
    }
    throw err;
  }
  _context.on('close', () => {
    _context = null;
  });

  const page = _context.pages()[0] || (await _context.newPage());
  await page.goto(LOGIN_URL, { waitUntil: 'domcontentloaded' }).catch(() => {});
  await page.waitForTimeout(6000);

  if (await isLoggedIn(page)) {
    log('✓ Already signed in to Meesho (profile restored).');
    return { context: _context, page };
  }

  log('Not signed in — attempting automatic login…');
  if (await attemptLogin(page, log)) {
    log('✓ Signed in to Meesho.');
    return { context: _context, page };
  }

  log(`Waiting up to ${LOGIN_TIMEOUT_MS / 60000} minutes for you to finish signing in…`);
  const start = Date.now();
  while (Date.now() - start < LOGIN_TIMEOUT_MS) {
    // No re-navigation while polling: reloading the page mid-login throws away a
    // half-completed OTP step, which is exactly when the seller needs it left alone.
    if (await isLoggedIn(page)) {
      log('✓ Signed in to Meesho.');
      return { context: _context, page };
    }
    await page.waitForTimeout(2000);
  }
  throw new Error('Meesho login timed out.');
}

export async function closeMeeshoSession() {
  await _context?.close().catch(() => {});
  _context = null;
}
