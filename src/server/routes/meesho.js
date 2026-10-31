import express from 'express';
import crypto from 'crypto';
import fs from 'fs/promises';
import {
  broadcast,
  getActiveRun,
  setActiveRun,
  clearActiveRun,
  throwIfStopped,
  RunStopped,
} from '../index.js';
import {
  getPath,
  allocateSku,
  sharedImagePaths,
  variantSharedImagePaths,
  resolveVariant,
} from '../store.js';
import { getMeeshoSession } from '../../browser/meesho/session.js';
import { createCatalog, MAX_PRODUCTS } from '../../browser/meesho/listing.js';
import { MAX_BATCH } from '../constants.js';
import { jitterPrice } from '../price.js';

const router = express.Router();

const hashFile = async (file) =>
  crypto.createHash('md5').update(await fs.readFile(file)).digest('hex');

/**
 * A multi-variant path lists on Meesho as ONE catalog holding every variant as its
 * own product — Meesho's form of a variation listing. (Until 2026-10-31 only the
 * first variant was listed and _SET paths were skipped; the seller reversed both.)
 *
 * Every product needs its own front image, the parent's included, so on Meesho
 * every variant after the first needs a photo — even the Seating Capacity and Size
 * variants that share the parent's photo on Flipkart. Table Cloths and the other
 * home categories offer only Free Size, so a 60x90 cover cannot be a size row
 * beside the 40x60; it is a second product, and a second product needs a picture.
 */
export const meeshoImageVariants = (path) => path.variants.slice(1);

/** One product's Meesho values: the path's, with the variant's own on top. */
export const meeshoFor = (path, variant) => ({ ...path.meesho, ...(variant.meesho || {}) });

/**
 * The per-variant fronts lined up with the parent's, or the reason they cannot be.
 * Counts must match exactly: zipping a short list would pair the wrong photo with
 * the wrong product, which is invisible until the catalog is live.
 */
export function meeshoVariantFronts(path, variantImages = {}, cycles, total) {
  const out = {};
  const missing = [];
  const uneven = [];
  for (const v of meeshoImageVariants(path)) {
    const raw = variantImages[v.key];
    const list = (Array.isArray(raw) ? raw : raw ? [raw] : []).filter(Boolean);
    out[v.key] = Array.from({ length: cycles }, () => list).flat();
    if (!list.length) missing.push(v.label || v.key);
    else if (out[v.key].length !== total) uneven.push(`${v.label || v.key}: ${list.length}`);
  }
  if (missing.length) {
    return { error: `Meesho needs a front image for every variant — missing: ${missing.join(', ')}` };
  }
  if (uneven.length) {
    return { error: `Every variant needs the same number of front images as the main one — ${uneven.join(', ')}.` };
  }
  return { fronts: out };
}

/**
 * One product's resolved data, with a freshly allocated SKU.
 *
 * `index` picks the stored copy variant, so a batch of the same product goes out
 * with different titles and descriptions rather than the same words every time.
 */
async function buildOne(path, variant, index = 0) {
  if (!variant.copy && !variant.copyPool?.length) {
    throw new Error(
      `No saved copy for "${variant.label || variant.key}". Generate it from the Copy panel first.`,
    );
  }
  const v = resolveVariant(path, variant);
  v.sku = await allocateSku(variant.skuPattern || path.skuPattern);
  const pool = variant.copyPool?.length ? variant.copyPool : [variant.copy];
  Object.assign(v, pool[index % pool.length]);
  return v;
}

/**
 * The three reused images that follow each product's front.
 *
 * Meesho caps a product at four images against Flipkart's five, so slot 4 is the
 * one that does not fit — the seller's choice is slots 2, 3 and 5. A variant with
 * its own file in one of those slots (the wall organiser's pack shots) gets it.
 */
async function reusedImages(pathId, variantKey = null) {
  const shared = await sharedImagePaths(pathId);
  const slots = variantKey ? await variantSharedImagePaths(pathId, variantKey, shared) : shared;
  const [img2, img3, , img5] = slots;
  if (!img2 || !img3 || !img5) {
    throw new Error('Meesho needs the reused images in slots 2, 3 and 5 saved on the path.');
  }
  return [img2, img3, img5];
}

// ─── POST /api/meesho/run ─────────────────────────────────────────────────────
// Batches exactly like the Flipkart run: every front image becomes its own
// catalogue with its own SKU, and the whole selection can be repeated.
/**
 * Why a path cannot be listed on Meesho, or null when it can.
 *
 * Shared with the combined run, which needs to say so before starting a Flipkart
 * batch rather than after — finding out at the handover is finding out too late.
 */
export function meeshoBlocker(path) {
  if (!path.meesho) return `"${path.name}" is not configured for Meesho.`;
  if (path.variants.length > MAX_PRODUCTS) {
    return `Meesho takes at most ${MAX_PRODUCTS} products per catalog; "${path.name}" has ${path.variants.length} variants.`;
  }
  // A variant without a price of its own inherits the path's, which for a bigger
  // size or pack would list it at the smaller one's settlement — so a variation must
  // state each variant's price unless they genuinely all match.
  const parentMrp = path.variants[0].mrp;
  const unpriced = path.variants.filter(
    (v, i) =>
      !meeshoFor(path, v).sellingPrice ||
      (i > 0 && v.mrp !== parentMrp && !v.meesho?.sellingPrice),
  );
  if (unpriced.length) {
    return `No Meesho price for: ${unpriced.map((v) => v.label || v.key).join(', ')}.`;
  }
  return null;
}

/**
 * List one path's images on Meesho.
 *
 * Deliberately owns neither the active-run flag nor run-finished: a combined run
 * hands this one storefront of several, and each announcing the run over is how a
 * progress bar ends up jumping back to the start halfway through.
 */
export async function runMeeshoBatch({ path, pathId, fronts, variantFronts = {}, submit, log }) {
  const done = [];
  const extras = {};
  for (const v of path.variants) {
    extras[v.key] = await reusedImages(pathId, v === path.variants[0] ? null : v.key);
  }
  const { page } = await getMeeshoSession(log);
  broadcast({ type: 'event', event: 'batch-start', total: fronts.length });

  {
    for (let i = 0; i < fronts.length; i++) {
      const label = `listing ${i + 1}/${fronts.length}`;
      let sku = null;
      try {
        throwIfStopped();
        // A product per variant, each with its own SKU, price and front. Listing i
        // takes the i-th front of every variant, exactly as the Flipkart run does.
        const products = [];
        for (const [k, v] of path.variants.entries()) {
          const variant = await buildOne(path, v, i);
          const M = meeshoFor(path, v);
          // Meesho carries its own price, so it is jittered separately from the
          // Flipkart one rather than sharing a figure — two marketplaces drifting in
          // step would be its own kind of pattern. Copied per product so the loaded
          // path keeps the seller's number for the listing after this.
          const meesho = { ...M, sellingPrice: jitterPrice(M.sellingPrice, variant.mrp, 'meesho') };
          const front = k === 0 ? fronts[i] : variantFronts[v.key]?.[i];
          if (!front) throw new Error(`No front image for "${v.label || v.key}".`);
          products.push({ meesho, variant, sku: variant.sku, front, extras: extras[v.key] });
        }
        sku = products.map((p) => p.sku).join(', ');

        // Two products with the same front is a duplicate Meesho will flag — and on a
        // Size or Seating Capacity variation it is the easy mistake to make, because
        // those share one photo on Flipkart.
        const seen = new Map();
        for (const [k, p] of products.entries()) {
          const h = await hashFile(p.front);
          if (seen.has(h)) {
            throw new Error(
              `"${path.variants[k].label || path.variants[k].key}" has the same front image as ` +
                `"${path.variants[seen.get(h)].label || path.variants[seen.get(h)].key}" — every product needs its own photo.`,
            );
          }
          seen.set(h, k);
        }

        broadcast({ type: 'event', event: 'item-start', index: i, total: fronts.length, sku });
        log(`── ${label} · ${products.map((p) => `${p.sku} ₹${p.meesho.sellingPrice}`).join(' · ')} ──`);

        throwIfStopped();
        const result = await createCatalog(page, {
          category: path.meesho.category,
          products,
          submit,
          log,
        });

        if (result.ok) {
          log(`${label} ${result.submitted ? 'submitted' : 'filled (not submitted)'}: ${sku}`);
          done.push(sku);
        } else {
          broadcast({ type: 'error', text: `${label} refused: ${result.problems.join('; ')}` });
        }
        broadcast({ type: 'event', event: 'item-done', index: i, ok: result.ok, sku });
      } catch (err) {
        // A stop is a decision, not a failure.
        if (err instanceof RunStopped) {
          broadcast({ type: 'event', event: 'item-done', index: i, ok: false, sku });
          broadcast({
            type: 'info',
            text: `Stopped during ${label}. A part-built catalogue may be left on screen.`,
          });
          break;
        }
        // One bad listing does not end the batch — the rest of the images are still
        // worth listing, and the SKU it burned is already recorded either way.
        broadcast({ type: 'error', text: `${label} failed: ${err.message}` });
        broadcast({ type: 'event', event: 'item-done', index: i, ok: false, sku });
      }
    }

    broadcast({
      type: done.length ? 'success' : 'error',
      text: done.length
        ? `Meesho: ${done.length}/${fronts.length} ${submit ? 'submitted' : 'filled'} — ${done.join(', ')}`
        : 'Meesho: nothing was listed.',
    });
  }
  return done;
}

// ─── POST /api/meesho/run — Meesho on its own ─────────────────────────────────
router.post('/run', async (req, res) => {
  const { pathId, frontImages = [], variantImages = {}, repeat = 1, submit = false } = req.body || {};
  if (getActiveRun()) return res.status(409).json({ error: 'A run is already in progress.' });

  const path = await getPath(pathId);
  if (!path) return res.status(404).json({ error: 'Path not found.' });
  const blocker = meeshoBlocker(path);
  if (blocker) return res.status(400).json({ error: blocker });

  const selected = Array.isArray(frontImages) ? frontImages : [frontImages];
  if (!selected.length) return res.status(400).json({ error: 'Select at least one front image.' });

  const cycles = Math.min(Math.max(Number(repeat) || 1, 1), 99);
  const fronts = Array.from({ length: cycles }, () => selected).flat();
  if (fronts.length > MAX_BATCH) {
    return res.status(400).json({
      error: `That is ${fronts.length} listings; the limit is ${MAX_BATCH} per run.`,
    });
  }
  const lined = meeshoVariantFronts(path, variantImages, cycles, fronts.length);
  if (lined.error) return res.status(400).json({ error: lined.error });

  res.json({ started: true });
  setActiveRun({ marketplace: 'meesho', pathId });
  const log = (text) => broadcast({ type: 'info', text });
  try {
    if (cycles > 1) {
      log(`Repeating ${selected.length} image(s) × ${cycles} = ${fronts.length} listings.`);
    }
    await runMeeshoBatch({ path, pathId, fronts, variantFronts: lined.fronts, submit, log });
  } catch (err) {
    broadcast({ type: 'error', text: err.message });
  } finally {
    clearActiveRun();
    broadcast({ type: 'event', event: 'run-finished' });
  }
});

// ─── GET /api/meesho/catalogs — what Meesho's own list says ───────────────────
// A submission that reached Proceed is not proof the catalog exists. This reads the
// Single Uploads list from the live session: the page's text, and a screenshot.
// Read-only: it opens a tab and clicks nothing that changes a catalog.
router.get('/catalogs', async (req, res) => {
  if (getActiveRun()) return res.status(409).json({ error: 'A run is in progress.' });
  try {
    const { page } = await getMeeshoSession(() => {});
    await page.goto(CATALOG_LIST_URL, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(5000);
    const tab = String(req.query.tab || 'Single Uploads');
    const single = page.locator(`text=/^${tab}/i`).first();
    if (await single.isVisible().catch(() => false)) {
      await single.click().catch(() => {});
      await page.waitForTimeout(5000);
    }
    if (req.query.status) {
      const status = page.locator(`text=/^${String(req.query.status)}/i`).first();
      if (await status.isVisible().catch(() => false)) {
        await status.click().catch(() => {});
        await page.waitForTimeout(5000);
      }
    }
    // ?inventoryRow=N opens the Nth row's "View in Inventory", where a QC Error
    // catalog states why it failed. Still read-only: that page only shows the reason.
    const row = Number(req.query.inventoryRow);
    if (row > 0) {
      const link = page.locator('text="View in Inventory"').nth(row - 1);
      if (await link.isVisible().catch(() => false)) {
        const popup = page.context().waitForEvent('page', { timeout: 8000 }).catch(() => null);
        await link.click().catch(() => {});
        const opened = await popup;
        const target = opened || page;
        await target.waitForLoadState('domcontentloaded').catch(() => {});
        await target.waitForTimeout(6000);
        const shotI = `data/runs/${Date.now()}_inventory.png`;
        await target.screenshot({ path: shotI, fullPage: true }).catch(() => {});
        const textI = await target.evaluate(() => document.body.innerText);
        if (opened) await opened.close().catch(() => {});
        return res.json({ url: target.url(), shot: shotI, text: textI.slice(0, Number(req.query.chars) || 8000) });
      }
    }
    // ?scroll=N: the table scrolls inside its own panel and loads ten rows at a time,
    // so older rows only exist after scrolling that panel to the bottom N times.
    for (let i = 0; i < Math.min(Number(req.query.scroll) || 0, 10); i++) {
      await page.evaluate(() => {
        for (const el of document.querySelectorAll('*')) {
          if (el.scrollHeight > el.clientHeight + 40 && /(auto|scroll)/.test(getComputedStyle(el).overflowY)) {
            el.scrollTop = el.scrollHeight;
          }
        }
        window.scrollTo(0, document.body.scrollHeight);
      });
      await page.waitForTimeout(3000);
    }
    const shot = `data/runs/${Date.now()}_catalog-list.png`;
    await page.screenshot({ path: shot, fullPage: true }).catch(() => {});
    const text = await page.evaluate(() => document.body.innerText);
    res.json({ url: page.url(), shot, text: text.slice(0, Number(req.query.chars) || 8000) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

const CATALOG_LIST_URL = 'https://supplier.meesho.com/panel/v3/new/cataloging/vaqbo/catalogs';

export default router;
