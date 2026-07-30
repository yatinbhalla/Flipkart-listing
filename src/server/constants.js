/**
 * Shared constants. Deliberately imports nothing — both the run route and the
 * upload route need MAX_BATCH, and importing it from either one creates a cycle
 * (index → uploads → run → index) that can leave the value undefined at module
 * evaluation time, where it is read by `upload.array(...)`.
 */

/** Ceiling on one batch. 50 listings is already roughly an hour of unattended run. */
export const MAX_BATCH = 50;
