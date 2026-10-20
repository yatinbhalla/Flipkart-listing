import express from 'express';
import fs from 'fs/promises';
import path from 'path';
import sharp from 'sharp';
import { broadcast } from '../index.js';
import { getPath, resolveVariant, sharedImagePaths } from '../store.js';
import { buildImagePrompt } from '../../ai/imagePrompt.js';
import { generateImage, imageProvidersReady } from '../../ai/images.js';
import { validateGenerated } from '../../images/validate.js';
import { MAX_BATCH } from '../constants.js';

const router = express.Router();

/** Same folder uploaded front images land in, so the run route needs no new concept. */
const RUN_UPLOADS = path.resolve('data/runs');

/** How many generations run at once. Enough to be quick, few enough to stay polite. */
const CONCURRENCY = 3;

/**
 * The photo the model re-scenes.
 *
 * The first of the path's stored slots, which is the Close Up Shot — the one that
 * shows the fabric and the border most clearly, and therefore the one that carries
 * the most of what must survive the edit. Falls through the slots so a path missing
 * slot 2 still works.
 */
async function referenceFor(pathId) {
  const slots = await sharedImagePaths(pathId);
  const found = slots.find(Boolean);
  if (!found) {
    throw new Error(
      'This path has no saved images to work from. Generated fronts are re-scened from ' +
        'a real photo of the product, so upload slots 2–5 in Path settings first.',
    );
  }
  return found;
}

/** One generated, validated image written next to the uploaded ones. */
async function makeOne({ cfg, pathId, variant, index, reference, others, log }) {
  const prompt = buildImagePrompt(cfg, variant, index);
  const { buffer, mime, provider, model } = await generateImage({ referenceFile: reference, prompt, log });

  await fs.mkdir(RUN_UPLOADS, { recursive: true });
  const ext = mime.includes('jpeg') ? 'jpg' : 'png';
  const file = path.join(RUN_UPLOADS, `${Date.now()}_gen_${pathId}_${index}.${ext}`);
  await fs.writeFile(file, buffer);

  const checked = await validateGenerated(file, { against: reference, others });
  // `name` is what the grid fetches through /api/images/file; `file` is the absolute
  // path the run route wants, exactly as /api/uploads/front returns it.
  return { ...checked, name: path.basename(checked.file), index, provider, model, prompt };
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
  const { pathId, count = 1 } = req.body || {};
  const cfg = await getPath(pathId);
  if (!cfg) return res.status(404).json({ error: 'Path not found.' });

  const ready = imageProvidersReady();
  if (!ready.length) {
    return res.status(400).json({
      error:
        'No image provider is configured. Add CLOUDFLARE_ACCOUNT_ID and ' +
        'CLOUDFLARE_API_TOKEN (free allowance covers about 57 images a day), or ' +
        'OPENAI_API_KEY, to .env and restart.',
    });
  }

  const n = Math.min(Math.max(Number(count) || 1, 1), MAX_BATCH);
  let reference;
  try {
    reference = await referenceFor(pathId);
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
    const made = await makeOne({ cfg, pathId, variant, index: i, reference, others: done, log });
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
  const { pathId, index = 0, others = [] } = req.body || {};
  const cfg = await getPath(pathId);
  if (!cfg) return res.status(404).json({ error: 'Path not found.' });
  if (!imageProvidersReady().length) {
    return res.status(400).json({ error: 'No image provider is configured. See .env.example.' });
  }

  try {
    const reference = await referenceFor(pathId);
    const variant = resolveVariant(cfg, cfg.variants[0]);
    const log = (text) => broadcast({ type: 'info', text });
    // A different index gives a different scene, so pressing regenerate actually
    // changes something rather than redrawing the same instruction.
    const made = await makeOne({
      cfg,
      pathId,
      variant,
      index: Number(index) + Math.floor(Math.random() * 7) + 1,
      reference,
      others: Array.isArray(others) ? others : [],
      log,
    });
    res.json({ image: { ...made, index: Number(index) } });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
