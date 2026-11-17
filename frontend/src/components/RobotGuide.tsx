import { useEffect, useState } from "react";
import type { GuideMessage } from "../engine/narrator";

const TONE = {
  info: { ring: "border-sky-300", light: "#38bdf8", tag: "bg-sky-100 text-sky-800" },
  success: { ring: "border-emerald-300", light: "#34d399", tag: "bg-emerald-100 text-emerald-800" },
  warn: { ring: "border-amber-300", light: "#fbbf24", tag: "bg-amber-100 text-amber-800" },
};

export function RobotGuide({ messages }: { messages: GuideMessage[] }) {
  const [index, setIndex] = useState(messages.length - 1);
  const [open, setOpen] = useState(true);

  // Jump to the newest explanation whenever one arrives.
  useEffect(() => setIndex(messages.length - 1), [messages]);

  const message = messages[Math.min(index, messages.length - 1)];
  if (!message) return null;
  const tone = TONE[message.tone];

  return (
    <div className="fixed bottom-3 left-3 z-50 flex max-w-[calc(100vw-1.5rem)] items-end gap-2">
      <button onClick={() => setOpen(!open)} aria-label={open ? "Hide the guide" : "Show the guide"} className="robot-bob shrink-0">
        <Robot light={tone.light} key={message.id} />
      </button>
      {open && (
        <div className={`relative w-64 max-w-[calc(100vw-5rem)] rounded-xl border-2 ${tone.ring} bg-white p-2.5 shadow-xl`}>
          <button
            onClick={() => setOpen(false)}
            aria-label="Close the guide"
            className="absolute -right-2 -top-2 flex h-5 w-5 items-center justify-center rounded-full border border-slate-300 bg-white text-[10px] font-bold text-slate-600 shadow hover:bg-slate-100"
          >
            {"\u2715"}
          </button>
          <span className={`inline-block rounded-full px-2 py-0.5 text-[9px] font-semibold ${tone.tag}`}>{message.pattern}</span>
          <h3 className="mt-1 text-xs font-bold text-slate-900">{message.title}</h3>
          <p className="mt-1 text-[11px] leading-snug text-slate-700">{message.body}</p>
          <div className="mt-1.5 flex items-center justify-end gap-2">
            <div className="flex items-center gap-1 text-[10px] text-slate-500">
              <button disabled={index <= 0} onClick={() => setIndex(index - 1)} className="rounded px-1.5 hover:bg-slate-100 disabled:opacity-30">
                {"<"}
              </button>
              <span>
                {index + 1}/{messages.length}
              </span>
              <button
                disabled={index >= messages.length - 1}
                onClick={() => setIndex(index + 1)}
                className="rounded px-1.5 hover:bg-slate-100 disabled:opacity-30"
              >
                {">"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function Robot({ light }: { light: string }) {
  return (
    <svg width="44" height="51" viewBox="0 0 64 74" role="img" aria-label="Dispatch-bot">
      <line x1="32" y1="5" x2="32" y2="13" stroke="#334155" strokeWidth="2" />
      <circle className="antenna-light" cx="32" cy="5" r="3.5" fill={light} />
      <rect x="7" y="22" width="5" height="11" rx="2" fill="#94a3b8" />
      <rect x="52" y="22" width="5" height="11" rx="2" fill="#94a3b8" />
      <rect x="11" y="13" width="42" height="30" rx="10" fill="#e2e8f0" stroke="#334155" strokeWidth="2" />
      <rect x="16" y="18" width="32" height="19" rx="6" fill="#0f172a" />
      <circle className="robot-eye" cx="26" cy="26" r="3" fill={light} />
      <circle className="robot-eye" cx="38" cy="26" r="3" fill={light} />
      <path d="M26 32 Q32 36 38 32" stroke={light} strokeWidth="2" fill="none" strokeLinecap="round" />
      <rect x="9" y="47" width="6" height="15" rx="3" fill="#94a3b8" />
      <rect className="robot-wave" x="49" y="47" width="6" height="15" rx="3" fill="#94a3b8" />
      <rect x="17" y="45" width="30" height="21" rx="6" fill="#cbd5e1" stroke="#334155" strokeWidth="2" />
      <circle cx="32" cy="55" r="3.5" fill={light} />
      <rect x="21" y="66" width="7" height="6" rx="2" fill="#475569" />
      <rect x="36" y="66" width="7" height="6" rx="2" fill="#475569" />
    </svg>
  );
}
