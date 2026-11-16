import { colourWord, packContents, vocabulary } from './compose.js';

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
 *    vertical. Counted by `packContents()` in compose.js rather than here, so the
 *    photograph and the description under it cannot contradict each other.
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

/**
 * In-use framings, keyed by the noun `vocabulary()` returns.
 *
 * A product lying folded on a surface shows what it is; a product hanging on its
 * rail or spread on the cot shows what it is FOR, and that is the picture that sells
 * it. One image in three uses these so a batch carries both kinds.
 *
 * None of them puts a person in frame, including the baby ones — see USE_PEOPLE.
 */
const IN_USE = {
  'hooded baby towel': [
    'hanging over the side of a baby bath, hood open so the embroidered face shows',
    'draped over the rail of a white cot',
    'laid open on a changing mat, ready to wrap',
  ],
  'hand towel': [
    'hanging from a towel ring beside a wash basin',
    'folded over the rail of an oven door in a tidy kitchen',
    'hanging on a hook beside a bathroom mirror',
  ],
  'table cover': [
    'spread on a laid dining table with a few plates and a water jug',
    'on a centre table with a cup of tea and a book resting on it',
    'spread on a study desk with a lamp at one corner',
  ],
  'wall hanging organizer': [
    'hung on the back of a door with brushes and small bottles in its pockets',
    'hung beside a study desk holding pens, a notebook and a phone',
    'hung on a kitchen wall holding small utensils',
  ],
  'baby dohar': [
    'spread over a cot mattress with one corner turned back',
    'draped over the side of a pram',
  ],
  aasan: ['laid on the floor in front of a small mandir, a brass lamp beside it'],
  'fridge top cover': [
    'spread over the top of a refrigerator in a tidy kitchen, side flaps hanging down',
    'on a fridge top with a couple of small jars tucked into its side pockets',
  ],
};

/**
 * Framings that put a baby in the picture, and how often each family gets one.
 *
 * The seller asked for these directly, for the plain reason that a baby item shown
 * in use sells better: every second image for the towels and clothing sets, every
 * fourth for the muslin dohars.
 *
 * Worth knowing when reading the output: the infant in these is generated, not
 * photographed, and the product guardrail checks the PRODUCT only — it has nothing
 * to say about whether the child looks right. These are the frames to look hardest
 * at in the review grid.
 */
const WITH_BABY = {
  'hooded baby towel': {
    every: 2,
    shots: [
      'wrapped around a freshly bathed baby sitting on a towel, hood up on the baby\'s head so the embroidered face shows',
      'being held open by a parent behind a baby, about to wrap them after a bath',
      'draped over a baby lying on a changing mat, hood beside their head',
    ],
  },
  'baby clothing set': {
    every: 2,
    shots: [
      'worn by a smiling baby sitting up on a plain nursery rug',
      'worn by a baby lying on a soft blanket, the full set visible',
    ],
  },
  'baby dohar': {
    every: 4,
    shots: [
      'tucked over a sleeping baby in a cot, the print clearly visible',
      'wrapped around a baby held in a parent\'s arms',
    ],
  },
};

const ANGLE = [
  'photographed straight on at eye level',
  'photographed at a three-quarter angle',
  'photographed from slightly above',
  'photographed from standing height looking down',
  'photographed at a low angle close to the surface',
];

/**
 * How many pieces are in shot, said the way a photographer needs to hear it.
 *
 * The counting itself lives in compose.js — the copy under the photograph has to
 * agree with it, and when each side counted for itself they did not: the prompt
 * asked for five garments while the description called the same listing a single
 * piece.
 *
 * A null count means nothing on the path answered it. The prompt then says nothing
 * about quantity, because an unstated one is recoverable and a wrong one is not.
 */
export function packComposition(path, variant) {
  const { count, pieces, isSet, mixedPrints, mixedSizes, sizes } = packContents(path, variant);

  // A buyer expecting five pieces and receiving one is a return, so a set is named
  // piece by piece rather than counted.
  if (isSet) {
    const named =
      pieces.length > 1 ? `${pieces.slice(0, -1).join(', ')} and ${pieces.at(-1)}` : pieces[0];
    return {
      count,
      mixedPrints,
      mixedSizes,
      phrase: `Show all ${count} pieces of the set together and clearly — ${named}.`,
    };
  }

  let phrase = '';
  if (count > 1 && mixedSizes) {
    phrase = `Show all ${count} pieces together, in their two different sizes (${sizes.join(' and ')}).`;
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
 * The product's real size, and the instruction that makes the picture honest about it.
 *
 * Its own line rather than four words inside the description, because scale is not a
 * detail — it is the thing a buyer judges from the photograph before they read a
 * single dimension. Told only to fill the frame, the model photographs a 70cm baby
 * towel and a 150cm table cover at exactly the same apparent size, and a hand towel
 * that looks like a bath sheet is a return.
 *
 * Two shapes of size exist on these paths and they need different sentences:
 * measurements ("70 x 70 cm", or width/length in inches), and garment sizes ("0-6
 * Months"), where the scale cue is the child rather than a ruler.
 */
function sizing(variant) {
  const label = String(variant.sizeLabel || '').trim();
  const si = variant.sizeInches || {};
  const w = Number(si.width);
  const l = Number(si.length);
  const inches =
    Number.isFinite(w) && w > 0 && Number.isFinite(l) && l > 0 ? `${w} x ${l} inch` : '';
  // Most labels are already a measurement in centimetres; keep the seller's own
  // wording and add the other unit, rather than restating one of them twice.
  const written = /\d\s*[x×]\s*\d/.test(label) ? label : '';

  let measures = '';
  if (written && inches) measures = `${written} (${inches})`;
  else if (written) measures = written;
  else if (inches) measures = `${inches} (${Math.round(w * 2.54)} x ${Math.round(l * 2.54)} cm)`;

  if (measures) {
    return (
      `TRUE SIZE: the item measures ${measures}. It must look that size in the photograph — ` +
      'the furniture, fittings, props and any person in shot all have to be in realistic ' +
      'proportion to an item of exactly those dimensions. Fill the frame by bringing the ' +
      'camera closer, never by making the item bigger than it is.'
    );
  }
  if (label) {
    return (
      `TRUE SIZE: it is sold in size "${label}". Everything in shot must be in realistic ` +
      'proportion to an item that size.'
    );
  }
  return null;
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

  const light = LIGHT[(index * 3) % LIGHT.length];
  const angle = ANGLE[(index * 2) % ANGLE.length];

  // Three kinds of frame, in priority order: with a baby (on the families and at the
  // cadence the seller set), in use, or the product in a setting. A batch therefore
  // carries what it is, what it is for, and who it is for.
  const kind = v.noun;
  const baby = WITH_BABY[kind];
  const withBaby = Boolean(baby) && index % baby.every === baby.every - 1;

  const places = v.where;
  const uses = IN_USE[kind] || [];
  const inUse = !withBaby && uses.length && index % 3 === 2;

  const where = withBaby
    ? baby.shots[Math.floor(index / baby.every) % baby.shots.length]
    : inUse
      ? uses[Math.floor(index / 3) % uses.length]
      : `${places[index % places.length]} setting`;

  const colour = colourWord(variant);
  const material = list(variant.material).join(' ').toLowerCase();
  const pattern = list(variant.pattern).join(', ').toLowerCase();

  const describe = [colour && `${colour}`, material, v.noun, pattern && `with a ${pattern} design`]
    .filter(Boolean)
    .join(' ');

  // Deliberately scene-led, and deliberately thin on describing the product.
  //
  // The previous version spelled the product out in words — colour, material,
  // pattern, size, plus two sentences of copyNotes — and that is an invitation to
  // draw it from the description rather than from the photographs. Paired with a
  // reference slot that was often the marketing infographic, the words were the only
  // product signal the model had, and the output looked exactly like what it was:
  // generated from text. The photographs carry the product now; the prompt carries
  // the scene and the things a photograph cannot say, like how many pieces are in
  // the pack.
  return [
    'You are a commercial e-commerce product photographer.',
    'THE SUPPLIED PHOTOGRAPHS ARE THE PRODUCT. They show the same item from different',
    'views. Reproduce that exact item — its colour, weave, texture, print, border, trim',
    'and proportions — as photographed. Do not redesign, restyle or re-draw it.',
    '',
    `It is a ${describe || v.noun}.`,
    pack.phrase,
    sizing(variant),
    '',
    `THE SHOT: re-photograph it ${inUse || withBaby ? '' : 'in a realistic '}${where}, ${light}, ${angle}.`,
    // On a baby shot the product still has to be the subject, or the result is a
    // charming photograph of a child that happens to contain a towel.
    withBaby
      ? 'The product stays the subject and must remain fully recognisable. Keep the baby ' +
        'natural and modestly covered, face calm, no distress. Do not let the child obscure ' +
        'the print, the border or the embroidered details.'
      : null,
    // Said only on the in-use shots, where a model or a hand is the obvious thing to
    // reach for and is the one thing those must not contain.
    inUse ? 'Show the product alone — no people, no hands, no pets in the frame.' : null,
    'Photorealistic commercial product photography, square 1:1 framing, the product',
    'clearly the subject and filling most of the frame through close framing alone.',
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
