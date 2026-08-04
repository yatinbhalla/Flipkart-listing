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
  add('Colour', list(variant.colorText ?? variant.brandColor ?? variant.color));
  add('Pattern', list(variant.pattern));
  add('Type', variant.type);
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
function renderSpecs(specs) {
  if (!specs.length) return '';
  return `\n\nSpecifications\n${specs.map((s) => `${s.label}: ${s.value}`).join('\n')}`;
}

/**
 * Generate and return the copy bundle for one variant. Callers persist the result
 * onto the path; nothing here writes to disk.
 */
export async function generateCopy(path, variant, log) {
  const size = `${variant.sizeInches.width}x${variant.sizeInches.length} inch`;
  const specs = buildSpecs(variant);

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

Return JSON exactly:
{
  "description": "body text with line breaks, no specification list",
  "searchKeywords": ["10 to 14 short lowercase search phrases"],
  "keyFeatures": ["6 to 8 short feature phrases, title case"],
  "modelName": "one keyword-rich title-style line naming the size and key attributes"
}`;

  log(`Writing copy for ${variant.label} (${size})…`);
  const out = await callGeminiJSON(prompt, { log, temperature: 0.6 });

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
  // "10 to 14 search phrases" will not reliably include a specific term like
  // "dohar", and the terms a seller knows their buyers type are not negotiable.
  const mustHave = (path.extraKeywords || []).map((k) => String(k).trim()).filter(Boolean);
  const seen = new Set();
  const searchKeywords = [...mustHave, ...(out.searchKeywords || []).map(scrub)]
    .map((k) => k.trim())
    .filter((k) => {
      const key = k.toLowerCase();
      if (!k || seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, 20);

  const copy = {
    specs,
    description: (body + renderSpecs(specs)).slice(0, 4500),
    searchKeywords,
    keyFeatures: (out.keyFeatures || []).map(scrub).filter(Boolean).slice(0, 8),
    modelName: scrub(out.modelName),
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
