import sharp from 'sharp';
import path from 'path';

// Flipkart's stated minimum for listing images. A 1080x1080 file was accepted by
// the upload widget without complaint, so this is not enforced client-side — but
// undersized images are a QC-rejection risk, which is why we fix them on the way in.
export const MIN_EDGE = 1100;

// Upscale past the minimum rather than landing exactly on it, so a later crop or
// a change to Flipkart's threshold doesn't put the image back under.
export const TARGET_EDGE = 1200;

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
  const image = sharp(file, { failOn: 'none' });
  const { width, height } = await image.metadata();
  if (!width || !height) throw new Error(`Could not read image dimensions: ${path.basename(file)}`);

  if (Math.min(width, height) >= MIN_EDGE) {
    return { changed: false, from: [width, height], to: [width, height] };
  }

  const scale = targetEdge / Math.min(width, height);
  const to = [Math.round(width * scale), Math.round(height * scale)];

  // sharp cannot read and write the same file in one pass — buffer it first.
  const buffer = await sharp(file, { failOn: 'none' })
    .resize(to[0], to[1], { kernel: sharp.kernel.lanczos3, fit: 'fill' })
    .png({ compressionLevel: 9 })
    .toBuffer();

  await sharp(buffer).toFile(file);
  return { changed: true, from: [width, height], to };
}
