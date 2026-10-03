/**
 * Report which variant axes a Flipkart vertical actually offers.
 *
 * The discovery route walks the attribute tabs and deliberately skips Variant
 * addition, so a path's axis has until now been a guess that only a failed listing
 * could correct — "Size" looked obvious for a Mat and does not exist.
 *
 * The tab cannot be read on an empty form: Flipkart replaces the whole panel with
 * "Fix errors first — please fix the attribute errors before adding variants", so
 * the axes only exist once the main listing is valid. This therefore fills a real
 * listing from a path and stops at the Variant tab. Nothing is submitted, and the
 * SKU is a fixed probe value rather than one taken from the ledger.
 *
 * Run: node tools/flipkart-variant-axes.mjs <pathId> [partner]
 */
import fs from 'fs/promises';
import { getSession } from '../src/browser/session.js';
import * as F from '../src/browser/form.js';
import * as L from '../src/browser/listing.js';
import { getPath, sharedImagePaths, resolveVariant } from '../src/server/store.js';

const [, , pathId, partner = 'flipkart'] = process.argv;
if (!pathId) {
  console.error('usage: node tools/flipkart-variant-axes.mjs <pathId> [partner]');
  process.exit(1);
}
const log = (t) => console.log(t);

const cfg = await getPath(pathId);
if (!cfg) throw new Error(`No path "${pathId}".`);
const shared = await sharedImagePaths(pathId);
const front = shared.find(Boolean);
if (!front) throw new Error('This path has no images to probe with.');

const parent = resolveVariant(cfg, cfg.variants[0]);
// Never allocate from the ledger: a probe must not consume a number the catalogue
// will later expect to find on a real listing. But it must still be UNIQUE per run —
// a fixed probe SKU is rejected by Flipkart as a duplicate the second time, which
// puts one error on Price/Stock and blocks the whole Variant panel, so the probe
// then reports "this vertical has no axes" about a form it broke itself.
parent.sku = `PROBE/${Math.floor(10000 + Math.random() * 90000)}`;
log(`probe SKU: ${parent.sku} (not written to the ledger)`);
Object.assign(parent, cfg.variants[0].copyPool?.[0] || cfg.variants[0].copy || {});

const { page } = await getSession(log);
const vertical = partner === 'shopsy' ? cfg.shopsyVerticalPath || cfg.vertical : cfg.vertical;
await L.selectVertical(page, vertical, log, { partner });
await L.selectBrand(page, cfg.brand, log);
await L.uploadImages(page, [front, ...shared], log);
await L.fillTabs(page, cfg, parent, log, { partner });

// Which tab is unhappy, and what it says. A blocked Variant panel only reports that
// errors exist somewhere; naming them is the difference between a fix and a guess.
log('\n== tab states ==');
const states = await F.readTabStates(page).catch(() => ({}));
for (const [tab, s] of Object.entries(states)) {
  log(`  ${tab}: filled ${s.filled ?? '?'}/${s.total ?? '?'} errors ${s.errors ?? 0}`);
}
for (const tab of [F.TABS.price, F.TABS.description, F.TABS.additional]) {
  await F.openTab(page, tab);
  await page.waitForTimeout(1200);
  // Flipkart marks the offending control itself; the tab counter only says "1 Error"
  // somewhere on this tab, which is not enough to fix anything.
  const flagged = await page.evaluate(() => {
    const out = [];
    const bad = document.querySelectorAll(
      '[aria-invalid="true"], [class*=error i], [class*=Error i], [class*=invalid i]',
    );
    for (const el of bad) {
      const r = el.getBoundingClientRect();
      if (r.width < 5 || r.height < 5) continue;
      // Walk out to the row and take its first line, which is the field's caption.
      let label = '';
      for (let n = el, i = 0; n && i < 6 && !label; n = n.parentElement, i++) {
        const line = (n.innerText || '').split('\n').map((s) => s.trim()).filter(Boolean)[0];
        if (line && line.length < 70) label = line;
      }
      const text = (el.innerText || '').trim().slice(0, 120);
      out.push(`${label}${text && text !== label ? ` — ${text}` : ''}`);
    }
    return [...new Set(out)];
  });
  if (flagged.length) log(`  !! ${tab} flagged: ${flagged.join('  ||  ')}`);
  const file = `data/runs/${Date.now()}_${tab.replace(/[^a-z]+/gi, '-')}.png`;
  await page.screenshot({ path: file, fullPage: true }).catch(() => {});
  log(`  screenshot: ${file}`);
}

// Leaving a tab IS the save, and validation only runs then — the tab reads clean
// while it is open and flags its error once you are elsewhere. So bounce away and
// come back: that is the only state in which the error text is on screen to read.
log('\n== price tab after a save bounce ==');
await F.openTab(page, F.TABS.variants);
await page.waitForTimeout(1500);
await F.openTab(page, F.TABS.price);
await page.waitForTimeout(2000);
const priceText = await page.evaluate(() => document.body.innerText);
const lines = priceText.split('\n').map((s) => s.trim()).filter(Boolean);
const hits = lines.filter((l) =>
  /error|required|invalid|must be|cannot|should be|enter a|not valid|mandatory/i.test(l),
);
log(hits.length ? hits.map((h) => `  • ${h}`).join('\n') : '  (no error text found)');
await page
  .screenshot({ path: `data/runs/${Date.now()}_price-after-bounce.png`, fullPage: true })
  .catch(() => {});

log('\n== opening Variant addition ==');
// openTab swallows its timeout, so the switch has to be proved rather than assumed —
// a probe that reads the previous tab reports "no axes" with total confidence.
for (let attempt = 1; attempt <= 3; attempt++) {
  await F.openTab(page, F.TABS.variants);
  const open = await page
    .locator('text=/^Add variants$/i')
    .first()
    .isVisible({ timeout: 6000 })
    .catch(() => false);
  if (open) {
    log(`  panel open (attempt ${attempt})`);
    break;
  }
  log(`  did not open, retry ${attempt}/3`);
  await page.waitForTimeout(1500);
}
await page.waitForTimeout(2500);
await F.scrollSection(page, 0).catch(() => {});
await page.waitForTimeout(1200);

const shot = `data/runs/${Date.now()}_variant-tab.png`;
await page.screenshot({ path: shot, fullPage: true }).catch(() => {});
log(`screenshot: ${shot}`);

const blocked = await page
  .locator('text=/fix the attribute errors before adding variants/i')
  .first()
  .isVisible()
  .catch(() => false);
log(`panel blocked by attribute errors: ${blocked ? 'YES' : 'no'}`);

/** Each axis row: its name, and the control that fills it. */
const axes = await page.evaluate(() => {
  const seen = [];
  for (const el of document.querySelectorAll('input[placeholder], button, [class*=Dropdown i]')) {
    const ph = el.getAttribute?.('placeholder') || '';
    const free = /^Enter New/i.test(ph);
    const drop = /dropdown/i.test(String(el.className || ''));
    if (!free && !drop) continue;
    const r = el.getBoundingClientRect();
    if (r.width < 20 || r.height < 8) continue;
    let label = '';
    for (let n = el.parentElement, i = 0; n && i < 4 && !label; n = n.parentElement, i++) {
      const line = (n.innerText || '').split('\n').map((s) => s.trim()).filter(Boolean)[0];
      if (line && line.length < 60) label = line;
    }
    seen.push({
      kind: free ? 'free text' : 'dropdown',
      axis: free ? ph.replace(/^Enter New\s*/i, '').trim() : label,
      label,
      text: (el.innerText || '').trim().slice(0, 40),
    });
  }
  return seen;
});

log('\n=== variant axis controls ===');
log(axes.length ? axes.map((a) => `  [${a.kind}] axis="${a.axis}" (label "${a.label}")`).join('\n') : '  (none)');

const { readVariantAxes } = await import('../src/browser/variants.js');
log(`\nreadVariantAxes(): ${(await readVariantAxes(page)).join(' / ') || '(none)'}`);

// With an axis and value given, prove the driver can actually drive it — reading
// the panel only shows the control exists, not that addVariant can find it.
const [tryAxis, tryValue] = process.argv.slice(4);
if (tryAxis && tryValue) {
  log(`\n== attempting addVariant("${tryAxis}", "${tryValue}") ==`);
  const { addVariant } = await import('../src/browser/variants.js');
  try {
    await addVariant(page, tryAxis, tryValue);
    log(`  ✓ addVariant did not throw`);
    await page.waitForTimeout(1500);
    const after = await page.screenshot({ path: `data/runs/${Date.now()}_variant-added.png`, fullPage: true }).then(() => 'saved').catch(() => 'failed');
    log(`  screenshot after: ${after}`);
  } catch (err) {
    log(`  ✗ ${err.message}`);
  }
}

const text = await page.evaluate(() => document.body.innerText.slice(0, 5000));
const out = `data/runs/${Date.now()}_variant-tab.txt`;
await fs.writeFile(out, text, 'utf8');
log(`panel text: ${out}`);
log('\nNothing was submitted. The draft can be deleted from Listings.');
