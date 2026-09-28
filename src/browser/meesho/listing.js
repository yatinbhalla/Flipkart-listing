/**
 * Drives one Meesho single catalog from an empty form to a submitted listing.
 *
 * Flow: Catalog Uploads > Add Single Catalog > pick category > front image >
 * Continue > fill > Submit Catalog > declaration > Update Changes > Proceed.
 *
 * Proven against all three categories the seller lists in. The comments below
 * record the things that cost a run each to discover — see
 * content/MEESHO_REQUIREMENTS.md for the longer version.
 */

const SELECT_CATEGORY_URL =
  'https://supplier.meesho.com/panel/v3/new/cataloging/vaqbo/catalogs/single/select-category';

/** The search box MUI puts inside long option lists (HSN, dimensions). */
const SEARCH_BOX = 'input.MuiInputBase-input.MuiInputBase-inputAdornedStart';

/**
 * The same attribute is not the same element in every category.
 *
 * Net Quantity is #multipack on Table Cloths and Wall Decor but #pack_of on Baby
 * Blanket; the dimensions differ likewise. The Baby Blanket pair does not even
 * exist until the size row has been created, so "the field is absent" can never be
 * read as "the field is not required" — Meesho will still refuse the submit with
 * "Mandatory field, Please provide Length Size".
 */
const ID_CANDIDATES = {
  netQuantity: ['#multipack', '#pack_of'],
  length: ['#product_length', '#length_size'],
  breadth: ['#product_breadth', '#width_size'],
};

/** Meesho rejects a description over this, and the stored copy targets Flipkart's 5000. */
export const DESCRIPTION_CAP = 1400;

/** Trim to a sentence boundary rather than cutting a word in half. */
export function fitDescription(text, limit = DESCRIPTION_CAP) {
  const t = String(text || '').trim();
  if (t.length <= limit) return t;
  const cut = t.slice(0, limit);
  const stop = Math.max(cut.lastIndexOf('. '), cut.lastIndexOf('\n'));
  return (stop > limit * 0.6 ? cut.slice(0, stop + 1) : cut).trim();
}

/** The description Meesho gets: the stored copy, plus keywords when they fit. */
export function meeshoDescription(copy) {
  let desc = fitDescription(copy?.description);
  const kw = 'Search keywords: ' + (copy?.searchKeywords || []).join(', ') + '.';
  if (desc.length + kw.length + 2 <= DESCRIPTION_CAP) desc = desc + '\n\n' + kw;
  return desc;
}

export function createFiller(page, log) {
  const problems = [];
  const has = async (sel) => (await page.locator(sel).count()) > 0;

  async function type(sel, value, what, { required = true } = {}) {
    if (!(await has(sel))) return log(`  skip ${what} — not in this category`);
    try {
      await page.locator(sel).first().fill(String(value), { timeout: 15000 });
      log(`  typed ${what}`);
    } catch (err) {
      if (required) problems.push(what);
      log(`  FAIL ${what}: ${String(err.message).slice(0, 70)}`);
    }
  }

  /**
   * Every "Select" is a readonly MUI input: it opens a list on click and the option
   * is chosen by clicking it, so fill() can never work on one. Short values need the
   * match scoped to the open listbox — looking for text "1" anywhere on the page
   * finds a dozen things that are not options.
   */
  async function pick(sel, value, what, { required = true } = {}) {
    if (!(await has(sel))) {
      log(`  skip ${what} — not in this category`);
      return null;
    }
    const wanted = (Array.isArray(value) ? value : [value]).map(String);
    let offered = [];
    for (const v of wanted) {
      try {
        await page.locator(sel).first().click({ timeout: 15000 });
        await page.waitForTimeout(1200);

        const box = page.locator(SEARCH_BOX).first();
        if (await box.isVisible().catch(() => false)) {
          await box.fill(v).catch(() => {});
          await page.waitForTimeout(1500);
        }

        let option = page.getByRole('option', { name: v, exact: true }).first();
        if (!(await option.isVisible().catch(() => false))) {
          const list = page
            .locator('[role="listbox"], ul.MuiMenu-list, .MuiAutocomplete-listbox')
            .last();
          if (await list.count()) {
            const items = list.locator('li');
            const texts = await items.allInnerTexts().catch(() => []);
            offered = texts;
            const i = texts.findIndex((t) => t.trim() === v);
            option = i >= 0 ? items.nth(i) : page.locator(`text="${v}"`).first();
          } else {
            option = page.locator(`text="${v}"`).first();
          }
        }

        if (await option.isVisible().catch(() => false)) {
          await option.click({ timeout: 10000 });
          await page.waitForTimeout(900);
          log(`  picked ${what} = ${v}`);
          return v;
        }
        await page.keyboard.press('Escape').catch(() => {});
        await page.waitForTimeout(400);
      } catch {
        await page.keyboard.press('Escape').catch(() => {});
      }
    }
    // Report the real choices. The submit banner only counts errors, so a miss that
    // does not name its alternatives costs another whole run to identify.
    if (required) problems.push(what);
    log(
      `  FAIL ${what} wanted [${wanted.join(', ')}] | offered: ` +
        ([...new Set(offered.map((t) => t.trim()))].slice(0, 20).join(' | ') || '(none seen)'),
    );
    return null;
  }

  /**
   * For fields Meesho rewrites behind you.
   *
   * The price row settles asynchronously as Meesho computes its own figures, and
   * the return discount, row SKU and inventory were each seen to lose or mangle a
   * value that fill() had reported as written — a "1" typed before the price
   * became "141", and the form refused with "Enter discount here, not price".
   */
  async function typeVerified(sel, value, what, attempts = 3) {
    const el = page.locator(sel).first();
    for (let i = 1; i <= attempts; i++) {
      await el.click({ timeout: 10000 }).catch(() => {});
      await page.keyboard.press('Control+A').catch(() => {});
      await page.keyboard.press('Delete').catch(() => {});
      await page.waitForTimeout(400);
      await el.type(String(value), { delay: 70 }).catch(() => {});
      await page.waitForTimeout(1400);
      const got = await el.inputValue().catch(() => '');
      if (got === String(value)) return log(`  typed ${what} = ${value}`);
      log(`  ${what} attempt ${i} gave "${got}"`);
    }
    problems.push(`${what} would not hold`);
  }

  /** First id that exists wins; a dropdown that will not open is typed into instead. */
  async function byCandidates(keys, value, what) {
    for (const sel of keys) {
      if (!(await has(sel))) continue;
      const before = problems.length;
      if ((await pick(sel, value, `${what} (${sel})`)) !== null) return;
      problems.length = before;
      return type(sel, value, `${what} (${sel}, typed)`);
    }
    log(`  ${what}: no known id in this category`);
  }

  return { problems, has, type, pick, typeVerified, byCandidates };
}

/**
 * Fill and optionally submit one catalog.
 *
 * `images` is { front, extras } — the front is chosen at the category step and the
 * extras go in afterwards through a single file input. Meesho caps the set at four.
 */
export async function createListing(page, { path: cfg, variant, sku, images, submit, log }) {
  const M = cfg.meesho;
  if (!M) throw new Error(`"${cfg.name}" has no meesho block — nothing to list with.`);
  const f = createFiller(page, log);
  const description = meeshoDescription(variant.copy);

  log(`== category: ${M.category}`);
  await page.goto(SELECT_CATEGORY_URL, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(8000);
  // Search on the leaf name: the typeahead misses on a fragment ("wall decor" finds
  // nothing where "wall decor & hangings" finds the category).
  await page
    .locator('input[placeholder*="Sarees" i]')
    .first()
    .fill(M.category.split('>').pop().trim());
  await page.waitForTimeout(4500);
  await page.locator(`text="${M.category}"`).first().click();
  await page.waitForTimeout(6000);

  log('== front image');
  const chooser = page.waitForEvent('filechooser', { timeout: 25000 });
  await page.locator('button:has-text("Add Product Images")').first().click();
  (await chooser).setFiles(images.front);
  await page.waitForTimeout(15000);
  const cont = page.locator('button:has-text("Continue")').first();
  if (await cont.isVisible().catch(() => false)) {
    await cont.click();
    await page.waitForTimeout(12000);
  }

  log('== product, size and inventory');
  await f.pick('#supplier_gst_percent', M.gstPercent, 'GST');
  await f.pick('#hsn_code', M.hsn, 'HSN');
  await f.type('#product_weight_in_gms', variant.weightGrams, 'net weight (gms)');
  await f.type('#supplier_product_id', sku, 'style code / product id');
  await f.type('#product_name', variant.copy.modelName, 'product name');

  // The price row does not exist until a size is chosen, and the size options are
  // DRAWN checkboxes: there is no input[type=checkbox] on the page and clicking the
  // option's text is a no-op, so the box itself has to be clicked.
  log('== size column');
  await page.locator('input[placeholder="Select"]:not([name])').first().click();
  await page.waitForTimeout(2500);
  const box = await page.locator('text="Free Size"').first().boundingBox().catch(() => null);
  if (box) {
    await page.mouse.click(box.x - 18, box.y + box.height / 2);
    await page.waitForTimeout(1200);
  }
  const apply = page.locator('button:has-text("Apply")').first();
  if (await apply.isVisible().catch(() => false)) {
    await apply.click();
    await page.waitForTimeout(6000);
  }
  const sizeColumn = await page
    .locator('input[placeholder="Select"]:not([name])')
    .first()
    .inputValue()
    .catch(() => '');
  if (!/free size/i.test(sizeColumn)) f.problems.push('Free Size column');

  log('== remaining images');
  if (await f.has('#addMoreImagesInput')) {
    await page
      .locator('#addMoreImagesInput')
      .setInputFiles(images.extras)
      .catch((err) => {
        f.problems.push('extra images');
        log(`  FAIL images: ${String(err.message).slice(0, 70)}`);
      });
    await page.waitForTimeout(20000);
  }

  // Price before MRP so Meesho's own figures settle first, and the two volatile
  // fields last so nothing rewrites them afterwards.
  log('== price row');
  await f.type('#meesho_price', M.sellingPrice, 'meesho price');
  await f.type('#product_mrp', variant.mrp, 'mrp');
  await f.typeVerified('#inventory', variant.stock, 'inventory');
  await f.typeVerified('#wdrp_discount', M.returnDiscount, 'return discount');
  await f.typeVerified('#supplier_sku_id', sku, 'row sku id');

  log('== product details');
  await f.pick('#color', M.color, 'colour');
  await f.pick('#generic_name', M.genericName, 'generic name');
  await f.pick('#material', M.material, 'material');
  await f.byCandidates(ID_CANDIDATES.netQuantity, M.multipack || '1', 'net quantity');
  await f.pick('#pattern', M.pattern, 'pattern');
  await f.pick('#type', M.type, 'type');
  await f.pick('#fabric', M.fabric, 'fabric');
  await f.pick('#ideal_for', M.idealFor, 'ideal for');
  if (M.printOrPatternType) await f.pick('#print_or_pattern_type', M.printOrPatternType, 'print or pattern type');
  if (M.secondaryColor) await f.pick('#secondary_color', M.secondaryColor, 'secondary colour');
  if (M.includedComponents) await f.type('#included_components', M.includedComponents, 'included components');
  await f.byCandidates(ID_CANDIDATES.length, variant.sizeInches.length, 'product length');
  await f.byCandidates(ID_CANDIDATES.breadth, variant.sizeInches.width, 'product breadth');
  await f.pick('#product_height', ['0', '0.5'], 'product height');
  await f.pick('#product_unit', 'Inch', 'product unit');

  // Product Details > Size is the Free Size column on Baby Blanket (already set,
  // and clicking it opens nothing) and a product size on Table Cloths. It carries no
  // asterisk either way, so it never blocks a listing.
  const sizeNow = (await f.has('#size'))
    ? await page.locator('#size').first().inputValue().catch(() => '')
    : '';
  if (!sizeNow.trim()) {
    const before = f.problems.length;
    await f.pick(
      '#size',
      M.size ? [M.size] : [`${variant.sizeInches.width}x${variant.sizeInches.length} Inch`],
      'size',
    );
    f.problems.length = before;
  }

  await f.pick('#weight', ['0.1', '0.2'], 'weight');
  await f.pick('#weight_unit', 'kg', 'weight unit');

  // Country of origin FIRST: choosing India disables all three importer fields and
  // fills them with "Not Required", so they are never typed into.
  log('== origin and addresses');
  await f.pick('#country_of_origin', M.countryOfOrigin || 'India', 'country of origin');
  await f.type('#manufacturer_name', M.manufacturerName, 'manufacturer name');
  await f.type('#manufacturer_address', M.manufacturerAddress, 'manufacturer address');
  await f.type('#manufacturer_pincode', M.pincode, 'manufacturer pincode');
  await f.type('#packer_name', M.packerName || M.manufacturerName, 'packer name');
  await f.type('#packer_address', M.packerAddress || M.manufacturerAddress, 'packer address');
  await f.type('#packer_pincode', M.pincode, 'packer pincode');
  await f.type('#comment', description, 'description');

  // Re-read what Meesho likes to rewrite, immediately before committing.
  for (const [sel, want, what] of [
    ['#wdrp_discount', M.returnDiscount, 'return discount'],
    ['#supplier_sku_id', sku, 'row sku id'],
    ['#inventory', variant.stock, 'inventory'],
  ]) {
    const got = await page.locator(sel).first().inputValue().catch(() => '?');
    if (got !== String(want)) f.problems.push(`${what} drifted to "${got}"`);
  }

  if (f.problems.length) {
    return { ok: false, submitted: false, problems: f.problems };
  }
  if (!submit) return { ok: true, submitted: false, problems: [] };

  log('== submit');
  await page.locator('role=button[name="Submit Catalog"]').first().click({ timeout: 20000 });
  await page.waitForTimeout(6000);
  await clearBrandGate(page, log);

  const declaration = page.locator('text=I understand that all products').first();
  if (await declaration.isVisible().catch(() => false)) {
    const db = await declaration.boundingBox();
    if (db) await page.mouse.click(db.x - 18, db.y + db.height / 2);
    await page.waitForTimeout(2000);
  }
  // Update Changes appears for some categories and not others.
  for (const name of ['Update Changes', 'Proceed']) {
    const button = page.locator(`role=button[name="${name}"]`).first();
    if (await button.isVisible().catch(() => false)) {
      await button.click({ timeout: 15000 }).catch(() => {});
      await page.waitForTimeout(6000);
    }
  }
  await page.waitForTimeout(8000);

  const stuck = /\/single\/add/.test(page.url());
  return { ok: !stuck, submitted: !stuck, problems: stuck ? await readErrors(page) : [] };
}

/**
 * Meesho scans the description for words "similar to authorised brands" and
 * intercepts the submit with a modal naming them. Each flagged word carries an X
 * chip; clicking it strikes the word and Update Changes then goes live. The check
 * is fuzzy rather than a fixed list — "everyday" appears in most of the catalogue
 * and passes, while "navy" was caught — so this handles whatever it names.
 */
export async function clearBrandGate(page, log) {
  const gate = page.locator('text=/unauthorized brands|illegal keywords/i').first();
  if (!(await gate.isVisible().catch(() => false))) return false;

  const words = await page.evaluate(() =>
    [...document.querySelectorAll('mark, [class*=highlight i], [class*=Highlight]')]
      .map((e) => (e.innerText || '').trim())
      .filter(Boolean),
  );
  log(`  brand gate flagged: ${[...new Set(words)].join(', ') || '(unnamed)'}`);

  for (let i = 0; i < 10; i++) {
    const x = page
      .locator('svg[class*=close i], [data-testid*=Close], [class*=chip i] svg, mark svg')
      .first();
    if (!(await x.isVisible().catch(() => false))) break;
    await x.click({ timeout: 8000 }).catch(() => {});
    await page.waitForTimeout(900);
  }
  const update = page.locator('role=button[name="Update Changes"]').first();
  if (await update.isVisible().catch(() => false)) {
    await update.click({ timeout: 15000 }).catch(() => {});
    await page.waitForTimeout(7000);
    log('  cleared the brand gate');
  }
  return true;
}

/** The submit banner counts errors; the fields themselves name them. */
export async function readErrors(page) {
  return page.evaluate(() =>
    [
      ...new Set(
        [...document.querySelectorAll('.Mui-error, [aria-invalid="true"], .MuiFormHelperText-root')]
          .filter((el) => {
            const r = el.getBoundingClientRect();
            return r.width > 0 && r.height > 0;
          })
          .map((el) => {
            const row = el.closest('div');
            const text = ((row ? row.innerText : el.innerText) || '').replace(/\s+/g, ' ').trim();
            return text.length > 3 ? text.slice(0, 90) : '';
          })
          .filter((t) => t && /mandatory|required|invalid|please|error/i.test(t)),
      ),
    ],
  );
}
