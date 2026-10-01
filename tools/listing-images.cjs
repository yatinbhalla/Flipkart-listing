/**
 * Build the listing image set for the hand towel path from the seller's raw photos.
 *
 * The photos arrive as phone shots of towels bagged in polythene on a brown glass
 * table. They are honest but they are not listing images, so each one is colour
 * corrected and then placed in a deliberate layout.
 *
 * WHY NOT CUT THE TOWELS OUT: it was tried three ways and none of them hold up. A
 * lightness threshold cannot separate cloth from table, because the navy and blue print
 * motifs are darker than the table and get erased with it. Adding saturation to the test
 * fixes the prints but leaves the polythene, whose specular bands are BRIGHTER than the
 * cloth. Flooding inward from the border gets further — the background is one connected
 * region and the towels are islands — but those same bright bands are a wall it cannot
 * cross, so the table survives in pockets between the towels. Using local texture to
 * cross them (cloth is a weave, film is smooth) then lets the flood into the cloth,
 * because the camera's own smoothing flattens the weave in the brighter areas. A ragged
 * cut-out looks worse on a listing than an honest photograph, so the photographs stay.
 *
 * Run: node tools/listing-images.cjs <sourceDir> <outDir>
 */
const sharp = require('sharp');
const fs = require('fs');
const path = require('path');

const SRC = process.argv[2] || 'data/paths/hand-towel-print-mix/source';
const OUT = process.argv[3] || 'data/paths/hand-towel-print-mix/listing';
const S = 1200;

const INK = '#1b1b1b';
const MUTED = '#6b7280';
const TEAL = '#15616d';
const OCHRE = '#c0792b';
const RULE = '#e3e6e8';
const FONT = 'Segoe UI, Noto Sans, DejaVu Sans, Arial, sans-serif';

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const svg = (body, w = S, h = S) =>
  Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}">${body}</svg>`);
const text = (x, y, s, o = {}) =>
  `<text x="${x}" y="${y}" font-family="${FONT}" font-size="${o.size || 34}" ` +
  `font-weight="${o.weight || 400}" fill="${o.fill || INK}" ` +
  `text-anchor="${o.anchor || 'start'}" letter-spacing="${o.spacing || 0}">${esc(s)}</text>`;

/**
 * Neutralise the colour cast, then open the image up.
 *
 * The gains come from the photo's own brightest near-neutral pixels, which are the
 * cloth. Correcting at the source is worth more than any amount of brightening
 * afterwards, because a brightened cast is just a paler cast — the cloth has to read
 * white, not cream, or every towel looks grubby next to a competitor's listing.
 */
async function grade(input, o = {}) {
  const { data, info } = await sharp(input).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const N = info.width * info.height;
  let sr = 0, sg = 0, sb = 0, n = 0;
  for (let i = 0; i < N; i++) {
    const p = i * 3;
    const r = data[p], g = data[p + 1], b = data[p + 2];
    if (Math.max(r, g, b) - Math.min(r, g, b) < 30 && Math.max(r, g, b) > 170) {
      sr += r; sg += g; sb += b; n++;
    }
  }
  let gains = [1, 1, 1];
  if (n > 500) {
    const ar = sr / n, ag = sg / n, ab = sb / n;
    const t = Math.max(ar, ag, ab);
    gains = [t / ar, t / ag, t / ab];
  }
  const contrast = o.contrast || 1;
  return sharp(input)
    .removeAlpha()
    .linear(gains, [0, 0, 0])
    .modulate({ brightness: o.brightness || 1, saturation: o.saturation || 1.18 })
    .linear(contrast, 128 - 128 * contrast)
    .sharpen({ sigma: 1 })
    .png()
    .toBuffer();
}

const file = (n) => path.join(SRC, n);

async function photoCover(name, crop, w, h, o) {
  const base = await sharp(file(name)).extract(crop).png().toBuffer();
  return sharp(await grade(base, o)).resize({ width: w, height: h, fit: 'cover', position: 'centre' }).png().toBuffer();
}
async function photoFit(name, crop, w, h, o) {
  const base = await sharp(file(name)).extract(crop).png().toBuffer();
  return sharp(await grade(base, o)).resize({ width: w, height: h, fit: 'inside' }).png().toBuffer();
}
const blank = () => sharp({ create: { width: S, height: S, channels: 3, background: '#ffffff' } });

/**
 * 1 — Front View: the pack of four, and nothing else.
 *
 * Deliberately carries no text, badge or border. Flipkart's QC rejects graphics,
 * watermarks and promotional text on the primary image, and a rejection costs the whole
 * listing rather than just the picture.
 */
async function front() {
  // Taller crop than the towels strictly need, and run to the full canvas width: a
  // primary image that floats in white reads as a thumbnail. The bottom stops at 1080
  // because the photographer's feet are in frame below that.
  const photo = await photoFit('3.jpg', { left: 215, top: 60, width: 1365, height: 1020 }, S, S, {
    brightness: 1.3, contrast: 1.2, saturation: 1.2,
  });
  const m = await sharp(photo).metadata();
  return blank()
    .composite([{ input: photo, left: Math.round((S - m.width) / 2), top: Math.round((S - m.height) / 2) }])
    .jpeg({ quality: 94 })
    .toBuffer();
}

/** 2 — Close up: the three things the pack shot is too far away to show. */
async function closeup() {
  const PH = 770;
  const CROP = { left: 150, top: 150, width: 1300, height: 1050 };
  const photo = await photoCover('1.jpg', CROP, S, PH, { brightness: 1.26, contrast: 1.16, saturation: 1.22 });

  // Markers are placed in crop coordinates and carried through the same cover transform
  // as the photo, so they keep pointing at the right thread if the crop is retuned.
  const k = S / CROP.width;
  const offY = (Math.round(CROP.height * k) - PH) / 2;
  const at = (x, y) => [Math.round(x * k), Math.round(y * k - offY)];
  const marks = [at(750, 330), at(422, 573), at(330, 875)];

  let b = '';
  marks.forEach((p, i) => {
    b += `<circle cx="${p[0]}" cy="${p[1]}" r="30" fill="#ffffff" fill-opacity="0.94" stroke="${TEAL}" stroke-width="3"/>`;
    b += text(p[0], p[1] + 13, String(i + 1), { size: 36, weight: 700, fill: TEAL, anchor: 'middle' });
  });

  b += `<rect x="0" y="${PH}" width="${S}" height="${S - PH}" fill="#ffffff"/>`;
  b += `<rect x="0" y="${PH}" width="${S}" height="4" fill="${TEAL}"/>`;
  [
    ['Knotted fringe', 'Finished on both short edges'],
    ['Woven texture bands', 'Raised weave across the body'],
    ['Printed floral motifs', 'Colour print on white cotton'],
  ].forEach(([head, sub], i) => {
    const y = PH + 92 + i * 112;
    b += `<circle cx="84" cy="${y - 12}" r="26" fill="${TEAL}"/>`;
    b += text(84, y + 1, String(i + 1), { size: 30, weight: 700, fill: '#ffffff', anchor: 'middle' });
    b += text(136, y - 4, head, { size: 40, weight: 700 });
    b += text(136, y + 38, sub, { size: 29, fill: MUTED });
  });

  return blank()
    .composite([{ input: photo, left: 0, top: 0 }, { input: svg(b), left: 0, top: 0 }])
    .jpeg({ quality: 94 })
    .toBuffer();
}

/**
 * 3 — The range of prints, with the assortment stated quietly.
 *
 * Six are shown and four are sent, which is exactly the expectation that turns into a
 * return if it is left to the photograph to imply.
 */
async function assorted() {
  const photo = await photoFit('4.jpg', { left: 70, top: 25, width: 1290, height: 1035 }, 1080, 880, {
    brightness: 1.3, contrast: 1.2, saturation: 1.2,
  });
  const m = await sharp(photo).metadata();
  const top = 150;
  let b = '';
  b += text(S / 2, 86, 'PRINTS FROM OUR RANGE', { size: 44, weight: 700, fill: TEAL, anchor: 'middle', spacing: 2 });
  b += `<rect x="${(S - 120) / 2}" y="110" width="120" height="4" fill="${OCHRE}"/>`;
  const fy = top + m.height + 56;
  b += `<line x1="140" y1="${fy - 34}" x2="${S - 140}" y2="${fy - 34}" stroke="${RULE}" stroke-width="2"/>`;
  b += text(S / 2, fy + 8, 'Any 4 of these prints are sent, and the combination varies by pack', {
    size: 27, fill: MUTED, anchor: 'middle',
  });
  return blank()
    .composite([
      { input: photo, left: Math.round((S - m.width) / 2), top },
      { input: svg(b), left: 0, top: 0 },
    ])
    .jpeg({ quality: 94 })
    .toBuffer();
}

/** 4 — The one thing no photograph of a towel on a table can answer: how big is it. */
async function sizecard() {
  const photo = await photoFit('2.jpg', { left: 125, top: 70, width: 800, height: 1460 }, 470, 690, {
    brightness: 1.26, contrast: 1.16, saturation: 1.2,
  });
  const m = await sharp(photo).metadata();
  const px = 140, py = 260;

  let b = '';
  b += text(S / 2, 92, 'SIZE & PACK', { size: 44, weight: 700, fill: TEAL, anchor: 'middle', spacing: 2 });
  b += `<rect x="${(S - 120) / 2}" y="116" width="120" height="4" fill="${OCHRE}"/>`;

  const aw = m.width, ay = py - 48;
  b += `<line x1="${px}" y1="${ay}" x2="${px + aw}" y2="${ay}" stroke="${INK}" stroke-width="3"/>`;
  for (const [x, d] of [[px, 1], [px + aw, -1]]) {
    b += `<path d="M ${x} ${ay} l ${14 * d} -8 l 0 16 z" fill="${INK}"/>`;
    b += `<line x1="${x}" y1="${ay - 14}" x2="${x}" y2="${ay + 14}" stroke="${INK}" stroke-width="3"/>`;
  }
  b += `<rect x="${px + aw / 2 - 72}" y="${ay - 27}" width="144" height="54" fill="#ffffff"/>`;
  b += text(px + aw / 2, ay + 13, '34 cm', { size: 38, weight: 700, anchor: 'middle' });

  const bx = px + aw + 54, y0 = py, y1 = py + m.height;
  b += `<line x1="${bx}" y1="${y0}" x2="${bx}" y2="${y1}" stroke="${INK}" stroke-width="3"/>`;
  for (const [y, d] of [[y0, 1], [y1, -1]]) {
    b += `<path d="M ${bx} ${y} l -8 ${14 * d} l 16 0 z" fill="${INK}"/>`;
    b += `<line x1="${bx - 14}" y1="${y}" x2="${bx + 14}" y2="${y}" stroke="${INK}" stroke-width="3"/>`;
  }
  b += `<rect x="${bx - 72}" y="${(y0 + y1) / 2 - 27}" width="144" height="54" fill="#ffffff"/>`;
  b += text(bx, (y0 + y1) / 2 + 13, '52 cm', { size: 38, weight: 700, anchor: 'middle' });

  const sx = 700;
  [
    ['Pack of', '4 hand towels'],
    ['Each towel', '34 x 52 cm'],
    ['Material', 'Cotton'],
    ['Prints', 'Assorted floral'],
    ['Care', 'Machine wash cold'],
  ].forEach(([k, v], i) => {
    const y = 300 + i * 112;
    b += text(sx, y, k.toUpperCase(), { size: 25, weight: 700, fill: MUTED, spacing: 2 });
    b += text(sx, y + 48, v, { size: 42, weight: 600 });
    b += `<line x1="${sx}" y1="${y + 76}" x2="${S - 130}" y2="${y + 76}" stroke="${RULE}" stroke-width="2"/>`;
  });

  return blank()
    .composite([{ input: photo, left: px, top: py }, { input: svg(b), left: 0, top: 0 }])
    .jpeg({ quality: 94 })
    .toBuffer();
}

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  for (const [name, fn] of [
    ['1-front', front],
    ['2-closeup', closeup],
    ['3-assorted', assorted],
    ['4-sizecard', sizecard],
  ]) {
    const buf = await fn();
    fs.writeFileSync(path.join(OUT, `${name}.jpg`), buf);
    const m = await sharp(buf).metadata();
    console.log(`${name}.jpg  ${m.width}x${m.height}  ${Math.round(buf.length / 1024)}KB`);
  }
})();
