import express from 'express';
import multer from 'multer';
import fs from 'fs/promises';
import path from 'path';
import { ensureMinSize } from '../../images/normalize.js';

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

router.post('/front', upload.single('image'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No image uploaded.' });
  try {
    const file = path.resolve(req.file.path);
    const sized = await ensureMinSize(file);
    res.json({
      path: file,
      name: req.file.originalname,
      width: sized.to[0],
      height: sized.to[1],
      upscaled: sized.changed,
    });
  } catch (err) {
    res.status(400).json({ error: `Could not process that image: ${err.message}` });
  }
});

export default router;
