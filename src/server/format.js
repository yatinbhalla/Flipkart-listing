/**
 * How a run reports what it produced.
 *
 * A bare SKU is not much use once a batch has finished — the reason to read the log
 * afterwards is to confirm each listing went out at the intended price, and a
 * mispriced listing is expensive to notice late.
 */

/** `₹1,299` — grouped the Indian way. Null when there is no usable number. */
export function money(amount) {
  const n = Number(amount);
  return Number.isFinite(n) && String(amount ?? '').trim() !== ''
    ? `\u20b9${n.toLocaleString('en-IN')}`
    : null;
}

/** `TC_BT/12345 ₹449`, degrading to the bare SKU when a variant carries no price. */
export function skuWithPrice(v) {
  const price = money(v?.sellingPrice);
  return price ? `${v.sku} ${price}` : String(v?.sku ?? '');
}

/**
 * Every variant of one listing: `PARENT ₹449 · CHILD ₹499`.
 *
 * All variants, not just the parent: they carry different SKUs AND different
 * prices, so reporting only the parent hides the number actually charged for the
 * other sizes or pack counts.
 */
export function describeListing(resolved) {
  return (resolved || []).map(skuWithPrice).filter(Boolean).join(' \u00b7 ');
}

/** The structured form, for clients that render it themselves. */
export function listingSkus(resolved) {
  return (resolved || []).map((v) => ({
    sku: v.sku,
    label: v.label || v.key || null,
    sellingPrice: v.sellingPrice ?? null,
    mrp: v.mrp ?? null,
  }));
}
