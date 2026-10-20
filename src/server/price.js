/**
 * Per-listing price jitter.
 *
 * Every listing of a path otherwise goes out at exactly the same price. Fifty
 * identical figures read as machine-generated next to other sellers, whose prices
 * drift by a few rupees; each listing instead takes its own price a little either
 * side of the one the seller set.
 *
 * Deliberately imports nothing, for the same reason constants.js does not: both the
 * Flipkart run and the Meesho run need it, and reaching it through either route
 * would create a cycle.
 */

/** How far below and above the seller's figure a listing may land. */
export const PRICE_JITTER_BELOW = 5;
export const PRICE_JITTER_ABOVE = 10;

/**
 * A whole-rupee price within [base - BELOW, base + ABOVE].
 *
 * `ceiling` is the MRP where one is known. A selling price above the MRP is refused
 * by the form, and no amount of variation is worth a listing that will not save —
 * so the ceiling wins over the range, and the floor of 1 wins for the same reason
 * at the other end.
 *
 * A base that is not a usable number is handed back untouched. Some paths leave the
 * price to a field they fill themselves, and inventing a figure here would be worse
 * than leaving it alone.
 *
 * Returns a string, because that is how the configs store prices and how the form
 * is typed into — handing back a number would quietly change the type a path
 * carries.
 */
export function jitterPrice(base, ceiling) {
  const price = Number(base);
  if (!Number.isFinite(price) || price <= 0) return base;
  const rounded = Math.round(price);

  const cap = Number(ceiling);
  const hi = Number.isFinite(cap) && cap > 0
    ? Math.min(rounded + PRICE_JITTER_ABOVE, Math.round(cap))
    : rounded + PRICE_JITTER_ABOVE;
  // Clamped against hi rather than assumed below it: a price already at its MRP
  // would otherwise produce an empty range.
  const lo = Math.min(Math.max(1, rounded - PRICE_JITTER_BELOW), hi);

  return String(lo + Math.floor(Math.random() * (hi - lo + 1)));
}
