import React, { useState } from 'react';

const MAX_BATCH = 50;
const AXES_NEEDING_IMAGE = new Set(['Color', 'Pack of']);

/** Colour / Pack-of variants look different, so each needs its own photo. */
function needsOwnImage(variant) {
  return AXES_NEEDING_IMAGE.has(variant.axis);
}

export default function RunPanel({ path, running, progress, onStarted }) {
  const [fronts, setFronts] = useState([]);        // [{ path, name, width, height, upscaled }]
  const [variantImages, setVariantImages] = useState({});
  const [preview, setPreview] = useState(null);
  const [sendToQc, setSendToQc] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notes, setNotes] = useState([]);

  const imageVariants = path.variants.filter(needsOwnImage);
  // A per-listing photo can't vary across a batch, so those paths list one at a time.
  const batchAllowed = imageVariants.length === 0;
  const copyReady = path.variants.every((v) => v.copy);

  const ready =
    fronts.length > 0 &&
    copyReady &&
    path._sharedImagesReady &&
    imageVariants.every((v) => variantImages[v.key]) &&
    (batchAllowed || fronts.length === 1);

  async function upload(files, onDone) {
    setBusy(true);
    setError('');
    setNotes([]);
    try {
      const body = new FormData();
      for (const file of files) body.append('image', file);
      const res = await fetch('/api/uploads/front', { method: 'POST', body });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      if (data.rejected?.length) {
        setNotes(data.rejected.map((r) => `${r.name} skipped — ${r.error}`));
      }
      const upscaled = data.images.filter((i) => i.upscaled);
      if (upscaled.length) {
        setNotes((prev) => [...prev, `${upscaled.length} image(s) upscaled to clear the 1100px minimum.`]);
      }
      onDone(data.images);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function pickFronts(fileList) {
    const files = [...fileList].slice(0, MAX_BATCH);
    if (fileList.length > MAX_BATCH) {
      setError(`Only the first ${MAX_BATCH} images were taken — that's the per-run limit.`);
    }
    await upload(files, setFronts);
  }

  async function runPreview() {
    setBusy(true);
    setError('');
    try {
      const res = await fetch('/api/run/preview', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pathId: path.id }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setPreview(data.variants);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function start() {
    setBusy(true);
    setError('');
    try {
      const res = await fetch('/api/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          pathId: path.id,
          frontImages: fronts.map((f) => f.path),
          variantImages: Object.fromEntries(
            Object.entries(variantImages).map(([k, v]) => [k, v.path]),
          ),
          sendToQc,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      onStarted();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-slate-200 bg-white p-4">
        <h3 className="mb-1 text-sm font-semibold">
          Front View images — one listing per image
        </h3>
        <p className="mb-3 text-xs text-slate-500">
          {batchAllowed
            ? `Select up to ${MAX_BATCH}. They are listed one after another in a single browser session, each with its own SKU.`
            : `This path has variants that need their own photo, so it lists one at a time.`}
        </p>

        <input
          type="file"
          multiple={batchAllowed}
          accept="image/png,image/jpeg,image/webp"
          disabled={busy || running}
          onChange={(e) => e.target.files.length && pickFronts(e.target.files)}
          className="text-xs file:mr-2 file:rounded file:border-0 file:bg-slate-100 file:px-2 file:py-1"
        />

        {fronts.length > 0 && (
          <div className="mt-3">
            <div className="mb-1 text-xs font-medium text-emerald-700">
              {fronts.length} image{fronts.length > 1 ? 's' : ''} ready
              {fronts.length > 1 && ` → ${fronts.length} listings`}
            </div>
            <div className="max-h-32 overflow-y-auto text-[11px] text-slate-500">
              {fronts.map((f, i) => (
                <div key={f.path} className="flex justify-between gap-2">
                  <span className="truncate">
                    {i + 1}. {f.name}
                  </span>
                  <span className="shrink-0">
                    {f.width}×{f.height}
                    {f.upscaled && ' ↑'}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        {imageVariants.length > 0 && (
          <div className="mt-4 space-y-3 border-t border-slate-100 pt-3">
            {imageVariants.map((variant) => (
              <div key={variant.key} className="flex items-center gap-3">
                <div className="w-48 shrink-0 text-sm font-medium">{variant.label}</div>
                <input
                  type="file"
                  accept="image/png,image/jpeg,image/webp"
                  disabled={busy || running}
                  onChange={(e) =>
                    e.target.files[0] &&
                    upload([e.target.files[0]], ([img]) =>
                      setVariantImages((prev) => ({ ...prev, [variant.key]: img })),
                    )
                  }
                  className="text-xs file:mr-2 file:rounded file:border-0 file:bg-slate-100 file:px-2 file:py-1"
                />
                {variantImages[variant.key] && (
                  <span className="text-xs text-emerald-600">✓ {variantImages[variant.key].name}</span>
                )}
              </div>
            ))}
          </div>
        )}

        {notes.map((n) => (
          <p key={n} className="mt-2 text-xs text-slate-500">
            {n}
          </p>
        ))}
      </div>

      <div className="rounded-xl border border-slate-200 bg-white p-4">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-sm font-semibold">Next SKUs</h3>
            <p className="text-xs text-slate-500">
              Allocated rule-based from the path's pattern. Nothing is sent to Flipkart.
            </p>
          </div>
          <button
            onClick={runPreview}
            disabled={busy || running || !copyReady}
            className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-medium disabled:opacity-50"
          >
            Preview
          </button>
        </div>

        {preview && (
          <div className="mt-3 space-y-1">
            {preview.map((v) => (
              <div key={v.key} className="flex flex-wrap items-baseline gap-x-3 text-xs">
                <span className="font-medium">{v.label}</span>
                <code className="rounded bg-slate-100 px-1.5 py-0.5">{v.sku}</code>
                <span className="text-slate-500">
                  MRP ₹{v.mrp} · selling ₹{v.sellingPrice}
                </span>
              </div>
            ))}
            <p className="pt-1 text-[11px] text-slate-400">
              A fresh SKU is allocated per listing, so a batch of {fronts.length || 'N'} gets{' '}
              {fronts.length || 'N'} distinct sets.
            </p>
          </div>
        )}
      </div>

      <div className="rounded-xl border border-slate-200 bg-white p-4">
        <label className="flex items-start gap-2 text-sm">
          <input
            type="checkbox"
            checked={sendToQc}
            onChange={(e) => setSendToQc(e.target.checked)}
            className="mt-0.5"
          />
          <span>
            <span className="font-medium">Submit to QC automatically</span>
            <span className="block text-xs text-slate-500">
              Off by default: each listing stops as a validated draft so you can check it in the
              browser first. Sending to QC cannot be undone.
            </span>
          </span>
        </label>

        {!copyReady && (
          <p className="mt-3 text-xs text-amber-700">Generate the saved copy before running.</p>
        )}
        {!path._sharedImagesReady && (
          <p className="mt-3 text-xs text-amber-700">Upload the four reused images before running.</p>
        )}
        {error && <p className="mt-3 text-xs text-rose-600">{error}</p>}

        {running && progress?.total > 0 && (
          <div className="mt-3">
            <div className="mb-1 flex justify-between text-xs text-slate-500">
              <span>
                listing {Math.min(progress.completed + 1, progress.total)} of {progress.total}
              </span>
              <span>
                {progress.ok} ok{progress.failed > 0 && ` · ${progress.failed} failed`}
              </span>
            </div>
            <div className="h-1.5 w-full overflow-hidden rounded-full bg-slate-100">
              <div
                className="h-full bg-fk-blue transition-all"
                style={{ width: `${(progress.completed / progress.total) * 100}%` }}
              />
            </div>
          </div>
        )}

        <button
          onClick={start}
          disabled={!ready || busy || running}
          className="mt-4 w-full rounded-lg bg-fk-blue px-4 py-2 text-sm font-semibold text-white disabled:opacity-40"
        >
          {running
            ? 'Run in progress…'
            : `${sendToQc ? 'List and send to QC' : 'Create draft'}${
                fronts.length > 1 ? ` — ${fronts.length} listings` : ''
              }`}
        </button>
      </div>
    </div>
  );
}
