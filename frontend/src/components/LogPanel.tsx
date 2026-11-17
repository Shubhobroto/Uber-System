import { useEffect, useMemo, useRef, useState } from "react";
import type { Component } from "../engine/events";
import type { Simulator } from "../engine/simulator";

const COMPONENT_STYLE: Record<Component, string> = {
  API: "bg-slate-700 text-white",
  DB: "bg-emerald-600 text-white",
  RabbitMQ: "bg-orange-500 text-white",
  Redis: "bg-red-600 text-white",
  WebSocket: "bg-violet-600 text-white",
  Scheduler: "bg-sky-600 text-white",
  Driver: "bg-amber-500 text-white",
  Rider: "bg-fuchsia-600 text-white",
};

const LEVEL_STYLE = { info: "", warn: "bg-amber-50", error: "bg-red-50", quiet: "opacity-60" };
const MAX_ROWS = 300;

export function LogPanel({ sim, version }: { sim: Simulator; version: number }) {
  const [showQuiet, setShowQuiet] = useState(false);
  const [follow, setFollow] = useState(true);
  const body = useRef<HTMLDivElement>(null);

  const rows = useMemo(
    () => sim.logs.filter((l) => showQuiet || l.level !== "quiet").slice(-MAX_ROWS),
    // version changes whenever the simulator appends a log line
    [sim, version, showQuiet],
  );

  useEffect(() => {
    if (follow && body.current) body.current.scrollTop = body.current.scrollHeight;
  }, [rows, follow]);

  return (
    <div className="rounded-xl border border-slate-200 bg-white shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 px-3 py-2">
        <div>
          <h2 className="text-sm font-bold">Behind the scenes</h2>
          <p className="text-[11px] text-slate-500">Every command the backend sends, in the order it sends it.</p>
        </div>
        <div className="flex items-center gap-3 text-[11px] text-slate-600">
          <label className="flex items-center gap-1">
            <input type="checkbox" checked={showQuiet} onChange={(e) => setShowQuiet(e.target.checked)} />
            Show location pings and polls
          </label>
          <label className="flex items-center gap-1">
            <input type="checkbox" checked={follow} onChange={(e) => setFollow(e.target.checked)} />
            Follow
          </label>
        </div>
      </div>
      <div ref={body} className="h-80 overflow-y-auto font-mono text-[11px]">
        {rows.length === 0 && <p className="p-3 text-slate-400">Nothing yet. Book a ride or pick a scenario.</p>}
        {rows.map((l) => (
          <div key={l.id} className={`flex gap-2 border-b border-slate-100 px-3 py-1 ${LEVEL_STYLE[l.level]}`}>
            <span className="w-14 shrink-0 text-slate-400">{(l.t / 1000).toFixed(2)}s</span>
            <span className={`h-fit w-20 shrink-0 rounded px-1 text-center text-[10px] font-semibold ${COMPONENT_STYLE[l.component]}`}>
              {l.component}
            </span>
            <span className="min-w-0 flex-1 break-words">
              <span className="text-slate-800">{l.text}</span>
              {l.result && <span className="text-slate-500"> {"->"} {l.result}</span>}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
