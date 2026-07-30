import React, { useEffect, useState } from 'react';
import { useWebSocket } from './hooks/useWebSocket.js';
import LiveLog from './components/LiveLog.jsx';
import SharedImages from './components/SharedImages.jsx';
import RunPanel from './components/RunPanel.jsx';

export default function App() {
  const { lines, events, clear } = useWebSocket();
  const [paths, setPaths] = useState([]);
  const [selectedId, setSelectedId] = useState(null);
  const [running, setRunning] = useState(false);

  useEffect(() => { refresh(); }, []);

  // The server announces run-finished over the socket so the button re-enables
  // even if the run ended in an error.
  useEffect(() => {
    if (events['run-finished']) setRunning(false);
  }, [events['run-finished']]);

  async function refresh() {
    const res = await fetch('/api/paths');
    const data = await res.json();
    setPaths(data);
    if (!selectedId && data.length) setSelectedId(data[0].id);
  }

  const selected = paths.find((p) => p.id === selectedId);

  return (
    <div className="mx-auto max-w-5xl px-6 py-8">
      <header className="mb-6 flex items-center gap-3">
        <div className="rounded-lg bg-fk-blue px-2.5 py-1 text-lg font-bold text-fk-yellow">f</div>
        <div>
          <h1 className="text-xl font-bold text-fk-ink">Flipkart Lister</h1>
          <p className="text-xs text-slate-500">
            Drives Seller Hub end to end: images, all four tabs, variants, QC.
          </p>
        </div>
      </header>

      {paths.length > 1 && (
        <select
          value={selectedId || ''}
          onChange={(e) => setSelectedId(e.target.value)}
          className="mb-4 rounded-lg border border-slate-300 px-3 py-1.5 text-sm"
        >
          {paths.map((p) => (
            <option key={p.id} value={p.id}>{p.name}</option>
          ))}
        </select>
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

            <RunPanel path={selected} running={running} onStarted={() => setRunning(true)} />
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
