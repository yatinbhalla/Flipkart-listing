import express from 'express';
import {
  broadcast,
  getActiveRun,
  setActiveRun,
  clearActiveRun,
  throwIfStopped,
  RunStopped,
} from '../index.js';
import { getPath, allocateSku, sharedImagePaths, resolveVariant } from '../store.js';
import { getMeeshoSession } from '../../browser/meesho/session.js';
import { createListing } from '../../browser/meesho/listing.js';
import { MAX_BATCH } from '../constants.js';

const router = express.Router();

/**
 * Meesho lists one product per catalogue and never a variant set.
 *
 * The seller lists only the first variant of a multi-variant path, and skips the
 * _SET bundles entirely — so a Meesho run resolves one variant rather than the
 * matrix the Flipkart run builds.
 */
function isSetPath(path) {
  return /_SET$/i.test(String(path.skuPattern || '').replace(/\{X\}/g, '').replace(/\/+$/, ''));
}

/**
 * One listing's worth of resolved data, with a freshly allocated SKU.
 *
 * `index` picks the stored copy variant, so a batch of the same product goes out
 * with different titles and descriptions rather than the same words every time.
 */
async function buildOne(path, index = 0) {
  const variant = path.variants[0];
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
 * The three reused images that follow the front one.
 *
 * Meesho caps a product at four images against Flipkart's five, so slot 4 is the
 * one that does not fit — the seller's choice is slots 2, 3 and 5.
 */
async function reusedImages(pathId) {
  const [img2, img3, , img5] = await sharedImagePaths(pathId);
  if (!img2 || !img3 || !img5) {
    throw new Error('Meesho needs the reused images in slots 2, 3 and 5 saved on the path.');
  }
  return [img2, img3, img5];
}

// ─── POST /api/meesho/run ─────────────────────────────────────────────────────
// Batches exactly like the Flipkart run: every front image becomes its own
// catalogue with its own SKU, and the whole selection can be repeated.
router.post('/run', async (req, res) => {
  const { pathId, frontImages = [], repeat = 1, submit = false } = req.body || {};
  if (getActiveRun()) return res.status(409).json({ error: 'A run is already in progress.' });

  const path = await getPath(pathId);
  if (!path) return res.status(404).json({ error: 'Path not found.' });
  if (!path.meesho) {
    return res.status(400).json({ error: `"${path.name}" is not configured for Meesho.` });
  }
  if (isSetPath(path)) {
    return res.status(400).json({ error: 'Set paths are not listed on Meesho.' });
  }

  const selected = Array.isArray(frontImages) ? frontImages : [frontImages];
  if (!selected.length) return res.status(400).json({ error: 'Select at least one front image.' });

  const cycles = Math.min(Math.max(Number(repeat) || 1, 1), 99);
  const fronts = Array.from({ length: cycles }, () => selected).flat();
  if (fronts.length > MAX_BATCH) {
    return res.status(400).json({
      error: `That is ${fronts.length} listings; the limit is ${MAX_BATCH} per run.`,
    });
  }

  res.json({ started: true });
  setActiveRun({ marketplace: 'meesho', pathId });
  const log = (text) => broadcast({ type: 'info', text });
  const done = [];

  try {
    const extras = await reusedImages(pathId);
    const { page } = await getMeeshoSession(log);
    if (cycles > 1) {
      log(`Repeating ${selected.length} image(s) × ${cycles} = ${fronts.length} listings.`);
    }
    broadcast({ type: 'event', event: 'batch-start', total: fronts.length });

    for (let i = 0; i < fronts.length; i++) {
      const label = `listing ${i + 1}/${fronts.length}`;
      let sku = null;
      try {
        throwIfStopped();
        // A SKU per listing, so every catalogue in the batch is unique.
        const variant = await buildOne(path, i);
        sku = variant.sku;
        broadcast({ type: 'event', event: 'item-start', index: i, total: fronts.length, sku });
        log(`── ${label} · ${sku} ₹${path.meesho.sellingPrice} ──`);

        throwIfStopped();
        const result = await createListing(page, {
          path,
          variant,
          sku,
          images: { front: fronts[i], extras },
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
  } catch (err) {
    broadcast({ type: 'error', text: err.message });
  } finally {
    clearActiveRun();
    broadcast({ type: 'event', event: 'run-finished' });
  }
});

export default router;
