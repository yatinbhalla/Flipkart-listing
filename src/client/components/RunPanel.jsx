import React, { useState } from 'react';

const AXES_NEEDING_IMAGE = new Set(['Color', 'Pack of']);

/** Variant 0 is the parent and always needs a front image; so do Colour / Pack-of variants. */
function needsFrontImage(variant, index) {
  return index === 0 || AXES_NEEDING_IMAGE.has(variant.axis);
}

export default function RunPanel({ path, running, onStarted }) {
  const [fronts, setFronts] = useState({});     // variantKey -> { path, name }
  const [preview, setPreview] = useState(null);
  const [sendToQc, setSendToQc] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const required = path.variants.filter(needsFrontImage);
  const ready = required.every((v) => fronts[v.key]) && path._sharedImagesReady;

  async function uploadFront(variantKey, file) {
    const body = new FormData();
    body.append('image', file);
    const res = await fetch('/api/uploads/front', { method: 'POST', body });
    const data = await res.json();
    if (!res.ok) return setError(data.error);
    setFronts((prev) => ({ ...prev, [variantKey]: data }));
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
          frontImages: Object.fromEntries(Object.entries(fronts).map(([k, v]) => [k, v.path])),
          sendToQc,
          variants: preview || undefined,
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
        <h3 className="mb-1 text-sm font-semibold">Front View image per variant</h3>
        <p className="mb-3 text-xs text-slate-500">
          Seating Capacity variants share the parent's photos. Colour and Pack-of variants each
          need their own front image.
        </p>

        <div className="space-y-3">
          {path.variants.map((variant, i) => {
            const need = needsFrontImage(variant, i);
            return (
              <div key={variant.key} className="flex items-center gap-3">
                <div className="w-48 shrink-0">
                  <div className="text-sm font-medium">{variant.label}</div>
                  <div className="text-xs text-slate-400">
                    {need ? 'needs its own image' : `reuses parent images (${variant.axis})`}
                  </div>
                </div>
                {need ? (
                  <div className="flex items-center gap-2">
                    <input
                      type="file"
                      accept="image/png,image/jpeg,image/webp"
                      onChange={(e) => e.target.files[0] && uploadFront(variant.key, e.target.files[0])}
                      className="text-xs file:mr-2 file:rounded file:border-0 file:bg-slate-100 file:px-2 file:py-1"
                    />
                    {fronts[variant.key] && (
                      <span className="text-xs text-emerald-600">✓ {fronts[variant.key].name}</span>
                    )}
                  </div>
                ) : (
                  <span className="text-xs text-slate-400">—</span>
                )}
              </div>
            );
          })}
        </div>
      </div>

      <div className="rounded-xl border border-slate-200 bg-white p-4">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-sm font-semibold">Generated copy &amp; SKUs</h3>
            <p className="text-xs text-slate-500">
              Written per variant, brand names stripped. Review before anything reaches Flipkart.
            </p>
          </div>
          <button
            onClick={runPreview}
            disabled={busy || running}
            className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-medium disabled:opacity-50"
          >
            {busy ? 'Writing…' : 'Preview'}
          </button>
        </div>

        {preview && (
          <div className="mt-4 space-y-4">
            {preview.map((v) => (
              <div key={v.key} className="rounded-lg bg-slate-50 p-3">
                <div className="mb-1 flex flex-wrap items-baseline gap-x-3 text-sm">
                  <span className="font-semibold">{v.label}</span>
                  <code className="rounded bg-white px-1.5 py-0.5 text-xs">{v.sku}</code>
                  <span className="text-xs text-slate-500">
                    MRP ₹{v.mrp} · selling ₹{v.sellingPrice}
                  </span>
                </div>
                <p className="mb-2 text-xs font-medium text-slate-600">{v.modelName}</p>
                <details className="text-xs text-slate-600">
                  <summary className="cursor-pointer text-slate-500">description</summary>
                  <pre className="mt-2 whitespace-pre-wrap font-sans">{v.description}</pre>
                </details>
                <div className="mt-2 flex flex-wrap gap-1">
                  {v.searchKeywords.map((k) => (
                    <span key={k} className="rounded bg-white px-1.5 py-0.5 text-[11px] text-slate-600">
                      {k}
                    </span>
                  ))}
                </div>
              </div>
            ))}
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
              Off by default: the run stops with a validated draft so you can check it in the
              browser first. Sending to QC cannot be undone.
            </span>
          </span>
        </label>

        {!path._sharedImagesReady && (
          <p className="mt-3 text-xs text-amber-700">
            Upload the four reused images before running.
          </p>
        )}
        {error && <p className="mt-3 text-xs text-rose-600">{error}</p>}

        <button
          onClick={start}
          disabled={!ready || busy || running}
          className="mt-4 w-full rounded-lg bg-fk-blue px-4 py-2 text-sm font-semibold text-white disabled:opacity-40"
        >
          {running ? 'Run in progress…' : sendToQc ? 'Create listing and send to QC' : 'Create draft listing'}
        </button>
      </div>
    </div>
  );
}
