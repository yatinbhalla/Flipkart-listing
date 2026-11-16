import express from 'express';
import fs from 'fs/promises';
import path from 'path';
import sharp from 'sharp';
import { broadcast } from '../index.js';
import { getPath, resolveVariant, sharedImagePaths } from '../store.js';
import { buildImagePrompt } from '../../ai/imagePrompt.js';
import { generateImage, imageProvidersReady, describeUsage } from '../../ai/images.js';
import { validateGenerated } from '../../images/validate.js';
import { verifyProduct, verdictFlag } from '../../images/verify.js';
import { MAX_BATCH } from '../constants.js';

const router = express.Router();

/** Same folder uploaded front images land in, so the run route needs no new concept. */
const RUN_UPLOADS = path.resolve('data/runs');

/** How many generations run at once. Enough to be quick, few enough to stay polite. */
const CONCURRENCY = 3;

/** The edits endpoint takes 16; three views of one product is plenty and keeps the bill down. */
const MAX_REFERENCES = 3;

/**
 * The photo the model re-scenes.
 *
 * The first of the path's stored slots, which is the Close Up Shot — the one that
 * shows the fabric and the border most clearly, and therefore the one that carries
 * the most of what must survive the edit. Falls through the slots so a path missing
 * slot 2 still works.
 */
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
 */
async function referencesFor(pathId, cfg, requested) {
  const slots = await sharedImagePaths(pathId); // [img2, img3, img4, img5], null where absent
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

/** One generated, validated image written next to the uploaded ones. */
async function makeOne({ cfg, pathId, variant, index, references, others, log }) {
  const prompt = buildImagePrompt(cfg, variant, index);
  const { buffer, mime, provider, model, usage } = await generateImage({
    referenceFiles: references,
    prompt,
    log,
  });

  await fs.mkdir(RUN_UPLOADS, { recursive: true });
  const ext = mime.includes('jpeg') ? 'jpg' : 'png';
  const file = path.join(RUN_UPLOADS, `${Date.now()}_gen_${pathId}_${index}.${ext}`);
  await fs.writeFile(file, buffer);

  // What it cost, from the API's own usage rather than an estimate — so a batch can
  // be priced after the fact and a quality setting judged against what it charged.
  const spend = describeUsage(usage);
  if (spend) log(`  image ${index + 1}: ${spend.label}`);

  const checked = await validateGenerated(file, { against: references[0], others });

  // The offline checks cannot tell whether this is still the seller's product, so a
  // model is asked. Costs about a half-percent of the image it is checking.
  const verdict = await verifyProduct({ reference: references[0], candidate: checked.file, log });
  const flag = verdictFlag(verdict);
  if (flag) checked.flags.push(flag);
  checked.ok = !checked.flags.some((f) => f.level === 'error');
  // `name` is what the grid fetches through /api/images/file; `file` is the absolute
  // path the run route wants, exactly as /api/uploads/front returns it.
  return {
    ...checked,
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

// ─── GET /api/images/file/:name — show a generated image in the review grid ──
/**
 * Serves one file out of data/runs, and nothing else.
 *
 * `data/runs` also holds debug screenshots and the daily logs, and sits beside
 * directories that contain the seller's addresses — so this resolves the path and
 * refuses anything that did not land inside the uploads folder, rather than
 * trusting the name. Same reasoning as the shared-image route, which whitelists
 * slots so config.json can never be served.
 */
router.get('/file/:name', async (req, res) => {
  const name = path.basename(String(req.params.name || ''));
  const file = path.resolve(RUN_UPLOADS, name);
  if (!file.startsWith(RUN_UPLOADS + path.sep) || !/\.(png|jpe?g|webp)$/i.test(file)) {
    return res.status(400).end();
  }
  if (!(await fs.stat(file).catch(() => null))) return res.status(404).end();

  const w = Math.min(Number(req.query.w) || 0, 512);
  res.set('Cache-Control', 'public, max-age=31536000, immutable');
  if (!w) return res.sendFile(file);
  try {
    res.type('image/webp').send(await sharp(file).resize(w, w, { fit: 'cover' }).webp({ quality: 80 }).toBuffer());
  } catch {
    res.sendFile(file);
  }
});

// ─── POST /api/images/generate ────────────────────────────────────────────────
router.post('/generate', async (req, res) => {
  const { pathId, count = 1, referenceSlots } = req.body || {};
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
  let references;
  try {
    references = await referencesFor(pathId, cfg, referenceSlots);
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }

  const variant = resolveVariant(cfg, cfg.variants[0]);
  const log = (text) => broadcast({ type: 'info', text });

  // Answers when the work is done rather than immediately. Progress is already
  // visible in the live log, and returning the images in the response saves
  // threading a second event channel through the client for a job that takes
  // minutes at most — against a listing run that takes hours.
  log(`Generating ${n} front image${n === 1 ? '' : 's'} for ${cfg.name} (via ${ready.join(' then ')})…`);

  const done = [];
  const jobs = Array.from({ length: n }, (_, i) => async () => {
    const made = await makeOne({ cfg, pathId, variant, index: i, references, others: done, log });
    if (made.file) done.push(made.file);
    log(`  image ${i + 1}/${n} ${made.ok ? 'ready' : 'needs a look'}`);
    return made;
  });

  try {
    const images = await pooled(jobs, CONCURRENCY);
    const good = images.filter((i) => i.ok).length;
    broadcast({ type: good ? 'success' : 'error', text: `Generated ${good}/${n} image${n === 1 ? '' : 's'}.` });
    res.json({ images });
  } catch (err) {
    broadcast({ type: 'error', text: err.message });
    res.status(500).json({ error: err.message });
  }
});

// ─── POST /api/images/regenerate ──────────────────────────────────────────────
/** One image again, for the seller's "this one is wrong" button. */
router.post('/regenerate', async (req, res) => {
  const { pathId, index = 0, others = [], referenceSlots } = req.body || {};
  const cfg = await getPath(pathId);
  if (!cfg) return res.status(404).json({ error: 'Path not found.' });
  if (!imageProvidersReady().length) {
    return res.status(400).json({ error: 'No image provider is configured. See .env.example.' });
  }

  try {
    const references = await referencesFor(pathId, cfg, referenceSlots);
    const variant = resolveVariant(cfg, cfg.variants[0]);
    const log = (text) => broadcast({ type: 'info', text });
    // A different index gives a different scene, so pressing regenerate actually
    // changes something rather than redrawing the same instruction.
    const made = await makeOne({
      cfg,
      pathId,
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
