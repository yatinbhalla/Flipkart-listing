/**
 * Drives one complete Flipkart single-listing from an empty form to QC.
 *
 * Flow (each tab switch is also the save):
 *   vertical → brand → 5 images → Price/Stock → Product Description →
 *   Additional Description → variants → verify → (optional) Send to QC
 */

import * as F from './form.js';
import * as V from './variants.js';
import { fillTab } from './fill.js';
import { adaptFieldMap } from '../server/partners.js';

const ADD_LISTING_URL = 'https://seller.flipkart.com/index.html#dashboard/addListings/single';

/**
 * Flipkart and Shopsy are two storefronts behind one Seller Hub. The single-listing
 * form picks between them with a segmented control beside its title, and the choice
 * rewrites the whole vertical list: "Blanket" becomes "Shopsy Blanket", with its own
 * field requirements behind it.
 *
 * The radios are addressed by `name` because Flipkart renders their `id` and `value`
 * as the literal string "[object Object]" — a bug, but `name` is clean and stable.
 */
const PARTNER_RADIO = { flipkart: 'FLIPKART', shopsy: 'SHOPSY' };

export async function selectPartner(page, partner, log) {
  const wanted = PARTNER_RADIO[String(partner || 'flipkart').toLowerCase()];
  if (!wanted) throw new Error(`Unknown partner "${partner}" — expected flipkart or shopsy.`);

  const widget = page.locator('#partner-context-segmented-control');
  if (!(await widget.count())) {
    // A seller not enrolled in Shopsy has no switch at all. Defaulting to Flipkart
    // is correct there; silently listing on Flipkart when Shopsy was asked for is not.
    if (wanted === 'SHOPSY') {
      throw new Error(
        'No Flipkart/Shopsy switch on the listing form — this account may not be ' +
          'enrolled in Shopsy.',
      );
    }
    return;
  }

  const pick = (name) => widget.locator(`label:has(input[name="${name}"])`);
  const radio = widget.locator(`input[name="${wanted}"]`);

  if (!(await radio.isChecked().catch(() => false))) {
    // Click the label, never the input: the real radio is visually hidden behind the
    // label art, so Playwright rejects a click on it as outside the viewport.
    await pick(wanted).click({ timeout: 15000 });
    await page.waitForTimeout(2500);

    // Verify by property. React never writes `checked` back to the HTML attribute,
    // so re-reading the markup would report the old value forever.
    if (!(await radio.isChecked().catch(() => false))) {
      throw new Error(`Clicked the ${wanted} switch but it did not become selected.`);
    }
  }

  // Switching partners re-fetches the vertical catalogue, and that fetch sometimes
  // comes back empty: the favourites grid renders blank AND the typeahead offers
  // nothing, so every later step fails with a confusing "no suggestion matched".
  // Toggling away and back re-issues it. Observed on a clean page load, so this is
  // checked even when the wanted partner was already selected.
  if (!(await hasVerticalCards(page))) {
    log('Vertical list came back empty — re-toggling the partner switch…');
    await pick(wanted === 'SHOPSY' ? 'FLIPKART' : 'SHOPSY').click({ timeout: 15000 });
    await page.waitForTimeout(2500);
    await pick(wanted).click({ timeout: 15000 });
    await page.waitForTimeout(3000);
    if (!(await hasVerticalCards(page))) {
      throw new Error(
        `Switched to ${wanted} but the vertical list never populated. Nothing can be ` +
          `selected in this state.`,
      );
    }
  }

  log(`✓ Partner: ${wanted}`);
}

/** Has the vertical catalogue actually rendered? */
function hasVerticalCards(page, timeout = 12000) {
  return page
    .locator('div[class*="VerticalCard-"]')
    .first()
    .waitFor({ state: 'visible', timeout })
    .then(() => true)
    .catch(() => false);
}

export async function selectVertical(page, verticalLabel, log, { partner = 'flipkart' } = {}) {
  log(`Opening the single-listing form…`);
  await page.goto(ADD_LISTING_URL, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(4000);

  await F.dismissOverlays(page);

  // The target differs from the dashboard URL only by its hash, so Playwright
  // performs a same-document navigation and the SPA may not re-render the route.
  // Wait for the vertical picker; force a hard reload if it never appears.
  const picker = page.locator('text=/Select The Vertical/i').first();
  if (!(await picker.isVisible().catch(() => false))) {
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(5000);
  }
  await picker.waitFor({ state: 'visible', timeout: 45000 }).catch(() => {});
  await F.dismissOverlays(page);
  if (!(await picker.isVisible().catch(() => false))) {
    throw new Error(
      'The vertical picker never rendered. The browser is usually signed out when this ' +
        'happens — check the Chromium window.',
    );
  }

  // Before anything is searched for: the partner switch rewrites the vertical list
  // underneath, so choosing it afterwards would mean picking from the wrong catalogue.
  await selectPartner(page, partner, log);

  // A vertical may be given as a full category path — "Home & Kitchen Accessories /
  // Kitchen & Table Linen / Table Cover" — or as the bare leaf. Cards and the search
  // box both work on the leaf; the typeahead rows carry the whole path, which is
  // what makes a full path worth storing: it distinguishes two leaves of the same
  // name in different branches.
  const leaf = String(verticalLabel).split('/').pop().trim();

  // Shopsy's verticals have been named both ways. They used to carry a "Shopsy "
  // prefix — "Shopsy Table Cover" — and now show the plain name under a Flipkart /
  // Shopsy slider instead. Which one is live is not worth betting a run on, so both
  // forms are tried; the storefront itself is already set by the partner switch.
  const bare = leaf.replace(/^shopsy\s+/i, '');
  const names = [...new Set([leaf, bare, `Shopsy ${bare}`])];

  // Favourited verticals appear as cards under "Your Verticals" — cheapest path.
  for (const name of names) {
    const card = page.locator('div').filter({ hasText: new RegExp(`^${name}$`) }).first();
    if (await card.count()) {
      await card.click().catch(() => {});
      await page.waitForTimeout(1500);
      if (await page.locator('text=Please select a brand').count()) break;
    }
  }

  // Fall back to the search box if the card was not there.
  if (!(await page.locator('text=Please select a brand').count())) {
    const search = page.locator('input[placeholder*="Enter Product Name"]').first();
    if (await search.count()) {
      // Search on the unprefixed name: it matches under either naming, where
      // "Shopsy Table Cover" returns nothing at all once the prefix is dropped.
      await search.fill(bare);
      await page.waitForTimeout(2500);

      // Typeahead rows are full category paths — "Shopsy / Baby Bedding & Gear /
      // Shopsy Blanket" — so match on the segment after the last slash. A plain
      // substring match picks up neighbours like "ShopsyFridge Door Shelf" and
      // silently opens the wrong vertical, which only shows up as a baffling set
      // of fields several steps later.
      const rows = page.locator('li[class*="TypeAheadItemBox"]');
      await rows.first().waitFor({ state: 'visible', timeout: 15000 }).catch(() => {});

      // Normalise separators and spacing so a stored path matches however Flipkart
      // happens to space its own — " / " against "/" is not a difference worth
      // failing a run over.
      const norm = (t) =>
        String(t).replace(/\s*\/\s*/g, ' / ').replace(/\s+/g, ' ').trim().toLowerCase();
      const tail = (t) => String(t).split('/').pop().trim().toLowerCase();
      const wantFull = norm(verticalLabel);
      const wantLeaf = leaf.toLowerCase();
      const texts = await rows.allInnerTexts().catch(() => []);

      // A full-path match first: it is the only one that cannot pick the wrong
      // branch. Leaf matching stays as the fallback for paths stored as a bare name.
      const wanted = names.map((n) => n.toLowerCase());
      let index = texts.findIndex((t) => norm(t) === wantFull);
      if (index < 0) index = texts.findIndex((t) => wanted.includes(tail(t)));
      if (index < 0) index = texts.findIndex((t) => wanted.some((w) => tail(t).includes(w)));
      if (index < 0) {
        throw new Error(
          `Searched for "${bare}" (also tried ${names.join(', ')}) but no suggestion ` +
            `matched. Offered: ${texts.slice(0, 6).join(' | ') || '(none)'}`,
        );
      }
      // Log the row actually taken: it is the full category path, which is the value
      // worth storing on the path so later runs match on the branch, not the leaf.
      log(`Matched vertical: ${texts[index].replace(/\s+/g, ' ').trim()}`);
      await rows.nth(index).click({ timeout: 15000 });
      await page.waitForTimeout(2000);
    }
  }

  // Clear the satisfaction survey, which pops up on a timer over this panel.
  await F.dismissOverlays(page);

  // The button that advances to the brand step is labelled "Select Brand", not
  // "Continue" — an older build of this page used Continue, and looking only for
  // that meant this step silently clicked nothing at all. Accept either.
  const proceed = page
    .locator('button:has-text("Select Brand"), button:has-text("Continue")')
    .first();

  // Wait for it rather than testing once. Selecting a vertical triggers a fetch for
  // the right-hand panel, so a bare count() right after the click races the render
  // and intermittently reports "no button to advance" on a page that is simply
  // still loading — the same mistake that made a valid brand look unapproved.
  const appeared = await proceed
    .waitFor({ state: 'visible', timeout: 30000 })
    .then(() => true)
    .catch(() => false);
  if (!appeared) {
    throw new Error(
      `Selected "${verticalLabel}" but no button to advance to the brand step appeared ` +
        `within 30s (expected "Select Brand" or "Continue").`,
    );
  }
  await proceed.scrollIntoViewIfNeeded().catch(() => {});
  await proceed.click({ timeout: 15000 }).catch(async () => {
    await F.dismissOverlays(page);
    await proceed.click({ timeout: 15000 });
  });
  await page.waitForTimeout(3000);

  // Only claim success once the brand step is actually on screen. Logging a tick
  // unconditionally here is what made a blank page look like a working run.
  const onBrandStep = await page
    .locator('button:has-text("Check Brand")')
    .first()
    .waitFor({ state: 'visible', timeout: 30000 })
    .then(() => true)
    .catch(() => false);
  if (!onBrandStep) {
    throw new Error(
      `Selected "${verticalLabel}" but the brand step never appeared — the vertical card ` +
        `may not have been clicked.`,
    );
  }
  log(`✓ Vertical: ${verticalLabel}`);
}

export async function selectBrand(page, brand, log) {
  await F.dismissOverlays(page);
  // Anchor on the button, not on "the first input on the page" — that resolves to a
  // hidden seller_session_unique_token field and fill() then times out waiting for
  // something that will never be visible. The brand box is the nearest non-hidden
  // input before the button.
  const check = page.locator('button:has-text("Check Brand")').first();
  await check.waitFor({ state: 'visible', timeout: 60000 });

  let input = check.locator('xpath=preceding::input[not(@type="hidden")][1]');
  if (!(await input.count())) {
    input = page.locator('input[type="text"]:visible, input:not([type]):visible').first();
  }

  await input.fill(brand);
  // Confirm the text actually landed before spending a click on the check.
  const typed = await input.inputValue().catch(() => '');
  if (typed.trim() !== brand.trim()) {
    throw new Error(`Could not type the brand name — the field read "${typed}" instead of "${brand}".`);
  }

  await check.click();

  // The brand check is a round trip to Flipkart. A fixed sleep then a one-shot
  // existence check made this intermittently report "brand not approved" for a
  // brand that is perfectly fine — it just hadn't answered yet. Wait for the real
  // outcome instead, and only call it a rejection once a rejection is on screen.
  const create = page.locator('button:has-text("Create new listing")').first();
  const approved = await create
    .waitFor({ state: 'visible', timeout: 30000 })
    .then(() => true)
    .catch(() => false);

  if (!approved) {
    const message = await page
      .locator('text=/cannot|not allowed|not approved|brand.*violation|invalid/i')
      .first()
      .innerText()
      .catch(() => '');
    throw new Error(
      `Flipkart did not approve the brand "${brand}"` +
        (message ? ` — "${message.trim().slice(0, 120)}"` : ' (no response within 30s)') +
        `. Check the spelling, or that your account is authorised to sell under it.`,
    );
  }

  await create.click();
  await page.waitForTimeout(5000);
  log(`✓ Brand: ${brand}`);
}

/**
 * Upload all five slots. `images` is an ordered array of absolute file paths:
 * [Front View, Close Up Shot, Edge View, Flip Side, Package View].
 */
export async function uploadImages(page, images, log) {
  await F.openTab(page, F.TABS.images);
  for (let i = 0; i < images.length && i < 5; i++) {
    if (!images[i]) continue;
    log(`Uploading image ${i + 1}/5 — ${F.IMAGE_SLOTS[i]}…`);
    await F.uploadImage(page, i, images[i]);
  }
  log('✓ Images uploaded.');
}

/**
 * Fill every attribute tab from the path's declared field map.
 *
 * Preferred over the per-tab functions below: verticals do not share a schema, so
 * a path that declares its own fields can be added without touching this file.
 * Falls back to the Table Cover functions when a path has no `fields` map, so the
 * original seeded path keeps working unchanged.
 */
export async function fillTabs(page, path, variant, log, { partner = 'flipkart' } = {}) {
  if (!path.fields) {
    // The Table Cover paths still run on hardcoded fills. Those address Flipkart's
    // labels directly, so they cannot be pointed at Shopsy — refuse rather than
    // half-fill a listing and leave it failing QC for reasons that look unrelated.
    if (String(partner).toLowerCase() === 'shopsy') {
      throw new Error(
        `"${path.name}" has no field map, so it can only be listed on Flipkart. ` +
          `Shopsy needs a field map because its labels differ (Items Included is ` +
          `"Sales Package", and Color becomes "Color For Refiner").`,
      );
    }
    await fillPriceStock(page, variant, log);
    await fillProductDescription(page, variant, log);
    await fillAdditional(page, variant, log);
    return;
  }
  const fields = adaptFieldMap(path.fields, path.vertical, partner);
  for (const [tabName, tabFields] of Object.entries(fields)) {
    await fillTab(page, tabName, tabFields, variant, log);
  }
}

export async function fillPriceStock(page, v, log) {
  await F.openTab(page, F.TABS.price);
  log('Filling Price, Stock and Shipping…');

  await F.setText(page, 'Seller SKU ID', v.sku);
  await F.pick(page, 'Listing Status', v.listingStatus);
  await F.setText(page, 'MRP', v.mrp);
  await F.setText(page, 'Your selling price', v.sellingPrice);
  await F.pick(page, 'Minimum Order Quantity (MinOQ)', v.minoq);
  await F.pick(page, 'Fullfilment by', v.fullfilmentBy);
  await F.pick(page, 'Procurement type', v.procurementType);
  await F.setText(page, 'Procurement SLA', v.procurementSla);
  await F.setText(page, 'Stock', v.stock);
  await F.pick(page, 'Shipping provider', v.shippingProvider);

  // Package group shares one React state object — strictly one at a time.
  await F.setText(page, 'Length', v.package.length);
  await F.setText(page, 'Breadth', v.package.breadth);
  await F.setText(page, 'Height', v.package.height);
  await F.setText(page, 'Weight', v.package.weightKg);

  await F.setText(page, 'HSN', v.hsn);
  await F.pick(page, 'Tax Code', v.taxCode);
  await F.pick(page, 'Country Of Origin', v.countryOfOrigin);
  await F.setText(page, 'Manufacturer Details', v.manufacturerDetails);
  await F.setText(page, 'Packer Details', v.packerDetails);

  // Only rendered when Country of Origin is not India.
  if (v.importerDetails && (await F.hasField(page, 'Importer Details'))) {
    await F.setText(page, 'Importer Details', v.importerDetails);
  }
}

export async function fillProductDescription(page, v, log) {
  await F.openTab(page, F.TABS.description);
  log('Filling Product Description…');

  await F.setText(page, 'Model Number', v.modelNumber);
  await F.setText(page, 'Model Name', v.modelName);
  await F.setPills(page, 'Color', v.colorText, 0);       // free-text pill field
  await F.setText(page, 'Pack of', v.packOf);
  await F.pickMulti(page, 'Color', v.colorRefiner, 1);   // dropdown refiner
  await F.pick(page, 'Type', v.type);
  await F.pickMulti(page, 'Material', v.material);
  await F.pickMulti(page, 'Pattern', v.pattern);
  await F.pick(page, 'Seating Capacity', v.seatingCapacity);
}

/**
 * Fill the Table Cover Additional Description tab.
 *
 * Ordered to match the live form top-to-bottom (see TABLE_COVER_SCHEMA.json, 25
 * attributes). Addressing is by label, so the order is only about keeping the
 * panel scrolling one way rather than jumping around.
 *
 * Three attributes are deliberately never written:
 *   - EAN/UPC — these products carry no GTIN, and inventing one risks colliding
 *     with a real product's barcode.
 *   - Video URL — a URL field; there is no video, and "Not Applicable" is not a URL.
 *   - Domestic / International Warranty — these are warranty UNIT dropdowns whose
 *     only options are "Year" and "Months". Neither says "none", so picking one
 *     would assert a warranty period that does not exist. The free-text warranty
 *     fields carry "Not Applicable" instead.
 */
export async function fillAdditional(page, v, log) {
  await F.openTab(page, F.TABS.additional);
  log('Filling Additional Description…');

  await F.setPills(page, 'Items Included', v.itemsIncluded);
  await F.setPills(page, 'Character', v.character);
  await F.setText(page, 'Thread Count', v.threadCount);
  await F.setPills(page, 'Brand Color', v.brandColor);
  await F.pick(page, 'Reversible', v.reversible);
  await F.setText(page, 'Description', v.description);
  await F.setPills(page, 'Search Keywords', v.searchKeywords);
  await F.setPills(page, 'Key Features', v.keyFeatures);
  await F.pick(page, 'Gift Pack', v.giftPack);
  await F.setText(page, 'Width', v.sizeInches.width);
  await F.setText(page, 'Length', v.sizeInches.length);
  // Thickness stays empty on purpose — see APP_REQUIREMENTS.md.
  await F.setText(page, 'Thickness', v.thickness);
  await F.setText(page, 'Weight', v.weightGrams);
  // Derived rather than stored: it is just this variant's size restated, and a
  // stored copy would go stale the moment a variant's dimensions changed.
  await F.setPills(page, 'Other Dimensions', [
    `Cover size: ${v.sizeInches.width} x ${v.sizeInches.length} inch`,
  ]);
  await F.pick(page, 'Wrinkle Free', v.wrinkleFree);
  await F.setPills(page, 'Care Instructions', v.careInstructions);
  await F.setPills(page, 'Other Features', v.otherFeatures);
  await F.setText(page, 'Warranty Summary', v.warrantySummary);
  await F.setText(page, 'Warranty Service Type', v.warrantyServiceType);
  await F.setText(page, 'Covered in Warranty', v.coveredInWarranty);
  await F.setText(page, 'Not Covered in Warranty', v.notCoveredInWarranty);
}

/**
 * Add every extra variant and fill its matrix row.
 *
 * Row 0 is the parent listing (already filled through the tabs above), so extra
 * variants start at row 1.
 */
/**
 * Commit the Variant tab. Switching tabs IS the save — there is no save button —
 * so bouncing out and back is how work on this tab is persisted.
 */
async function saveVariantTab(page) {
  await F.openTab(page, F.TABS.description);
  await F.openTab(page, F.TABS.variants);
}

export async function fillVariants(
  page, variants, log, columns = null, variantImages = {}, shared = [], variantShared = {},
) {
  if (variants.length < 2) return;

  await F.openTab(page, F.TABS.variants);

  for (let i = 1; i < variants.length; i++) {
    const v = variants[i];
    log(`Adding variant: ${v.axis} = ${v.axisValue}`);
    await V.addVariant(page, v.axis, v.axisValue);
  }

  // Bank the variants before the matrix. A failure while filling ~30 cells per row
  // used to discard the variants with it, leaving a draft holding only the parent
  // and nowhere to attach variant images.
  //
  // HOW FAR THIS ACTUALLY GETS YOU IS PER-VERTICAL, and the difference is not
  // obvious from the UI:
  //   - Hanging Organizers: the tab switch persists. A run that died in the matrix
  //     still left both variants and their photos on the draft.
  //   - Blanket: it does NOT. Verified on draft BM_W_BL_TD_SET/17171 — created a
  //     variant, switched tabs and back (it was still on screen, which is what
  //     made this look fixed), then RELOADED: gone, and the draft's "Updated On"
  //     never moved. Only client state survived the tab switch.
  // Re-check with a reload, never a tab switch, before trusting this on a new
  // vertical. Persisting a Blanket draft needs "Save & Go Back", which is not
  // wired up here yet.
  log('Saving variants…');
  await saveVariantTab(page);

  // Report the matrix columns once per run. They differ per vertical and only
  // exist after a variant is created, so without this the only way to learn a new
  // vertical's column set is to let a run fail on the first name it cannot find.
  await F.scrollSection(page, 'bottom');
  const headers = (await V.readHeaders(page)).filter(Boolean);
  if (headers.length) log(`Variant matrix columns (${headers.length}): ${headers.join(' | ')}`);

  // Images before the matrix, and banked separately. Filling ~38 cells per row is
  // by far the most failure-prone step here, and there is no reason for it to be
  // able to throw away photos that already uploaded cleanly.
  for (let i = 1; i < variants.length; i++) {
    const v = variants[i];
    const front = variantImages[v.key];
    if (!front) continue;
    log(`Images for variant ${v.axisValue} (${v.label})…`);
    await V.selectVariantImageTarget(page, v.axisValue);
    // Slots 2–5 come from this variant's own set where it has one — slot 4 shows
    // the pack size, so a 1-pack must not display the parent's two-panel photo.
    const reused = variantShared[v.key] || shared;
    const set = [front, ...reused];
    const own = reused.filter((f, i) => f && f !== shared[i]).length;
    for (let s = 0; s < set.length && s < 5; s++) {
      if (!set[s]) continue;
      await F.uploadImage(page, s, set[s]);
    }
    log(
      `  ✓ ${set.filter(Boolean).length} image(s) for variant ${v.axisValue}` +
        `${own ? ` (${own} variant-specific)` : ''}.`,
    );
  }
  if (variants.slice(1).some((v) => variantImages[v.key])) {
    log('Saving variant images…');
    await saveVariantTab(page);
  }

  await F.scrollSection(page, 'bottom');

  // Collapse the Variant Issues sidebar before touching the matrix. It is a layout
  // column, not an overlay: it covers the right-hand ~253px of the table wrapper, and
  // the table cannot scroll far enough to bring its last columns out from under it.
  // The cell helpers collapse it too, but doing it once up front means the whole row
  // is filled against a full-width table.
  if (await V.collapseErrorSidebar(page)) log('  · collapsed the Variant Issues sidebar');

  for (let i = 1; i < variants.length; i++) {
    const v = variants[i];
    log(`Filling variant row ${i} (${v.label})…`);
    if (columns) await fillVariantRowFromMap(page, i, v, columns, log);
    else await fillVariantRow(page, i, v);
  }

  // Save, then re-read. On the first pass Procurement SLA, Stock and the package
  // dimensions have come back empty — never trust the matrix until it is re-read.
  log('Saving variant rows…');
  await saveVariantTab(page);
  await F.scrollSection(page, 'bottom');

  for (let i = 1; i < variants.length; i++) {
    const missing = await repairVariantRow(page, i, variants[i]);
    if (missing.length) {
      log(`  ↻ Re-entered dropped fields on row ${i}: ${missing.join(', ')}`);
    }
  }
}

/**
 * Fill one matrix row from a declared column map — the same idea as fillTab(), and
 * for the same reason: the matrix column set is per-vertical.
 *
 * Two differences from the tab filler. Repeated headers are addressed by `at`
 * ("Length" is both package cm and product inch, "Weight" both package kg and
 * product g), and a column that simply is not in this vertical's matrix is skipped
 * with a log line rather than throwing — the tabs already carried those values, and
 * losing the whole listing over an absent column is the worse outcome.
 */
async function fillVariantRowFromMap(page, i, v, columns, log) {
  const valueAt = (data, path) =>
    String(path).split('.').reduce((acc, key) => (acc == null ? undefined : acc[key]), data);

  const skipped = [];
  for (const col of columns) {
    const value = col.from ? valueAt(v, col.from) : col.value;
    if (value === undefined || value === null || value === '' ||
        (Array.isArray(value) && value.length === 0)) {
      continue;
    }
    const at = col.at || 0;
    if (!(await V.hasColumn(page, col.label, at))) {
      skipped.push(col.label);
      continue;
    }
    // Name every cell as it is entered. Without this a stalled row is a silent
    // 20-minute gap in the log and the only way to find the column it died on is to
    // interrogate the live page afterwards — which is how Country Of Origin cost an
    // entire run to identify.
    log(`    · ${col.label}${at ? ` (#${at + 1})` : ''}`);
    switch (col.type) {
      case 'dropdown':
        await V.setCellPick(page, i, col.label, value, at);
        break;
      case 'multi-pick':
        await V.setCellPickMulti(page, i, col.label, value, at);
        break;
      case 'pills':
      case 'multi-value':
        await V.setCellPills(page, i, col.label, value, at);
        break;
      default:
        await V.setCellText(page, i, col.label, value, at);
        break;
    }
  }
  if (skipped.length) log(`  · row ${i}: no such column, skipped — ${skipped.join(', ')}`);
}

async function fillVariantRow(page, i, v) {
  await V.setCellText(page, i, 'Seller SKU ID', v.sku);
  await V.setCellPick(page, i, 'Listing Status', v.listingStatus);
  await V.setCellText(page, i, 'MRP', v.mrp);
  await V.setCellText(page, i, 'Your selling price', v.sellingPrice);
  await V.setCellPick(page, i, 'Minimum Order Quantity (MinOQ)', v.minoq);
  await V.setCellPick(page, i, 'Fullfilment by', v.fullfilmentBy);
  await V.setCellPick(page, i, 'Procurement type', v.procurementType);
  await V.setCellText(page, i, 'Procurement SLA', v.procurementSla);
  await V.setCellText(page, i, 'Stock', v.stock);
  await V.setCellPick(page, i, 'Shipping provider', v.shippingProvider);

  // occurrence 0 = package dimensions (cm/kg)
  await V.setCellText(page, i, 'Length', v.package.length, 0);
  await V.setCellText(page, i, 'Breadth', v.package.breadth, 0);
  await V.setCellText(page, i, 'Height', v.package.height, 0);
  await V.setCellText(page, i, 'Weight', v.package.weightKg, 0);

  await V.setCellText(page, i, 'HSN', v.hsn);
  await V.setCellPick(page, i, 'Tax Code', v.taxCode);
  await V.setCellPick(page, i, 'Country Of Origin', v.countryOfOrigin);
  await V.setCellText(page, i, 'Manufacturer Details', v.manufacturerDetails);
  await V.setCellText(page, i, 'Packer Details', v.packerDetails);

  await V.setCellText(page, i, 'Model Number', v.modelNumber);
  await V.setCellText(page, i, 'Model Name', v.modelName);
  // Color, Pack of and Seating Capacity are NOT filled here. They are the variant
  // axis columns — read-only labels that identify which variant the row is, carrying
  // no input at all. Their values come from addVariant(); trying to type into them
  // just times out waiting for a control that does not exist.

  await V.setCellPills(page, i, 'Items Included', v.itemsIncluded);
  await V.setCellPills(page, i, 'Brand Color', v.brandColor);
  await V.setCellPick(page, i, 'Reversible', v.reversible);
  await V.setCellPick(page, i, 'Gift Pack', v.giftPack);
  await V.setCellPick(page, i, 'Wrinkle Free', v.wrinkleFree);

  // occurrence 1 = product dimensions (inch/g)
  await V.setCellText(page, i, 'Width', v.sizeInches.width);
  await V.setCellText(page, i, 'Length', v.sizeInches.length, 1);
  await V.setCellText(page, i, 'Weight', v.weightGrams, 1);

  await V.setCellText(page, i, 'Description', v.description);
  await V.setCellPills(page, i, 'Search Keywords', v.searchKeywords);
  await V.setCellPills(page, i, 'Key Features', v.keyFeatures);
  await V.setCellPills(page, i, 'Care Instructions', v.careInstructions);
}

/** Re-enter any of the known-flaky numeric cells that came back empty after a save. */
async function repairVariantRow(page, i, v) {
  const checks = [
    ['Procurement SLA', v.procurementSla, 0],
    ['Stock', v.stock, 0],
    ['Length', v.package.length, 0],
    ['Breadth', v.package.breadth, 0],
    ['Height', v.package.height, 0],
    ['Weight', v.package.weightKg, 0],
  ];
  const repaired = [];
  for (const [name, want, occ] of checks) {
    const got = await V.readCellText(page, i, name, occ).catch(() => '');
    if (String(got).trim() === '' && want !== undefined && want !== '') {
      await V.setCellText(page, i, name, want, occ);
      repaired.push(name);
    }
  }
  return repaired;
}

/**
 * Final gate.
 *
 * Two things this gets right that the obvious version does not:
 *
 *  1. The last tab filled has never been left, so it is UNSAVED and its counters
 *     are stale. Bounce tabs first to force the save, then read.
 *  2. Counters are not a completeness signal anyway — a finished listing sat at
 *     "Product Description (5/15)" and "Additional Description (0/26)" while
 *     Flipkart considered it perfectly submittable, because the totals count every
 *     attribute rather than the mandatory ones. The authoritative verdict is
 *     whether Flipkart enables its own Send to QC button.
 */
export async function verifyReady(page) {
  await F.openTab(page, F.TABS.images);
  await F.openTab(page, F.TABS.price);

  const states = await F.readTabStates(page);
  const problems = [];
  for (const [name, s] of Object.entries(states)) {
    if (s.errors > 0) problems.push(`${name}: ${s.errors} error(s)`);
  }

  const qc = page.locator('button:has-text("Send to QC")').first();
  const submittable = (await qc.count()) ? !(await qc.isDisabled().catch(() => true)) : false;
  if (!submittable) {
    problems.push('Flipkart has not enabled "Send to QC" — the listing is still incomplete');
  }

  return { states, problems, submittable, ready: problems.length === 0 };
}

export async function sendToQc(page, log) {
  const btn = page.locator('button:has-text("Send to QC")').first();
  if (await btn.isDisabled().catch(() => true)) {
    throw new Error('"Send to QC" is disabled — the form still has unresolved errors.');
  }
  await btn.click();
  await page.waitForTimeout(8000);

  const banner = await page
    .locator('text=/sent for Quality Check successfully/i')
    .first()
    .isVisible()
    .catch(() => false);
  if (!banner) {
    throw new Error('Clicked Send to QC but no success confirmation appeared. Check the browser.');
  }
  log('✓ Sent for Quality Check.');
  return true;
}
