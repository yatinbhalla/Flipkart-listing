import express from 'express';
import fs from 'fs/promises';
import crypto from 'crypto';
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

const SHARED_SLOTS = ['img2', 'img3', 'img4', 'img5'];

/** The path's reused images, with any run-scoped overrides applied. */
async function resolveShared(pathId, overrides = {}) {
  const shared = await sharedImagePaths(pathId);
  return shared.map((file, i) => overrides[SHARED_SLOTS[i]] || file);
}

const hashFile = async (file) =>
  crypto.createHash('md5').update(await fs.readFile(file)).digest('hex');

/**
 * Reject a Front View that is byte-identical to one of the reused images.
 *
 * Flipkart's catalog validation fails the whole listing with
 * CMS_CATALOG_VALIDATION_FAILURE_DUPLICATE_IMAGE_FOUND when two slots hold the same
 * photo — and it only surfaces at QC, long after the run reported success. Cheaper
 * to catch it here: the form is otherwise perfectly valid, so nothing else warns.
 */
async function findDuplicateImages(fronts, shared) {
  const sharedHashes = new Map();
  for (const [i, file] of shared.entries()) {
    if (file) sharedHashes.set(await hashFile(file), `reused slot ${i + 2}`);
  }
  const clashes = [];
  for (const front of fronts) {
    const hit = sharedHashes.get(await hashFile(front));
    if (hit) clashes.push(`${front.split(/[\\/]/).pop()} is the same image as your ${hit}`);
  }
  return clashes;
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

    // Append the SKU to Model Name when the path asks for it. This has to happen
    // here rather than in the stored copy: the SKU is allocated per listing, so a
    // baked-in one would be identical across every listing on the path — and it must
    // come after the copy is merged, since the copy carries its own modelName.
    if (path.appendSkuToModelName && v.modelName && !v.modelName.includes(v.sku)) {
      v.modelName = `${v.modelName} ${v.sku}`;
    }

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

/**
 * POST /api/run/send-to-qc — submit a draft that was left for review.
 *
 * The normal flow ends on a validated draft so a human can look at it; this is how
 * that draft gets submitted afterwards without rebuilding it. Body: { url } to open
 * the draft first, otherwise it acts on whatever the browser is showing.
 *
 * Uses a real Playwright click: Flipkart's React buttons ignore a programmatic
 * element.click(), which looks like a successful submit that never happened.
 */
router.post('/send-to-qc', async (req, res) => {
  const log = (text) => broadcast({ type: 'info', text });
  try {
    const { page } = await getSession(log);
    if (req.body?.url) {
      await page.goto(String(req.body.url), { waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(10000);
    }
    const { problems, submittable } = await L.verifyReady(page);
    if (!submittable) {
      return res.status(400).json({ error: `Not submittable — ${problems.join('; ')}` });
    }
    await L.sendToQc(page, log);
    broadcast({ type: 'success', text: 'Sent to QC.' });
    res.json({ sent: true });
  } catch (err) {
    broadcast({ type: 'error', text: err.message });
    res.status(500).json({ error: err.message });
  }
});

// ─── POST /api/run — drive the real listings ─────────────────────────────────
// `frontImages` is an array of absolute paths: one listing per image, run
// sequentially in a single browser session.
router.post('/', async (req, res) => {
  if (getActiveRun()) {
    return res.status(409).json({ error: 'A run is already in progress.' });
  }

  const {
    pathId,
    frontImages = [],
    variantImages = {},
    sendToQc = false,
    // How many times to repeat the whole selection. Flipkart, unlike Meesho, accepts
    // any number of listings carrying the same photo, so 5 images with repeat 4 means
    // 20 listings — each still gets its own freshly allocated SKU.
    repeat = 1,
    // One-off replacements for the reused slots, keyed img2..img5. Scoped to this
    // run only — the path's stored images are left alone, so a one-listing swap
    // leaves no residue to remember to undo.
    sharedOverrides = {},
  } = req.body;
  const path = await getPath(pathId);
  if (!path) return res.status(404).json({ error: 'Path not found.' });

  const selected = Array.isArray(frontImages) ? frontImages : [frontImages];
  if (!selected.length) {
    return res.status(400).json({ error: 'Select at least one Front View image.' });
  }
  if (selected.length > MAX_BATCH) {
    return res.status(400).json({ error: `Too many images — the limit is ${MAX_BATCH} per run.` });
  }

  const cycles = Math.min(Math.max(Number(repeat) || 1, 1), 99);
  // Repeat the selection as a whole cycle rather than consecutively per image, so a
  // run that is stopped part-way has produced a balanced spread of the set.
  const fronts = Array.from({ length: cycles }, () => selected).flat();

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

  // …and before building a listing Flipkart will only reject at QC.
  try {
    const shared = await resolveShared(pathId, sharedOverrides);
    // Check the distinct selection, not the repeated list — repeats are deliberate
    // here and hashing the same file 99 times proves nothing.
    const clashes = await findDuplicateImages(
      [...new Set([...selected, ...Object.values(variantImages)])],
      shared,
    );
    if (clashes.length) {
      return res.status(400).json({
        error:
          `Duplicate image: ${clashes.join('; ')}. Flipkart fails the whole listing at QC ` +
          `(DUPLICATE_IMAGE_FOUND) when two slots hold the same photo — pick a different Front View.`,
      });
    }
  } catch (err) {
    return res.status(400).json({ error: `Could not read the images: ${err.message}` });
  }

  setActiveRun(pathId);
  res.json({ started: true, total: fronts.length, images: selected.length, cycles });

  const log = (text) => broadcast({ type: 'info', text });
  const fail = (text) => broadcast({ type: 'error', text });
  const done = [];
  const failed = [];

  try {
    const shared = await resolveShared(pathId, sharedOverrides);
    if (shared.some((p) => !p)) {
      throw new Error('Images 2–5 are not uploaded for this path. Add them in Path settings.');
    }
    for (const [slot, file] of Object.entries(sharedOverrides)) {
      log(`Using a one-off image for ${slot}: ${String(file).split(/[\\/]/).pop()}`);
    }

    const { page } = await getSession(log);
    if (cycles > 1) {
      log(`Repeating ${selected.length} image(s) × ${cycles} = ${fronts.length} listings.`);
    }
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

        await L.fillTabs(page, path, parent, log);
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
