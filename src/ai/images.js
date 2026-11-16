import fs from 'fs/promises';
import path from 'path';
import sharp from 'sharp';

/**
 * Turns one of a path's real product photos into a listing front image in a new
 * setting.
 *
 * Deliberately an EDIT of a photograph, never a picture invented from a description.
 * The cloth's colour, weave and border come from a photo of the item that actually
 * ships, so the listing is not promising something else; only the table it is lying
 * on changes. A product drawn from a text prompt would be a different product.
 *
 * Plain fetch rather than a vendor SDK, for two reasons: the installed
 * @google/generative-ai (0.21.0) cannot request image output at all — its
 * GenerationConfig has no responseModalities — and both providers here are a single
 * JSON or multipart POST, so one small adapter beats two more dependencies.
 */

/**
 * Providers in the order they are tried, overridable with IMAGE_PROVIDERS.
 *
 * OpenAI only. Its /images/edits endpoint really edits the photo it is given;
 * Cloudflare's FLUX klein came back with a completely different product, so it is
 * no longer a fallback — a wrong picture is worse than a failed one. It can still
 * be opted into with IMAGE_PROVIDERS=openai,cloudflare.
 */
const DEFAULT_PROVIDERS = ['openai'];

/** Flipkart's minimum is 1100px; ask for 1200 so nothing has to be upscaled afterwards. */
export const IMAGE_EDGE = 1200;

/**
 * Per-provider model fallback, cheapest first — the same strategy as
 * src/ai/client.js, and for the same reason: which models a key may call varies by
 * account, and a 404 on one should move to the next rather than fail the run.
 *
 * Read off this account's own ListModels response on 2026-10-20.
 */
const MODELS = {
  // klein-4b first: ~173 neurons an image against a 10,000/day free allowance, so
  // roughly 57 free images a day — a whole batch. 9b is ten times the cost.
  cloudflare: ['@cf/black-forest-labs/flux-2-klein-4b', '@cf/black-forest-labs/flux-2-klein-9b'],
  // Sunburst is the editing-precision model of the pair; Flare is the fast one.
  openai: ['gpt-image-2.5-sunburst', 'gpt-image-2.5-flare'],
  // Kept out of the default chain: image generation has no free tier on this API
  // (limit: 0), so it only works once billing is on a Google Cloud project.
  gemini: [
    'gemini-3.1-flash-lite-image',
    'gemini-3.1-flash-image',
    'gemini-2.5-flash-image',
    'gemini-3-pro-image',
  ],
};

/** Cheapest first until the review grid says the product is not holding up. */
const quality = () => process.env.IMAGE_QUALITY || 'low';

/**
 * References are sent downscaled.
 *
 * Input images dominate the bill and the latency, and the detail is not needed:
 * measured against gpt-image-2.5-sunburst, a 1200px reference costs about 1,520
 * image-input tokens against 1,024 at 512px, and two 1200px references took 149
 * seconds where two at 512px took 27 — for a result that was, if anything, better.
 */
export const REFERENCE_EDGE = Number(process.env.IMAGE_REFERENCE_EDGE) || 512;

async function shrinkReference(file) {
  const bytes = await sharp(file)
    .resize(REFERENCE_EDGE, REFERENCE_EDGE, { fit: 'inside', withoutEnlargement: true })
    .png()
    .toBuffer();
  return { bytes, mime: 'image/png', name: `${path.basename(file, path.extname(file))}.png` };
}

const MAX_RETRIES = 2;
/** The model that last worked, per provider, so a batch probes once and not fifty times. */
const _working = {};

const usable = (v) => (v && !/^your_.*_here$/.test(v) ? v : null);

const keyFor = (provider) => {
  if (provider === 'cloudflare') {
    // Needs both halves; an account id without a token is not a usable provider.
    return usable(process.env.CLOUDFLARE_API_TOKEN) && usable(process.env.CLOUDFLARE_ACCOUNT_ID)
      ? process.env.CLOUDFLARE_API_TOKEN
      : null;
  }
  if (provider === 'gemini') return usable(process.env.GEMINI_API_KEY);
  return usable(process.env.OPENAI_API_KEY);
};

const mimeOf = (file) => {
  const ext = path.extname(file).toLowerCase();
  if (ext === '.jpg' || ext === '.jpeg') return 'image/jpeg';
  if (ext === '.webp') return 'image/webp';
  return 'image/png';
};

/**
 * A transient 429 or a 5xx is worth waiting out; a 400 or 404 is not.
 *
 * A 429 that talks about plans and billing is a tier wall, not a burst limit — it
 * will say the same thing in four seconds, so backing off twice per model only
 * delays a failure the seller needs to read.
 */
const retryable = (status, message = '') =>
  (status >= 500 && status < 600) ||
  (status === 429 && !/billing|plan|exceeded your current quota/i.test(message)) ||
  // No status at all means fetch never got an answer. Seen three times in testing —
  // ENOTFOUND, ECONNRESET and a bare "fetch failed" — and it matters more now that a
  // variation path makes one batch per variant: twenty calls where there used to be
  // five, and a dropped connection on any of them left that variant short.
  (!status && /fetch failed|network|socket|ECONNRESET|ENOTFOUND|ETIMEDOUT|EAI_AGAIN|aborted/i.test(message));

function modelsFor(provider) {
  const list = [];
  if (_working[provider]) list.push(_working[provider]);
  const pinned = process.env.IMAGE_MODEL;
  if (pinned && MODELS[provider]?.includes(pinned) && !list.includes(pinned)) list.push(pinned);
  for (const m of MODELS[provider] || []) if (!list.includes(m)) list.push(m);
  return list;
}

// ─── Gemini ───────────────────────────────────────────────────────────────────
async function gemini({ model, key, refs, prompt }) {
  // Gemini takes several inline parts; send every reference it was given.
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      // Shape copied from the seller's EcomLens app, which does this successfully
      // against a billed project: the image part FIRST, then the text, and an
      // imageConfig aspect ratio rather than responseModalities.
      body: JSON.stringify({
        contents: [
          {
            parts: [
              ...refs.map((r) => ({ inline_data: { mime_type: r.mime, data: r.bytes.toString('base64') } })),
              { text: prompt },
            ],
          },
        ],
        generationConfig: { imageConfig: { aspectRatio: '1:1' } },
      }),
    },
  );

  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(json.error?.message || `HTTP ${res.status}`);
    err.status = res.status;
    throw err;
  }

  const parts = json.candidates?.[0]?.content?.parts || [];
  // The field is inlineData over REST and inline_data in some responses; accept both
  // rather than silently returning "no image" for a response that has one.
  const found = parts.find((p) => p.inlineData || p.inline_data);
  if (!found) {
    const said = parts.find((p) => p.text)?.text || '';
    const err = new Error(`returned no image${said ? ` — it said: ${said.slice(0, 160)}` : ''}`);
    err.status = 422;
    throw err;
  }
  const data = found.inlineData?.data ?? found.inline_data?.data;
  const outMime = found.inlineData?.mimeType ?? found.inline_data?.mime_type ?? 'image/png';
  return { buffer: Buffer.from(data, 'base64'), mime: outMime };
}

// ─── Cloudflare Workers AI ────────────────────────────────────────────────────
/**
 * FLUX.2 [klein] on Workers AI.
 *
 * Cloudflare documents this model's input only as `multipart` and does not publish
 * the field names, so the first call against a real token is partly a probe. Rather
 * than guess silently, a rejection carries Cloudflare's own validation text back to
 * the caller — the API names the fields it wanted, which is how this gets pinned.
 */
async function cloudflare({ model, key, refs, prompt }) {
  // Opt-in only, and it ignores the reference anyway — first one is plenty.
  const { bytes, mime } = refs[0];
  const account = process.env.CLOUDFLARE_ACCOUNT_ID;
  const url = `https://api.cloudflare.com/client/v4/accounts/${account}/ai/run/${model}`;

  const form = new FormData();
  form.append('prompt', prompt);
  form.append('width', String(IMAGE_EDGE));
  form.append('height', String(IMAGE_EDGE));
  form.append('image', new Blob([bytes], { type: mime }), `reference.${mime.split('/')[1] || 'png'}`);

  const res = await fetch(url, { method: 'POST', headers: { Authorization: `Bearer ${key}` }, body: form });
  const json = await res.json().catch(() => ({}));

  if (!res.ok || json.success === false) {
    const said = (json.errors || []).map((e) => e.message || JSON.stringify(e)).join('; ');
    const err = new Error(said || `HTTP ${res.status}`);
    err.status = res.status;
    throw err;
  }

  // Documented output: `image`, a base64 string.
  const b64 = json.result?.image ?? json.result?.images?.[0];
  if (!b64) {
    const err = new Error(`no image in response (keys: ${Object.keys(json.result || {}).join(', ') || 'none'})`);
    err.status = 422;
    throw err;
  }
  return { buffer: Buffer.from(b64, 'base64'), mime: 'image/png' };
}

// ─── OpenAI ───────────────────────────────────────────────────────────────────
async function openai({ model, key, refs, prompt }) {
  const form = new FormData();
  form.append('model', model);
  form.append('prompt', prompt);
  // NOT sent, though both look like the obvious fix and the docs are ambiguous about
  // them: gpt-image-2.5-sunburst rejects `input_fidelity` and `complexity` outright
  // with HTTP 400. Fidelity here comes from sending the right photographs, not a flag.
  // Custom sizes are allowed when both edges are multiples of 16 and the pixel count
  // is in range; 1200 is 16x75, so this clears Flipkart's 1100 floor natively and
  // nothing has to be resampled afterwards.
  form.append('size', `${IMAGE_EDGE}x${IMAGE_EDGE}`);
  form.append('quality', quality());
  form.append('n', '1');
  // Repeated image[] rather than a single image: the endpoint takes up to 16, and
  // more views of the same product is the lever that actually improved fidelity.
  for (const r of refs) form.append('image[]', new Blob([r.bytes], { type: r.mime }), r.name);

  const res = await fetch('https://api.openai.com/v1/images/edits', {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}` },
    body: form,
  });

  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(json.error?.message || `HTTP ${res.status}`);
    err.status = res.status;
    throw err;
  }
  const b64 = json.data?.[0]?.b64_json;
  if (!b64) {
    const err = new Error('returned no image');
    err.status = 422;
    throw err;
  }
  return { buffer: Buffer.from(b64, 'base64'), mime: 'image/png', usage: json.usage };
}

/**
 * What one call actually cost, from the usage the API returns rather than an estimate.
 *
 * Published rates: $8 per 1M image input tokens, $5 per 1M text input, $30 per 1M
 * image output.
 */
export function describeUsage(usage) {
  if (!usage) return null;
  const d = usage.input_tokens_details || {};
  const image = d.image_tokens ?? 0;
  const text = d.text_tokens ?? 0;
  const out = usage.output_tokens ?? 0;
  const dollars = (image * 8 + text * 5 + out * 30) / 1e6;
  return { image, text, out, dollars, label: `${image}+${text} in, ${out} out ≈ $${dollars.toFixed(4)}` };
}

const CALL = { cloudflare, openai, gemini };

/**
 * One image, from one reference photo and one prompt.
 *
 * Walks providers, then that provider's models, retrying only what is worth
 * retrying. Throws with everything that was tried when nothing worked, because
 * "image generation failed" on its own is not diagnosable.
 */
export async function generateImage({ referenceFiles, referenceFile, prompt, log = () => {} }) {
  // Several photographs of one product beat one: measured on the hooded towel, adding
  // the close weave shot to the flat-lay fixed a towelling texture the flat-lay alone
  // did not convey. referenceFile stays accepted so older callers keep working.
  const files = (referenceFiles?.length ? referenceFiles : [referenceFile]).filter(Boolean);
  if (!files.length) throw new Error('No reference photograph to work from.');

  const refs = await Promise.all(files.map(shrinkReference));

  const providers = (process.env.IMAGE_PROVIDERS || DEFAULT_PROVIDERS.join(','))
    .split(',')
    .map((p) => p.trim().toLowerCase())
    .filter((p) => CALL[p]);

  const tried = [];
  for (const provider of providers) {
    const key = keyFor(provider);
    if (!key) {
      tried.push(`${provider}: no API key`);
      continue;
    }

    for (const model of modelsFor(provider)) {
      for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
        try {
          const out = await CALL[provider]({ model, key, refs, prompt });
          if (_working[provider] !== model) {
            log(`✓ Images via ${provider} · ${model}`);
            _working[provider] = model;
          }
          return { ...out, provider, model };
        } catch (err) {
          const status = err.status ?? 0;
          if (retryable(status, err.message) && attempt < MAX_RETRIES) {
            await new Promise((r) => setTimeout(r, 2 ** (attempt + 1) * 1000));
            continue;
          }
          tried.push(`${provider}/${model}: ${err.message}`);
          break; // next model
        }
      }
    }
  }

  throw new Error(`Could not generate an image. Tried — ${tried.join(' | ')}`);
}

/** Whether any configured provider has a key, for the UI to grey the mode out. */
export function imageProvidersReady() {
  const providers = (process.env.IMAGE_PROVIDERS || DEFAULT_PROVIDERS.join(','))
    .split(',')
    .map((p) => p.trim().toLowerCase())
    .filter((p) => CALL[p]);
  return providers.filter((p) => keyFor(p));
}
