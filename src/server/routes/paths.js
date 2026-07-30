import express from 'express';
import multer from 'multer';
import fs from 'fs/promises';
import path from 'path';
import { listPaths, getPath, savePath, deletePath, sharedImagesDir } from '../store.js';
import { ensureMinSize } from '../../images/normalize.js';
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
  limits: { fileSize: 15 * 1024 * 1024 },
  fileFilter: (_req, file, cb) =>
    /jpe?g|png|webp/i.test(path.extname(file.originalname))
      ? cb(null, true)
      : cb(new Error('Only JPG, PNG and WebP images are allowed.')),
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
        const ext = path.extname(file.originalname).toLowerCase();
        // Drop any previous file for this slot, whatever extension it had.
        for (const existing of await fs.readdir(dir)) {
          if (existing.startsWith(slot + '.')) await fs.rm(path.join(dir, existing), { force: true });
        }
        const dest = path.join(dir, `${slot}${ext}`);
        await fs.rename(file.path, dest);

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
