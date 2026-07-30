import React, { useState } from 'react';

const SLOTS = [
  { key: 'img2', label: 'Close Up Shot' },
  { key: 'img3', label: 'Edge View' },
  { key: 'img4', label: 'Flip Side' },
  { key: 'img5', label: 'Package View' },
];

/**
 * Slots 2–5 are uploaded once per path and reused by every listing on it. Only the
 * Front View changes per run.
 */
export default function SharedImages({ path, onSaved }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      const body = new FormData(e.target);
      const res = await fetch(`/api/paths/${path.id}/images`, { method: 'POST', body });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      onSaved(data);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="rounded-xl border border-slate-200 bg-white p-4">
      <div className="mb-1 flex items-center gap-2">
        <h3 className="text-sm font-semibold">Reused images (slots 2–5)</h3>
        {path._sharedImagesReady ? (
          <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-xs text-emerald-700">ready</span>
        ) : (
          <span className="rounded-full bg-amber-50 px-2 py-0.5 text-xs text-amber-700">missing</span>
        )}
      </div>
      <p className="mb-3 text-xs text-slate-500">
        Uploaded once and reused for every listing on this path. Minimum 1100×1100 px.
      </p>

      <div className="grid grid-cols-2 gap-3">
        {SLOTS.map((slot) => (
          <label key={slot.key} className="text-xs">
            <span className="mb-1 block font-medium text-slate-600">{slot.label}</span>
            <input
              type="file"
              name={slot.key}
              accept="image/png,image/jpeg,image/webp"
              className="w-full text-xs file:mr-2 file:rounded file:border-0 file:bg-slate-100 file:px-2 file:py-1"
            />
          </label>
        ))}
      </div>

      {error && <p className="mt-3 text-xs text-rose-600">{error}</p>}

      <button
        disabled={busy}
        className="mt-4 rounded-lg bg-slate-800 px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50"
      >
        {busy ? 'Uploading…' : 'Save images'}
      </button>
    </form>
  );
}
