/**
 * Drives one complete Flipkart single-listing from an empty form to QC.
 *
 * Flow (each tab switch is also the save):
 *   vertical → brand → 5 images → Price/Stock → Product Description →
 *   Additional Description → variants → verify → (optional) Send to QC
 */

import * as F from './form.js';
import * as V from './variants.js';

const ADD_LISTING_URL = 'https://seller.flipkart.com/index.html#dashboard/addListings/single';

export async function selectVertical(page, verticalLabel, log) {
  log(`Opening the single-listing form…`);
  await page.goto(ADD_LISTING_URL, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(4000);

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

  const cont = page.locator('button:has-text("Continue")').first();
  if (await cont.count()) {
    await cont.click();
    await page.waitForTimeout(3000);
  }
  log(`✓ Vertical: ${verticalLabel}`);
}

export async function selectBrand(page, brand, log) {
  const input = page.locator('input').first();
  await input.fill(brand);
  await page.locator('button:has-text("Check Brand")').first().click();
  await page.waitForTimeout(3000);

  const create = page.locator('button:has-text("Create new listing")').first();
  if (!(await create.count())) {
    throw new Error(
      `Flipkart did not approve the brand "${brand}". Check the spelling, or that ` +
        `your account is authorised to sell under it.`,
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
  await V.setCellText(page, i, 'Pack of', v.packOf);
  await V.setCellPick(page, i, 'Seating Capacity', v.seatingCapacity);

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

/** Final gate: every tab green, no error badges. */
export async function verifyReady(page) {
  const states = await F.readTabStates(page);
  const problems = [];
  for (const [name, s] of Object.entries(states)) {
    if (s.errors > 0) problems.push(`${name}: ${s.errors} error(s)`);
  }
  return { states, problems, ready: problems.length === 0 };
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
