import React, { useState } from 'react';

/**
 * Copy is generated once and stored on the path. Runs read it back, so a listing
 * makes no AI calls — same words every time, and a Gemini outage can't block a run.
 */
export default function CopyPanel({ path, running, onSaved }) {
  const [busy, setBusy] = useState(null);      // variantKey | 'all' | null
  const [error, setError] = useState('');
  const [open, setOpen] = useState(null);

  const missing = path.variants.filter((v) => !v.copy);

  async function generate(variantKey, force) {
    setBusy(variantKey || 'all');
    setError('');
    try {
      const res = await fetch(`/api/paths/${path.id}/copy`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ variantKey, force }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      onSaved(data);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold">Saved copy</h3>
          <p className="text-xs text-slate-500">
            Written once and stored on the path. Runs reuse it — no AI call per listing.
          </p>
        </div>
        {missing.length > 0 && (
          <button
            onClick={() => generate(undefined, false)}
            disabled={busy || running}
            className="shrink-0 rounded-lg bg-slate-800 px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50"
          >
            {busy === 'all' ? 'Writing…' : `Generate (${missing.length})`}
          </button>
        )}
      </div>

      {error && <p className="mt-3 text-xs text-rose-600">{error}</p>}

      <div className="mt-3 space-y-2">
        {path.variants.map((variant) => {
          const copy = variant.copy;
          const isOpen = open === variant.key;
          return (
            <div key={variant.key} className="rounded-lg bg-slate-50 p-3">
              <div className="flex items-center justify-between gap-2">
                <div className="min-w-0">
                  <div className="truncate text-sm font-medium">{variant.label}</div>
                  {copy ? (
                    <div className="text-xs text-slate-500">
                      {copy.searchKeywords.length} keywords · {copy.keyFeatures.length} features ·{' '}
                      {copy.specs?.length || 0} specs
                    </div>
                  ) : (
                    <div className="text-xs text-amber-700">no copy yet</div>
                  )}
                </div>
                <div className="flex shrink-0 gap-2">
                  {copy && (
                    <button
                      onClick={() => setOpen(isOpen ? null : variant.key)}
                      className="text-xs text-slate-500 hover:text-slate-800"
                    >
                      {isOpen ? 'hide' : 'view'}
                    </button>
                  )}
                  <button
                    onClick={() => generate(variant.key, true)}
                    disabled={busy || running}
                    className="text-xs text-slate-500 hover:text-slate-800 disabled:opacity-40"
                  >
                    {busy === variant.key ? '…' : copy ? 'regenerate' : 'generate'}
                  </button>
                </div>
              </div>

              {isOpen && copy && (
                <div className="mt-3 space-y-3 border-t border-slate-200 pt-3 text-xs">
                  <p className="font-medium text-slate-700">{copy.modelName}</p>
                  <pre className="whitespace-pre-wrap font-sans text-slate-600">{copy.description}</pre>
                  <div>
                    <div className="mb-1 font-medium text-slate-500">Key features</div>
                    <ul className="list-inside list-disc text-slate-600">
                      {copy.keyFeatures.map((f) => (
                        <li key={f}>{f}</li>
                      ))}
                    </ul>
                  </div>
                  <div className="flex flex-wrap gap-1">
                    {copy.searchKeywords.map((k) => (
                      <span key={k} className="rounded bg-white px-1.5 py-0.5 text-[11px] text-slate-600">
                        {k}
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
