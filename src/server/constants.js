/**
 * Shared constants. Deliberately imports nothing — both the run route and the
 * upload route need MAX_BATCH, and importing it from either one creates a cycle
 * (index → uploads → run → index) that can leave the value undefined at module
 * evaluation time, where it is read by `upload.array(...)`.
 */

/** Ceiling on one batch. 50 listings is already roughly an hour of unattended run. */
export const MAX_BATCH = 50;

/**
 * Axes whose variants reuse the parent's photo instead of supplying their own.
 *
 * Seating Capacity is the case: a 4-seater and a 6-seater table cover are the same
 * cloth photographed once, and Flipkart does not ask again.
 *
 * WHY this is a denylist and not a list of axes that DO need photos: it was the
 * other way round and the default was wrong. An unlisted axis silently meant "no
 * photo needed", so the UI stopped rendering per-variant pickers and the run
 * uploaded only the parent's image — no error, nothing to notice until the listing
 * was live with the wrong picture. That happened three times: 'Number of Holders'
 * on Hanging Organizers, then again when the client kept its own stale copy of the
 * list, then again when Blanket's axis turned out to be 'Brand Color'. Defaulting
 * to "this variant needs its own photo" fails loudly instead — the UI asks for an
 * image nobody wanted, which someone notices immediately.
 */
export const AXES_SHARING_PARENT_IMAGE = new Set(['Seating Capacity']);

export function variantNeedsImage(variant) {
  const axis = variant?.axis;
  if (!axis) return false; // the parent row has no axis and uses the main picker
  return !AXES_SHARING_PARENT_IMAGE.has(axis);
}
