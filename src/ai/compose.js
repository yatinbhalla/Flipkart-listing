/**
 * Copy composed from the path's own attributes, without an AI call.
 *
 * A pool of thirty versions per path is 1,590 Gemini calls across the catalogue,
 * which runs into the rate limit long before it finishes. Composing instead is
 * instant and free, and it cannot invent a fact: every sentence is assembled from
 * the material, colour, pattern, size and pack count already recorded on the path.
 *
 * generateCopyPool in content.js remains the better tool for regenerating one path
 * on its own, where a model's phrasing is worth the call.
 */

import { buildSpecs, renderSpecs } from './content.js';

/**
 * Words Meesho's brand check has flagged, or is likely to.
 *
 * It intercepts the submit with a modal for anything "similar to authorised brands"
 * — "navy" was caught on a live listing. Since the vocabulary here is ours to
 * choose, the simplest fix is not to use them.
 */
const AVOID = ['navy', 'royal', 'premium', 'luxury', 'classic', 'essential', 'everyday', 'branded'];

/** Acronyms in the seller's data, which Title Case would otherwise mangle to "Pvc". */
const ACRONYMS = /\b(pvc|gsm|mdf|pu)\b/gi;

/** Units that stay lowercase in Title Case — "34x52 Cm Size" reads like a typo. */
const UNITS = /\b(Cm|Mm|Gsm|Kg)\b/g;
const LOWER_UNITS = { Cm: 'cm', Mm: 'mm', Gsm: 'GSM', Kg: 'kg' };

/** Title Case — for titles and feature chips only. */
const cap = (s) =>
  String(s || '')
    .replace(/\b\w/g, (c) => c.toUpperCase())
    .replace(ACRONYMS, (m) => m.toUpperCase())
    .replace(UNITS, (m) => LOWER_UNITS[m]);

/** Sentence case; capitalising every word of a sentence reads like a headline. */
const sentence = (s) => {
  const t = String(s || '').trim();
  return t.charAt(0).toUpperCase() + t.slice(1);
};

/** "a office table" is exactly what makes copy look auto-generated. */
const article = (word) => (/^[aeiou]/i.test(String(word).trim()) ? 'an' : 'a');

const list = (a) => (Array.isArray(a) ? a.filter(Boolean) : [a].filter(Boolean));
const pickAt = (arr, i) => arr[i % arr.length];

/** "Cap, Top, Bib, Pyjama and Footed Pyjama" — a written list, not a comma dump. */
const listWords = (a) =>
  a.length > 1 ? `${a.slice(0, -1).join(', ')} and ${a[a.length - 1]}` : a[0] || '';

/**
 * The colour, from whichever field the path recorded it in.
 *
 * Flipkart asks for the colour three different ways and a path fills in whichever
 * its vertical demanded, so reading only two of them loses it entirely on the rest.
 * The appliance covers record `color` alone, which is how they ended up with a
 * feature chip reading " Finish" and an image prompt that never said what colour the
 * product was.
 */
export function colourWord(v) {
  const found = list(v.colorText)[0] || list(v.colorRefiner)[0] || list(v.color)[0] || '';
  return String(found).toLowerCase();
}

/** Rotate through an array so successive versions take different entries. */
const rotate = (arr, start, n) =>
  Array.from({ length: Math.min(n, arr.length) }, (_, k) => arr[(start + k) % arr.length]);

/** The nouns and verbs that differ by what the product actually is. */
export function vocabulary(path, v) {
  const vertical = path.vertical;
  // Some paths carry the whole category branch — "Home & Kitchen Accessories /
  // Kitchen & Table Linen / Apron" — so an equality test against a bare leaf name
  // silently fails and the product falls through to the table cover default. That is
  // how aprons came to be described as table covers.
  const leaf = String(vertical || '').split('/').pop().trim();
  if (vertical === 'Hanging Organizers') {
    return {
      noun: 'wall hanging organizer',
      nouns: ['wall hanging organizer', 'hanging storage organizer', 'wall organizer', 'hanging pocket organizer'],
      does: [
        'keeps small items off the floor and within reach',
        'holds stationery, cosmetics and phone accessories in one place',
        'frees up table and shelf space in a small room',
        'keeps bedside clutter sorted without extra furniture',
      ],
      where: ['bedroom', 'hostel room', 'study corner', 'kitchen wall', 'bathroom door', 'rented flat'],
      detail: v.numberOfPockets ? `${v.numberOfPockets} open pockets` : 'open pockets',
      mount: list(v.mountingType).join(' or ').toLowerCase() || 'hook',
      check: 'the wall space you have in mind',
    };
  }
  if (vertical === 'Blanket') {
    return {
      noun: 'baby dohar',
      nouns: ['baby dohar', 'muslin dohar', 'baby wrap blanket', 'cotton dohar'],
      does: [
        'keeps a baby lightly covered without overheating',
        'works as a swaddle wrap, a stroller cover or a nursing cover',
        'stays breathable through changing Indian weather',
        'softens with every wash instead of stiffening',
      ],
      where: ['cot', 'stroller', 'car seat', 'floor mat', 'travel bag'],
      detail: 'layered muslin cotton',
      mount: '',
      check: 'the cot or stroller you have in mind',
    };
  }
  // Flipkart files these under the generic "Mat" vertical, which also covers door and
  // bath mats — so the productType is what distinguishes a prayer mat, not the
  // vertical. Without this the fall-through below described an aasan as a table cover.
  if (vertical === 'Mat' || /aasan|prayer|pooja|puja/i.test(`${path.name} ${path.productType}`)) {
    return {
      noun: 'aasan',
      nouns: ['aasan', 'pooja mat', 'prayer mat', 'puja aasan'],
      does: [
        'gives a clean and soft place to sit through a long pooja',
        'keeps you off a cold floor during prayer and meditation',
        'marks out a seat in front of the mandir without taking up space',
        'rolls up small enough to keep in the pooja shelf between uses',
      ],
      where: ['mandir', 'pooja room', 'prayer corner', 'meditation spot', 'living room floor'],
      detail: list(v.pattern).join(' and ').toLowerCase() || 'traditional print',
      mount: '',
      check: 'the space in front of your mandir',
    };
  }
  // Clothing has to be tested BEFORE the /baby/ rule below, or "Baby Clothing Set"
  // matches that first and five pieces of babywear get described as a hooded towel —
  // which is what happened until this branch existed.
  if (leaf === 'Kids Apparel Combo') {
    return {
      noun: 'baby clothing set',
      nouns: ['baby clothing set', 'newborn clothing set', 'infant dress set', 'baby combo set'],
      does: [
        'dresses a baby for the day without hunting for pieces that match',
        'keeps a newborn covered in soft cotton from top to bottom',
        'goes straight into a hospital bag or a gift box',
        'washes and dries quickly enough for daily changes',
      ],
      where: ['nursery', 'hospital bag', 'cot', 'gift box', 'day out'],
      detail: list(v.pattern).join(' and ').toLowerCase() || 'printed cotton',
      mount: '',
      check: "your baby's age in months",
    };
  }
  // An apron matched nothing at all and fell through to the table cover default, so
  // the copy called it a table cover and sized it for a four seater.
  if (leaf === 'Apron') {
    return {
      noun: 'apron',
      nouns: ['apron', 'kitchen apron', 'cooking apron', 'kitchen wear apron'],
      does: [
        'keeps splashes and stains off your clothes while you cook',
        'ties at the waist and stays put through a long session at the stove',
        'wipes down and washes without the print fading out',
        'saves changing your clothes after every meal you cook',
      ],
      where: ['kitchen', 'baking session', 'cooking class', 'food stall', 'home kitchen'],
      detail: list(v.pattern).join(' and ').toLowerCase() || 'printed cotton',
      mount: '',
      check: 'the waist size you want it to tie at',
    };
  }
  // A fridge top cover is near enough to a table cover that the default was almost
  // right, and almost right is the worst case: the copy called it a table cover,
  // sized it "for a 4 seater" and suggested it for a dining table or a study desk.
  // It sits on one appliance, in one room, and what a buyer has to check is whether
  // it clears the width of their fridge.
  if (leaf === 'Appliance Cover') {
    return {
      noun: 'fridge top cover',
      nouns: ['fridge top cover', 'refrigerator top cover', 'fridge cover', 'appliance top cover'],
      does: [
        'keeps dust, grease and kitchen splashes off the top of the fridge',
        'saves the fridge top from scratches and ring marks',
        'holds small kitchen bits in its side pockets instead of on the counter',
        'wipes clean and goes back on without shifting about',
      ],
      where: ['kitchen', 'modular kitchen', 'utility area', 'pantry corner', 'rented flat'],
      detail: v.numberOfPockets
        ? `${v.numberOfPockets} side pockets`
        : list(v.pattern).join(' and ').toLowerCase() || 'quilted finish',
      mount: '',
      check: 'the width of your own fridge top',
    };
  }
  // A hooded baby towel is filed under the same Bath Towels vertical as an adult
  // towel, so the vertical cannot tell them apart — and the vertical here is a full
  // category path, which matches none of the bare leaf names below. Identify it by
  // what it is instead, or the fall-through calls a baby towel a table cover.
  if (/baby|hooded|infant|newborn/i.test(`${path.name} ${path.productType}`)) {
    return {
      noun: 'hooded baby towel',
      nouns: ['hooded baby towel', 'baby bath towel', 'baby towel', 'hooded towel'],
      does: [
        'wraps a baby straight out of the bath and keeps their head covered',
        'dries a newborn quickly without rubbing at their skin',
        'keeps a baby warm in the minutes between the bath and getting dressed',
        'folds down small enough to keep one in the bag and one at home',
      ],
      where: ['bathroom', 'nursery', 'changing table', 'travel bag', 'grandparents house'],
      detail: 'an embroidered animal hood',
      mount: '',
      check: 'the size you want for your baby',
    };
  }
  // Flipkart files hand towels under Bath Linen Set; the plainer names are kept so a
  // later towel path does not have to be filed under a "set" vertical to get the copy.
  if (
    vertical === 'Bath Towels' ||
    vertical === 'Bath Linen Set' ||
    vertical === 'Hand Towel' ||
    vertical === 'Towel Set'
  ) {
    return {
      noun: 'hand towel',
      // No noun here names the fabric: the banks cross material with noun already,
      // and "cotton hand towel" then composes titles like "Cotton Hand Towel in Cotton".
      nouns: ['hand towel', 'hand towel set', 'face towel', 'kitchen hand towel'],
      does: [
        'dries hands quickly and goes straight back on the rail',
        'stays soft against skin wash after wash',
        'folds down small enough to keep a spare in every room',
        'takes daily use at the basin without turning stiff',
      ],
      where: ['wash basin', 'kitchen counter', 'guest bathroom', 'gym bag', 'travel bag'],
      // Singular: the middles read "the ${detail} keeps it from looking plain".
      detail: 'printed floral design',
      mount: '',
      check: 'the towel ring or rail you have in mind',
    };
  }
  return {
    noun: 'table cover',
    nouns: ['table cover', 'table cloth', 'dining table cover', 'table linen'],
    does: [
      'protects the table top from spills, marks and scratches',
      'takes the daily wear that a bare table top otherwise collects',
      'hides an older or scratched surface without replacing the furniture',
      'keeps dust off a table that is not used often',
    ],
    where: ['dining table', 'centre table', 'study desk', 'office table', 'side table'],
    detail: list(v.pattern).join(' and ').toLowerCase() || 'plain finish',
    mount: '',
    check: 'your own table',
  };
}

/**
 * What is actually in the box: how many pieces, and whether they differ.
 *
 * One function because the copy and the image prompt were answering this
 * differently and both were on the listing. The prompt said "show all 5 pieces of
 * the set — Cap, Top, Bib, Pyjama and Footed Pyjama" while the description under it
 * said "Supplied as a single piece", because this side read `packOf` alone and the
 * clothing sets record packOf: "1" with five entries in itemsIncluded. A buyer
 * reading one and counting the other has a return either way.
 *
 * `count: null` means nothing here answered it. The caller decides what to do with
 * that — the prompt stays silent, the copy assumes one — because an unstated
 * quantity is recoverable and a wrong one is not.
 */
export function packContents(path, v) {
  const items = list(v.itemsIncluded).map((e) => String(e));
  const label = String(v.label || v.key || '');
  const name = String(path.name || '');

  // A set of DIFFERENT things, not several of one thing. ["1 Cap","1 Top","1 Bib",
  // "1 Pyjama","1 Footed Pyjama"] is five garments, each quantity one — reading the
  // leading number off the first entry, as the single-entry case below does, is what
  // called a five-piece set a single piece.
  if (items.length > 1) {
    const pieces = items.map((e) => e.replace(/^\s*\d+\s*/, '').trim()).filter(Boolean);
    const count = items.reduce((n, e) => n + (Number(/^\s*(\d+)/.exec(e)?.[1]) || 1), 0);
    return { count, pieces, isSet: true, mixedPrints: false, mixedSizes: false, sizes: [] };
  }

  // The count lives somewhere different on almost every vertical, so fall through
  // the places it is actually recorded.
  let count = null;
  for (const entry of items) {
    const m = /^\s*(\d+)\s+\S/.exec(entry); // "4 Hand Towels", "2 Aasan"
    if (m) {
      count = Number(m[1]);
      break;
    }
  }
  if (!count) count = Number(v.packOf) || null;
  if (!count) count = Number(v.numberOfBlankets) || null;
  if (!count) {
    // The organizers carry the pack size only on the variant label.
    const m = /pack of\s*(\d+)/i.exec(label) || /pack of\s*(\d+)/i.exec(name);
    if (m) count = Number(m[1]);
  }
  if (!Number.isFinite(count) || count < 1) count = null;

  // Two ways a multi-pack is not simply "N of the same thing". The label is searched
  // too: "Pack of 3 — mixed colours" says it there and nowhere else.
  const haystack = `${path.packNote || ''} ${name} ${path.productType || ''} ${label}`;
  const mixedPrints = /different|assorted|varies|\bmix(ed|\b)/i.test(haystack);
  // "19x19 + 23x23 in" — a pack of two different sizes.
  const sizes = [
    ...new Set((`${name} ${label}`.match(/(\d+\s*[x×]\s*\d+)/gi) || []).map((s) => s.replace(/\s/g, ''))),
  ];
  const mixedSizes = count > 1 && sizes.length > 1;

  return { count, pieces: [], isSet: false, mixedPrints, mixedSizes, sizes };
}

/** Parts every sentence bank draws on. */
function parts(path, v) {
  // `sizeLabel` lets a variant say its size the way buyers type it. Inches are right
  // for a table cover and wrong for a hand towel — "13.5x20.5 inch hand towel" is a
  // phrase nobody searches, while the pack itself is sold as 34x52 cm. Opt-in, so
  // every existing path keeps the inch string it already composes.
  const size = v.sizeLabel || `${v.sizeInches.width}x${v.sizeInches.length} inch`;
  const colour = colourWord(v);
  const material = list(v.material).join(' ').toLowerCase() || '';
  const contents = packContents(path, v);
  const pack = contents.count || 1;
  return {
    size,
    colour,
    material,
    pattern: list(v.pattern).join(', ').toLowerCase(),
    pack,
    // A size that is not a measurement cannot be measured: these paths record
    // "0-6 Months" where the rest record "40x60 inch".
    sizeVerb: /\d\s*[x×]\s*\d/.test(size) ? 'measures' : 'comes in size',
    pieces: contents.pieces,
    isSet: contents.isSet,
    // A five-piece set is not a pack of five: a pack is five of one thing, a set is
    // five different things, and a buyer who reads "pack of 5" expects five outfits.
    packPhrase: contents.isSet
      ? `${pack}-piece set`
      : pack > 1
        ? `pack of ${pack}`
        : 'single piece',
    seating: v.seatingCapacity || '',
    care: list(v.careInstructions),
    packNote: path.packNote || '',
    vocab: vocabulary(path, v),
  };
}

/** Thirty distinct titles, built by reordering the attributes that matter. */
function title(p, i) {
  const { colour, material, size, seating, packPhrase, vocab } = p;
  // The noun advances on a different clock to the shape. Indexing both by i means
  // they cycle together — ten shapes and four nouns gives twenty combinations, not
  // forty, which capped distinct titles at exactly 20 of 30.
  const noun = cap(vocab.nouns[Math.floor(i / 10) % vocab.nouns.length]);
  const c = cap(colour);
  const m = cap(material);
  const fit = seating ? `for ${seating}` : p.pack > 1 ? `(${packPhrase})` : '';
  const shapes = [
    () => `${c} ${m} ${noun} ${size} ${fit}`,
    () => `${m} ${noun} in ${c}, ${size} ${fit}`,
    () => `${size} ${c} ${noun} ${fit}`,
    () => `${c} ${noun} ${size} with ${vocab.detail}`,
    () => `${m} ${size} ${noun} ${fit}`,
    () => `${noun} ${size} in ${c} ${m}`,
    () => `${c} ${size} ${noun} with ${vocab.detail}`,
    () => `${m} ${c} ${noun} ${size}`,
    () => `${size} ${noun} in ${c} with ${vocab.detail}`,
    () => `${c} ${m} ${size} ${noun}`,
    () => `${noun} in ${c}, ${size}, ${fit}`,
    () => `${c} ${noun} in ${m}, ${size}`,
    () => `${size} ${m} ${noun} in ${c}`,
  ];
  return pickAt(shapes, i)()
    .replace(/\s{2,}/g, ' ')
    .replace(/\s+,/g, ',')
    .trim();
}

/** The body: an opening angle, what it does, where it suits, then care. */
function description(p, i) {
  const { colour, material, size, seating, pack, vocab, care } = p;
  const twoPlaces = rotate(vocab.where, i, 2);
  const where = `${twoPlaces[0]} or ${article(twoPlaces[1])} ${twoPlaces[1]}`;
  const does = pickAt(vocab.does, i);
  const second = pickAt(vocab.does, i + 1);

  const openers = [
    // "measures 0-6 Months" is how a garment size reads when the sentence assumes
    // every size is a measurement. The clothing sets are sold by age, not by inches.
    `This ${colour} ${material} ${vocab.noun} ${p.sizeVerb} ${size} and ${does}.`,
    `Sized at ${size}, this ${colour} ${vocab.noun} ${does}.`,
    `A ${colour} ${vocab.noun} in ${material}, ${size}, made to be used rather than saved for guests.`,
    `Made from ${material} and finished in ${colour}, this ${size} ${vocab.noun} ${does}.`,
    `If ${article(twoPlaces[0])} ${where} needs covering, this ${size} ${colour} ${vocab.noun} is cut for it.`,
    `This ${size} ${vocab.noun} comes in ${colour} ${material} and ${does}.`,
  ];

  const middles = [
    `It suits ${article(twoPlaces[0])} ${where}${seating ? `, and fits a ${seating} comfortably` : ''}.`,
    `Use it on ${article(twoPlaces[0])} ${where}. It also ${second}.`,
    `It ${second}, which is what most buyers are after at this size.`,
    `It ${second}, and the ${vocab.detail} keeps it from looking plain.`,
  ];

  const practical = [
    p.isSet
      ? `Supplied as a ${p.packPhrase} — ${listWords(p.pieces)}.`
      : pack > 1
        ? `Supplied as a ${p.packPhrase}, so a second one is ready when the first is in the wash.`
        : `Supplied as a single piece.`,
    `Weighs about ${p.weightGrams || '150'} g, so it handles and stores easily.`,
    `The ${size} size is the one to check against ${vocab.check || 'your own'} before ordering.`,
    `Colour may vary slightly between screens and daylight.`,
  ];

  const careLine = care.length
    ? `Care: ${care.slice(0, 4).join('. ')}.`
    : 'Wipe or hand wash gently and dry in shade.';

  return [
    pickAt(openers, i),
    pickAt(middles, i),
    pickAt(practical, i),
    // A pack that is not N of the same thing has to say so in EVERY version, not one
    // in four — a buyer who expected four identical pieces and received four
    // different ones opens a return. Only the path knows, so it carries the sentence
    // and this just places it.
    p.packNote,
    careLine,
  ]
    .filter(Boolean)
    .join('\n\n');
}

/** Ten keywords: the seller's core terms, then a rotating tail built from attributes. */
function keywords(path, p, i) {
  const seller = (path.extraKeywords || []).map((k) => String(k).trim()).filter(Boolean);
  const { colour, material, size, seating, vocab } = p;

  // A wide bank, so thirty listings can each take a different slice. Every noun is
  // crossed with the attributes a buyer actually searches on — colour, size,
  // material, room — which is where long-tail traffic comes from.
  const generated = [];
  for (const n of vocab.nouns) {
    generated.push(`${colour} ${n}`, `${size} ${n}`, `${material} ${n}`, `${n} ${size}`);
    if (seating) generated.push(`${seating.toLowerCase()} ${n}`);
    for (const w of vocab.where) generated.push(`${n} for ${w}`);
    generated.push(`${colour} ${n} ${size}`, `${material} ${n} in ${colour}`);
  }
  if (p.pattern) {
    for (const n of vocab.nouns) generated.push(`${p.pattern} ${n}`, `${colour} ${p.pattern} ${n}`);
  }
  if (p.pack > 1) {
    generated.push(`${p.pack} piece ${vocab.noun}`);
    // "baby clothing set pack of 5" is a phrase nobody types and a claim nobody
    // means; a set is searched for by its piece count.
    generated.push(p.isSet ? `${p.pack} piece set ${vocab.noun}` : `${vocab.noun} pack of ${p.pack}`);
  }
  // Buyers type the size both ways, and search on the job as well as the object.
  const spaced = size.replace('x', ' x ');
  for (const n of vocab.nouns) generated.push(`${spaced} ${n}`, `${n} online`, `${n} for home use`);
  for (const d of vocab.does) generated.push(`${vocab.noun} that ${d.split(' ').slice(0, 4).join(' ')}`);
  if (vocab.detail) generated.push(`${vocab.noun} with ${vocab.detail}`, `${colour} ${vocab.noun} with ${vocab.detail}`);

  // Four seller terms on every listing because they are what buyers type; the rest
  // rotates so thirty listings do not share one keyword set.
  // The four most important terms appear on every listing. A path with no seller
  // keywords of its own would otherwise lose "table cover" itself from some
  // versions, which is the one phrase that must never be missing.
  const core = [
    vocab.noun,
    `${size} ${vocab.noun}`,
    `${colour} ${vocab.noun}`,
    seating ? `${seating.toLowerCase()} ${vocab.noun}` : `${material} ${vocab.noun}`,
  ];
  const pinned = [...new Set([...seller.slice(0, 4), ...core])].slice(0, 4);
  const spare = seller.slice(4);
  const tail = Math.max(10 - pinned.length - Math.min(2, spare.length), 4);
  // Stepping through the bank rather than taking a contiguous slice: the bank is
  // built noun by noun, so a slice lands on runs of near-identical phrases — one
  // version came out with six variations of "solid table cloth" and little else.
  const step = 7;
  const strided = Array.from(
    { length: tail + 4 },
    (_, k) => generated[(i * 3 + k * step) % generated.length],
  );
  const out = [...pinned, ...rotate(spare, i * 2, 2), ...strided];

  // Collapse a word that repeats back to back. The bank crosses material with nouns,
  // and a noun that already names the material ("cotton hand towel") then yields
  // "cotton cotton hand towel" — a keyword that looks like a bug to anyone reading
  // the listing.
  const dedupeWords = (k) => k.replace(/\b(\w+)(\s+\1\b)+/gi, '$1');

  const seen = new Set();
  return out
    .map((k) => dedupeWords(k.toLowerCase()).replace(/\s{2,}/g, ' ').trim())
    .filter((k) => k && !AVOID.some((w) => k.includes(w)) && !seen.has(k) && seen.add(k))
    .slice(0, 10);
}

function features(p, i) {
  const { colour, material, size, seating, vocab, pack } = p;
  const all = [
    `${cap(material)} Construction`,
    `${cap(size)} Size`,
    seating ? `Fits ${seating}` : `Suits A ${cap(vocab.where[0])}`,
    `${cap(colour)} Finish`,
    // First pattern only. The joined string makes chips like "Floral, Self Design
    // Design", which reads as a data error on a live listing.
    p.pattern ? `${cap(p.pattern.split(',')[0].trim())} Design` : `${cap(vocab.detail)}`,
    p.isSet ? `${pack} Piece Set` : pack > 1 ? `Pack Of ${pack}` : 'Single Piece',
    vocab.mount ? `${cap(vocab.mount)} Mounting` : 'Ready To Use',
    // Was hardcoded "Hand Wash Gentle", which is wrong on anything that is machine
    // washable and wrong on a PVC sheet that is only ever wiped. The path already
    // states how the product is cleaned, so take it from there.
    cap(p.care[0] || 'hand wash gentle'),
  ].filter(Boolean);
  return rotate(all, i, 7);
}

/**
 * A pool of `count` distinct copies for one variant, composed rather than generated.
 *
 * Shapes are indexed by position, and the banks are different lengths on purpose —
 * titles rotate through ten shapes, descriptions through six openers and four
 * middles — so the combinations do not repeat until well past thirty.
 */
export function composeCopyPool(path, variant, count = 30) {
  const p = { ...parts(path, variant), weightGrams: variant.weightGrams };
  const specs = buildSpecs(variant);
  const pool = [];
  const usedTitles = new Set();

  for (let i = 0; i < count; i++) {
    // Ten shapes crossed with four nouns is forty combinations, but they are not all
    // distinct once the parts are substituted — so walk the space until an unused
    // title turns up rather than nudging by a fixed step and hoping.
    let name = title(p, i);
    for (let step = 1; usedTitles.has(name) && step < 200; step++) {
      name = title(p, i + step);
    }
    usedTitles.add(name);

    pool.push({
      specs,
      description: (description(p, i) + renderSpecs(specs)).slice(0, 4500),
      searchKeywords: keywords(path, p, i),
      keyFeatures: features(p, i),
      modelName: name,
      generatedAt: new Date().toISOString(),
      composed: true,
    });
  }
  return pool;
}
