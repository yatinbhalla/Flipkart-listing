/**
 * How a path is named in the UI.
 *
 * The SKU stem leads, because the names alone are ambiguous: four Wall Hanging
 * Organizer paths read "black multicolour floral, 3 pockets, 10x30 in" and differ
 * only by pack size, which lives in the SKU (WH_1MFO / WH_MFO / WH_4MFO /
 * WH_MFO_SET). Picking the wrong one is invisible until the listing is built.
 */

/** The fixed part of a path's SKU pattern — `BM_W_BL_DN/{X}` becomes `BM_W_BL_DN`. */
export function skuPrefix(path) {
  const pattern = path?.skuPattern || path?.variants?.[0]?.skuPattern || '';
  // Only the placeholder and the separator it leaves behind are removed. Trimming
  // other trailing punctuation would quietly eat a real character — `WH_MFO_SET`
  // ends in a token that matters.
  return String(pattern).replace(/\{X\}/gi, '').replace(/\/+$/, '').trim();
}

/** `BM_W_BL_DN — Baby Muslin Dohar (…)`, falling back to the bare name. */
export function pathLabel(path) {
  const sku = skuPrefix(path);
  return sku ? `${sku} — ${path?.name || ''}`.trim() : path?.name || '';
}
