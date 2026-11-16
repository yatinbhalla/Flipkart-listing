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
};

/**
 * The product family, refined for framing purposes.
 *
 * `vocabulary()` is right about most things and wrong about two in a way that only
 * shows up once you start staging the product: it files a Kids Apparel Combo as a
 * "hooded baby towel" (its /baby|infant/ test matches "Baby Clothing Set" first) and
 * an Apron as a "table cover" (nothing matches, so it hits the default). Framing a
 * baby outfit as a towel over a bath, or an apron spread on a laid dining table, is
 * visibly wrong.
 *
 * Corrected here rather than in vocabulary() because that function also drives the
 * stored copy for 43 paths, and quietly changing how an apron is described is a
 * bigger change than this one. The underlying misfiling is worth fixing properly —
 * it means apron copy currently calls it a table cover — but separately.
 */
function family(path, variant) {
  const leaf = String(path.vertical || '').split('/').pop().trim();
  // Apron and Kids Apparel Combo used to be corrected here; they are branches in
  // vocabulary() now, so only the appliance cover is still misfiled — it lands on
  // the table cover default, which is nearly right for a fridge top and wrong
  // enough to stage it on a dining table.
  if (leaf === 'Appliance Cover') return 'appliance cover';
  return vocabulary(path, variant).noun;
}

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

/** Settings for the one family `vocabulary()` still misfiles — see `family()`. */
const WHERE = {
  'appliance cover': ['kitchen with a fridge', 'modular kitchen', 'utility corner'],
};

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

  // A set of DIFFERENT things, not several of one thing. The baby clothing set lists
  // ["1 Cap","1 Top","1 Bib","1 Pyjama","1 Footed Pyjama"] — five garments, each
  // quantity one. Reading the leading number off the first entry, as the single-entry
  // case does, called a five-piece set "a single piece" in both the prompt and the
  // copy. Several entries means show them all, and name them, because a buyer
  // expecting five pieces and receiving one is a return.
  if (items.length > 1) {
    const parts = items.map((e) => String(e).replace(/^\s*\d+\s*/, '').trim()).filter(Boolean);
    const total = items.reduce((n, e) => n + (Number(/^\s*(\d+)/.exec(String(e))?.[1]) || 1), 0);
    const named = parts.length > 1 ? `${parts.slice(0, -1).join(', ')} and ${parts.at(-1)}` : parts[0];
    return {
      count: total,
      mixedPrints: false,
      mixedSizes: false,
      phrase: `Show all ${total} pieces of the set together and clearly — ${named}.`,
    };
  }

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
  const kind = family(path, variant);
  const baby = WITH_BABY[kind];
  const withBaby = Boolean(baby) && index % baby.every === baby.every - 1;

  const places = WHERE[kind] || v.where;
  const uses = IN_USE[kind] || [];
  const inUse = !withBaby && uses.length && index % 3 === 2;

  const where = withBaby
    ? baby.shots[Math.floor(index / baby.every) % baby.shots.length]
    : inUse
      ? uses[Math.floor(index / 3) % uses.length]
      : `${places[index % places.length]} setting`;

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
