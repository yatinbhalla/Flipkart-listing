import { vocabulary } from './compose.js';

/**
 * Builds the instruction that turns one of a path's real photos into a listing front
 * image in a new setting.
 *
 * Two things here are per-path rather than per-template, because getting either wrong
 * produces a listing that misrepresents the product:
 *
 *  - WHERE the product is photographed. A single rotated scene list would stand a
 *    hand towel on a dining table. The setting comes from `vocabulary(path, v).where`,
 *    which already knows that an aasan belongs in front of a mandir and an organizer
 *    on a wall — and already handles the two cases the vertical alone gets wrong
 *    (Mat also covers door mats; a hooded baby towel shares a vertical with adult
 *    towels). That function earned those branches the hard way; this reuses them
 *    rather than writing a second list to get wrong independently.
 *
 *  - HOW MANY items are in shot. A pack of four photographed as one item is a
 *    returns problem, and the count lives in a different field on almost every
 *    vertical.
 */

const list = (a) => (Array.isArray(a) ? a.filter(Boolean) : [a].filter(Boolean));

/** Lighting and framing, strided separately so a batch does not repeat scene+light pairs. */
const LIGHT = [
  'bright natural daylight',
  'soft diffused morning light',
  'warm late-afternoon light',
  'clean even studio lighting',
  'gentle window light with soft shadows',
  'bright overcast daylight',
  'warm indoor lamp light',
];

const ANGLE = [
  'photographed straight on at eye level',
  'photographed at a three-quarter angle',
  'photographed from slightly above',
  'photographed from standing height looking down',
  'photographed at a low angle close to the surface',
];

/**
 * How many pieces the listing sells, and whether they differ from each other.
 *
 * Falls through the places the count actually lives. Returns `count: null` when none
 * of them answer — an unstated quantity is recoverable, a wrong one is not, so the
 * prompt stays silent rather than guessing.
 */
export function packComposition(path, variant) {
  const label = String(variant.label || variant.key || '');
  const name = String(path.name || '');
  const items = list(variant.itemsIncluded);

  let count = null;
  // "4 Hand Towels", "2 Aasan" — the most common and the most explicit.
  for (const entry of items) {
    const m = /^\s*(\d+)\s+\S/.exec(String(entry));
    if (m) {
      count = Number(m[1]);
      break;
    }
  }
  if (!count && variant.packOf) count = Number(variant.packOf) || null;
  if (!count && variant.numberOfBlankets) count = Number(variant.numberOfBlankets) || null;
  // The organizers carry the pack size only on the variant, not in any shared field.
  if (!count) {
    const m = /pack of\s*(\d+)/i.exec(label) || /pack of\s*(\d+)/i.exec(name);
    if (m) count = Number(m[1]);
  }
  if (!Number.isFinite(count) || count < 1) count = null;

  // Two ways a multi-pack is not simply "N of the same thing". The variant label is
  // searched too: "Pack of 3 — mixed colours" says it there and nowhere else, and
  // "mixed" does not match a \bmix\b anchored on the right.
  const haystack = `${path.packNote || ''} ${name} ${path.productType || ''} ${label}`;
  const mixedPrints = /different|assorted|varies|\bmix(ed|\b)/i.test(haystack);
  // "19x19 + 23x23 in" — a pack of two different sizes.
  const sizes = `${name} ${label}`.match(/(\d+\s*[x×]\s*\d+)/gi) || [];
  const mixedSizes = count > 1 && new Set(sizes.map((s) => s.replace(/\s/g, ''))).size > 1;

  let phrase = '';
  if (count > 1 && mixedSizes) {
    phrase = `Show all ${count} pieces together, in their two different sizes (${[...new Set(sizes.map((s) => s.replace(/\s/g, '')))].join(' and ')}).`;
  } else if (count > 1 && mixedPrints) {
    phrase = `Show all ${count} pieces together, each in a visibly DIFFERENT print — they are an assorted pack, not ${count} identical pieces.`;
  } else if (count > 1) {
    phrase = `Show all ${count} pieces together as a set.`;
  } else if (count === 1) {
    phrase = 'Show a single piece.';
  }

  return { count, mixedPrints, mixedSizes, phrase };
}

/**
 * The visual sentences out of `copyNotes`.
 *
 * copyNotes is written for the copywriter and carries instructions to it — "do not
 * name any branded character", "Do NOT state a GSM". Those are rules about wording,
 * not about the picture, and feeding them to an image model is noise at best. Keep
 * the sentences that describe what the thing looks like.
 */
const TO_THE_WRITER =
  /\b(do not|don't|avoid|never|instead|seller|the app|keep the|copy|wording|describe[sd]?|claim|keyword|title|listing|return|customer|attribute|field)\b/i;

function appearance(path) {
  const notes = String(path.copyNotes || '');
  return notes
    .split(/(?<=\.)\s+/)
    .map((sentence) => {
      // A sentence can be half description, half note to the writer, joined by a dash:
      // "…sold as a pack of FOUR in ASSORTED prints — say so plainly in every version
      // of the copy, because a customer expecting four identical towels is a return."
      // Keep the half that describes the thing.
      const [head, ...rest] = sentence.split(/\s+[—–-]{1,2}\s+/);
      return rest.length && TO_THE_WRITER.test(rest.join(' ')) ? `${head.trim()}.` : sentence;
    })
    .filter((s) => s.trim() && !TO_THE_WRITER.test(s))
    .slice(0, 2)
    .join(' ')
    .trim();
}

/**
 * The prompt for listing `index` of a batch.
 *
 * `index` rotates the setting; lighting and angle move on their own strides, both
 * coprime with their list lengths, so fifty listings get fifty combinations rather
 * than the same handful repeated.
 */
export function buildImagePrompt(path, variant, index = 0) {
  if (path.imagePrompt) return String(path.imagePrompt);

  const v = vocabulary(path, variant);
  const pack = packComposition(path, variant);

  const where = v.where[index % v.where.length];
  const light = LIGHT[(index * 3) % LIGHT.length];
  const angle = ANGLE[(index * 2) % ANGLE.length];

  const colour = (list(variant.colorText)[0] || list(variant.colorRefiner)[0] || '').toString().toLowerCase();
  const material = list(variant.material).join(' ').toLowerCase();
  const pattern = list(variant.pattern).join(', ').toLowerCase();
  const size = variant.sizeLabel || (variant.sizeInches ? `${variant.sizeInches.width}x${variant.sizeInches.length} inch` : '');

  const describe = [
    colour && `${colour}`,
    material,
    v.noun,
    pattern && `with a ${pattern} design`,
    size && `measuring ${size}`,
  ]
    .filter(Boolean)
    .join(' ');

  return [
    'You are a commercial e-commerce product photographer.',
    'Use the supplied photograph as the reference for the product.',
    '',
    'PRODUCT FIDELITY — non-negotiable: keep the product itself 100% IDENTICAL to the',
    'reference photograph. Do not alter its shape, proportions, weave, texture, print,',
    'pattern, border, trim or colour. It must be instantly recognisable as the same item.',
    '',
    `THE PRODUCT: ${describe}.`,
    appearance(path),
    pack.phrase,
    '',
    `THE SHOT: place it in a realistic ${where} setting, ${light}, ${angle}.`,
    'Photorealistic commercial product photography, square 1:1 framing, the product',
    'clearly the subject and filling most of the frame.',
    '',
    'DO NOT include: any text, lettering, watermark, logo, label or badge; any border or',
    'frame; any price or promotional graphic; any additional item that could be mistaken',
    'for part of what the buyer receives.',
  ]
    .filter((l) => l !== undefined && l !== null)
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
