import express from 'express';
import multer from 'multer';
import fs from 'fs/promises';
import path from 'path';
import { ensureMinSize } from '../../images/normalize.js';
import { MAX_BATCH } from '../constants.js';

const router = express.Router();
const RUN_UPLOADS = path.resolve('data/runs');

/**
 * Front View images for a single run. Unlike the shared slots 2–5 these change
 * every time, so they land in a per-run folder and the run route is handed the
 * absolute paths.
 */
const upload = multer({
  storage: multer.diskStorage({
    destination: async (_req, _file, cb) => {
      await fs.mkdir(RUN_UPLOADS, { recursive: true });
      cb(null, RUN_UPLOADS);
    },
    filename: (_req, file, cb) => cb(null, `${Date.now()}_${file.originalname.replace(/[^\w.-]+/g, '_')}`),
  }),
  limits: { fileSize: 15 * 1024 * 1024 },
  fileFilter: (_req, file, cb) =>
    /jpe?g|png|webp/i.test(path.extname(file.originalname))
      ? cb(null, true)
      : cb(new Error('Only JPG, PNG and WebP images are allowed.')),
});

/**
 * Accepts 1..MAX_BATCH Front View images — one listing per image. Each is measured
 * and upscaled if needed, and reported back individually so the UI can show which
 * ones were resized. A file that cannot be read is reported rather than failing the
 * whole selection, so one bad file out of fifty doesn't force a re-pick.
 */
router.post('/front', upload.array('image', MAX_BATCH), async (req, res) => {
  const files = req.files || [];
  if (!files.length) return res.status(400).json({ error: 'No image uploaded.' });

  const images = [];
  const rejected = [];
  for (const file of files) {
    const resolved = path.resolve(file.path);
    try {
      const sized = await ensureMinSize(resolved);
      images.push({
        path: resolved,
        name: file.originalname,
        width: sized.to[0],
        height: sized.to[1],
        upscaled: sized.changed,
      });
    } catch (err) {
      rejected.push({ name: file.originalname, error: err.message });
      await fs.rm(resolved, { force: true }).catch(() => {});
    }
  }

  if (!images.length) {
    return res.status(400).json({ error: `Could not process any of those images.`, rejected });
  }
  res.json({ images, rejected });
});

export default router;
