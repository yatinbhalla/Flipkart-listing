import fs from 'fs/promises';

/**
 * Asks a model to look at the real photograph and the generated one and say whether
 * they show the same product.
 *
 * This exists because the cheap way does not work. Three pixel heuristics were
 * written and measured against this catalogue and all three were removed: a
 * perceptual hash rated a DIFFERENT product closer than the same product shot from
 * another angle; dominant and centre-crop colour could not separate them either,
 * because the photographs are mostly white backdrop; and edge density scored an
 * image with lettering burned across it BELOW a plain photo. Nothing in the bytes
 * answers "is this still my product", so something that can actually look has to.
 *
 * Kept out of validate.js deliberately: everything there is offline and
 * deterministic, and mixing a network call into it would make a local check depend
 * on a key and a connection.
 *
 * Measured cost: about $0.0001 a check, roughly half a percent of the image it is
 * checking. On that price there is no reason to skip it.
 */

const MODEL = () => process.env.IMAGE_VERIFY_MODEL || 'gpt-6-luna';

const ASK = [
  "Image 1 is the seller's real product photograph. Image 2 is a generated listing photo.",
  'Decide whether image 2 shows THE SAME product as image 1 — same item type, same colour,',
  'same pattern, same applied details such as embroidery, trim or border.',
  'The background, setting, framing and how the item is folded or arranged are EXPECTED to',
  'differ; none of those is a mismatch. Judge the product only.',
  'Reply as JSON only: {"same": true|false, "confidence": 0-1, "differences": "<short phrase>"}',
].join(' ');

const dataUrl = async (file) => `data:image/png;base64,${(await fs.readFile(file)).toString('base64')}`;

/**
 * `null` means "not checked" — no key, or the call failed — which the caller must
 * show as unverified rather than treating as a pass. A guardrail that silently
 * reports success when it did not run is worse than none.
 */
export async function verifyProduct({ reference, candidate, log = () => {} }) {
  const key = process.env.OPENAI_API_KEY;
  if (!key || /^your_.*_here$/.test(key)) return null;

  try {
    const body = {
      model: MODEL(),
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: ASK },
            // `detail: low` keeps this at a few hundred tokens; the question is about
            // the product's identity, not its stitching.
            { type: 'image_url', image_url: { url: await dataUrl(reference), detail: 'low' } },
            { type: 'image_url', image_url: { url: await dataUrl(candidate), detail: 'low' } },
          ],
        },
      ],
    };

    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
      log(`  product check unavailable: ${(json.error?.message || `HTTP ${res.status}`).slice(0, 90)}`);
      return null;
    }

    const text = json.choices?.[0]?.message?.content ?? '';
    const parsed = JSON.parse(text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/, '').trim());
    return {
      same: Boolean(parsed.same),
      confidence: Number(parsed.confidence) || 0,
      differences: String(parsed.differences || '').slice(0, 160),
    };
  } catch (err) {
    log(`  product check unavailable: ${String(err.message).slice(0, 90)}`);
    return null;
  }
}

/**
 * Turn a verdict into the flag the review grid shows.
 *
 * A "not the same product" is only hard-blocked when the model is confident. On the
 * first real batch it rejected an image for having "a plain beak" where the product
 * has a striped one — but the horn WAS striped, just more faintly than in the macro
 * shot, and it had read the unicorn horn as a beak. The product was right. Blocking
 * on that would mean discarding usable images over fine detail, so a low-confidence
 * mismatch is raised for the seller to look at rather than decided for them. The
 * confidence is shown, because "0.55 sure" and "0.98 sure" deserve different
 * reactions and hiding the number invites treating them the same.
 */
const BLOCK_BELOW = 0.8;

export function verdictFlag(verdict) {
  if (!verdict) {
    return { level: 'warn', text: 'product not verified — check it yourself before using' };
  }
  const sure = `${Math.round(verdict.confidence * 100)}% sure`;
  if (!verdict.same) {
    return verdict.confidence >= BLOCK_BELOW
      ? { level: 'error', text: `not the same product (${sure}): ${verdict.differences}` }
      : { level: 'warn', text: `may not match (${sure}): ${verdict.differences}` };
  }
  if (verdict.confidence < 0.7) {
    return { level: 'warn', text: `match uncertain (${sure}): ${verdict.differences}` };
  }
  return null;
}
