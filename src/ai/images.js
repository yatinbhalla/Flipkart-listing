import fs from 'fs/promises';
import path from 'path';

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
 * Gemini first because the key is already in .env and already pays for the copy.
 * OpenAI second so a Gemini quota wall does not stop a batch.
 */
const DEFAULT_PROVIDERS = ['cloudflare', 'openai'];

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
  (status === 429 && !/billing|plan|exceeded your current quota/i.test(message));

function modelsFor(provider) {
  const list = [];
  if (_working[provider]) list.push(_working[provider]);
  const pinned = process.env.IMAGE_MODEL;
  if (pinned && MODELS[provider]?.includes(pinned) && !list.includes(pinned)) list.push(pinned);
  for (const m of MODELS[provider] || []) if (!list.includes(m)) list.push(m);
  return list;
}

// ─── Gemini ───────────────────────────────────────────────────────────────────
async function gemini({ model, key, bytes, mime, prompt }) {
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
          { parts: [{ inline_data: { mime_type: mime, data: bytes.toString('base64') } }, { text: prompt }] },
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
async function cloudflare({ model, key, bytes, mime, prompt }) {
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
async function openai({ model, key, bytes, mime, prompt }) {
  const form = new FormData();
  form.append('model', model);
  form.append('prompt', prompt);
  // Custom sizes are allowed when both edges are multiples of 16 and the pixel count
  // is in range; 1200 is 16x75, so this clears Flipkart's 1100 floor natively and
  // nothing has to be resampled afterwards.
  form.append('size', `${IMAGE_EDGE}x${IMAGE_EDGE}`);
  form.append('quality', quality());
  form.append('n', '1');
  form.append('image', new Blob([bytes], { type: mime }), `reference.${mime.split('/')[1]}`);

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
  return { buffer: Buffer.from(b64, 'base64'), mime: 'image/png' };
}

const CALL = { cloudflare, openai, gemini };

/**
 * One image, from one reference photo and one prompt.
 *
 * Walks providers, then that provider's models, retrying only what is worth
 * retrying. Throws with everything that was tried when nothing worked, because
 * "image generation failed" on its own is not diagnosable.
 */
export async function generateImage({ referenceFile, prompt, log = () => {} }) {
  const bytes = await fs.readFile(referenceFile);
  const mime = mimeOf(referenceFile);

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
          const out = await CALL[provider]({ model, key, bytes, mime, prompt });
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
