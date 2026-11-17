import React, { useMemo, useState } from 'react';
import { skuPrefix } from '../pathLabel.js';

/**
 * Pick a product, then work through every listing that makes it up.
 *
 * The other two pickers answer "which path do I want", which is the right question
 * once you know. This one answers the question before it: what do I have to list to
 * have listed all my table covers? The answer is not one path — the table covers are
 * 33 paths carrying 25 distinct products, because the same product appears in a
 * 17-design variation, in two Flipkart groups of 9 and 8, and again in the Meesho
 * catalogues. Working down a flat list of 117 names, it is genuinely hard to see
 * which of those you still need and which you have already covered twice over.
 *
 * So: choose the product, see its paths largest first, and the arithmetic that makes
 * "9 + 8 + the rest" add up to everything is done for you.
 *
 * Deliberately NOT a tracker. Nothing here is remembered between sessions and
 * nothing marks a path done — the seller asked for a menu, not a checklist. The
 * ticks are scratch arithmetic for choosing a set in one sitting, and the page
 * forgets them the moment it reloads.
 */

/** Every SKU code a path lists, which is what "a product" means here. */
function codesOf(path) {
  return (path.variants || [])
    .map((v) => String(v.skuPattern || path.skuPattern || '').replace(/\/?\{X\}\s*$/, '').trim())
    .filter(Boolean);
}

export default function ProductPicker({ paths, selectedId, onSelect }) {
  const [product, setProduct] = useState('');
  const [picked, setPicked] = useState({});   // { [pathId]: true } — scratch, per sitting

  // Families in catalogue order, biggest first: the long shelves are the ones that
  // need navigating.
  const families = useMemo(() => {
    const by = new Map();
    for (const p of paths) {
      const type = p._productType || 'other';
      if (!by.has(type)) by.set(type, []);
      by.get(type).push(p);
    }
    return [...by.entries()]
      .map(([type, rows]) => ({
        type,
        rows,
        products: new Set(rows.flatMap(codesOf)).size,
      }))
      .sort((a, b) => b.products - a.products || a.type.localeCompare(b.type));
  }, [paths]);

  const family = families.find((f) => f.type === product);

  // The family's paths, largest first, each with the products it covers and how many
  // of them no other path in the family carries. That second number is the one that
  // matters: a path with products only it has is one you cannot skip.
  const rows = useMemo(() => {
    if (!family) return [];
    const seen = new Map();
    for (const p of family.rows) for (const c of codesOf(p)) seen.set(c, (seen.get(c) || 0) + 1);
    return family.rows
      .map((p) => {
        const codes = codesOf(p);
        return { path: p, codes, only: codes.filter((c) => seen.get(c) === 1).length };
      })
      .sort((a, b) => b.codes.length - a.codes.length || a.path.name.localeCompare(b.path.name));
  }, [family]);

  // What the ticked paths add up to, and what they still leave out.
  const tally = useMemo(() => {
    if (!family) return null;
    const all = new Set(family.rows.flatMap(codesOf));
    const covered = new Set(rows.filter((r) => picked[r.path.id]).flatMap((r) => r.codes));
    return {
      all: all.size,
      covered: covered.size,
      missing: [...all].filter((c) => !covered.has(c)),
      chosen: rows.filter((r) => picked[r.path.id]).length,
    };
  }, [family, rows, picked]);

  if (!paths.length) return null;

  return (
    <div className="mb-3 max-w-2xl">
      <div className="mb-1 flex items-baseline gap-2">
        <span className="text-xs font-medium text-fk-ink">By product</span>
        <span className="text-[11px] text-slate-400">
          {families.length} products · every listing that makes one up
        </span>
      </div>

      <select
        value={product}
        onChange={(e) => {
          setProduct(e.target.value);
          setPicked({});
        }}
        className="w-full rounded-lg border border-slate-300 px-3 py-1.5 text-sm outline-none focus:border-fk-blue focus:ring-1 focus:ring-fk-blue"
      >
        <option value="">Choose a product — table cover, wall hanging, towel…</option>
        {families.map((f) => (
          <option key={f.type} value={f.type}>
            {f.type} — {f.rows.length} path{f.rows.length === 1 ? '' : 's'} · {f.products} product
            {f.products === 1 ? '' : 's'}
          </option>
        ))}
      </select>

      {family && (
        <div className="mt-2 rounded-lg border border-slate-200 bg-white">
          <div className="flex flex-wrap items-baseline gap-2 border-b border-slate-100 px-3 py-2">
            <span className="text-xs font-semibold capitalize text-fk-ink">{family.type}</span>
            <span className="text-[11px] text-slate-500">
              {tally.all} products across {family.rows.length} paths
            </span>
            {tally.chosen > 0 && (
              <span
                className={`ml-auto text-[11px] font-medium ${
                  tally.missing.length ? 'text-amber-700' : 'text-emerald-700'
                }`}
              >
                {tally.chosen} ticked cover {tally.covered} of {tally.all}
                {tally.missing.length ? ` — ${tally.missing.length} left` : ' — all of them'}
              </span>
            )}
          </div>

          <ul className="max-h-80 overflow-y-auto">
            {rows.map(({ path, codes, only }) => (
              <li key={path.id} className="border-b border-slate-50 last:border-0">
                <div
                  className={`flex items-center gap-2 px-3 py-1.5 text-xs ${
                    path.id === selectedId ? 'bg-fk-blue/10 font-semibold' : ''
                  }`}
                >
                  <input
                    type="checkbox"
                    checked={Boolean(picked[path.id])}
                    onChange={(e) =>
                      setPicked((v) => ({ ...v, [path.id]: e.target.checked }))
                    }
                    title="Count this path towards the total"
                  />
                  <button
                    type="button"
                    onClick={() => onSelect(path.id)}
                    className="flex min-w-0 flex-1 items-baseline gap-2 text-left"
                  >
                    <span className="shrink-0 font-mono text-[11px] text-fk-ink">
                      {skuPrefix(path) || '—'}
                    </span>
                    <span className="truncate text-slate-600">{path.name}</span>
                  </button>
                  <span className="shrink-0 rounded bg-slate-100 px-1 text-[10px] text-slate-500">
                    {codes.length} product{codes.length === 1 ? '' : 's'}
                  </span>
                  {/* Marked only when something here is carried by no other path in
                      the family, which makes it a path you cannot skip. Measured
                      across the catalogue that is true of 3 paths out of 117, so
                      labelling the other 114 "all shared" would be noise on every
                      row to say the ordinary thing. Silence means shared. */}
                  {only > 0 && (
                    <span
                      className="shrink-0 text-[10px] font-medium text-emerald-700"
                      title="no other path here carries these — this one cannot be skipped"
                    >
                      {only} only here
                    </span>
                  )}
                </div>
              </li>
            ))}
          </ul>

          {tally.chosen > 0 && tally.missing.length > 0 && (
            <div className="border-t border-slate-100 px-3 py-2 text-[11px] text-slate-500">
              Still not covered:{' '}
              <span className="font-mono text-slate-600">{tally.missing.join(', ')}</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
