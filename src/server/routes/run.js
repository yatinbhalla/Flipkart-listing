import express from 'express';
import { broadcast, getActiveRun, setActiveRun, clearActiveRun } from '../index.js';
import { getPath, allocateSku, sharedImagePaths, resolveVariant } from '../store.js';
import { getSession } from '../../browser/session.js';
import * as L from '../../browser/listing.js';
import { MAX_BATCH } from '../constants.js';

const router = express.Router();

/**
 * Which variant axes require their own Front View image?
 *
 * Seating Capacity variants are the same product photographed once — Flipkart does
 * not ask for another image. Colour and Pack-of variants look different, so each
 * needs its own front image. Images 2–5 are reused either way.
 */
const AXES_NEEDING_IMAGE = new Set(['Color', 'Pack of']);

export function variantNeedsImage(variant) {
  return AXES_NEEDING_IMAGE.has(variant.axis);
}

/**
 * Build the ready-to-list variant set for ONE listing: shared defaults + variant
 * overrides + the copy stored on the path + a freshly allocated SKU.
 *
 * Copy is read from the path, never generated here. A run makes no AI calls.
 */
async function buildListing(path) {
  const out = [];
  for (const variant of path.variants) {
    if (!variant.copy) {
      throw new Error(
        `No saved copy for variant "${variant.label || variant.key}". ` +
          `Generate it once from the Copy panel, then run.`,
      );
    }
    const v = resolveVariant(path, variant);
    v.sku = await allocateSku(variant.skuPattern || path.skuPattern);
    v.modelNumber = v.sku; // Model Number mirrors the SKU exactly.
    Object.assign(v, variant.copy);
    out.push(v);
  }
  return out;
}

// ─── POST /api/run/preview — allocate SKUs and show what would be listed ──────
// Reads stored copy; touches neither Gemini nor the browser.
router.post('/preview', async (req, res) => {
  try {
    const path = await getPath(req.body.pathId);
    if (!path) return res.status(404).json({ error: 'Path not found.' });
    res.json({ variants: await buildListing(path) });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// ─── POST /api/run — drive the real listings ─────────────────────────────────
// `frontImages` is an array of absolute paths: one listing per image, run
// sequentially in a single browser session.
router.post('/', async (req, res) => {
  if (getActiveRun()) {
    return res.status(409).json({ error: 'A run is already in progress.' });
  }

  const { pathId, frontImages = [], variantImages = {}, sendToQc = false } = req.body;
  const path = await getPath(pathId);
  if (!path) return res.status(404).json({ error: 'Path not found.' });

  const fronts = Array.isArray(frontImages) ? frontImages : [frontImages];
  if (!fronts.length) return res.status(400).json({ error: 'Select at least one Front View image.' });
  if (fronts.length > MAX_BATCH) {
    return res.status(400).json({ error: `Too many images — the limit is ${MAX_BATCH} per run.` });
  }

  // Colour / Pack-of variants need their own photo, which cannot vary per listing
  // in a batch. Allow them for a single listing only.
  const imageVariants = path.variants.filter(variantNeedsImage);
  if (imageVariants.length && fronts.length > 1) {
    return res.status(400).json({
      error:
        `This path has variants that need their own image ` +
        `(${imageVariants.map((v) => v.label || v.key).join(', ')}), so it can only be listed one at a time.`,
    });
  }
  const missingVariantImage = imageVariants.filter((v) => !variantImages[v.key]);
  if (missingVariantImage.length) {
    return res.status(400).json({
      error: `Front View image missing for: ${missingVariantImage.map((v) => v.label || v.key).join(', ')}`,
    });
  }

  // Fail before opening a browser if the copy was never generated.
  try {
    await buildListing(path);
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }

  setActiveRun(pathId);
  res.json({ started: true, total: fronts.length });

  const log = (text) => broadcast({ type: 'info', text });
  const fail = (text) => broadcast({ type: 'error', text });
  const done = [];
  const failed = [];

  try {
    const shared = await sharedImagePaths(pathId);
    if (shared.some((p) => !p)) {
      throw new Error('Images 2–5 are not uploaded for this path. Add them in Path settings.');
    }

    const { page } = await getSession(log);
    broadcast({ type: 'event', event: 'batch-start', total: fronts.length });

    for (let i = 0; i < fronts.length; i++) {
      const front = fronts[i];
      const label = `listing ${i + 1}/${fronts.length}`;

      try {
        // SKUs are allocated per listing, so each one in the batch is unique.
        const resolved = await buildListing(path);
        const parent = resolved[0];
        broadcast({
          type: 'event',
          event: 'item-start',
          index: i,
          total: fronts.length,
          sku: parent.sku,
        });
        log(`── ${label} · ${parent.sku} ──`);

        await L.selectVertical(page, path.vertical, log);
        await L.selectBrand(page, path.brand, log);
        await L.uploadImages(page, [front, ...shared], log);

        await L.fillPriceStock(page, parent, log);
        await L.fillProductDescription(page, parent, log);
        await L.fillAdditional(page, parent, log);
        await L.fillVariants(page, resolved, log);

        const { states, problems, ready } = await L.verifyReady(page);
        broadcast({ type: 'event', event: 'tabs', states });

        if (!ready) {
          throw new Error(`Not ready for QC — ${problems.join('; ')}`);
        }
        log(`✓ ${label}: all tabs green.`);

        if (sendToQc) {
          await L.sendToQc(page, log);
        } else {
          log(`${label}: draft complete — not submitted (QC opt-in is off).`);
        }

        done.push(parent.sku);
        broadcast({ type: 'event', event: 'item-done', index: i, sku: parent.sku, ok: true });
      } catch (err) {
        // One bad listing should not abandon the other 49.
        failed.push({ index: i, error: err.message });
        fail(`${label} failed: ${err.message}`);
        broadcast({ type: 'event', event: 'item-done', index: i, ok: false, error: err.message });
      }
    }

    const summary = `${done.length} listed${failed.length ? `, ${failed.length} failed` : ''}`;
    broadcast({
      type: failed.length ? 'error' : 'success',
      text: sendToQc
        ? `Batch finished — ${summary}. Sent to QC: ${done.join(', ') || 'none'}`
        : `Batch finished — ${summary}. Drafts left for review in the browser.`,
    });
  } catch (err) {
    fail(err.message);
  } finally {
    clearActiveRun();
    broadcast({ type: 'event', event: 'run-finished', done, failed });
  }
});

export default router;
