import React, { useEffect, useState } from 'react';
import { useWebSocket } from './hooks/useWebSocket.js';
import LiveLog from './components/LiveLog.jsx';
import SharedImages from './components/SharedImages.jsx';
import RunPanel from './components/RunPanel.jsx';
import CopyPanel from './components/CopyPanel.jsx';
import SavedImagesBadge from './components/SavedImagesBadge.jsx';
import PathPicker from './components/PathPicker.jsx';

export default function App() {
  const { lines, events, clear } = useWebSocket();
  const [paths, setPaths] = useState([]);
  const [selectedId, setSelectedId] = useState(null);
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState({ total: 0, completed: 0, ok: 0, failed: 0 });

  useEffect(() => { refresh(); }, []);

  // Path configs change on disk outside the app — a path recorded, a field map
  // added — and the list is otherwise fetched only at mount. A tab left open then
  // shows stale data indefinitely, which reads as the app being wrong about a path
  // rather than merely out of date. Re-fetching on focus costs one request when the
  // seller comes back to the window.
  useEffect(() => {
    const onFocus = () => refresh();
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, []);

  // The server announces run-finished over the socket so the button re-enables
  // even if the run ended in an error.
  useEffect(() => {
    if (events['run-finished']) setRunning(false);
  }, [events['run-finished']]);

  useEffect(() => {
    const start = events['batch-start'];
    if (start) setProgress({ total: start.total, completed: 0, ok: 0, failed: 0 });
  }, [events['batch-start']]);

  // Each item-done tick advances the bar; a failed listing does not stop the batch.
  useEffect(() => {
    const item = events['item-done'];
    if (!item) return;
    setProgress((p) => ({
      ...p,
      completed: p.completed + 1,
      ok: p.ok + (item.ok ? 1 : 0),
      failed: p.failed + (item.ok ? 0 : 1),
    }));
  }, [events['item-done']]);

  async function refresh() {
    const res = await fetch('/api/paths');
    const data = await res.json();
    setPaths(data);
    // Functional update, because refresh runs from a listener whose closure holds
    // whatever selectedId was when it was registered. Reading the state variable
    // here would see `null` forever and reset the seller's choice to the first
    // path every time the window regained focus.
    setSelectedId((current) => current || (data.length ? data[0].id : null));
  }

  const selected = paths.find((p) => p.id === selectedId);

  return (
    <div className="mx-auto max-w-5xl px-6 py-8">
      <header className="mb-6 flex flex-wrap items-start gap-3">
        {/* The same mark as the tab icon, inline so the two cannot drift apart. */}
        <svg viewBox="0 0 64 64" className="h-9 w-9 shrink-0" role="img" aria-label="ListOnce">
          <rect width="64" height="64" rx="14" fill="#1E293B" />
          <rect x="6" y="21" width="22" height="22" rx="6" fill="#F59E0B" />
          <g fill="#E2E8F0">
            <rect x="37" y="8" width="21" height="21" rx="6" />
            <rect x="37" y="35" width="21" height="21" rx="6" />
          </g>
        </svg>
        <div>
          <h1 className="text-xl font-bold text-fk-ink">ListOnce</h1>
          <p className="text-xs text-slate-500">
            One set of images and copy, listed across Flipkart, Shopsy and Meesho.
          </p>
        </div>

        {/* Pinned top-right so the selected path's own photos are always in view
            while picking a Front View — the paths differ only by print. */}
        <div className="ml-auto">
          <SavedImagesBadge path={selected} />
        </div>
      </header>

      {paths.length > 1 && (
        <PathPicker paths={paths} selectedId={selectedId} onSelect={setSelectedId} />
      )}

      {!selected && <p className="text-sm text-slate-500">No paths yet.</p>}

      {selected && (
        <div className="grid gap-5 lg:grid-cols-[1fr_20rem]">
          <div className="space-y-4">
            <div className="rounded-xl border border-slate-200 bg-white p-4">
              <h2 className="text-sm font-semibold">{selected.name}</h2>
              <p className="mt-1 text-xs text-slate-500">
                {selected.vertical} · {selected.brand} · {selected.variants.length} variant(s)
              </p>
            </div>

            <CopyPanel
              path={selected}
              running={running}
              onSaved={(updated) =>
                setPaths((prev) => prev.map((p) => (p.id === updated.id ? updated : p)))
              }
            />

            <RunPanel
              path={selected}
              running={running}
              progress={progress}
              onStarted={() => setRunning(true)}
            />
          </div>

          <aside className="space-y-4">
            <SharedImages
              path={selected}
              onSaved={(updated) =>
                setPaths((prev) => prev.map((p) => (p.id === updated.id ? updated : p)))
              }
            />
            <LiveLog lines={lines} onClear={clear} />
            {events.tabs && (
              <div className="rounded-xl border border-slate-200 bg-white p-4 text-xs">
                <h3 className="mb-2 text-sm font-semibold">Tab status</h3>
                {Object.entries(events.tabs.states).map(([name, s]) => (
                  <div key={name} className="flex justify-between py-0.5">
                    <span className="truncate pr-2 text-slate-600">{name}</span>
                    <span className={s.errors ? 'text-rose-600' : 'text-emerald-600'}>
                      {s.filled != null ? `${s.filled}/${s.total}` : '—'}
                      {s.errors ? ` · ${s.errors} err` : ' ✓'}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </aside>
        </div>
      )}
    </div>
  );
}
