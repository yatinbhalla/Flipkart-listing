import { skuPrefix } from './pathLabel.js';

/**
 * Collapsing case and every separator is what lets one query shape find a path
 * however the seller happens to type its SKU: `WH_MFO_SET`, `wh mfo set` and
 * `whmfoset` all fold to the same thing, and so does the `(pack of 4)` in a name
 * when the query is `4`.
 */
function fold(value) {
  return String(value ?? '')
    .toLowerCase()
    .replace(/[\s_\-/.,()&x*]+/g, '');
}

/**
 * Everything about a path worth typing at: its SKU stem, its name, its vertical
 * and brand, and each variant's stem and label.
 *
 * The variant stems matter on their own — a set path is four SKUs in one listing
 * (BM_W_BL_TD_SET, BM_W_BR_LN_SET …), so searching one of those stems has to turn
 * up the set as well as the standalone path that shares the print.
 */
function haystack(path) {
  const variants = path?.variants || [];
  return fold(
    [
      skuPrefix(path),
      path?.name,
      path?.vertical,
      path?.brand,
      path?.productType,
      ...variants.map((v) => v?.skuPattern),
      ...variants.map((v) => v?.label),
    ].join(' ')
  );
}

/**
 * Where a path ranks for a query.
 *
 * SKU stems are ordered ahead of name hits, and an exact stem ahead of a longer
 * one that merely starts with it, because the stems nest: `WH_MFO` is a prefix of
 * `WH_MFO_SET`, so typing the shorter one must not bury it under the longer.
 */
function rank(path, folded) {
  const stem = fold(skuPrefix(path));
  if (stem && stem === folded) return 0;
  if (stem && stem.startsWith(folded)) return 1;
  if (stem && stem.includes(folded)) return 2;
  if (fold(path?.name).includes(folded)) return 3;
  return 4;
}

/**
 * The paths matching `query`, best first.
 *
 * Tokens are matched independently so word order does not have to be guessed:
 * `mauve 4` and `4 mauve` both find the four-pocket mauve organizer, even though
 * the name puts "pack of 4" at the far end. An empty query returns everything in
 * the order given.
 */
export function searchPaths(paths, query) {
  const list = paths || [];
  const tokens = String(query ?? '')
    .split(/\s+/)
    .map(fold)
    .filter(Boolean);

  if (!tokens.length) return [...list];

  const folded = tokens.join('');
  return list
    .map((path, index) => ({ path, index, hay: haystack(path) }))
    .filter(({ hay }) => tokens.every((t) => hay.includes(t)))
    .map((row) => ({ ...row, score: rank(row.path, folded) }))
    // Original order breaks ties, so an unfiltered list and a broad query both
    // read in the same familiar sequence.
    .sort((a, b) => a.score - b.score || a.index - b.index)
    .map(({ path }) => path);
}
