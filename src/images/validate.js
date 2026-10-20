import crypto from 'crypto';
import fs from 'fs/promises';
import sharp from 'sharp';
import { ensureFlipkartFormat, ensureMinSize, MIN_EDGE } from './normalize.js';

/**
 * Checks a generated front image before a human is asked to approve it.
 *
 * WHAT THIS DELIBERATELY DOES NOT DO, and why — three heuristics were written,
 * measured against this catalogue, and removed because the measurements disproved
 * them. Keeping them would have meant shipping warnings that are wrong more often
 * than right, which trains the seller to ignore the warnings that are not:
 *
 *  - "Is it still the same product?" by perceptual hash. Measured against the red
 *    net cover: a DIFFERENT product (a wall organizer) scored 20, while the SAME
 *    product shot from another angle scored 28. The hash tracks framing, not
 *    identity, so the check fires on correct images more than wrong ones.
 *  - "Is the colour right?" by dominant or centre-crop colour. These photos are
 *    mostly white backdrop, so whole-image dominant reads the backdrop on every
 *    image. Centre-crop does no better: same product 46, different product 49,
 *    different colour 47 — no separation to threshold on.
 *  - "Is there text on it?" by edge density. An image with BEST PRICE SALE burned
 *    across the middle scored 0.0000 against a plain photo's 0.1001.
 *
 * So this reports what can actually be proven from the bytes, and the review grid
 * carries the judgement. That was always the design; this just stops it pretending
 * otherwise. A vision-model pass would answer the first three properly, at the cost
 * of an API call per image — worth adding once the generation itself is proven.
 */

const md5 = (buf) => crypto.createHash('md5').update(buf).digest('hex');

/**
 * 64-bit average hash, used for one narrow question only: did the model hand the
 * reference straight back instead of re-scening it?
 *
 * Sound for that, because it compares against one specific photo and only a
 * near-zero distance counts. Measured on real pairs: an unchanged copy scores 0,
 * genuinely different shots of the same product score 20–28.
 */
async function aHash(file) {
  const px = await sharp(file).greyscale().resize(8, 8, { fit: 'fill' }).raw().toBuffer();
  const mean = px.reduce((a, b) => a + b, 0) / px.length;
  let bits = 0n;
  for (let i = 0; i < px.length; i++) if (px[i] > mean) bits |= 1n << BigInt(i);
  return bits;
}

const distance = (a, b) => {
  let x = a ^ b;
  let n = 0;
  while (x) {
    n += Number(x & 1n);
    x >>= 1n;
  }
  return n;
};

/**
 * Validate one generated image in place.
 *
 * `against` is the reference photo it was generated from; `others` are files already
 * accepted in this batch, because Flipkart fails a listing outright on a duplicate
 * image. Flags are advisory except `level: 'error'`, which blocks approval.
 */
export async function validateGenerated(file, { against, others = [] } = {}) {
  const flags = [];

  // Normalise first: conversion can change the path, and everything after this
  // should measure the file that will actually be uploaded.
  const converted = await ensureFlipkartFormat(file);
  const resolved = converted.file;
  const sized = await ensureMinSize(resolved);
  if (sized.changed) {
    flags.push({
      level: 'info',
      text: `upscaled ${sized.from.join('x')} → ${sized.to.join('x')} to clear the ${MIN_EDGE}px minimum`,
    });
  }

  const [width, height] = sized.to;
  if (Math.min(width, height) < MIN_EDGE) {
    flags.push({ level: 'error', text: `only ${width}×${height}; Flipkart wants ${MIN_EDGE}px minimum` });
  }

  const hash = md5(await fs.readFile(resolved));
  for (const other of others) {
    if (!other || other === resolved) continue;
    const bytes = await fs.readFile(other).catch(() => null);
    if (bytes && md5(bytes) === hash) {
      flags.push({ level: 'error', text: 'byte-identical to another image in this batch' });
      break;
    }
  }

  if (against) {
    const [a, b] = await Promise.all([aHash(resolved), aHash(against)]);
    if (distance(a, b) <= 2) {
      flags.push({ level: 'error', text: 'essentially unchanged from the reference photo' });
    }
  }

  return { file: resolved, width, height, hash, flags, ok: !flags.some((f) => f.level === 'error') };
}
