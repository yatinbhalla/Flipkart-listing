import express from 'express';
import fs from 'fs/promises';
import path from 'path';
import sharp from 'sharp';
import { broadcast } from '../index.js';
import {
  getPath,
  resolveVariant,
  sharedImagePaths,
  skuFolder,
  variantSharedImagePaths,
} from '../store.js';
import { buildImagePrompt } from '../../ai/imagePrompt.js';
import { generateImage, imageProvidersReady, describeUsage } from '../../ai/images.js';
import { validateGenerated } from '../../images/validate.js';
import { verifyProduct, verdictFlag } from '../../images/verify.js';
import { MAX_BATCH } from '../constants.js';

const router = express.Router();

/** Where uploaded Front Views land, and where the old flat generated files still are. */
const RUN_UPLOADS = path.resolve('data/runs');

/**
 * Generated images are kept, not spooled.
 *
 * They used to be written into data/runs beside the debug screenshots, the page
 * dumps and the daily logs, under a name that was a millisecond timestamp — which
 * made them look like scratch and made finding last month's good one impossible.
 * An image costs real money to make and stays usable for as long as the product is
 * listed, so each one is filed under the SKU code it was made for and stays there.
 */
const GENERATED = path.resolve('data/generated');

/** How many generations run at once. Enough to be quick, few enough to stay polite. */
const CONCURRENCY = 3;

/** The edits endpoint takes 16; three views of one product is plenty and keeps the bill down. */
const MAX_REFERENCES = 3;

/**
 * A library folder name from a request. Never a path.
 *
 * Rejects rather than sanitises: a request that does not already look exactly like
 * something skuFolder() produced is a request for a folder that does not exist, and
 * quietly rewriting it into one that might is how a traversal becomes a near miss.
 */
const safeSku = (raw) => {
  const s = String(raw || '');
  return /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(s) ? s : null;
};

/**
 * Which variant this batch is for.
 *
 * A variation path lists several products at once and every one of them needs its
 * own front images — its own colour, its own pack size, its own photographs. The
 * generate endpoint used to resolve `cfg.variants[0]` unconditionally, so a
 * four-colour path generated four batches of the first colour and the seller had
 * nothing to put against the other three.
 *
 * The key is matched against the path's own variants rather than trusted, because
 * it reaches the filesystem through variantSharedImagePaths().
 */
function pickVariant(cfg, variantKey) {
  const row =
    cfg.variants.find((v) => String(v.key) === String(variantKey)) || cfg.variants[0];
  return { row, variant: resolveVariant(cfg, row) };
}

/**
 * The photographs the model works from.
 *
 * This used to take `slots.find(Boolean)` — always slot 2 — and that was the bug
 * behind every "it looks generated from text" result. Slot 2 on these paths is the
 * marketing infographic: a page of feature icons, dimension diagrams and headings.
 * Handed that and told to keep the product identical, the model had no product to
 * copy and fell back on the words in the prompt.
 *
 * No heuristic reliably tells a product photo from a graphic here — tried, and the
 * one statistic that separated them would misclassify any product shot on a white
 * background, which is most e-commerce photography. So the seller chooses, the
 * choice is remembered on the path, and the fallback is merely a starting point
 * rather than a guess dressed as an answer.
 *
 * Resolved per variant: a variant with its own slot images is a different colour or
 * a different pack, and generating it from the parent's photographs would produce
 * the parent's product under the variant's SKU.
 */
async function referencesFor(pathId, cfg, requested, row) {
  const base = await sharedImagePaths(pathId); // [img2, img3, img4, img5], null where absent
  const slots =
    row && row !== cfg.variants[0] ? await variantSharedImagePaths(pathId, row.key, base) : base;
  const byName = { img2: slots[0], img3: slots[1], img4: slots[2], img5: slots[3] };

  const wanted =
    (Array.isArray(requested) && requested.length ? requested : cfg.imageReferenceSlots) || [];
  const chosen = wanted.map((s) => byName[s]).filter(Boolean);
  if (chosen.length) return chosen.slice(0, MAX_REFERENCES);

  // Nothing chosen yet: slot 3 first, because on every path inspected it is the
  // close product photograph while slot 2 is the infographic and slot 5 the brand
  // card. Still only a default — the picker is what makes it right.
  const fallback = [byName.img3, byName.img4, byName.img2, byName.img5].filter(Boolean);
  if (!fallback.length) {
    throw new Error(
      'This path has no saved images to work from. Generated fronts are re-photographed ' +
        'from real photos of the product, so upload slots 2–5 in Path settings first.',
    );
  }
  return fallback.slice(0, 1);
}

/** `20261117-143905-k3f` — sorts chronologically, and two batches in one second do not collide. */
function stamp() {
  const d = new Date();
  const p = (n, w = 2) => String(n).padStart(w, '0');
  const when = `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
  return `${when}-${Math.random().toString(36).slice(2, 5)}`;
}

/** One generated, validated image, filed under its SKU. */
async function makeOne({ cfg, sku, variant, index, references, others, log }) {
  const prompt = buildImagePrompt(cfg, variant, index);
  const { buffer, mime, provider, model, usage } = await generateImage({
    referenceFiles: references,
    prompt,
    log,
  });

  const dir = path.join(GENERATED, sku);
  await fs.mkdir(dir, { recursive: true });
  const ext = mime.includes('jpeg') ? 'jpg' : 'png';
  const file = path.join(dir, `${sku}_${stamp()}.${ext}`);
  await fs.writeFile(file, buffer);

  // What it cost, from the API's own usage rather than an estimate — so a batch can
  // be priced after the fact and a quality setting judged against what it charged.
  const spend = describeUsage(usage);
  if (spend) log(`  ${sku} image ${index + 1}: ${spend.label}`);

  const checked = await validateGenerated(file, { against: references[0], others });

  // The offline checks cannot tell whether this is still the seller's product, so a
  // model is asked. Costs about a half-percent of the image it is checking.
  const verdict = await verifyProduct({ references, candidate: checked.file, log });
  const flag = verdictFlag(verdict);
  if (flag) checked.flags.push(flag);
  checked.ok = !checked.flags.some((f) => f.level === 'error');
  // `name` and `sku` are what the grid fetches through /api/images/file; `file` is
  // the absolute path the run route wants, exactly as /api/uploads/front returns it.
  return {
    ...checked,
    sku,
    name: path.basename(checked.file),
    index,
    provider,
    model,
    prompt,
    cost: spend?.dollars ?? null,
    usage: spend?.label ?? null,
  };
}

/** Run `jobs` with a small pool, preserving order in the result. */
async function pooled(jobs, limit) {
  const out = new Array(jobs.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, jobs.length) }, async () => {
      while (next < jobs.length) {
        const i = next++;
        try {
          out[i] = await jobs[i]();
        } catch (err) {
          out[i] = { index: i, error: err.message, flags: [], ok: false };
        }
      }
    }),
  );
  return out;
}

// ─── Serving generated images ─────────────────────────────────────────────────
/**
 * Serves one image file and nothing else.
 *
 * `data/runs` holds debug screenshots and the daily logs and sits beside directories
 * that contain the seller's addresses, so this resolves the path and refuses
 * anything that did not land inside the folder it meant to read, rather than
 * trusting the name. Same reasoning as the shared-image route, which whitelists
 * slots so config.json can never be served.
 */
async function sendImage(req, res, root, name) {
  const file = path.resolve(root, path.basename(String(name || '')));
  if (!file.startsWith(root + path.sep) || !/\.(png|jpe?g|webp)$/i.test(file)) {
    return res.status(400).end();
  }
  if (!(await fs.stat(file).catch(() => null))) return res.status(404).end();

  const w = Math.min(Number(req.query.w) || 0, 512);
  res.set('Cache-Control', 'public, max-age=31536000, immutable');
  if (!w) return res.sendFile(file);
  try {
    res
      .type('image/webp')
      .send(await sharp(file).resize(w, w, { fit: 'cover' }).webp({ quality: 80 }).toBuffer());
  } catch {
    res.sendFile(file);
  }
}

// An image out of a SKU's library.
router.get('/file/:sku/:name', async (req, res) => {
  const sku = safeSku(req.params.sku);
  if (!sku) return res.status(400).end();
  await sendImage(req, res, path.join(GENERATED, sku), req.params.name);
});

// The flat form, for images generated before they were filed by SKU.
router.get('/file/:name', (req, res) => sendImage(req, res, RUN_UPLOADS, req.params.name));

// ─── GET /api/images/library/:sku — what has already been made for this SKU ───
/**
 * Lets a batch reuse what earlier batches produced instead of paying for it twice.
 * The grid seeds itself from this, so the saved images sit beside the new ones under
 * the same tick boxes.
 */
router.get('/library/:sku', async (req, res) => {
  const sku = safeSku(req.params.sku);
  if (!sku) return res.status(400).json({ error: 'Bad SKU.' });

  const dir = path.join(GENERATED, sku);
  const names = (await fs.readdir(dir).catch(() => [])).filter((n) => /\.(png|jpe?g|webp)$/i.test(n));

  const images = [];
  for (const name of names) {
    const file = path.join(dir, name);
    const [stat, meta] = await Promise.all([
      fs.stat(file).catch(() => null),
      sharp(file).metadata().catch(() => ({})),
    ]);
    if (!stat) continue;
    images.push({
      sku,
      name,
      file,
      saved: true,
      ok: true,
      flags: [],
      width: meta.width ?? null,
      height: meta.height ?? null,
      madeAt: stat.mtimeMs,
    });
  }
  // Newest first: the last batch is the one most likely to be reused.
  images.sort((a, b) => b.madeAt - a.madeAt);
  res.json({ sku, images });
});

// ─── POST /api/images/generate ────────────────────────────────────────────────
router.post('/generate', async (req, res) => {
  const { pathId, count = 1, referenceSlots, variantKey } = req.body || {};
  const cfg = await getPath(pathId);
  if (!cfg) return res.status(404).json({ error: 'Path not found.' });

  const ready = imageProvidersReady();
  if (!ready.length) {
    return res.status(400).json({
      error:
        'No image provider is configured. Add OPENAI_API_KEY to .env and restart.',
    });
  }

  const n = Math.min(Math.max(Number(count) || 1, 1), MAX_BATCH);
  const { row, variant } = pickVariant(cfg, variantKey);
  const sku = skuFolder(cfg, row);

  let references;
  try {
    references = await referencesFor(pathId, cfg, referenceSlots, row);
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }

  const log = (text) => broadcast({ type: 'info', text });

  // Answers when the work is done rather than immediately. Progress is already
  // visible in the live log, and returning the images in the response saves
  // threading a second event channel through the client for a job that takes
  // minutes at most — against a listing run that takes hours.
  log(
    `Generating ${n} front image${n === 1 ? '' : 's'} for ${sku} — ` +
      `${row.label || cfg.name} (via ${ready.join(' then ')})…`,
  );

  const done = [];
  const jobs = Array.from({ length: n }, (_, i) => async () => {
    const made = await makeOne({ cfg, sku, variant, index: i, references, others: done, log });
    if (made.file) done.push(made.file);
    log(`  ${sku} image ${i + 1}/${n} ${made.ok ? 'ready' : 'needs a look'}`);
    return made;
  });

  try {
    const images = await pooled(jobs, CONCURRENCY);
    const good = images.filter((i) => i.ok).length;
    broadcast({
      type: good ? 'success' : 'error',
      text: `${sku}: generated ${good}/${n} image${n === 1 ? '' : 's'}.`,
    });
    res.json({ sku, variantKey: row.key, images });
  } catch (err) {
    broadcast({ type: 'error', text: err.message });
    res.status(500).json({ error: err.message });
  }
});

// ─── POST /api/images/regenerate ──────────────────────────────────────────────
/** One image again, for the seller's "this one is wrong" button. */
router.post('/regenerate', async (req, res) => {
  const { pathId, index = 0, others = [], referenceSlots, variantKey } = req.body || {};
  const cfg = await getPath(pathId);
  if (!cfg) return res.status(404).json({ error: 'Path not found.' });
  if (!imageProvidersReady().length) {
    return res.status(400).json({ error: 'No image provider is configured. See .env.example.' });
  }

  try {
    const { row, variant } = pickVariant(cfg, variantKey);
    const references = await referencesFor(pathId, cfg, referenceSlots, row);
    const log = (text) => broadcast({ type: 'info', text });
    // A different index gives a different scene, so pressing regenerate actually
    // changes something rather than redrawing the same instruction.
    const made = await makeOne({
      cfg,
      sku: skuFolder(cfg, row),
      variant,
      index: Number(index) + Math.floor(Math.random() * 7) + 1,
      references,
      others: Array.isArray(others) ? others : [],
      log,
    });
    res.json({ image: { ...made, index: Number(index) } });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
