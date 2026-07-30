import express from 'express';
import { broadcast, getActiveRun, setActiveRun, clearActiveRun } from '../index.js';
import { getPath, allocateSku, sharedImagePaths } from '../store.js';
import { generateCopy } from '../../ai/content.js';
import { getSession } from '../../browser/session.js';
import * as L from '../../browser/listing.js';

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

/** Merge path-level defaults with a variant's own overrides into one flat object. */
function resolveVariant(path, variant) {
  return {
    ...path.shared,
    ...variant,
    package: { ...(path.shared.package || {}), ...(variant.package || {}) },
    sizeInches: { ...(path.shared.sizeInches || {}), ...(variant.sizeInches || {}) },
  };
}

// ─── POST /api/run/preview — resolve everything WITHOUT touching the browser ───
// Lets the user read the generated copy and the allocated SKUs before anything is
// written to Flipkart.
router.post('/preview', async (req, res) => {
  try {
    const { pathId } = req.body;
    const path = await getPath(pathId);
    if (!path) return res.status(404).json({ error: 'Path not found.' });

    const log = (text) => broadcast({ type: 'info', text });
    const variants = [];
    for (const variant of path.variants) {
      const v = resolveVariant(path, variant);
      v.sku = await allocateSku(variant.skuPattern || path.skuPattern);
      v.modelNumber = v.sku; // Model Number mirrors the SKU exactly.
      const copy = await generateCopy(path, v, log);
      Object.assign(v, copy);
      variants.push(v);
    }
    res.json({ variants });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── POST /api/run — drive the real listing ───────────────────────────────────
router.post('/', async (req, res) => {
  if (getActiveRun()) {
    return res.status(409).json({ error: 'A run is already in progress.' });
  }

  const { pathId, frontImages = {}, sendToQc = false, variants: precomputed } = req.body;
  const path = await getPath(pathId);
  if (!path) return res.status(404).json({ error: 'Path not found.' });

  // Every variant that needs its own front image must have one before we start —
  // failing here costs nothing, failing mid-form leaves a half-built draft.
  const missing = path.variants
    .filter((v, i) => i === 0 || variantNeedsImage(v))
    .filter((v) => !frontImages[v.key])
    .map((v) => v.label || v.key);
  if (missing.length) {
    return res.status(400).json({ error: `Front View image missing for: ${missing.join(', ')}` });
  }

  setActiveRun(pathId);
  res.json({ started: true });

  const log = (text) => broadcast({ type: 'info', text });
  const fail = (text) => broadcast({ type: 'error', text });

  try {
    // 1. Resolve SKUs + copy (reuse the preview if the UI already generated it).
    let resolved = precomputed;
    if (!resolved) {
      resolved = [];
      for (const variant of path.variants) {
        const v = resolveVariant(path, variant);
        v.sku = await allocateSku(variant.skuPattern || path.skuPattern);
        v.modelNumber = v.sku;
        Object.assign(v, await generateCopy(path, v, log));
        resolved.push(v);
      }
    }

    const parent = resolved[0];
    const shared = await sharedImagePaths(pathId);
    if (shared.some((p) => !p)) {
      throw new Error('Images 2–5 are not uploaded for this path. Add them in Path settings.');
    }

    // 2. Drive the form.
    const { page } = await getSession(log);
    await L.selectVertical(page, path.vertical, log);
    await L.selectBrand(page, path.brand, log);
    await L.uploadImages(page, [frontImages[path.variants[0].key], ...shared], log);

    await L.fillPriceStock(page, parent, log);
    await L.fillProductDescription(page, parent, log);
    await L.fillAdditional(page, parent, log);
    await L.fillVariants(page, resolved, log);

    // 3. Verify before doing anything irreversible.
    const { states, problems, ready } = await L.verifyReady(page);
    broadcast({ type: 'event', event: 'tabs', states });

    if (!ready) {
      fail(`Not ready for QC — ${problems.join('; ')}`);
      broadcast({ type: 'event', event: 'needs-attention', problems });
      return;
    }
    log('✓ All tabs green, no errors.');

    if (!sendToQc) {
      broadcast({
        type: 'success',
        text: 'Draft complete and validated. Review it in the browser, then press Send to QC.',
      });
      return;
    }

    await L.sendToQc(page, log);
    broadcast({
      type: 'success',
      text: `Sent to QC: ${resolved.map((v) => v.sku).join(', ')}`,
    });
  } catch (err) {
    fail(err.message);
  } finally {
    clearActiveRun();
    broadcast({ type: 'event', event: 'run-finished' });
  }
});

export default router;
