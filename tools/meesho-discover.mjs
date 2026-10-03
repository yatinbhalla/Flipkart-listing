/**
 * Read a Meesho category's Add-Single-Catalog form and write its schema.
 *
 * Meesho has no discovery route the way Flipkart does, because its form only exists
 * after a category is chosen AND a front image is accepted — there is nothing to
 * read until then. So this walks the real flow, stops at the filled form, and
 * reports every control by id, which is how the driver addresses them.
 *
 * Run: node tools/meesho-discover.mjs "<category path>" "<front image>" <outFile>
 * The category path is the full breadcrumb as the typeahead prints it, with > or /.
 */
import fs from 'fs/promises';
import { getMeeshoSession } from '../src/browser/meesho/session.js';
import { appears } from '../src/browser/meesho/listing.js';

const SELECT_CATEGORY_URL =
  'https://supplier.meesho.com/panel/v3/new/cataloging/vaqbo/catalogs/single/select-category';

const [, , categoryArg, frontImage, outFile] = process.argv;
if (!categoryArg || !frontImage || !outFile) {
  console.error('usage: node tools/meesho-discover.mjs "<category>" "<image>" <out.json>');
  process.exit(1);
}
const category = categoryArg.replace(/\s*[/>]\s*/g, ' > ').trim();
const leaf = category.split('>').pop().trim();
const log = (t) => console.log(t);

const { page } = await getMeeshoSession(log);

log(`== category: ${category}`);
await page.goto(SELECT_CATEGORY_URL, { waitUntil: 'domcontentloaded' });
if (!(await appears(page, 'input[placeholder*="Sarees" i]', 12000))) {
  const addSingle = page.locator('button:has-text("Add Single Catalog")').first();
  if (await addSingle.isVisible().catch(() => false)) {
    log('  (landed on the catalog list — opening Add Single Catalog)');
    await addSingle.click();
  }
}
if (!(await appears(page, 'input[placeholder*="Sarees" i]', 40000))) {
  throw new Error('The category search box never rendered.');
}

await page.locator('input[placeholder*="Sarees" i]').first().fill(leaf);
if (!(await appears(page, `text="${category}"`, 25000))) {
  // Worth printing what it did offer: a breadcrumb that differs by one word is the
  // usual reason, and guessing again blind costs another run.
  const offered = await page
    .evaluate(() =>
      [...document.querySelectorAll('li, [role=option], div')]
        .map((e) => (e.innerText || '').trim())
        .filter((t) => t && t.includes('>') && t.length < 160),
    )
    .catch(() => []);
  throw new Error(
    `The typeahead never offered "${category}". Offered: ${[...new Set(offered)].slice(0, 10).join(' | ') || '(none)'}`,
  );
}
await page.locator(`text="${category}"`).first().click();
await appears(page, 'button:has-text("Add Product Images")', 30000);
log('  category chosen');

log('== front image');
const chooser = page.waitForEvent('filechooser', { timeout: 25000 });
await page.locator('button:has-text("Add Product Images")').first().click();
(await chooser).setFiles(frontImage);

const cont = page.locator('button:has-text("Continue")').first();
const until = Date.now() + 90000;
while (Date.now() < until) {
  if ((await cont.isVisible().catch(() => false)) && !(await cont.isDisabled().catch(() => true))) {
    await cont.click().catch(() => {});
    if (await appears(page, '#supplier_gst_percent', 8000)) break;
  }
  await page.waitForTimeout(250);
}
if (!(await appears(page, '#supplier_gst_percent', 5000))) {
  throw new Error('The product details form never rendered after Continue.');
}
log('  form rendered');

/** Every addressable control, with the label a human sees beside it. */
const readFields = () =>
  page.evaluate(() => {
    const labelFor = (el) => {
      if (el.id) {
        const l = document.querySelector(`label[for="${CSS.escape(el.id)}"]`);
        if (l?.innerText?.trim()) return l.innerText.trim();
      }
      // MUI puts the visible caption on an ancestor rather than a <label>, so walk
      // out until something short and human turns up.
      for (let n = el.parentElement, i = 0; n && i < 5; n = n.parentElement, i++) {
        const own = [...n.childNodes]
          .filter((c) => c.nodeType === 3)
          .map((c) => c.textContent.trim())
          .filter(Boolean)
          .join(' ');
        if (own) return own;
      }
      return el.placeholder || el.getAttribute('aria-label') || '';
    };
    const required = (el) => {
      if (el.required || el.getAttribute('aria-required') === 'true') return true;
      for (let n = el.parentElement, i = 0; n && i < 5; n = n.parentElement, i++) {
        if ((n.innerText || '').includes('*')) return true;
      }
      return false;
    };
    return [...document.querySelectorAll('input[id], textarea[id], select[id]')].map((el) => ({
      id: el.id,
      name: el.name || el.id,
      label: labelFor(el),
      required: required(el),
      readonly: !!el.readOnly,
      tag: el.tagName.toLowerCase(),
      type: el.type || 'text',
    }));
  });

const before = await readFields();
log(`  ${before.length} fields before the size row`);

/**
 * The option list behind each select.
 *
 * A Meesho select is readonly: it accepts only a value it already offers, so a
 * schema without the lists cannot be turned into a config. Opened the same way the
 * driver opens them, then closed with Escape so the form is left untouched.
 */
const SEARCH_BOX = 'input.MuiInputBase-input.MuiInputBase-inputAdornedStart';
const LIST = '[role="listbox"], ul.MuiMenu-list, .MuiAutocomplete-listbox';
const options = {};
for (const field of before) {
  // "Select" is how every dropdown renders before it is touched; everything else is
  // a typed input and has nothing to open.
  if (field.label !== 'Select') continue;
  try {
    await page.locator(`#${CSS_ESCAPE(field.id)}`).first().click({ timeout: 10000 });
    if (!(await appears(page, LIST, 5000))) {
      await page.keyboard.press('Escape').catch(() => {});
      continue;
    }
    const list = page.locator(LIST).last();
    const texts = await list.locator('li').allInnerTexts().catch(() => []);
    options[field.id] = [...new Set(texts.map((t) => t.trim()).filter(Boolean))];
    // A long list is paged behind its own search box; say so rather than implying
    // the first screenful is all there is.
    const searchable = await page.locator(SEARCH_BOX).first().isVisible().catch(() => false);
    if (searchable) options[field.id].push('…(searchable list — may hold more)');
  } catch {
    /* a select that will not open is reported by its absence from `options` */
  }
  await page.keyboard.press('Escape').catch(() => {});
  await page.waitForTimeout(200);
}
log(`  read options for ${Object.keys(options).length} selects`);

/** Playwright needs a literal id; Meesho's generated ids ("mui-11") are safe but escape anyway. */
function CSS_ESCAPE(id) {
  return String(id).replace(/([^\w-])/g, '\\$1');
}

const schema = {
  marketplace: 'Meesho',
  category,
  discoveredAt: new Date().toISOString().slice(0, 10),
  entry: 'Catalog Uploads > Add Single Catalog',
  url: page.url(),
  sizeRowCreated: false,
  fieldCountBeforeSize: before.length,
  fieldCount: before.length,
  requiredLabels: before.filter((f) => f.required).map((f) => f.label || f.id),
  fields: before,
  options,
};

await fs.writeFile(outFile, JSON.stringify(schema, null, 2), 'utf8');
log(`\nwrote ${outFile}`);
log(`required: ${schema.requiredLabels.length} of ${before.length}`);
log(before.map((f) => `  ${f.id.padEnd(34)}${f.required ? '*' : ' '} ${f.label}`).join('\n'));
log('\nThe browser is left on the form — nothing was submitted.');
