/**
 * Look at the Meesho draft catalogues, and optionally submit them.
 *
 * The listing driver only ever builds a NEW catalogue, so a draft that was filled but
 * never submitted had no way back in. This opens the catalogue list, reports the
 * drafts it finds, and — only when asked — opens each and runs the same submission
 * sequence the driver uses, declaration and all.
 *
 * Run: node tools/meesho-drafts.mjs            # look only, change nothing
 *      node tools/meesho-drafts.mjs --submit N # submit at most N of them
 */
import { getMeeshoSession } from '../src/browser/meesho/session.js';
import { appears, finishSubmission } from '../src/browser/meesho/listing.js';

const LIST_URL = 'https://supplier.meesho.com/panel/v3/new/cataloging/vaqbo/catalogs';
const args = process.argv.slice(2);
const submitAt = args.indexOf('--submit');
const limit = submitAt >= 0 ? Number(args[submitAt + 1] || 1) : 0;
const log = (t) => console.log(t);

const { page } = await getMeeshoSession(log);
await page.goto(LIST_URL, { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(4000);

// The catalogs URL lands on Bulk Uploads; single catalogues — the ones the driver
// builds, and the ones left as drafts — are behind their own tab.
const single = page.locator('text=/^Single Uploads/i').first();
if (await single.isVisible().catch(() => false)) {
  await single.click().catch(() => {});
  await page.waitForTimeout(4000);
  log('opened the Single Uploads tab');
}

// Narrow to drafts only, so nothing already submitted can be caught up in this.
const draftTab = page.locator('text=/^Draft \\(/i').first();
if (await draftTab.isVisible().catch(() => false)) {
  await draftTab.click().catch(() => {});
  await page.waitForTimeout(4000);
  log('opened the Draft tab');
}

log(`url: ${page.url()}`);

// What the list offers: tabs, and the rows under them.
const shape = await page.evaluate(() => {
  const vis = (el) => {
    const r = el.getBoundingClientRect();
    return r.width > 4 && r.height > 4;
  };
  const text = (el) => (el.innerText || '').replace(/\s+/g, ' ').trim();
  const tabs = [...document.querySelectorAll('[role=tab], button')]
    .filter(vis)
    .map((e) => text(e))
    .filter((t) => t && t.length < 40);
  const rows = [...document.querySelectorAll('tr, [class*=row i], [class*=card i]')]
    .filter(vis)
    .map((e) => text(e))
    .filter((t) => t.length > 10 && t.length < 220);
  return { tabs: [...new Set(tabs)].slice(0, 30), rows: [...new Set(rows)].slice(0, 45) };
});

log(`\ntabs/buttons: ${shape.tabs.join(' | ')}`);
log(`\nrows (${shape.rows.length}):`);
shape.rows.forEach((r, i) => log(`  ${i + 1}. ${r.slice(0, 160)}`));

// Page through, because the list shows ten at a time and the drafts that matter are
// not necessarily on the first page.
const pages = Number(args[args.indexOf('--pages') + 1]) || 1;
for (let p = 1; p < pages; p++) {
  const next = page
    .locator('[aria-label*="next" i], button:has-text("Next"), li:has-text("›")')
    .first();
  if (!(await next.isVisible().catch(() => false))) break;
  await next.click().catch(() => {});
  await page.waitForTimeout(3500);
  const more = await page.evaluate(() => {
    const vis = (el) => {
      const r = el.getBoundingClientRect();
      return r.width > 4 && r.height > 4;
    };
    return [...document.querySelectorAll('tr')]
      .filter(vis)
      .map((e) => (e.innerText || '').replace(/\s+/g, ' ').trim())
      .filter((t) => /Draft/i.test(t));
  });
  log(`\npage ${p + 1}:`);
  more.forEach((r, i) => log(`  ${i + 1}. ${r.slice(0, 150)}`));
}

const shot = `data/runs/${Date.now()}_drafts-list.png`;
await page.screenshot({ path: shot, fullPage: true }).catch(() => {});
log(`\nscreenshot: ${shot}`);

if (!limit) {
  log('\nLook-only: nothing was opened or submitted. Pass --submit N to act.');
  process.exit(0);
}

// Submitting is deliberately one at a time with a report after each, so a sequence
// that goes wrong stops at one rather than at twenty-one.
log(`\n== submitting up to ${limit} draft(s) ==`);
for (let i = 0; i < limit; i++) {
  const opened = await page
    .locator('text=/^Draft$/i')
    .first()
    .click({ timeout: 10000 })
    .then(() => true)
    .catch(() => false);
  if (!opened) {
    log(`  could not open a draft (${i + 1}/${limit}) — stopping.`);
    break;
  }
  await page.waitForTimeout(3000);
  log(`  opened a draft — ${page.url()}`);

  const submit = page.locator('button:has-text("Submit Catalog")').first();
  if (!(await submit.isVisible().catch(() => false))) {
    log('  no Submit Catalog on this page — stopping.');
    break;
  }
  await submit.click({ timeout: 15000 }).catch(() => {});
  const result = await finishSubmission(page, (t) => log(`    ${t}`), { timeout: 120000 });
  log(`  draft ${i + 1}: ${result.ok ? 'SUBMITTED' : `failed — ${result.problems.join('; ')}`}`);
  if (!result.ok) break;

  await page.goto(LIST_URL, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(3000);
}
log('\ndone');
