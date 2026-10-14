/**
 * Save every vertical on Flipkart, Shopsy and Meesho, so choosing one for a new
 * product is a lookup instead of a hunt through three typeaheads.
 *
 * The typeaheads are poor at this: Flipkart offers nothing useful for "baby
 * clothing set", and Shopsy's own match — "Shopsy Kids Apparel Combo" — sits under
 * "Combo Sets" rather than "Co-ords and Combo Sets", so browsing the obvious branch
 * misses it. Both portals load their complete tree when the add-listing page opens,
 * and that tree is what this saves.
 *
 *   Flipkart / Shopsy: GET /napi/listing/get-complete-category-tree?marketplace=…
 *   Meesho:            POST /api/cataloging/bulkCatalogUpload/fetchCategoryTreeOld
 *
 * Both requests are read off the page as it makes them, so the seller and supplier
 * ids come from the signed-in session rather than being written down here.
 *
 * Run: node tools/dump-verticals.mjs [flipkart] [meesho]   (no args = both)
 * Then search with: node tools/find-vertical.mjs <words>
 */
import fs from 'fs/promises';
import path from 'path';
import { getSession } from '../src/browser/session.js';
import { getMeeshoSession } from '../src/browser/meesho/session.js';

const OUT_DIR = path.resolve('content/verticals');
const ADD_LISTING_URL = 'https://seller.flipkart.com/index.html#dashboard/addListings/single';
const MEESHO_SELECT_CATEGORY_URL =
  'https://supplier.meesho.com/panel/v3/new/cataloging/vaqbo/catalogs/single/select-category';

const wanted = process.argv.slice(2).map((a) => a.toLowerCase());
const want = (name) => !wanted.length || wanted.includes(name);
const log = (t) => console.log(t);
const today = new Date().toISOString().slice(0, 10);

/** Wait for the first response whose URL matches, and return it with its body. */
function captureResponse(page, pattern, timeoutMs = 60000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      page.off('response', onResponse);
      reject(new Error(`No ${pattern} request within ${timeoutMs / 1000}s.`));
    }, timeoutMs);
    async function onResponse(res) {
      if (!pattern.test(res.url())) return;
      const body = await res.text().catch(() => '');
      if (!body) return;
      clearTimeout(timer);
      page.off('response', onResponse);
      resolve({ url: res.url(), body });
    }
    page.on('response', onResponse);
  });
}

/**
 * Flatten a Flipkart-style tree: { Category: { url, Subcategory: [vertical…] } }.
 * Keys other than arrays (the category image `url`) are not branches.
 */
function flattenFlipkartTree(tree, marketplace) {
  const rows = [];
  for (const [category, branches] of Object.entries(tree)) {
    for (const [subcategory, verticals] of Object.entries(branches)) {
      if (!Array.isArray(verticals)) continue;
      for (const v of verticals) {
        rows.push({
          path: `${category} / ${subcategory} / ${v.verticalDisplayName}`,
          name: v.verticalDisplayName,
          verticalName: v.verticalName,
          id: v.id,
          marketplace,
          synonyms: v.synonyms?.length ? v.synonyms : undefined,
          hidden: v.hidden || undefined,
        });
      }
    }
  }
  return rows;
}

async function dumpFlipkart() {
  const { page } = await getSession(log);
  const treeReq = captureResponse(page, /\/napi\/listing\/get-complete-category-tree\?/);
  await page.goto(ADD_LISTING_URL, { waitUntil: 'domcontentloaded' });
  const first = await treeReq;
  log(`Flipkart tree request seen: ${first.body.length} bytes`);

  // The page fetches only the marketplace its switch is on. The other one comes
  // from the same URL with the marketplace swapped, fetched inside the page so it
  // carries the session's cookies.
  const fetchTree = (marketplace) =>
    page.evaluate(async (url) => {
      const res = await fetch(url, { credentials: 'include' });
      if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
      return res.json();
    }, first.url.replace(/marketplace=[A-Z]+/, `marketplace=${marketplace}`));

  const flipkart = flattenFlipkartTree((await fetchTree('FLIPKART')).result, 'FLIPKART');
  const shopsy = flattenFlipkartTree((await fetchTree('SHOPSY')).result, 'SHOPSY');

  // A Shopsy vertical is its Flipkart one with a "shopsy_" prefix on the internal
  // name — shopsy_kids_apparel_combo ↔ kids_apparel_combo — even where the two sit
  // in differently named branches. Linking them answers "what is this called on the
  // other storefront" without a second search.
  const byName = (rows) => new Map(rows.map((r) => [r.verticalName, r]));
  const fkByName = byName(flipkart);
  const shByName = byName(shopsy);
  for (const r of flipkart) {
    const twin = shByName.get(`shopsy_${r.verticalName}`);
    if (twin) r.shopsy = twin.path;
  }
  for (const r of shopsy) {
    const twin = fkByName.get(r.verticalName.replace(/^shopsy_/, ''));
    if (twin) r.flipkart = twin.path;
  }

  await writeCatalogue('FLIPKART_VERTICALS.json', 'Flipkart Seller Hub', flipkart);
  await writeCatalogue('SHOPSY_VERTICALS.json', 'Flipkart Seller Hub, Shopsy switch', shopsy);
  await page.context().close().catch(() => {});
}

async function dumpMeesho() {
  const { page } = await getMeeshoSession(log);
  const treeReq = captureResponse(page, /\/fetchCategoryTreeOld/);
  await page.goto(MEESHO_SELECT_CATEGORY_URL, { waitUntil: 'domcontentloaded' });
  const { body } = await treeReq;
  log(`Meesho tree request seen: ${body.length} bytes`);

  // Four flat lists linked by parent_id, leaf to root:
  // sub-sub-category → sub-category → category → super-category.
  const levels = {};
  for (const item of JSON.parse(body).items) {
    levels[item.type] = new Map(item.data.map((n) => [n.id, n]));
  }
  const rows = [...levels['sub-sub-category'].values()].map((leaf) => {
    const sub = levels['sub-category'].get(leaf.parent_id);
    const cat = sub && levels.category.get(sub.parent_id);
    const sup = cat && levels['super-category'].get(cat.parent_id);
    const chain = [sup?.name, cat?.name, sub?.name, leaf.name].filter(Boolean);
    return {
      // The same " > " breadcrumb the category typeahead prints, which is what a
      // path config's meesho.category must match.
      path: chain.join(' > '),
      name: leaf.name,
      id: Number(leaf.id),
      minProducts: leaf.data?.min_products,
      maxProducts: leaf.data?.max_products,
    };
  });
  await writeCatalogue('MEESHO_CATEGORIES.json', 'Meesho Supplier Panel', rows);
  await page.context().close().catch(() => {});
}

/**
 * One entry per line: small diffs when a portal adds or renames a vertical, and a
 * plain grep still finds a line with its whole path on it.
 */
async function writeCatalogue(file, source, rows) {
  rows.sort((a, b) => a.path.localeCompare(b.path));
  const lines = rows.map((r) => '  ' + JSON.stringify(r));
  const text =
    `{\n "source": ${JSON.stringify(source)},\n "fetchedAt": "${today}",\n "count": ${rows.length},\n` +
    ` "entries": [\n${lines.join(',\n')}\n ]\n}\n`;
  await fs.mkdir(OUT_DIR, { recursive: true });
  await fs.writeFile(path.join(OUT_DIR, file), text);
  log(`Wrote ${rows.length} entries to content/verticals/${file}`);
}

if (want('flipkart')) await dumpFlipkart();
if (want('meesho')) await dumpMeesho();
process.exit(0);
