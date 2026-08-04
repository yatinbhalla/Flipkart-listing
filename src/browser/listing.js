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

const ADD_LISTING_URL = 'https://seller.flipkart.com/index.html#dashboard/addListings/single';

export async function selectVertical(page, verticalLabel, log) {
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

  // Favourited verticals appear as cards under "Your Verticals" — cheapest path.
  const card = page.locator('div').filter({ hasText: new RegExp(`^${verticalLabel}$`) }).first();
  if (await card.count()) {
    await card.click().catch(() => {});
    await page.waitForTimeout(1500);
  }

  // Fall back to the search box if the card was not there.
  if (!(await page.locator('text=Please select a brand').count())) {
    const search = page.locator('input[placeholder*="Enter Product Name"]').first();
    if (await search.count()) {
      await search.fill(verticalLabel);
      await page.waitForTimeout(2000);
      const hit = page.locator(`text=${verticalLabel}`).first();
      await hit.click().catch(() => {});
      await page.waitForTimeout(1500);
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
export async function fillTabs(page, path, variant, log) {
  if (!path.fields) {
    await fillPriceStock(page, variant, log);
    await fillProductDescription(page, variant, log);
    await fillAdditional(page, variant, log);
    return;
  }
  for (const [tabName, fields] of Object.entries(path.fields)) {
    await fillTab(page, tabName, fields, variant, log);
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

export async function fillAdditional(page, v, log) {
  await F.openTab(page, F.TABS.additional);
  log('Filling Additional Description…');

  await F.setPills(page, 'Items Included', v.itemsIncluded);
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
  await F.pick(page, 'Wrinkle Free', v.wrinkleFree);
  await F.setPills(page, 'Care Instructions', v.careInstructions);
}

/**
 * Add every extra variant and fill its matrix row.
 *
 * Row 0 is the parent listing (already filled through the tabs above), so extra
 * variants start at row 1.
 */
export async function fillVariants(page, variants, log) {
  if (variants.length < 2) return;

  await F.openTab(page, F.TABS.variants);

  for (let i = 1; i < variants.length; i++) {
    const v = variants[i];
    log(`Adding variant: ${v.axis} = ${v.axisValue}`);
    await V.addVariant(page, v.axis, v.axisValue);
  }

  await F.scrollSection(page, 'bottom');

  for (let i = 1; i < variants.length; i++) {
    const v = variants[i];
    log(`Filling variant row ${i} (${v.label})…`);
    await fillVariantRow(page, i, v);
  }

  // Save, then re-read. On the first pass Procurement SLA, Stock and the package
  // dimensions have come back empty — never trust the matrix until it is re-read.
  log('Saving variants…');
  await F.openTab(page, F.TABS.description);
  await F.openTab(page, F.TABS.variants);
  await F.scrollSection(page, 'bottom');

  for (let i = 1; i < variants.length; i++) {
    const missing = await repairVariantRow(page, i, variants[i]);
    if (missing.length) {
      log(`  ↻ Re-entered dropped fields on row ${i}: ${missing.join(', ')}`);
    }
  }
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
