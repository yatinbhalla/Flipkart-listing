import React, { useState } from 'react';

const SLOT_LABELS = {
  img2: 'Close Up',
  img3: 'Edge / Flipside',
  img4: 'Flip Side / Life Style',
  img5: 'Package',
};

/**
 * The selected path's saved images, pinned top-right.
 *
 * Exists to stop the wrong Front View being uploaded. Paths differ only by print —
 * teddy, lion, bunny, Doraemon — and the run panel otherwise shows nothing but a
 * name, so there is no way to notice you have the wrong path selected until the
 * listing is already built. Seeing the reused photos next to the picker makes a
 * mismatch obvious before anything is uploaded.
 *
 * URLs carry the file's mtime, so swapping a slot's image refreshes the thumbnail
 * instead of serving a stale cached one.
 */
export default function SavedImagesBadge({ path }) {
  const [zoom, setZoom] = useState(null);
  const slots = path?._sharedImageSlots || [];

  if (!path) return null;

  return (
    <div className="w-full max-w-xs shrink-0 rounded-xl border border-slate-200 bg-white p-3 lg:w-64">
      <div className="mb-2 flex items-baseline justify-between gap-2">
        <h3 className="text-xs font-semibold text-slate-700">Saved images</h3>
        <span className="text-[10px] uppercase tracking-wide text-slate-400">this path</span>
      </div>

      <p className="mb-2 truncate text-[11px] text-slate-500" title={path.name}>
        {path.name}
      </p>

      {slots.length === 0 ? (
        <p className="text-[11px] text-amber-700">
          No reused images saved yet — upload slots 2–5 below.
        </p>
      ) : (
        <div className="grid grid-cols-4 gap-1.5">
          {slots.map(({ slot, v }) => (
            <button
              key={slot}
              type="button"
              onClick={() => setZoom(slot)}
              title={`${SLOT_LABELS[slot] || slot} — click to enlarge`}
              className="group relative aspect-square overflow-hidden rounded border border-slate-200 hover:border-fk-blue"
            >
              {/* No loading="lazy": these are four small, permanently visible
                  thumbnails whose whole purpose is an at-a-glance check, and
                  deferring them defeats that. ?w= asks for a thumbnail rather than
                  the full stored image. */}
              <img
                src={`/api/paths/${path.id}/images/${slot}?v=${v}&w=128`}
                alt={SLOT_LABELS[slot] || slot}
                className="h-full w-full object-cover"
              />
            </button>
          ))}
        </div>
      )}

      {zoom && (
        <div
          role="dialog"
          aria-label="Saved image"
          onClick={() => setZoom(null)}
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-6"
        >
          <div className="max-h-full max-w-lg overflow-hidden rounded-xl bg-white p-2">
            <img
              src={`/api/paths/${path.id}/images/${zoom}?v=${
                slots.find((s) => s.slot === zoom)?.v || 0
              }`}
              alt={SLOT_LABELS[zoom] || zoom}
              className="max-h-[70vh] w-auto object-contain"
            />
            <p className="px-1 pt-2 text-xs text-slate-600">
              {SLOT_LABELS[zoom] || zoom} — {path.name}
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
