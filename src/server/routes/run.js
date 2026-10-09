import express from 'express';
import fs from 'fs/promises';
import crypto from 'crypto';
import {
  broadcast,
  getActiveRun,
  setActiveRun,
  clearActiveRun,
  throwIfStopped,
  RunStopped,
  requestStop,
} from '../index.js';
import {
  getPath,
  allocateSku,
  sharedImagePaths,
  variantSharedImagePaths,
  resolveVariant,
} from '../store.js';
import { getSession } from '../../browser/session.js';
import * as L from '../../browser/listing.js';
import { MAX_BATCH, variantNeedsImage } from '../constants.js';
import { describeListing, listingSkus, fitModelName } from '../format.js';
import { PARTNERS, verticalFor } from '../partners.js';
import { runMeeshoBatch, meeshoBlocker } from './meesho.js';

export { variantNeedsImage };

const router = express.Router();

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
/**
 * `index` selects which of the stored copy variants this listing uses.
 *
 * A batch lists the same product many times over with one image each; taking
 * pool[index % size] means those listings go out with different wording instead of
 * the same paragraph repeated, without costing an AI call during the run.
 */
async function buildListing(path, index = 0) {
  const out = [];
  for (const variant of path.variants) {
    if (!variant.copy && !variant.copyPool?.length) {
      throw new Error(
        `No saved copy for variant "${variant.label || variant.key}". ` +
          `Generate it once from the Copy panel, then run.`,
      );
    }
    const v = resolveVariant(path, variant);
    v.sku = await allocateSku(variant.skuPattern || path.skuPattern);
    v.modelNumber = v.sku; // Model Number mirrors the SKU exactly.
    const pool = variant.copyPool?.length ? variant.copyPool : [variant.copy];
    Object.assign(v, pool[index % pool.length]);

    // Append the SKU to Model Name when the path asks for it. This has to happen
    // here rather than in the stored copy: the SKU is allocated per listing, so a
    // baked-in one would be identical across every listing on the path — and it must
    // come after the copy is merged, since the copy carries its own modelName.
    if (path.appendSkuToModelName && v.modelName && !v.modelName.includes(v.sku)) {
      v.modelName = fitModelName(v.modelName, ` ${v.sku}`);
    } else if (v.modelName) {
      v.modelName = fitModelName(v.modelName);
    }

    out.push(v);
  }
  return out;
}

/**
 * POST /api/run/stop — end the run at its next checkpoint.
 *
 * Deliberately cooperative rather than killing the browser: the session stays
 * signed in, and whatever is on screen can be looked at and deleted. The run stops
 * between steps, so the wait is seconds rather than the rest of the batch.
 */
router.post('/stop', (_req, res) => {
  if (!getActiveRun()) return res.status(409).json({ error: 'No run is in progress.' });
  requestStop();
  broadcast({ type: 'info', text: 'Stopping after the current step…' });
  res.json({ stopping: true });
});

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
    // Which storefront to list on. Flipkart and Shopsy are separate catalogues
    // behind one Seller Hub: listing on one does not list on the other, so the same
    // path is run once per storefront.
    partner = 'flipkart',
    // One upload, listed on several storefronts in turn. The same images and the
    // same repeat count go to each; every listing still gets its own SKU.
    partners,
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
  const storefronts = (Array.isArray(partners) && partners.length ? partners : [partner]).map((p) =>
    String(p).toLowerCase(),
  );
  const known = [...PARTNERS, 'meesho'];
  const unknown = storefronts.find((p) => !known.includes(p));
  if (unknown) return res.status(400).json({ error: `Unknown storefront "${unknown}".` });

  // A path may declare the storefronts it belongs on. Some structures simply do not
  // exist everywhere: the baby towel variation varies by Brand Color, and Shopsy's
  // Bath Towel vertical offers only Pack of and Size as axes — so a Shopsy run filled
  // three tabs over four minutes and then failed at the variant step, every time.
  // Refusing here says so in a second instead.
  const allowed = Array.isArray(path.storefronts) && path.storefronts.length ? path.storefronts : null;
  if (allowed) {
    const refused = storefronts.find((p) => !allowed.includes(p));
    if (refused) {
      return res.status(400).json({
        error:
          `"${path.name}" is not listed on ${refused}. It is set up for ${allowed.join(' and ')}.` +
          (refused === 'shopsy' ? ' Shopsy has no Brand Color variant axis on this vertical.' : ''),
      });
    }
  }

  // Meesho is checked BEFORE anything is listed anywhere. Finding out at the
  // handover means a Flipkart batch has already gone out and the run then fails.
  if (storefronts.includes('meesho')) {
    const blocker = meeshoBlocker(path);
    if (blocker) return res.status(400).json({ error: blocker });
  }

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

  // A variant path batches too: listing i takes the i-th Front View from the parent
  // AND from every variant, so N photos per variant produce N listings each
  // carrying the full variant set. It used to be capped at one listing at a time
  // because only a single photo per variant could be supplied.
  //
  // Slots 2-5 stay fixed across the batch, exactly as they do for a plain path —
  // only the Front Views vary per listing.
  const imageVariants = path.variants.filter(variantNeedsImage);
  const variantFronts = {};
  for (const v of imageVariants) {
    const raw = variantImages[v.key];
    const list = (Array.isArray(raw) ? raw : raw ? [raw] : []).filter(Boolean);
    // Repeat per cycle so the variant selections stay aligned with `fronts`.
    variantFronts[v.key] = Array.from({ length: cycles }, () => list).flat();
  }
  const missingVariantImage = imageVariants.filter((v) => !variantFronts[v.key].length);
  if (missingVariantImage.length) {
    return res.status(400).json({
      error: `Front View image missing for: ${missingVariantImage.map((v) => v.label || v.key).join(', ')}`,
    });
  }
  // Counts must match exactly. Zipping a short list would silently pair the wrong
  // photo with the wrong listing, which is invisible until the listings are live.
  const uneven = imageVariants
    .filter((v) => variantFronts[v.key].length !== fronts.length)
    .map((v) => `${v.label || v.key}: ${variantFronts[v.key].length / cycles}`);
  if (uneven.length) {
    return res.status(400).json({
      error:
        `Every variant needs the same number of Front View images — ` +
        `${path.variants[0].label || 'main listing'}: ${selected.length}, ${uneven.join(', ')}.`,
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
      [...new Set([...selected, ...Object.values(variantFronts).flat()])],
      shared,
    );
    // A variant that overrides one of its reused slots is checked against ITS set,
    // not the parent's — otherwise a 1-pack whose Front View is the same photo as
    // its own slot-4 pack shot sails past this guard and dies at QC instead.
    for (const v of path.variants.slice(1)) {
      const list = [...new Set(variantFronts[v.key] || [])];
      if (!list.length) continue;
      const own = await variantSharedImagePaths(pathId, v.key, shared);
      if (own.every((f, i) => f === shared[i])) continue;
      for (const hit of await findDuplicateImages(list, own)) {
        clashes.push(`${v.label || v.key}: ${hit}`);
      }
    }
    if (clashes.length) {
      return res.status(400).json({
        error:
          `Duplicate image: ${clashes.join('; ')}. Flipkart fails the whole listing at QC ` +
          `(DUPLICATE_IMAGE_FOUND) when two slots hold the same photo — pick a different Front View.`,
      });
    }

    // Every variant must go out with the SAME number of photos.
    //
    // A buyer flipping between pack sizes on one product page sees a different
    // number of pictures per option otherwise, and it reads as a broken listing.
    // It is also the quiet failure mode of per-variant overrides: drop an img4 in
    // one variant's folder and forget the others and nothing complains — the run
    // just uploads five photos for one option and four for the next.
    if (imageVariants.length) {
      const counts = [
        { label: `${path.variants[0].label || 'parent'} (parent)`, n: 1 + shared.filter(Boolean).length },
      ];
      for (const v of imageVariants) {
        const own = await variantSharedImagePaths(pathId, v.key, shared);
        counts.push({ label: v.label || v.key, n: 1 + own.filter(Boolean).length });
      }
      const distinct = [...new Set(counts.map((c) => c.n))];
      if (distinct.length > 1) {
        return res.status(400).json({
          error:
            `Variants would get different numbers of images — ` +
            `${counts.map((c) => `${c.label}: ${c.n}`).join(', ')}. ` +
            `Every variant needs the same count, or the product page shows a different ` +
            `number of photos per pack size.`,
        });
      }
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
  // Everything listed across every storefront, for the finishing event.
  const allDone = [];

  try {
    const shared = await resolveShared(pathId, sharedOverrides);
    // Trailing slots may be empty — see sharedImagesReady(). A hole in the middle
    // is still rejected, because that is what a failed upload looks like.
    if (!shared[0]) {
      throw new Error('Images 2–5 are not uploaded for this path. Add them in Path settings.');
    }
    const gap = shared.findIndex((p) => !p);
    if (gap !== -1 && shared.slice(gap).some(Boolean)) {
      throw new Error(
        `Reused image slot ${gap + 2} is empty but a later slot is filled — ` +
          `an upload probably failed. Re-check the images for this path.`,
      );
    }
    for (const [slot, file] of Object.entries(sharedOverrides)) {
      log(`Using a one-off image for ${slot}: ${String(file).split(/[\\/]/).pop()}`);
    }

    if (cycles > 1) {
      log(`Repeating ${selected.length} image(s) × ${cycles} = ${fronts.length} listings.`);
    }

    for (const storefront of storefronts) {
      // Each storefront gets the whole batch before the next one starts.
      if (storefronts.length > 1) log(`━━ ${storefront.toUpperCase()} ━━`);

      if (storefront === 'meesho') {
        const listed = await runMeeshoBatch({ path, pathId, fronts, submit: sendToQc, log });
        allDone.push(...listed);
        continue;
      }

      done.length = 0;
      failed.length = 0;
      const { page } = await getSession(log);
      broadcast({ type: 'event', event: 'batch-start', total: fronts.length });

    for (let i = 0; i < fronts.length; i++) {
      const front = fronts[i];
      const label = `listing ${i + 1}/${fronts.length}`;

      try {
        // Between listings: the cheapest place to stop, since nothing is half-built.
        throwIfStopped();

        // SKUs are allocated per listing, so each one in the batch is unique.
        const resolved = await buildListing(path, i);
        const parent = resolved[0];
        broadcast({
          type: 'event',
          event: 'item-start',
          index: i,
          total: fronts.length,
          sku: parent.sku,
          skus: listingSkus(resolved),
        });
        log(`── ${label} · ${describeListing(resolved)} ──`);

        // A path may pin the full category path for either storefront. Addressing a
        // vertical by its whole branch rather than a leaf name is what stops two
        // same-named leaves in different branches being confused for each other.
        const wantedVertical =
          storefront === 'shopsy'
            ? path.shopsyVerticalPath || verticalFor(path.vertical, storefront)
            : path.verticalPath || path.vertical;
        await L.selectVertical(page, wantedVertical, log, { partner: storefront });
        throwIfStopped();
        await L.selectBrand(page, path.brand, log);
        throwIfStopped();
        // Checked before the images especially: a wrong image is the reason to stop,
        // and stopping here means nothing has been uploaded yet.
        await L.uploadImages(page, [front, ...shared], log);
        throwIfStopped();

        await L.fillTabs(page, path, parent, log, { partner: storefront });
        throwIfStopped();
        // Slots 2–5 per variant: the path's reused set, with any per-variant file
        // (typically the slot-4 pack-size shot) swapped in.
        const variantShared = {};
        for (const v of path.variants.slice(1)) {
          variantShared[v.key] = await variantSharedImagePaths(pathId, v.key, shared);
        }
        // This listing's slice of the batch: the i-th Front View for each variant.
        const listingVariantImages = {};
        for (const v of imageVariants) listingVariantImages[v.key] = variantFronts[v.key][i];
        await L.fillVariants(
          page, resolved, log, path.variantColumns || null, listingVariantImages, shared, variantShared,
        );

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

        done.push({ sku: parent.sku, text: describeListing(resolved), skus: listingSkus(resolved) });
        log(`${label} done: ${describeListing(resolved)}`);
        broadcast({
          type: 'event',
          event: 'item-done',
          index: i,
          sku: parent.sku,
          skus: listingSkus(resolved),
          ok: true,
        });
      } catch (err) {
        // A stop is a decision, not a failure: end the batch quietly rather than
        // logging it as an error and pressing on to the next image.
        if (err instanceof RunStopped) {
          broadcast({
            type: 'event',
            event: 'item-done',
            index: i,
            ok: false,
            error: 'stopped',
          });
          broadcast({
            type: 'info',
            text:
              `Stopped during ${label}. Anything already on screen is left as a ` +
              `part-built draft — delete it in the browser if it is not wanted.`,
          });
          break;
        }
        // One bad listing should not abandon the other 49.
        failed.push({ index: i, error: err.message });
        fail(`${label} failed: ${err.message}`);
        broadcast({ type: 'event', event: 'item-done', index: i, ok: false, error: err.message });
      }
    }

      const where = storefronts.length > 1 ? `${storefront}: ` : '';
      const summary = `${done.length} listed${failed.length ? `, ${failed.length} failed` : ''}`;
      broadcast({
        type: failed.length ? 'error' : 'success',
        text: sendToQc
          ? `${where}Batch finished — ${summary}. Sent to QC: ${done.map((d) => d.text).join(', ') || 'none'}`
          : `${where}Batch finished — ${summary}. Drafts left for review: ${
              done.map((d) => d.text).join(', ') || 'none'
            }`,
      });
      allDone.push(...done.map((d) => d.text));
    }
  } catch (err) {
    fail(err.message);
  } finally {
    clearActiveRun();
    broadcast({ type: 'event', event: 'run-finished', done: allDone, failed });
  }
});

export default router;
