import fs from 'fs/promises';
import path from 'path';

const DATA = path.resolve('data');
const PATHS_DIR = path.join(DATA, 'paths');
const SKU_FILE = path.join(DATA, 'used_skus.json');

export const pathDir = (id) => path.join(PATHS_DIR, id);
export const sharedImagesDir = (id) => path.join(pathDir(id), 'shared_images');

async function readJson(file, fallback) {
  try {
    return JSON.parse(await fs.readFile(file, 'utf8'));
  } catch {
    return fallback;
  }
}

// ─── Paths ─────────────────────────────────────────────────────────────────────

export async function listPaths() {
  await fs.mkdir(PATHS_DIR, { recursive: true });
  const entries = await fs.readdir(PATHS_DIR, { withFileTypes: true });
  const out = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const config = await readJson(path.join(pathDir(entry.name), 'config.json'), null);
    if (!config) continue;
    config.id = entry.name;
    config._sharedImagesReady = await sharedImagesReady(entry.name);
    out.push(config);
  }
  return out;
}

export async function getPath(id) {
  const config = await readJson(path.join(pathDir(id), 'config.json'), null);
  if (!config) return null;
  config.id = id;
  config._sharedImagesReady = await sharedImagesReady(id);
  return config;
}

export async function savePath(id, config) {
  await fs.mkdir(pathDir(id), { recursive: true });
  const clean = { ...config };
  delete clean.id;
  delete clean._sharedImagesReady;
  clean.updatedAt = new Date().toISOString();
  if (!clean.createdAt) clean.createdAt = clean.updatedAt;
  await fs.writeFile(path.join(pathDir(id), 'config.json'), JSON.stringify(clean, null, 2), 'utf8');
  return getPath(id);
}

export async function deletePath(id) {
  await fs.rm(pathDir(id), { recursive: true, force: true });
}

/**
 * Images 2–5 are the same for every listing on a path, so they are uploaded once
 * and reused. Only the Front View changes per listing (and per Colour / Pack-of
 * variant), which is what the user supplies at run time.
 */
export async function sharedImagesReady(id) {
  try {
    const files = await fs.readdir(sharedImagesDir(id));
    return ['img2', 'img3', 'img4', 'img5'].every((slot) =>
      files.some((f) => f.startsWith(slot + '.')),
    );
  } catch {
    return false;
  }
}

export async function sharedImagePaths(id) {
  const dir = sharedImagesDir(id);
  const files = await fs.readdir(dir).catch(() => []);
  return ['img2', 'img3', 'img4', 'img5'].map((slot) => {
    const hit = files.find((f) => f.startsWith(slot + '.'));
    return hit ? path.join(dir, hit) : null;
  });
}

/**
 * Flatten a path's shared defaults and one variant's overrides into a single
 * object. Nested groups are merged rather than replaced so a variant can override
 * just the package height without restating the whole group.
 */
export function resolveVariant(path, variant) {
  return {
    ...path.shared,
    ...variant,
    package: { ...(path.shared.package || {}), ...(variant.package || {}) },
    sizeInches: { ...(path.shared.sizeInches || {}), ...(variant.sizeInches || {}) },
  };
}

// ─── SKUs ──────────────────────────────────────────────────────────────────────

/**
 * Allocate a SKU from a pattern like `TC_BT/{X}` or `TC_60*90_BT/{X}`, where {X}
 * is a random 5-digit number.
 *
 * The ledger is append-only and consulted before every allocation, so a SKU is
 * never reused across runs — a duplicate SKU is rejected by Flipkart and wastes
 * a whole listing attempt.
 */
export async function allocateSku(pattern) {
  const used = new Set(await readJson(SKU_FILE, []));
  if (!pattern.includes('{X}')) {
    if (used.has(pattern)) throw new Error(`SKU "${pattern}" has already been used.`);
    await commitSku(pattern);
    return pattern;
  }
  for (let attempt = 0; attempt < 200; attempt++) {
    const sku = pattern.replace('{X}', String(Math.floor(10000 + Math.random() * 90000)));
    if (used.has(sku)) continue;
    await commitSku(sku);
    return sku;
  }
  throw new Error(`Could not find an unused SKU for pattern "${pattern}" after 200 tries.`);
}

async function commitSku(sku) {
  await fs.mkdir(DATA, { recursive: true });
  const used = await readJson(SKU_FILE, []);
  used.push(sku);
  await fs.writeFile(SKU_FILE, JSON.stringify(used, null, 2), 'utf8');
}

export async function listSkus() {
  return readJson(SKU_FILE, []);
}
