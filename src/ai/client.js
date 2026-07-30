import { GoogleGenerativeAI } from '@google/generative-ai';

// Same fallback strategy as the Meesho lister: free-tier model availability varies
// by account and region, so try the list in order and cache the first that works.
// Lite variants come first — the most generous free quota.
const MODEL_FALLBACK = [
  'gemini-2.5-flash-lite',
  'gemini-2.0-flash-lite',
  'gemini-flash-lite-latest',
  'gemini-2.5-flash',
  'gemini-2.0-flash',
  'gemini-flash-latest',
];

const MAX_RETRIES = 2;
let _client = null;
let _workingModel = null;

function getClient() {
  const key = process.env.GEMINI_API_KEY;
  if (!key || key === 'your_gemini_api_key_here') {
    throw new Error(
      'No Gemini API key. Put GEMINI_API_KEY in .env — get one at https://aistudio.google.com/app/apikey',
    );
  }
  if (!_client) _client = new GoogleGenerativeAI(key);
  return _client;
}

export async function callGeminiJSON(prompt, opts = {}) {
  const log = (m) => (opts.log ? opts.log(m) : null);
  const client = getClient();

  const candidates = [];
  if (_workingModel) candidates.push(_workingModel);
  if (process.env.GEMINI_MODEL && !candidates.includes(process.env.GEMINI_MODEL)) {
    candidates.push(process.env.GEMINI_MODEL);
  }
  for (const m of MODEL_FALLBACK) if (!candidates.includes(m)) candidates.push(m);

  for (const modelName of candidates) {
    try {
      const model = client.getGenerativeModel({
        model: modelName,
        generationConfig: {
          responseMimeType: 'application/json',
          temperature: opts.temperature ?? 0.7,
        },
      });
      const text = await callWithRetry(model, prompt);
      if (_workingModel !== modelName) {
        log(`✓ Using model: ${modelName}`);
        _workingModel = modelName;
      }
      return parseJSON(text);
    } catch (err) {
      if (err.code === 'MODEL_NOT_ACCESSIBLE') {
        log(`⚠ ${modelName} not accessible — trying next…`);
        continue;
      }
      throw new Error(friendly(err));
    }
  }
  throw new Error(`No accessible Gemini model for this key. Tried: ${candidates.join(', ')}`);
}

async function callWithRetry(model, prompt) {
  let lastErr;
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      const result = await model.generateContent(prompt);
      return result.response.text();
    } catch (err) {
      lastErr = err;
      const msg = String(err.message || err);
      if (msg.includes('404') || /not found/i.test(msg) || /limit:\s*0/.test(msg)) {
        const tagged = new Error(msg);
        tagged.code = 'MODEL_NOT_ACCESSIBLE';
        throw tagged;
      }
      const is429 = msg.includes('429') || /quota|rate/i.test(msg);
      if (!is429 || attempt === MAX_RETRIES) break;
      const m = msg.match(/retry in ([\d.]+)s/i);
      const delay = m ? Math.min(parseFloat(m[1]) + 0.5, 30) : 2 ** (attempt + 1);
      await new Promise((r) => setTimeout(r, delay * 1000));
    }
  }
  throw lastErr;
}

function parseJSON(text) {
  try {
    return JSON.parse(text);
  } catch {
    return JSON.parse(text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/, '').trim());
  }
}

function friendly(err) {
  const msg = String(err.message || err);
  if (/API key|401|403/.test(msg)) return 'Gemini API key is invalid or unauthorized. Check GEMINI_API_KEY in .env.';
  if (/429|quota/i.test(msg)) return 'Gemini rate limit hit and retries exhausted. Wait a minute and retry.';
  return msg;
}
