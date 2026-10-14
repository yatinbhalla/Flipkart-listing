/**
 * Search the saved vertical catalogues for a product, across all three storefronts.
 *
 * Reads content/verticals/*.json (written by tools/dump-verticals.mjs) and ranks
 * entries by how many of the words appear in the path or the synonyms Flipkart
 * attaches to a vertical — "kids cloth set" is a synonym of Kids Apparel Combo,
 * though neither of its words is in the name.
 *
 * Run: node tools/find-vertical.mjs <words…> [--limit 15]
 *   e.g. node tools/find-vertical.mjs baby clothing set
 */
import fs from 'fs/promises';
import path from 'path';

const DIR = path.resolve('content/verticals');
const args = process.argv.slice(2);
const limitAt = args.indexOf('--limit');
const limit = limitAt >= 0 ? Number(args.splice(limitAt, 2)[1]) : 15;
if (!args.length) {
  console.error('usage: node tools/find-vertical.mjs <words…> [--limit 15]');
  process.exit(1);
}

// Crude stemming so "sets" finds "Set" and "clothing" finds "Clothing Set".
const stem = (w) => w.toLowerCase().replace(/(ies)$/, 'y').replace(/(es|s)$/, '');
const tokens = (t) => String(t).toLowerCase().split(/[^a-z0-9]+/).filter(Boolean).map(stem);

// The portals name one thing several ways: what a seller calls a "baby clothing
// set" Flipkart files as "Kids Apparel Combo". Each query word also matches the
// rest of its group, so the seller's own words find the portal's.
const EQUIVALENT = [
  ['baby', 'kid', 'infant', 'newborn', 'toddler', 'children'],
  ['cloth', 'clothing', 'apparel', 'garment', 'wear', 'dress'],
  ['set', 'combo', 'kit', 'pack'],
  ['towel', 'bath'],
  ['blanket', 'dohar', 'quilt', 'comforter'],
  ['table', 'dining'],
].map((group) => group.map(stem));
const expand = (w) => [...new Set([w, ...EQUIVALENT.filter((g) => g.includes(w)).flat()])];
const words = args.join(' ').split(/\s+/).filter(Boolean).map(stem).map(expand);

function score(entry) {
  const pathTokens = tokens(entry.path);
  const leafTokens = tokens(entry.name);
  const synTokens = (entry.synonyms || []).flatMap(tokens);
  let s = 0;
  for (const [w, ...alike] of words) {
    const any = (list) => list.includes(w) || alike.some((a) => list.includes(a));
    if (leafTokens.includes(w)) s += 3;
    else if (pathTokens.includes(w) || synTokens.includes(w)) s += 2;
    else if (any(leafTokens) || any(pathTokens) || any(synTokens)) s += 1.5;
    else if (pathTokens.some((t) => t.startsWith(w))) s += 1;
  }
  return s;
}

for (const file of ['FLIPKART_VERTICALS.json', 'SHOPSY_VERTICALS.json', 'MEESHO_CATEGORIES.json']) {
  const data = JSON.parse(await fs.readFile(path.join(DIR, file), 'utf8'));
  const hits = data.entries
    .map((e) => ({ e, s: score(e) }))
    .filter((h) => h.s > 0)
    .sort((a, b) => b.s - a.s || a.e.path.length - b.e.path.length)
    .slice(0, limit);
  console.log(`\n== ${file.replace('.json', '')} (saved ${data.fetchedAt})`);
  for (const { e, s } of hits) {
    const syn = e.synonyms ? `  [${e.synonyms.slice(0, 4).join(', ')}]` : '';
    console.log(`  ${String(s).padStart(4)}  ${e.path}  #${e.id}${syn}`);
  }
  if (!hits.length) console.log('  (nothing)');
}
