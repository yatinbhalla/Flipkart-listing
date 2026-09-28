import express from 'express';
import { broadcast, getActiveRun, setActiveRun, clearActiveRun } from '../index.js';
import { getPath, allocateSku, sharedImagePaths, resolveVariant } from '../store.js';
import { getMeeshoSession } from '../../browser/meesho/session.js';
import { createListing } from '../../browser/meesho/listing.js';

const router = express.Router();

/**
 * Meesho listings are single products, never variant sets.
 *
 * The seller lists only the first variant of a multi-variant path there, and skips
 * the _SET bundles entirely — so a Meesho run resolves one variant, not the whole
 * matrix the Flipkart run builds.
 */
function isSetPath(path) {
  return /_SET$/i.test(String(path.skuPattern || '').replace(/\{X\}/g, '').replace(/\/+$/, ''));
}

async function buildOne(path) {
  const variant = path.variants[0];
  if (!variant.copy) {
    throw new Error(
      `No saved copy for "${variant.label || variant.key}". Generate it from the Copy panel first.`,
    );
  }
  const v = resolveVariant(path, variant);
  v.sku = await allocateSku(variant.skuPattern || path.skuPattern);
  Object.assign(v, variant.copy);
  return v;
}

/**
 * The four images Meesho takes: the front, then three more.
 *
 * Meesho caps a product at four images against Flipkart's five, and asks only for a
 * front view rather than a per-listing product photo — so the path's own slot 4,
 * which has nowhere to go under that cap, becomes the front and slots 2, 3 and 5
 * follow it.
 */
async function meeshoImages(pathId) {
  const [img2, img3, img4, img5] = await sharedImagePaths(pathId);
  if (!img2 || !img3 || !img4 || !img5) {
    throw new Error('Meesho needs all four reused images (slots 2-5) saved on the path.');
  }
  return { front: img4, extras: [img2, img3, img5] };
}

// ─── POST /api/meesho/run ─────────────────────────────────────────────────────
router.post('/run', async (req, res) => {
  const { pathId, submit = false } = req.body || {};
  if (getActiveRun()) return res.status(409).json({ error: 'A run is already in progress.' });

  const path = await getPath(pathId);
  if (!path) return res.status(404).json({ error: 'Path not found.' });
  if (!path.meesho) {
    return res.status(400).json({ error: `"${path.name}" is not configured for Meesho.` });
  }
  if (isSetPath(path)) {
    return res.status(400).json({ error: 'Set paths are not listed on Meesho.' });
  }

  res.json({ started: true });
  setActiveRun({ marketplace: 'meesho', pathId });
  const log = (text) => broadcast({ type: 'info', text });

  try {
    const variant = await buildOne(path);
    const images = await meeshoImages(pathId);
    broadcast({ type: 'event', event: 'item-start', index: 0, total: 1, sku: variant.sku });
    log(`── Meesho · ${variant.sku} ₹${path.meesho.sellingPrice} ──`);

    const { page } = await getMeeshoSession(log);
    const result = await createListing(page, {
      path,
      variant,
      sku: variant.sku,
      images,
      submit,
      log,
    });

    if (result.ok) {
      broadcast({
        type: 'success',
        text: result.submitted
          ? `Submitted to Meesho: ${variant.sku}`
          : `Filled but not submitted: ${variant.sku} — review it in the browser.`,
      });
    } else {
      // Report what the form actually objected to. Meesho's banner only counts
      // errors, so the field-level text is the only useful thing to surface.
      broadcast({ type: 'error', text: `Meesho refused ${variant.sku}: ${result.problems.join('; ')}` });
    }
    broadcast({ type: 'event', event: 'item-done', index: 0, ok: result.ok, sku: variant.sku });
  } catch (err) {
    broadcast({ type: 'error', text: err.message });
  } finally {
    clearActiveRun();
    broadcast({ type: 'event', event: 'run-finished' });
  }
});

export default router;
