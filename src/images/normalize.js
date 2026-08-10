import sharp from 'sharp';
import path from 'path';
import fs from 'fs/promises';

// Flipkart's stated minimum for listing images. A 1080x1080 file was accepted by
// the upload widget without complaint, so this is not enforced client-side — but
// undersized images are a QC-rejection risk, which is why we fix them on the way in.
export const MIN_EDGE = 1100;

// Upscale past the minimum rather than landing exactly on it, so a later crop or
// a change to Flipkart's threshold doesn't put the image back under.
export const TARGET_EDGE = 1200;

// Flipkart's own upload widget declares accept=".jpg, .png" — nothing else gets in,
// whatever this app is willing to read. So anything else (webp, jfif, avif, tiff,
// heic…) is converted to PNG on the way in rather than rejected.
const FLIPKART_FORMATS = new Set(['jpeg', 'png']);

/**
 * Read a file's bytes and hand sharp a Buffer, never a path.
 *
 * WHY: sharp keeps the file open behind a path-based input, and on Windows that
 * makes writing back to the same path fail with EBUSY or "unable to open" — which
 * showed up the moment two passes ran over one file (convert, then resize). Working
 * from a Buffer means there is no handle to collide with.
 */
async function load(file) {
  const bytes = await fs.readFile(file);
  return sharp(bytes, { failOn: 'none' });
}

/**
 * Detect the real format and convert it to something Flipkart accepts.
 *
 * Deliberately sniffs the file contents instead of trusting the extension. A
 * mislabelled or extension-less file is common when photos come off a phone or out
 * of a chat app, and rejecting it on the name alone is an unhelpful way to fail.
 *
 * Returns { changed, from, to, file } — `file` may be a NEW path when the extension
 * had to change.
 */
export async function ensureFlipkartFormat(file) {
  let meta;
  try {
    meta = await (await load(file)).metadata();
  } catch (err) {
    throw new Error(`${path.basename(file)} is not an image this app can read (${err.message})`);
  }
  const from = meta.format;
  if (!from) throw new Error(`Could not identify the image format of ${path.basename(file)}`);

  const ext = path.extname(file).toLowerCase();
  const usable =
    (from === 'jpeg' && (ext === '.jpg' || ext === '.jpeg')) || (from === 'png' && ext === '.png');
  if (FLIPKART_FORMATS.has(from) && usable) {
    return { changed: false, from, to: from, file };
  }

  // Re-encode as PNG and give it a .png name, since the widget matches on extension.
  const buffer = await (await load(file)).png({ compressionLevel: 9 }).toBuffer();
  const target = file.replace(/\.[^.\\/]*$/, '') + '.png';
  await fs.writeFile(target, buffer);
  if (path.resolve(target) !== path.resolve(file)) await fs.rm(file, { force: true });
  return { changed: true, from, to: 'png', file: target };
}

/**
 * Ensure an image meets the minimum resolution, upscaling in place if it doesn't.
 *
 * Listing images are square brand cards and product shots, so the short edge is
 * what matters. Lanczos3 is used because these are flat graphics with hard type
 * edges — bilinear leaves them visibly mushy.
 *
 * Returns { changed, from, to } so callers can tell the user what happened.
 */
export async function ensureMinSize(file, targetEdge = TARGET_EDGE) {
  const { width, height } = await (await load(file)).metadata();
  if (!width || !height) throw new Error(`Could not read image dimensions: ${path.basename(file)}`);

  if (Math.min(width, height) >= MIN_EDGE) {
    return { changed: false, from: [width, height], to: [width, height] };
  }

  const scale = targetEdge / Math.min(width, height);
  const to = [Math.round(width * scale), Math.round(height * scale)];

  // Keep the file's existing format — it has already been normalised to one
  // Flipkart accepts, and switching it here would leave the extension lying.
  const isPng = path.extname(file).toLowerCase() === '.png';
  const pipeline = (await load(file)).resize(to[0], to[1], {
    kernel: sharp.kernel.lanczos3,
    fit: 'fill',
  });
  const buffer = await (isPng ? pipeline.png({ compressionLevel: 9 }) : pipeline.jpeg({ quality: 92 }))
    .toBuffer();

  await fs.writeFile(file, buffer);
  return { changed: true, from: [width, height], to };
}
