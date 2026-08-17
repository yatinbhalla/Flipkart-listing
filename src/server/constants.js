/**
 * Shared constants. Deliberately imports nothing — both the run route and the
 * upload route need MAX_BATCH, and importing it from either one creates a cycle
 * (index → uploads → run → index) that can leave the value undefined at module
 * evaluation time, where it is read by `upload.array(...)`.
 */

/** Ceiling on one batch. 50 listings is already roughly an hour of unattended run. */
export const MAX_BATCH = 50;

/**
 * Which variant axes require their own Front View image?
 *
 * Seating Capacity variants are the same product photographed once — Flipkart does
 * not ask for another image. Colour and Pack-of variants look different, so each
 * needs its own front image.
 *
 * Number of Holders is the ONLY axis the Hanging Organizers vertical offers — no
 * Pack of, no Color — and there it carries the pack size (3 holders per panel, so
 * 3 / 6 / 12 is a pack of 1 / 2 / 4). A one-panel photo and a four-panel photo are
 * different pictures, so it belongs here.
 *
 * WHY it lives in this file: the run route and the RunPanel each used to keep their
 * own copy, and adding an axis to the server's list without the client's made the
 * UI quietly stop asking for per-variant photos — it rendered a single batch picker
 * for a path that needed three images. One definition, imported by both.
 */
export const AXES_NEEDING_IMAGE = new Set(['Color', 'Pack of', 'Number of Holders']);

export function variantNeedsImage(variant) {
  return AXES_NEEDING_IMAGE.has(variant?.axis);
}
