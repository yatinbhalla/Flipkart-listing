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

/**
 * How far a listing may drift, per storefront, because the number the seller types
 * does not mean the same thing on each.
 *
 * On Flipkart the figure is the CUSTOMER-FACING price, and shipping is deducted
 * from it afterwards by size and weight. Drifting it down a little costs a few
 * rupees of margin and is exactly the variation this feature is for.
 *
 * On Meesho the figure is the SETTLEMENT the seller wants to receive — Meesho adds
 * shipping on top for the buyer. So a downward draw there is a direct cut to what
 * lands in the account, on top of a per-piece deduction that is roughly fixed
 * rather than proportional (about Rs10 on a 5% GST item, about Rs2 on an 18% one).
 * That bites hardest at the bottom of the catalogue: on a Rs110 path the Rs10 is
 * already 9% of settlement. Meesho therefore never draws below the seller's own
 * figure — it is a floor they chose deliberately — and the buyer still sees a
 * varying price, because shipping is added to whatever is set.
 */
export const JITTER_BANDS = {
  flipkart: { below: 5, above: 10 },
  shopsy: { below: 5, above: 10 },
  meesho: { below: 0, above: 10 },
};

/** The default band, kept as named exports because the UI quotes the numbers. */
export const PRICE_JITTER_BELOW = JITTER_BANDS.flipkart.below;
export const PRICE_JITTER_ABOVE = JITTER_BANDS.flipkart.above;

/**
 * A whole-rupee price within the storefront's band around `base`.
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
export function jitterPrice(base, ceiling, storefront = 'flipkart') {
  const price = Number(base);
  if (!Number.isFinite(price) || price <= 0) return base;
  const rounded = Math.round(price);

  const band = JITTER_BANDS[String(storefront).toLowerCase()] || JITTER_BANDS.flipkart;

  const cap = Number(ceiling);
  const hi =
    Number.isFinite(cap) && cap > 0
      ? Math.min(rounded + band.above, Math.round(cap))
      : rounded + band.above;
  // Clamped against hi rather than assumed below it: a price already at its MRP
  // would otherwise produce an empty range.
  const lo = Math.min(Math.max(1, rounded - band.below), hi);

  return String(lo + Math.floor(Math.random() * (hi - lo + 1)));
}
