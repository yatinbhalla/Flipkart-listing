import React, { useEffect, useMemo, useRef, useState } from 'react';
import { pathLabel, skuPrefix } from '../pathLabel.js';
import { searchPaths } from '../pathSearch.js';

/**
 * A searchable path picker.
 *
 * Replaces a plain <select>, which stopped scaling once there were dozens of
 * paths: the Wall Hanging Organizers alone are forty near-identical entries whose
 * names differ only by colour and pack size, so finding one meant scrolling a list
 * where every line looks the same. Typing part of a SKU or a colour gets there in
 * one step.
 *
 * The input doubles as the display, so the selected path is still readable at rest.
 */
export default function PathPicker({ paths, selectedId, onSelect }) {
  // null means "not searching" — the input then shows the selection instead.
  const [query, setQuery] = useState(null);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const listRef = useRef(null);
  const inputRef = useRef(null);

  const selected = paths.find((p) => p.id === selectedId);
  const matches = useMemo(() => searchPaths(paths, open ? query : null), [paths, open, query]);

  // Keep the highlight on a row that still exists as the query narrows.
  useEffect(() => {
    setActive((i) => Math.min(i, Math.max(matches.length - 1, 0)));
  }, [matches.length]);

  // Arrow keys have to bring their row with them, or the highlight walks off the
  // scroll area and the list appears not to move at all.
  useEffect(() => {
    listRef.current?.children[active]?.scrollIntoView({ block: 'nearest' });
  }, [active, open]);

  /**
   * Ending a search always releases focus, so the input is never left focused
   * with no search running. In that state a click would not re-fire onFocus, and
   * the next keystroke would be spliced into the selected path's label — which is
   * the input's display value — instead of starting a fresh query.
   */
  function close() {
    setQuery(null);
    setOpen(false);
    inputRef.current?.blur();
  }

  function commit(path) {
    if (path) onSelect(path.id);
    close();
  }

  function onKeyDown(e) {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (!open) return setOpen(true);
      const step = e.key === 'ArrowDown' ? 1 : -1;
      setActive((i) => (i + step + matches.length) % Math.max(matches.length, 1));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (open) commit(matches[active]);
    } else if (e.key === 'Escape') {
      // Abandons the search without changing the selection.
      close();
    }
  }

  return (
    <div className="relative mb-4 max-w-2xl">
      <input
        ref={inputRef}
        type="text"
        role="combobox"
        aria-expanded={open}
        aria-label="Search paths"
        value={query ?? (selected ? pathLabel(selected) : '')}
        placeholder={`Search ${paths.length} paths — SKU, name, colour, vertical`}
        onChange={(e) => {
          setQuery(e.target.value);
          setOpen(true);
          setActive(0);
        }}
        // Focusing starts a fresh search rather than making the seller clear the
        // selected path's label by hand.
        onFocus={() => {
          setQuery('');
          setOpen(true);
          setActive(Math.max(matches.findIndex((p) => p.id === selectedId), 0));
        }}
        onBlur={() => {
          setQuery(null);
          setOpen(false);
        }}
        onKeyDown={onKeyDown}
        className="w-full rounded-lg border border-slate-300 px-3 py-1.5 text-sm outline-none focus:border-fk-blue focus:ring-1 focus:ring-fk-blue"
      />

      {open && (
        <div className="absolute z-40 mt-1 w-full overflow-hidden rounded-lg border border-slate-300 bg-white shadow-lg">
          <div className="border-b border-slate-100 px-3 py-1 text-[10px] uppercase tracking-wide text-slate-400">
            {matches.length} of {paths.length}
          </div>

          {matches.length === 0 ? (
            <p className="px-3 py-3 text-xs text-slate-500">No path matches “{query}”.</p>
          ) : (
            <ul ref={listRef} className="max-h-80 overflow-y-auto">
              {matches.map((p, i) => (
                <li key={p.id}>
                  <button
                    type="button"
                    // Keeps focus in the input, so the blur handler never races the
                    // click that is trying to pick this row.
                    onMouseDown={(e) => e.preventDefault()}
                    onMouseEnter={() => setActive(i)}
                    onClick={() => commit(p)}
                    className={`flex w-full items-baseline gap-2 px-3 py-1.5 text-left text-xs ${
                      i === active ? 'bg-fk-blue/10' : ''
                    } ${p.id === selectedId ? 'font-semibold' : ''}`}
                  >
                    <span className="shrink-0 font-mono text-[11px] text-fk-ink">
                      {skuPrefix(p) || '—'}
                    </span>
                    <span className="truncate text-slate-600">{p.name}</span>
                    <span className="ml-auto shrink-0 text-[10px] text-slate-400">{p.vertical}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
