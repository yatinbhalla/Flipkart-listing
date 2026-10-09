/**
 * Customer-facing copy for one variant: specs, description, search keywords, key
 * features and the Model Name.
 *
 * Copy is generated ONCE and stored on the path (`variant.copy`). Runs read it
 * back, so a normal listing makes zero AI calls — the same words go out every
 * time, and a Gemini outage or quota limit can never block a run.
 *
 * Two hard constraints, enforced after generation as well as in the prompt:
 *
 *  - NO BRAND NAMES ANYWHERE, including the seller's own. Flipkart QC rejects
 *    brand mentions inside description/keyword fields.
 *  - Copy is written per variant. A 60x90 six-seater must not reuse the 40x60
 *    four-seater's text, or every variant reads identically and the size-specific
 *    keywords are wrong.
 */

import { callGeminiJSON } from './client.js';
import { MODEL_NAME_MAX, fitModelName } from '../server/format.js';

const BANNED_HINTS = ['flipkart', 'amazon', 'meesho', 'myntra', 'ajio'];
const INCH_TO_CM = 2.54;

/**
 * Build the specification table from the variant's own field values.
 *
 * Deliberately rule-based, not AI. These lines restate the structured attributes
 * that are also submitted to Flipkart, so deriving them guarantees the two agree.
 * An AI-written spec block can drift from the actual dropdown values and that
 * mismatch is exactly what QC and buyers notice.
 */
export function buildSpecs(variant) {
  const specs = [];
  const add = (label, value) => {
    if (value === undefined || value === null || String(value).trim() === '') return;
    specs.push({ label, value: String(value) });
  };
  const list = (v) => (Array.isArray(v) ? v.join(', ') : v);

  const { width, length } = variant.sizeInches || {};
  if (width && length) {
    const cm = (n) => Math.round(Number(n) * INCH_TO_CM);
    add('Size', `${width} x ${length} inches (approximately ${cm(width)} x ${cm(length)} cm)`);
  }
  // Field names differ by vertical — Table Cover calls it `material` and
  // `colorText`, Blanket calls the same things `outerMaterial` and `brandColor`.
  // Fall through the aliases so the spec block is complete either way.
  add('Material', list(variant.material ?? variant.outerMaterial));
  // `colorRefiner` first: it holds Flipkart's own canonical colour, which is the
  // one value a buyer should see in a spec table. `colorText` is a free-text pill
  // field and is often stuffed with shade synonyms (Brown, Coffee Brown, Dark
  // Brown) — useful for search, but it reads like a data error as a spec line.
  add('Colour', list(variant.colorRefiner ?? variant.colorText ?? variant.brandColor ?? variant.color));
  add('Pattern', list(variant.pattern));
  // `type` is a single dropdown on Table Cover but a multi-pick on Hanging
  // Organizers, where four values are ticked at once. Without list() an array
  // stringifies to "Bedside Organizer,Regular Organizer" with no spaces.
  add('Type', list(variant.type));
  add('Seating capacity', variant.seatingCapacity);
  add('Ideal for', variant.idealFor);
  add('Ideal usage', variant.idealUsage);
  add('Pack contents', list(variant.itemsIncluded));
  add('Reversible', variant.reversible);
  add('Wrinkle free', variant.wrinkleFree);
  if (variant.thickness) add('Thickness', `${variant.thickness} mm`);
  if (variant.weightGrams) add('Net weight', `${variant.weightGrams} g`);
  return specs;
}

/** Render the spec table as the tail of the description. */
export function renderSpecs(specs) {
  if (!specs.length) return '';
  return `\n\nSpecifications\n${specs.map((s) => `${s.label}: ${s.value}`).join('\n')}`;
}

/**
 * Generate and return the copy bundle for one variant. Callers persist the result
 * onto the path; nothing here writes to disk.
 */
/**
 * Angles to write from, so a pool of variants does not converge on one voice.
 *
 * Left to itself the model writes the same listing thirty times with the nouns
 * shuffled. Naming a different buyer question each time is what actually moves the
 * keywords apart, which is the whole point of having a pool.
 */
const ANGLES = [
  'what it protects the table from day to day',
  'how quickly it wipes clean and why that matters',
  'who the size suits and which rooms it fits',
  'how it compares to a fabric cover a buyer might own',
  'the look and finish, described plainly',
  'gifting and festive use',
  'care, washing and how long it lasts',
  'why the material was chosen for this use',
  'small-home and rented-flat practicality',
  'what a first-time buyer should check before ordering',
];

/**
 * A pool of distinct copy for one variant.
 *
 * Runs list the same product many times over, one image each. With a single stored
 * copy every one of those listings goes out word for word identical, which wastes
 * the chance to cover different search phrasings — and repeats in text the pattern
 * that already got a listing rejected for duplicate images.
 *
 * Generated deliberately and stored, never per run: a fifty-image batch still makes
 * no AI calls.
 */
export async function generateCopyPool(path, variant, count, log) {
  const pool = [];
  for (let i = 0; i < count; i++) {
    const angle = ANGLES[i % ANGLES.length];
    const avoid = pool
      .slice(-3)
      .flatMap((c) => c.searchKeywords || [])
      .slice(0, 24);
    // Titles converge faster than keywords do — the model reaches for the same
    // noun order every time — so every title already used is passed back, not just
    // the last few.
    const usedTitles = pool.map((c) => c.modelName).filter(Boolean);
    try {
      pool.push(
        await generateCopy(path, variant, log, { angle, avoid, usedTitles, index: i, total: count }),
      );
    } catch (err) {
      // One refusal should not cost the whole pool — thirty calls is thirty chances
      // to hit a quota blip, and a pool of 28 is perfectly usable.
      log(`  variant ${i + 1}/${count} failed: ${err.message}`);
    }
  }
  if (!pool.length) throw new Error(`No copy could be generated for ${variant.label}.`);
  return pool;
}

export async function generateCopy(path, variant, log, options = {}) {
  const size = `${variant.sizeInches.width}x${variant.sizeInches.length} inch`;
  const specs = buildSpecs(variant);
  // The run appends ` <SKU>` to Model Name on some paths, and the whole line has to
  // stay under 80 — so the title gets only what the SKU leaves.
  const skuRoom = path.appendSkuToModelName
    ? ` ${(variant.skuPattern || path.skuPattern || '').replace('{X}', '00000')}`
    : '';
  const titleMax = MODEL_NAME_MAX - skuRoom.length;

  const prompt = `You are writing an Indian e-commerce product listing.

PRODUCT
- Item: ${path.productType}
- Material: ${(variant.material || []).join(', ')}
- Colour: ${(variant.colorText || []).join(', ')}
- Pattern: ${(variant.pattern || []).join(', ')}
- Size: ${size}
- Fits: ${variant.seatingCapacity}
- Pack contains: ${variant.packOf} unit(s)
- Extra notes: ${path.copyNotes || 'none'}

HARD RULES
1. Never mention ANY brand name — not the seller's, not a marketplace, not a
   competitor. No brand-like proper nouns at all.
2. Write specifically for the ${size} / ${variant.seatingCapacity} size. Mention the
   size naturally where a buyer would search for it.
3. Optimise for both keyword search and AI-generated answers: plain factual
   sentences that answer what a buyer actually asks — what it protects against,
   who it is for, how to clean it. No marketing hyperbole, no invented
   certifications, no claims you cannot support from the details above.
4. Indian English. Do not mention price.
5. Do NOT write a specifications list — one is appended automatically from the
   structured product data. End with the care instructions instead.
6. Body text must be under 3500 characters.
${options.angle ? `7. This is version ${options.index + 1} of ${options.total} for the SAME product,
   each going on its own listing. Lead with: ${options.angle}. Say the same facts a
   different way — different sentence shapes, different search phrasings. Never
   contradict the details above.` : ''}
${options.avoid?.length ? `8. These phrases are already used by other versions; choose different ones:
   ${options.avoid.join(', ')}` : ''}
${options.usedTitles?.length ? `9. These titles are already taken by other versions of this product. Yours must
   differ from every one of them — reorder the attributes, lead with a different
   one, or name a different detail. Never make a title unique by numbering it —
   no "Version", "Edition", "Set 7" or counting words:
   ${options.usedTitles.map((t) => `- ${t}`).join('\n   ')}` : ''}

Return JSON exactly:
{
  "description": "body text with line breaks, no specification list",
  "searchKeywords": ["10 short lowercase search phrases, no overlap between them"],
  "keyFeatures": ["6 to 8 short feature phrases, title case"],
  "modelName": "one keyword-rich title-style line naming the size and key attributes, at most ${titleMax} characters"
}`;

  log(
    options.total
      ? `Writing copy ${options.index + 1}/${options.total} for ${variant.label} (${size})…`
      : `Writing copy for ${variant.label} (${size})…`,
  );
  // Warmer for a pool: the variants have to differ from each other to be worth having.
  const out = await callGeminiJSON(prompt, { log, temperature: options.total ? 0.95 : 0.6 });

  const brandWords = [path.brand, ...BANNED_HINTS]
    .filter(Boolean)
    .flatMap((b) => String(b).toLowerCase().split(/[\s<>]+/))
    .filter((w) => w.length > 2 && !w.startsWith('your'));

  const scrub = (text) => {
    let clean = String(text ?? '');
    for (const word of brandWords) {
      clean = clean.replace(new RegExp(`\\b${escapeRe(word)}\\b`, 'gi'), '');
    }
    return clean.replace(/[ \t]{2,}/g, ' ').trim();
  };

  const body = scrub(out.description).slice(0, 3500);

  // Seller-supplied keywords go in first and are never dropped. A model asked for
  // search phrases will not reliably include a specific term like "dohar", and the
  // terms a seller knows their buyers type are not negotiable.
  //
  // The list is cut to 10 and `extraKeywords` claim those slots first. Give a path
  // 10 extraKeywords and the generated phrases never make it in — that is a
  // deliberate trade, but keep the list shorter if you want the model to contribute.
  // How many pills the field really accepts is not settled: live listings went out
  // with 10, so any lower cap is applied by Flipkart after QC rather than by the
  // widget. `setPills` reports whatever does not fit instead of failing the run.
  const sellerKeywords = (path.extraKeywords || []).map((k) => String(k).trim()).filter(Boolean);

  // A pool exists to spread the keywords out, so the seller's fixed list cannot take
  // every slot. Several paths pin ten — the whole cap — which left all thirty
  // versions with byte-identical keywords and defeated the point entirely.
  //
  // The first few are pinned to every listing because they are the terms buyers
  // actually type. The remainder rotate, two per version, and what is left over is
  // the model's to fill — so each listing carries the core terms plus a different
  // tail.
  const PINNED = 4;
  const ROTATING = 2;
  let mustHave = sellerKeywords;
  if (options.total > 1 && sellerKeywords.length > PINNED) {
    const spares = sellerKeywords.slice(PINNED);
    const rotated = Array.from(
      { length: Math.min(ROTATING, spares.length) },
      (_, k) => spares[(options.index * ROTATING + k) % spares.length],
    );
    mustHave = [...sellerKeywords.slice(0, PINNED), ...rotated];
  }
  const seen = new Set();
  const searchKeywords = [...mustHave, ...(out.searchKeywords || []).map(scrub)]
    .map((k) => k.trim())
    .filter((k) => {
      const key = k.toLowerCase();
      if (!k || seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, 10);

  const copy = {
    specs,
    description: (body + renderSpecs(specs)).slice(0, 4500),
    searchKeywords,
    keyFeatures: (out.keyFeatures || []).map(scrub).filter(Boolean).slice(0, 8),
    modelName: fitModelName(scrub(out.modelName), '', titleMax),
    generatedAt: new Date().toISOString(),
  };

  if (!body || !copy.searchKeywords.length || !copy.keyFeatures.length) {
    throw new Error(`Gemini returned incomplete copy for ${variant.label}. Try again.`);
  }
  return copy;
}

function escapeRe(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
