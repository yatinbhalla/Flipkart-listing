/**
 * Writes the customer-facing copy for one variant: description, search keywords,
 * key features, and the Model Name.
 *
 * Two hard constraints, both enforced after generation as well as in the prompt:
 *
 *  - NO BRAND NAMES ANYWHERE, including the seller's own. Flipkart QC rejects
 *    brand mentions inside description/keyword fields.
 *  - Copy is written per variant. A 60x90 six-seater cover must not reuse the
 *    40x60 four-seater's text, or every variant reads identically and the
 *    size-specific keywords are wrong.
 */

import { callGeminiJSON } from './client.js';

const BANNED_HINTS = ['flipkart', 'amazon', 'meesho', 'myntra', 'ajio'];

export async function generateCopy(path, variant, log) {
  const size = `${variant.sizeInches.width}x${variant.sizeInches.length} inch`;
  const prompt = `You are writing an Indian e-commerce product listing.

PRODUCT
- Item: ${path.productType}
- Material: ${(path.shared.material || []).join(', ')}
- Colour: ${(path.shared.colorText || []).join(', ')}
- Pattern: ${(path.shared.pattern || []).join(', ')}
- Size: ${size}
- Fits: ${variant.seatingCapacity}
- Pack contains: ${variant.packOf} unit(s)
- Extra notes: ${path.copyNotes || 'none'}

HARD RULES
1. Never mention ANY brand name — not the seller's, not a marketplace, not a
   competitor. No brand-like proper nouns at all.
2. Write specifically for the ${size} / ${variant.seatingCapacity} size. Mention the
   size naturally where a buyer would search for it.
3. Optimise for both keyword search and AI-generated answers: use plain factual
   sentences, answer the questions a buyer would ask (what does it protect
   against, who is it for, how do you clean it), and include a short specification
   list. No marketing hyperbole, no invented certifications, no fake claims.
4. Indian English. Rupees only if you mention price — better not to.
5. Description must be under 4500 characters.

Return JSON exactly:
{
  "description": "full description text with line breaks",
  "searchKeywords": ["10 to 14 short lowercase search phrases"],
  "keyFeatures": ["6 to 8 short feature phrases, title case"],
  "modelName": "one keyword-rich title-style line naming the size and key attributes"
}`;

  log(`Writing copy for ${variant.label} (${size})…`);
  const out = await callGeminiJSON(prompt, { log, temperature: 0.6 });

  const brandWords = [path.brand, ...BANNED_HINTS]
    .filter(Boolean)
    .flatMap((b) => String(b).toLowerCase().split(/\s+/))
    .filter((w) => w.length > 2);

  const scrub = (text) => {
    let clean = String(text ?? '');
    for (const word of brandWords) {
      clean = clean.replace(new RegExp(`\\b${escapeRe(word)}\\b`, 'gi'), '').replace(/\s{2,}/g, ' ');
    }
    return clean.trim();
  };

  const result = {
    description: scrub(out.description).slice(0, 4500),
    searchKeywords: (out.searchKeywords || []).map(scrub).filter(Boolean).slice(0, 14),
    keyFeatures: (out.keyFeatures || []).map(scrub).filter(Boolean).slice(0, 8),
    modelName: scrub(out.modelName),
  };

  if (!result.description || !result.searchKeywords.length || !result.keyFeatures.length) {
    throw new Error(`Gemini returned incomplete copy for ${variant.label}. Retry, or fill it manually.`);
  }
  return result;
}

function escapeRe(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
