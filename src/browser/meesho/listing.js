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

import fs from 'fs/promises';

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

/** Wait for a thing to appear rather than sleeping a guessed number of seconds. */
export async function appears(page, selector, timeout = 30000) {
  return page
    .locator(selector)
    .first()
    .waitFor({ state: 'visible', timeout })
    .then(() => true)
    .catch(() => false);
}

/** Wait for a thing to go away — an upload control that vanishes when the set is full. */
export async function vanishes(page, selector, timeout = 45000) {
  return page
    .locator(selector)
    .first()
    .waitFor({ state: 'detached', timeout })
    .then(() => true)
    .catch(() => false);
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
        // The list is what we are waiting for, so wait for the list.
        await appears(page, '[role="listbox"], ul.MuiMenu-list, .MuiAutocomplete-listbox', 6000);

        const box = page.locator(SEARCH_BOX).first();
        if (await box.isVisible().catch(() => false)) {
          await box.fill(v).catch(() => {});
          await page.waitForTimeout(600);
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
          await page.waitForTimeout(350);
          log(`  picked ${what} = ${v}`);
          return v;
        }
        await page.keyboard.press('Escape').catch(() => {});
        await page.waitForTimeout(250);
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
      await page.waitForTimeout(200);
      await el.type(String(value), { delay: 35 }).catch(() => {});
      await page.waitForTimeout(700);
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
  // Phase timings: the seller can see which step is slow instead of us guessing.
  let mark = Date.now();
  const phase = (name) => {
    log(`  [${((Date.now() - mark) / 1000).toFixed(1)}s] ${name}`);
    mark = Date.now();
  };

  log(`== category: ${M.category}`);
  await page.goto(SELECT_CATEGORY_URL, { waitUntil: 'domcontentloaded' });
  // The .../catalogs/single/add URL no longer opens the category picker on its own —
  // as of 2026-10-01 it redirects to the catalog LIST, where the picker is behind an
  // "Add Single Catalog" button. Waiting on the search box alone therefore timed out
  // on a page that was loaded and fine. Short wait first, because when the URL does
  // open the picker directly there is no button to click.
  if (!(await appears(page, 'input[placeholder*="Sarees" i]', 12000))) {
    const addSingle = page.locator('button:has-text("Add Single Catalog")').first();
    if (await addSingle.isVisible().catch(() => false)) {
      log('  (the URL landed on the catalog list — opening Add Single Catalog)');
      await addSingle.click();
    }
  }
  if (!(await appears(page, 'input[placeholder*="Sarees" i]', 40000))) {
    throw new Error('The category search box never rendered — check the Chromium window.');
  }
  phase('load category page');
  // Search on the leaf name: the typeahead misses on a fragment ("wall decor" finds
  // nothing where "wall decor & hangings" finds the category).
  await page
    .locator('input[placeholder*="Sarees" i]')
    .first()
    .fill(M.category.split('>').pop().trim());
  if (!(await appears(page, `text="${M.category}"`, 25000))) {
    throw new Error(`The typeahead never offered "${M.category}".`);
  }
  phase('typeahead');
  await page.locator(`text="${M.category}"`).first().click();
  await appears(page, 'button:has-text("Add Product Images")', 30000);
  phase('category');

  log('== front image');
  const chooser = page.waitForEvent('filechooser', { timeout: 25000 });
  await page.locator('button:has-text("Add Product Images")').first().click();
  (await chooser).setFiles(images.front);
  phase('front image handed over');

  // Move on the instant Continue will take a click, rather than waiting for the
  // upload to report itself finished.
  const cont = page.locator('button:has-text("Continue")').first();
  const until = Date.now() + 90000;
  while (Date.now() < until) {
    if (
      (await cont.isVisible().catch(() => false)) &&
      !(await cont.isDisabled().catch(() => true))
    ) {
      await cont.click().catch(() => {});
      if (await appears(page, '#supplier_gst_percent', 8000)) break;
    }
    await page.waitForTimeout(250);
  }
  if (!(await f.has('#supplier_gst_percent'))) {
    throw new Error('The product details form never rendered after Continue.');
  }
  phase('continue');

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
  await appears(page, 'text="Free Size"', 12000);
  const box = await page.locator('text="Free Size"').first().boundingBox().catch(() => null);
  if (box) {
    await page.mouse.click(box.x - 18, box.y + box.height / 2);
    await page.waitForTimeout(500);
  }
  const apply = page.locator('button:has-text("Apply")').first();
  if (await apply.isVisible().catch(() => false)) {
    await apply.click();
    // Choosing a size is what creates the price row; wait for the row, not the clock.
    await appears(page, '#meesho_price', 30000);
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
    // Deliberately NOT waited on. Nothing between here and the submit depends on
    // the extra images, and there are two dozen fields to fill — so they upload
    // while the form is being filled and are checked once, just before submitting.
    phase('extra images handed over');
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
  // Bath linen only: Towel / Towel Set / Gamcha / Gamcha Set. Optional on the form,
  // so it is guarded like the rest of the category-specific attributes.
  if (M.set) await f.pick('#set', M.set, 'set');
  // Pooja Mats and the other Carpets & Rugs categories. `dimension` is REQUIRED
  // there and is a separate field from the product length/breadth below — it is the
  // marketed size off a fixed list that runs in feet, so it will not always be able
  // to state the true size and the config names the closest option on purpose.
  if (M.dimension) await f.pick('#dimension', M.dimension, 'dimension');
  if (M.shape) await f.pick('#shape', M.shape, 'shape');
  if (M.features) await f.pick('#features', M.features, 'features');
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

  phase('fields');

  // Now the images have to be there. They have had the whole form-filling pass to
  // finish, so this is usually instant.
  if (await f.has('#addMoreImagesInput')) {
    if (!(await vanishes(page, 'text="Add Images"', 60000))) {
      f.problems.push('extra images did not all upload');
    }
    phase('images settled');
  }

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
  return finishSubmission(page, log);
}

/**
 * A visible, enabled button with this label, or null.
 *
 * Two strategies, because one of them goes blind at exactly the wrong moment. MUI
 * marks the rest of the page `aria-hidden` while its dialog is open, and a `role=`
 * selector queries the accessibility tree — so every page button reports count=0
 * while the flagged-words modal is up, including the Submit Catalog sitting in plain
 * view. The text form is ordinary DOM matching and is unaffected.
 */
async function findButton(page, name) {
  const candidates = [
    page.locator(`role=button[name="${name}"]`),
    page.locator(`button:has-text("${name}")`),
  ];
  for (const locator of candidates) {
    const count = await locator.count().catch(() => 0);
    for (let i = 0; i < Math.min(count, 4); i++) {
      const button = locator.nth(i);
      if (!(await button.isVisible().catch(() => false))) continue;
      if (await button.isDisabled().catch(() => false)) continue;
      return button;
    }
  }
  return null;
}

/** Whether any button the declaration gates is live — the fallback proof of a tick. */
async function proceedEnabled(page) {
  for (const name of ['Proceed', 'Confirm', 'Submit', 'Yes']) {
    if (await findButton(page, name)) return true;
  }
  return false;
}

/**
 * Tick the submission declaration. Returns what happened, not just "I clicked".
 *
 * 'absent' nothing to tick · 'already' it was ticked · 'ticked' this call did it ·
 * 'failed' a click landed and changed nothing readable.
 *
 * Meesho draws the box rather than rendering a checkbox that reads back, so the
 * state often cannot be read at all. When it cannot, the substitute is the only
 * other honest signal: whether the button the declaration gates came alive.
 */
async function tickDeclaration(page, log) {
  const WANT = 'I understand that all products';
  // Let it render: the declaration appears with the warning modal, and deciding on
  // the first pass reports "absent" about a box that is about to exist.
  await page
    .getByText(WANT, { exact: false })
    .first()
    .waitFor({ state: 'visible', timeout: 4000 })
    .catch(() => {});

  // Tag the control browser-side, then let Playwright deliver a real pointer click.
  //
  // WHY this shape, and not a locator: Meesho's declaration is not an <input> with a
  // <label>. It is a styled <svg> sitting beside a text node, and only a genuine
  // pointer click on the svg toggles it — clicking the words does nothing. That is
  // also why the page's HTML holds no checkbox for it and every selector written
  // against one found nothing to tick. Approach taken from the seller's existing
  // Meesho app, where it is already proven against this form.
  const tagged = await page
    .evaluate((wanted) => {
      const norm = (s) => (s || '').replace(/\s+/g, ' ').trim();
      const w = wanted.toLowerCase();
      document.querySelectorAll('[data-fk-cb]').forEach((e) => e.removeAttribute('data-fk-cb'));

      // textContent, not innerText: no layout pass, and it sees text split across
      // child elements. Capped, because scanning every node on a miss is how a
      // lookup turns into a frozen run.
      const cands = [];
      for (const el of document.querySelectorAll('body *')) {
        if (el.children.length > 2) continue;
        const t = norm(el.textContent).toLowerCase();
        if (!t || !t.includes(w)) continue;
        cands.push({ el, exact: t === w, leaf: el.children.length === 0, len: t.length });
        if (cands.length >= 200) break;
      }
      const visible = (el) =>
        el.offsetParent !== null || (el.getClientRects && el.getClientRects().length);
      const vis = cands.filter((c) => visible(c.el));
      if (!vis.length) return null;
      vis.sort((a, b) => b.exact - a.exact || b.leaf - a.leaf || a.len - b.len);
      const textEl = vis[0].el;

      // A real input in the row, if this form ever grows one.
      let row = textEl;
      for (let i = 0; i < 5 && row.parentElement; i++) {
        const input = row.querySelector && row.querySelector('input[type="checkbox"]');
        if (input) {
          input.setAttribute('data-fk-cb', '1');
          return 'input';
        }
        row = row.parentElement;
      }
      // The svg immediately before the words — the shape this form actually uses.
      if (textEl.previousElementSibling?.tagName.toLowerCase() === 'svg') {
        textEl.previousElementSibling.setAttribute('data-fk-cb', '1');
        return 'svg-prev';
      }
      // Any svg in the enclosing row.
      row = textEl;
      for (let i = 0; i < 4 && row.parentElement; i++) {
        const svg = row.querySelector && row.querySelector('svg');
        if (svg) {
          svg.setAttribute('data-fk-cb', '1');
          return 'svg-row';
        }
        row = row.parentElement;
      }
      (textEl.parentElement || textEl).setAttribute('data-fk-cb', '1');
      return 'row';
    }, WANT)
    .catch(() => null);

  if (!tagged) return 'absent';

  const clean = () =>
    page
      .evaluate(() => document.querySelectorAll('[data-fk-cb]').forEach((e) => e.removeAttribute('data-fk-cb')))
      .catch(() => {});

  // A drawn box has no checked property, but it DOES redraw: an empty <rect> becomes
  // a filled box with a tick. So compare the svg's own markup before and after, and
  // only call it ticked when the drawing actually changed. Claiming success on a
  // click that landed on a non-interactive svg is what produced "ticked the
  // declaration" against a box that was still visibly empty.
  // Re-find the box from the sentence every time, and read the DRAWING. Reading the
  // tagged element instead gave a false pass: React drops the data attribute on
  // re-render, querySelector then returns nothing, and "" !== previous markup counted
  // as a tick — which is how an empty box was reported as ticked twice over.
  const markup = () =>
    page
      .evaluate((wanted) => {
        const w = wanted.toLowerCase();
        for (const p of document.querySelectorAll('p')) {
          if (!(p.textContent || '').toLowerCase().includes(w)) continue;
          const svg = p.previousElementSibling;
          if (svg && svg.tagName.toLowerCase() === 'svg') return svg.outerHTML;
        }
        return '';
      }, WANT)
      .catch(() => '');

  /**
   * Is the box drawn as ticked? A positive test, not a diff.
   *
   * An empty box is a bare stroked <rect>; a ticked one gains a <path> and a fill.
   * Comparing before and after passed three times on an empty box — once because the
   * element had been re-rendered away (missing !== previous) and once because the
   * "before" read came back empty (anything !== nothing). Only "it now looks ticked"
   * is safe to believe.
   */
  const isTicked = async () => {
    const svg = await markup();
    if (!svg) return null;
    return /<path/i.test(svg) || /fill="(?!none)[^"]+"/i.test(svg);
  };

  // Dispatch the event on the element rather than clicking at a point. The seller
  // noticed the form behind the modal scrolling up and down, and Playwright's click
  // scrolls the target into view first — so the box moves between the scroll and the
  // press and the click lands on whatever slid into that spot. That reports success
  // and ticks nothing, which is what every "ticked" log so far actually was.
  const fire = async (selector) =>
    page
      .locator(selector)
      .first()
      .dispatchEvent('click')
      .then(() => true)
      .catch(() => false);

  let changed = (await isTicked()) === true;
  for (const target of ['[data-fk-cb="1"]', '[data-fk-cb-row="1"]']) {
    if (changed) break;
    if (target.includes('row')) {
      await page
        .evaluate(() => {
          const el = document.querySelector('[data-fk-cb="1"]');
          if (el?.parentElement) el.parentElement.setAttribute('data-fk-cb-row', '1');
        })
        .catch(() => {});
    }
    if (await fire(target)) {
      await page.waitForTimeout(700);
      changed = (await isTicked()) === true;
    }
  }
  await page
    .evaluate(() =>
      document.querySelectorAll('[data-fk-cb-row]').forEach((e) => e.removeAttribute('data-fk-cb-row')),
    )
    .catch(() => {});

  if (!changed) {
    await clean();
    log(`  the declaration box did not change when clicked — ${await captureState(page, 'tick-failed')}`);
    return 'failed';
  }
  await clean();
  log(`  ticked the declaration (${tagged}) — ${await captureState(page, 'after-tick')}`);
  // The button it gates coming alive is the only readable confirmation this form
  // offers; a drawn svg reports no checked state of its own.
  if (await proceedEnabled(page)) log('  a confirmation button is now live');
  return 'ticked';
}

/**
 * See the submission through, whatever Meesho puts in the way.
 *
 * What follows Submit Catalog is not a fixed sequence. Sometimes a declaration
 * checkbox; sometimes a modal of flagged words to strike; sometimes Update Changes
 * and Proceed, sometimes only one of them, sometimes neither. Checking for each in
 * a fixed order — the way this used to — works only for the orders that have
 * already been seen, and silently gives up the first time Meesho reorders them or
 * is slow to render one.
 *
 * So this reacts to whatever is on screen instead: look, act on what is there, look
 * again, until the form is gone from the page or nothing actionable is left.
 */
export async function finishSubmission(page, log, { timeout = 120000 } = {}) {
  const deadline = Date.now() + timeout;
  const clicked = [];
  // Attempts at the thing that can fail silently: a box whose state cannot be read
  // would otherwise be toggled on and off for the rest of the deadline.
  let declarationTries = 0;
  let declarationDone = false;
  // Set once the flagged-words modal turns out to have nothing removable in it, which
  // changes the route through: accept the declaration and submit, rather than trying
  // to edit the copy on the spot.
  let gateIgnored = false;
  let submitPresses = 0;
  let describedIdle = false;
  const off = () => !/\/single\/add/.test(page.url());

  while (Date.now() < deadline) {
    if (off()) {
      log(`  submitted${clicked.length ? ` (via ${clicked.join(' → ')})` : ''}`);
      return { ok: true, submitted: true, problems: [] };
    }

    // The declaration before the gate, not after. It sits in the same panel as the
    // flagged-words modal and gates the buttons under it, so it is worth accepting
    // whether or not the gate is up — and ordering it after the gate meant a gate
    // that would not clear stopped the run with the box never once attempted.
    if (!declarationDone && declarationTries < 3) {
      const tick = await tickDeclaration(page, log);
      if (tick === 'ticked') {
        // Exactly once. A drawn svg reports no checked state of its own, so "tick it
        // again" cannot tell accepted from not-accepted — it only toggles. Ticking on
        // every pass flipped it 123 times in one run and ended on the deadline.
        declarationDone = true;
        clicked.push('declaration');
        continue;
      }
      // A click that changed nothing we can read. Counted, so a box this code cannot
      // work is not clicked on and off for the rest of the deadline.
      if (tick === 'failed') declarationTries += 1;
    }

    // Order, at the seller's instruction and matching their existing Meesho app:
    // checkbox first, then a straightforward confirmation button, and only then the
    // crossed-out words. The modal is never closed — closing it is what kept taking
    // the submission form off screen, and the warning itself is ignorable, not
    // something to clear.
    let acted = false;
    const names = ['Proceed', 'Confirm', 'Yes', 'Update Changes', 'Submit Catalog'];
    for (const name of names) {
      const button = await findButton(page, name);
      if (!button) continue;
      // Submit Catalog may need a second press — the first can land before the
      // declaration is accepted — but not an unbounded number, or a dialog that
      // never closes turns into repeated submissions.
      if (name === 'Submit Catalog' && submitPresses >= 3) continue;
      // Count the press only if the click actually landed. Incrementing first and
      // swallowing the failure spent the whole allowance on clicks the modal's
      // backdrop intercepted, so by the time the button was genuinely reachable
      // there were no presses left and the run sat out its deadline.
      const landed = await button
        .click({ timeout: 15000 })
        .then(() => true)
        .catch(() => false);
      if (!landed) continue;
      if (name === 'Submit Catalog') submitPresses += 1;
      clicked.push(name);
      acted = true;
      await page.waitForTimeout(2500);
      break;
    }
    if (acted) continue;

    // Last, the crossed-out words: only worth striking out when nothing simpler has
    // moved the form on. A gate with no removable chips is Meesho flagging an
    // ordinary word — the article "an" matches a brand of that name, and the modal
    // says so itself: "if product is not related to the brand, please ignore the
    // warning". So it is noted once and left alone rather than treated as a failure.
    const gate = await clearBrandGate(page, log);
    if (gate.changed) {
      clicked.push('brand gate');
      continue;
    }
    if (gate.seen && !gateIgnored) {
      gateIgnored = true;
      log(`  nothing to strike out — ignorable warning (${await captureState(page, 'brand-gate')})`);
    }

    // Nothing to act on. If the form is reporting errors, it is not going to submit.
    const errors = await readErrors(page);
    if (errors.length) {
      log(`  refused: ${errors.join(' | ')}`);
      return { ok: false, submitted: false, problems: errors };
    }
    // Say what "nothing to act on" actually looks like, once. Without this the loop
    // simply goes quiet until the deadline and the state that stalled it is gone by
    // the time anyone can look.
    if (!describedIdle) {
      describedIdle = true;
      const seen = await page.evaluate(() => {
        const vis = (el) => {
          const r = el.getBoundingClientRect();
          return r.width > 4 && r.height > 4;
        };
        const buttons = [...document.querySelectorAll('button,[role=button]')]
          .filter(vis)
          .map((b) => `${(b.innerText || '').trim().slice(0, 28)}${b.disabled ? ' [disabled]' : ''}`)
          .filter((t) => t && t !== '[disabled]');
        const boxes = [...document.querySelectorAll('input[type=checkbox],[role=checkbox]')].map(
          (c) =>
            `${c.id || c.name || '(unnamed)'}=${c.checked ?? c.getAttribute('aria-checked')}${vis(c) ? '' : ' [hidden]'}`,
        );
        const decl = /I understand that all products/i.test(document.body.innerText);
        return { buttons: [...new Set(buttons)], boxes, decl, url: location.pathname };
      });
      log(`  idle — declaration on page: ${seen.decl ? 'yes' : 'no'}`);
      log(`  idle — checkboxes: ${seen.boxes.join(', ') || '(none)'}`);
      log(`  idle — buttons: ${seen.buttons.join(' | ') || '(none)'}`);
      log(`  idle — captured ${await captureState(page, 'submit-idle')}`);
    }
    await page.waitForTimeout(1500);
  }

  return {
    ok: false,
    submitted: false,
    problems: (await readErrors(page)).concat(`submission did not complete within ${timeout / 1000}s`),
  };
}

/**
 * Meesho scans the description for words "similar to authorised brands" and
 * intercepts the submit with a modal naming them. Each flagged word carries an X
 * chip; clicking it strikes the word and Update Changes then goes live. The check
 * is fuzzy rather than a fixed list — "everyday" appears in most of the catalogue
 * and passes, while "navy" was caught — so this handles whatever it names.
 */
/**
 * Screenshot plus the markup of whatever is floating above the form.
 *
 * A modal this code cannot drive is a modal nobody has read. Guessing at selectors
 * costs a run per guess, so the first time one is not understood it gets written
 * down instead.
 */
async function captureState(page, tag) {
  const stamp = `${Date.now()}_${tag}`;
  await fs.mkdir('data/runs', { recursive: true }).catch(() => {});
  await page.screenshot({ path: `data/runs/${stamp}.png` }).catch(() => {});
  // The whole body, alongside the dialog. Scoping the capture to the dialog is what
  // left the declaration unaccounted for: it is plainly on screen beside the modal,
  // but it is not inside the dialog element, so a dialog-only dump said it did not
  // exist and sent the search after the modal instead of after the checkbox.
  await fs
    .writeFile(
      `data/runs/${stamp}_body.html`,
      await page.evaluate(() => document.body.innerHTML).catch(() => ''),
      'utf8',
    )
    .catch(() => {});
  const html = await page
    .evaluate(() => {
      // MUI's dialog is a sibling of its backdrop, not a child, and the paper itself
      // is positioned `relative` inside a fixed root — so filtering on "positioned
      // and large" caught the backdrop (an empty div) and nothing else. Ask for the
      // dialog by name, and fall back to the whole body rather than to guesswork.
      const dialogs = [...document.querySelectorAll('[role="dialog"], .MuiDialog-paper, .MuiModal-root')]
        .filter((el) => el.innerText && el.innerText.trim().length > 20)
        .map((el) => el.outerHTML);
      return dialogs.length ? dialogs.join('\n\n<!-- ── -->\n\n') : document.body.innerHTML;
    })
    .catch(() => '');
  if (html) await fs.writeFile(`data/runs/${stamp}.html`, html.slice(0, 400000), 'utf8').catch(() => {});
  return `data/runs/${stamp}.png`;
}

/**
 * Clear the flagged-words modal, reporting whether this pass actually changed
 * anything.
 *
 * Returning a bare `true` whenever the modal was on screen is what let an
 * uncleanable gate spin: the caller read "handled" and looped straight back into a
 * modal nothing had been done to, seventeen seconds at a time until the deadline.
 * `changed` is what the caller needs — "the gate is still there" is not progress.
 */
export async function clearBrandGate(page, log) {
  const gate = page.locator('text=/unauthorized brands|illegal keywords/i').first();
  if (!(await gate.isVisible().catch(() => false))) return { seen: false, changed: false };

  const words = await page.evaluate(() =>
    [...document.querySelectorAll('mark, [class*=highlight i], [class*=Highlight]')]
      .map((e) => (e.innerText || '').trim())
      .filter(Boolean),
  );
  log(`  brand gate flagged: ${[...new Set(words)].join(', ') || '(unnamed)'}`);

  let removed = 0;
  for (let i = 0; i < 10; i++) {
    const x = page
      .locator('svg[class*=close i], [data-testid*=Close], [class*=chip i] svg, mark svg')
      .first();
    if (!(await x.isVisible().catch(() => false))) break;
    if (await x.click({ timeout: 8000 }).then(() => true).catch(() => false)) removed++;
    await page.waitForTimeout(400);
  }

  const update = page.locator('role=button[name="Update Changes"]').first();
  const canUpdate =
    (await update.isVisible().catch(() => false)) && !(await update.isDisabled().catch(() => true));
  if (removed && canUpdate) {
    await update.click({ timeout: 15000 }).catch(() => {});
    await page.waitForTimeout(2500);
    log(`  cleared the brand gate (${removed} word${removed === 1 ? '' : 's'})`);
  }
  // Pressing Update Changes having struck nothing out just re-submits the same text
  // and the same modal comes back, so that is not a change.
  return { seen: true, changed: removed > 0 };
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
