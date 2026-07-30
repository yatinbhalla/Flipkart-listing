import React, { useEffect, useRef } from 'react';

const TONE = {
  info: 'text-slate-600',
  success: 'text-emerald-600 font-medium',
  error: 'text-rose-600 font-medium',
};

export default function LiveLog({ lines, onClear }) {
  const endRef = useRef(null);
  useEffect(() => { endRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [lines]);

  return (
    <div className="rounded-xl border border-slate-200 bg-white">
      <div className="flex items-center justify-between border-b border-slate-100 px-4 py-2">
        <h3 className="text-sm font-semibold">Activity</h3>
        <button onClick={onClear} className="text-xs text-slate-400 hover:text-slate-700">
          clear
        </button>
      </div>
      <div className="h-72 overflow-y-auto px-4 py-3 font-mono text-xs leading-relaxed">
        {lines.length === 0 && <p className="text-slate-400">Nothing yet.</p>}
        {lines.map((line, i) => (
          <div key={i} className={TONE[line.type] || TONE.info}>
            <span className="mr-2 text-slate-300">
              {line.at.toLocaleTimeString([], { hour12: false })}
            </span>
            {line.text}
          </div>
        ))}
        <div ref={endRef} />
      </div>
    </div>
  );
}
