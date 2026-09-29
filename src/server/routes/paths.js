import express from 'express';
import multer from 'multer';
import fs from 'fs/promises';
import path from 'path';
import sharp from 'sharp';
import {
  listPaths,
  getPath,
  savePath,
  deletePath,
  sharedImagesDir,
  resolveVariant,
  SHARED_SLOTS,
} from '../store.js';
import { ensureMinSize, ensureFlipkartFormat } from '../../images/normalize.js';
import { generateCopy, generateCopyPool } from '../../ai/content.js';
import { composeCopyPool } from '../../ai/compose.js';
import { COPY_POOL_SIZE } from '../constants.js';
import { broadcast } from '../index.js';

const router = express.Router();

router.get('/', async (_req, res) => res.json(await listPaths()));

router.get('/:id', async (req, res) => {
  const config = await getPath(req.params.id);
  if (!config) return res.status(404).json({ error: 'Path not found.' });
  res.json(config);
});

router.put('/:id', async (req, res) => {
  try {
    res.json(await savePath(req.params.id, req.body));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.delete('/:id', async (req, res) => {
  await deletePath(req.params.id);
  res.json({ ok: true });
});

// ─── POST /:id/copy — generate the copy once and store it on the path ─────────
// WHY store it: regenerating every run costs an AI call per variant, makes a
// Gemini outage or quota limit able to block a listing, and means two listings of
// the same product go out with different words. Generate deliberately, review it,
// then every run just reads it back.
//
// Each variant gets a POOL of distinct copy rather than one version, because a run
// lists the same product many times over with one image each — identical wording on
// all of them wastes the chance to cover different search phrasings. Listing N uses
// pool[N % pool.length], so a batch still makes no AI calls.
//
// Body: { variantKey?: string, force?: boolean, count?: number }
//   variantKey — regenerate just one variant, otherwise all of them
//   force      — overwrite copy that already exists (default: skip those)
//   count      — pool size (default COPY_POOL_SIZE). Regenerating replaces the
//                whole pool, never tops it up: a half-old pool would drift in voice.
//   compose    — build the pool from the path's own attributes instead of calling
//                Gemini. Instant and free, which matters when filling the whole
//                catalogue: thirty versions across every path is ~1,590 calls and
//                runs into the rate limit long before it finishes. Gemini phrases
//                better, so it stays the default for regenerating a single path.
router.post('/:id/copy', async (req, res) => {
  try {
    const config = await getPath(req.params.id);
    if (!config) return res.status(404).json({ error: 'Path not found.' });

    const { variantKey, force = false, count = COPY_POOL_SIZE, compose = false } = req.body || {};
    const size = Math.min(Math.max(Number(count) || COPY_POOL_SIZE, 1), 50);
    const log = (text) => broadcast({ type: 'info', text });
    const written = [];

    for (const variant of config.variants) {
      if (variantKey && variant.key !== variantKey) continue;
      if (variant.copyPool?.length && !force) continue;
      const resolved = resolveVariant(config, variant);
      const pool = compose
        ? composeCopyPool(config, resolved, size)
        : await generateCopyPool(config, resolved, size, log);
      if (compose) log(`Composed ${pool.length} versions for ${variant.label} (no AI call).`);
      variant.copyPool = pool;
      // The first of the pool stays on `copy` so anything reading a single copy —
      // the Copy panel, an older run — keeps working unchanged.
      variant.copy = pool[0];
      written.push(`${variant.key} (${pool.length})`);
    }

    if (!written.length) {
      return res.json({ ...config, _note: 'Copy already exists. Pass force to regenerate.' });
    }

    const saved = await savePath(req.params.id, config);
    broadcast({ type: 'success', text: `Copy saved for: ${written.join(', ')}` });
    res.json(saved);
  } catch (err) {
    broadcast({ type: 'error', text: err.message });
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /:id/images/:slot — serve one reused image so the UI can show it.
 *
 * Deliberately a per-slot endpoint rather than express.static over data/paths: that
 * directory also holds config.json, which carries the seller's manufacturer and
 * packer addresses. The slot name is matched against a fixed list, so the path
 * cannot be steered by the request.
 */
router.get('/:id/images/:slot', async (req, res) => {
  const { slot } = req.params;
  if (!SHARED_SLOTS.includes(slot)) return res.status(404).end();
  try {
    const dir = sharedImagesDir(req.params.id);
    const files = await fs.readdir(dir);
    const hit = files.find((f) => f.startsWith(slot + '.'));
    if (!hit) return res.status(404).end();
    const file = path.join(dir, hit);

    // Fingerprinted by mtime in the URL, so it is safe to cache hard.
    res.set('Cache-Control', 'public, max-age=31536000, immutable');

    // ?w=N returns a thumbnail. The stored images are 1100px+ and often over a
    // megabyte each; sending four of those to fill 51px squares makes switching
    // paths needlessly slow when the point is a quick glance.
    const width = Number(req.query.w);
    if (Number.isFinite(width) && width > 0 && width <= 512) {
      const buf = await sharp(await fs.readFile(file))
        .resize(Math.round(width), Math.round(width), { fit: 'cover' })
        .webp({ quality: 80 })
        .toBuffer();
      res.type('image/webp').send(buf);
      return;
    }

    res.sendFile(file);
  } catch {
    res.status(404).end();
  }
});

// ─── Shared images (slots 2–5) ────────────────────────────────────────────────
// Stored under stable names so the executor can predict them at run time,
// regardless of what the original files were called.
const upload = multer({
  storage: multer.diskStorage({
    destination: async (req, _file, cb) => {
      const dir = sharedImagesDir(req.params.id);
      await fs.mkdir(dir, { recursive: true });
      cb(null, dir);
    },
    filename: (_req, file, cb) => cb(null, `__tmp_${Date.now()}_${file.originalname}`),
  }),
  limits: { fileSize: 25 * 1024 * 1024 },
  // No extension filter — see uploads.js. The format is sniffed from the contents
  // and converted after upload.
});

router.post(
  '/:id/images',
  upload.fields([
    { name: 'img2', maxCount: 1 },
    { name: 'img3', maxCount: 1 },
    { name: 'img4', maxCount: 1 },
    { name: 'img5', maxCount: 1 },
  ]),
  async (req, res) => {
    try {
      const dir = sharedImagesDir(req.params.id);
      for (const slot of ['img2', 'img3', 'img4', 'img5']) {
        const file = req.files?.[slot]?.[0];
        if (!file) continue;

        // Convert to a format Flipkart's widget accepts before naming the slot, so
        // the stored extension always reflects the real, usable format.
        const converted = await ensureFlipkartFormat(path.resolve(file.path));
        const ext = path.extname(converted.file).toLowerCase();
        if (converted.changed) {
          broadcast({ type: 'info', text: `${slot}: converted ${converted.from} → png.` });
        }

        // Drop any previous file for this slot, whatever extension it had.
        for (const existing of await fs.readdir(dir)) {
          if (existing.startsWith(slot + '.')) await fs.rm(path.join(dir, existing), { force: true });
        }
        const dest = path.join(dir, `${slot}${ext}`);
        await fs.rename(converted.file, dest);

        // Undersized images are a QC-rejection risk and the upload widget does not
        // catch them, so fix them here rather than discovering it after submission.
        const sized = await ensureMinSize(dest);
        if (sized.changed) {
          broadcast({
            type: 'info',
            text: `${slot}: upscaled ${sized.from.join('×')} → ${sized.to.join('×')} to clear the ${1100}px minimum.`,
          });
        }
      }
      res.json(await getPath(req.params.id));
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  },
);

export default router;
