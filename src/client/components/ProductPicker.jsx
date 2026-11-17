import React, { useMemo, useState } from 'react';
import { skuPrefix } from '../pathLabel.js';

/**
 * Pick a product, and get the fewest listings that cover the whole of it.
 *
 * The other two pickers answer "which path do I want", which is the right question
 * once you know. This one answers the question before it: what do I have to list to
 * have listed all my table covers? Naming every path that touches the family is no
 * answer — there are 33 of them for 25 distinct products, because the same product
 * appears in a 17-design variation, in two Flipkart groups of 9 and 8, in the Meesho
 * catalogues, and again as a single listing of its own. Read that way the work looks
 * like 33 listings when it is 3, and the full list is already a keystroke away in
 * the row below.
 *
 * So this row shows the covering set only: the fewest paths that between them list
 * every product in the family, variations preferred over singles, with the products
 * each one brings named underneath. The paths that merely repeat them are not shown.
 *
 * Deliberately NOT a tracker. Nothing here is remembered between sessions and
 * nothing marks a path done for good — the seller asked for a menu, not a checklist.
 * The ticks are scratch, for keeping your place while working down the set in one
 * sitting, and the page forgets them the moment it reloads.
 */

/**
 * The covering set is per storefront, not per family.
 *
 * A path does not always exist on all of them: the 17-design net variation is
 * Flipkart and Shopsy, because Meesho lists a variation as a catalog of products
 * instead — which is what the Meesho catalog A and B paths are, and those are
 * Meesho-only. So the table covers are 3 listings on Flipkart and 7 on Meesho, and
 * one storefront-blind set would have been 3 paths covering nothing whatsoever on
 * Meesho. Defaulted to Flipkart, which is what the Run panel defaults to.
 */
const STOREFRONTS = [
  ['flipkart', 'Flipkart'],
  ['shopsy', 'Shopsy'],
  ['meesho', 'Meesho'],
];

/** Every SKU code a path lists, which is what "a product" means here. */
function codesOf(path) {
  return (path.variants || [])
    .map((v) => String(v.skuPattern || path.skuPattern || '').replace(/\/?\{X\}\s*$/, '').trim())
    .filter(Boolean);
}

/** Whether a path can be run on a storefront at all — see STOREFRONTS. */
function runsOn(path, store) {
  const only = path.storefronts;
  return !Array.isArray(only) || !only.length || only.includes(store);
}

/**
 * The fewest paths that cover every product, and what each one is there for.
 *
 * Greedy: repeatedly take the path that adds the most products still missing.
 * Variation paths are exhausted before a single listing is considered at all, so a
 * product reachable both ways is reached by the variation — one listing carrying
 * four products beats four listings, even when it re-lists products an earlier pick
 * already covered. Overlap costs nothing here; a missed product costs a product
 * nobody can buy.
 *
 * Returns the picks in the order they were taken, each with the products it is being
 * picked FOR. That list is the whole point of the row: the 4-seater PVC variation is
 * named TC_MW_PF and carries TC_BT, so printing the path's own prefix alone makes
 * TC_BT look like a product the set leaves out.
 */
function plan(rows, store) {
  const usable = rows.filter((p) => runsOn(p, store));
  const need = new Set(usable.flatMap(codesOf));
  const picks = [];
  const taken = new Set();
  const sweep = (pool) => {
    for (;;) {
      const best = pool
        .filter((p) => !taken.has(p.id))
        .map((p) => ({ path: p, adds: codesOf(p).filter((c) => need.has(c)) }))
        .filter((x) => x.adds.length > 0)
        .sort(
          (a, b) =>
            b.adds.length - a.adds.length ||
            codesOf(b.path).length - codesOf(a.path).length ||
            a.path.name.localeCompare(b.path.name),
        )[0];
      if (!best) return;
      taken.add(best.path.id);
      best.adds.forEach((c) => need.delete(c));
      picks.push(best);
    }
  };
  sweep(usable.filter((p) => (p.variants?.length ?? 1) > 1));
  sweep(usable.filter((p) => (p.variants?.length ?? 1) <= 1));

  // Products that live only on paths this storefront refuses. None today, but
  // pinning a path to one storefront is exactly how a product would quietly become
  // unlistable on another, and that is worth saying out loud rather than hiding by
  // counting only what is reachable.
  const reachable = new Set(usable.flatMap(codesOf));
  const unreachable = [...new Set(rows.flatMap(codesOf))].filter((c) => !reachable.has(c));
  return { picks, unreachable, hidden: rows.length - picks.length };
}

export default function ProductPicker({ paths, selectedId, onSelect }) {
  const [product, setProduct] = useState('');
  const [store, setStore] = useState('flipkart');
  const [done, setDone] = useState({}); // { [pathId]: true } — scratch, per sitting

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
      .map(([type, rows]) => ({ type, rows, products: new Set(rows.flatMap(codesOf)).size }))
      .sort((a, b) => b.products - a.products || a.type.localeCompare(b.type));
  }, [paths]);

  const family = families.find((f) => f.type === product);
  const { picks, unreachable, hidden } = useMemo(
    () => (family ? plan(family.rows, store) : { picks: [], unreachable: [], hidden: 0 }),
    [family, store],
  );

  const total = picks.reduce((n, p) => n + p.adds.length, 0);
  const covered = picks.filter((p) => done[p.path.id]).reduce((n, p) => n + p.adds.length, 0);
  const ticked = picks.filter((p) => done[p.path.id]).length;

  if (!paths.length) return null;

  return (
    <div className="mb-3 max-w-2xl">
      <div className="mb-1 flex items-baseline gap-2">
        <span className="text-xs font-medium text-fk-ink">By product</span>
        <span className="text-[11px] text-slate-400">
          {families.length} products · the fewest listings that cover one
        </span>
      </div>

      <select
        value={product}
        onChange={(e) => {
          setProduct(e.target.value);
          setDone({});
        }}
        className="w-full rounded-lg border border-slate-300 px-3 py-1.5 text-sm outline-none focus:border-fk-blue focus:ring-1 focus:ring-fk-blue"
      >
        <option value="">Choose a product — table cover, wall hanging, towel…</option>
        {families.map((f) => (
          <option key={f.type} value={f.type}>
            {f.type} — {f.products} product{f.products === 1 ? '' : 's'}
          </option>
        ))}
      </select>

      {family && (
        <div className="mt-2 rounded-lg border border-slate-200 bg-white">
          <div className="flex flex-wrap items-baseline gap-2 border-b border-slate-100 px-3 py-2">
            <span className="text-xs font-semibold capitalize text-fk-ink">{family.type}</span>
            <span className="text-[11px] text-slate-500">
              {picks.length} listing{picks.length === 1 ? ' covers' : 's cover'} all {total}{' '}
              product{total === 1 ? '' : 's'}
            </span>
            {ticked > 0 && (
              <span
                className={`text-[11px] font-medium ${
                  ticked === picks.length ? 'text-emerald-700' : 'text-amber-700'
                }`}
              >
                {ticked} done · {covered} of {total}
              </span>
            )}
            {/* Which storefront the set is for. Not a filter on the rows: it changes
                which paths can be run at all, and so changes the answer. */}
            <div className="ml-auto flex shrink-0 gap-1 rounded bg-slate-100 p-0.5">
              {STOREFRONTS.map(([key, label]) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => {
                    setStore(key);
                    setDone({});
                  }}
                  className={`rounded px-2 py-0.5 text-[11px] ${
                    store === key ? 'bg-white font-medium shadow-sm' : 'text-slate-500'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          <ul>
            {picks.map(({ path, adds }) => {
              const spare = codesOf(path).length - adds.length;
              return (
                <li key={path.id} className="border-b border-slate-50 last:border-0">
                  <div
                    className={`flex items-start gap-2 px-3 py-2 text-xs ${
                      path.id === selectedId ? 'bg-fk-blue/10' : ''
                    } ${done[path.id] ? 'opacity-60' : ''}`}
                  >
                    <input
                      type="checkbox"
                      className="mt-0.5"
                      checked={Boolean(done[path.id])}
                      onChange={(e) => setDone((v) => ({ ...v, [path.id]: e.target.checked }))}
                      title="Keep your place — forgotten when the page reloads"
                    />
                    <button
                      type="button"
                      onClick={() => onSelect(path.id)}
                      className="min-w-0 flex-1 text-left"
                    >
                      <div className="flex items-baseline gap-2">
                        <span className="shrink-0 font-mono text-[11px] font-semibold text-fk-ink">
                          {skuPrefix(path) || '—'}
                        </span>
                        <span
                          className={`truncate text-slate-600 ${
                            path.id === selectedId ? 'font-semibold' : ''
                          }`}
                        >
                          {path.name}
                        </span>
                      </div>
                      {/* The products this listing is here for, named. Without this
                          the 4-seater PVC row reads as TC_MW_PF alone and the four
                          prints it actually carries — TC_BT among them — look like
                          products the set leaves out. */}
                      <div className="mt-0.5 font-mono text-[10px] leading-relaxed text-slate-400">
                        {adds.join(' ')}
                        {spare > 0 && (
                          <span className="font-sans italic"> · +{spare} already covered above</span>
                        )}
                      </div>
                    </button>
                    <span className="mt-0.5 shrink-0 rounded bg-slate-100 px-1 text-[10px] text-slate-500">
                      {adds.length} product{adds.length === 1 ? '' : 's'}
                    </span>
                  </div>
                </li>
              );
            })}
          </ul>

          <div className="border-t border-slate-100 px-3 py-2 text-[11px] text-slate-500">
            {hidden > 0 && (
              <>
                The other {hidden} {family.type} path{hidden === 1 ? '' : 's'} list only products
                these already cover — they are in the rows below if you want one.
              </>
            )}
            {unreachable.length > 0 && (
              <div className="mt-1 font-medium text-rose-600">
                Not listable on {store}: <span className="font-mono">{unreachable.join(', ')}</span>{' '}
                — no path carrying {unreachable.length === 1 ? 'it' : 'them'} runs there.
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
