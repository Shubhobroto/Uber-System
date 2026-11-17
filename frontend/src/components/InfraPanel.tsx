import { useState } from "react";
import { DEAD_LETTER_QUEUE } from "../engine/fakeQueue";
import type { Simulator } from "../engine/simulator";

export function InfraPanel({ sim }: { sim: Simulator; version: number }) {
  // Arming a failure doesn't change the simulator's version, so re-render on click.
  const [, setClicks] = useState(0);
  const actions = [
    {
      label: "Deliver the next ride request twice",
      hint: "Tests the idempotent consumer",
      armed: sim.queue.duplicateNext,
      run: () => sim.duplicateNextDelivery(),
    },
    {
      label: "Make the next 2 Redis searches fail",
      hint: "Tests retry with backoff",
      armed: sim.redis.outages > 0,
      run: () => sim.failNextSearches(2),
    },
    {
      label: "Corrupt the next ride request",
      hint: "Tests the dead-letter queue",
      armed: sim.isCorruptNextArmed(),
      run: () => sim.corruptNextMessage(),
    },
  ];

  return (
    <div className="space-y-3 rounded-xl border border-slate-200 bg-white p-3 shadow-sm">
      <div>
        <h2 className="text-sm font-bold">Break something</h2>
        <p className="text-[11px] text-slate-500">Pick a failure, then book a ride. Watch the log and the guide to see how the backend copes.</p>
      </div>
      {actions.map((a) => (
        <button
          key={a.label}
          onClick={() => {
            a.run();
            setClicks((c) => c + 1);
          }}
          className={`w-full rounded-lg border px-3 py-2 text-left ${
            a.armed ? "border-red-500 bg-red-100 ring-2 ring-red-300" : "border-red-200 bg-red-50 hover:bg-red-100"
          }`}
        >
          <span className="block text-xs font-semibold text-red-900">{a.label}</span>
          <span className="block text-[10px] text-red-700">{a.armed ? "Armed: now book a ride" : a.hint}</span>
        </button>
      ))}
      <div className="rounded-lg bg-slate-50 p-2 text-[11px] text-slate-600">
        <p className="font-semibold">{DEAD_LETTER_QUEUE}</p>
        {sim.queue.deadLetters.length === 0 ? (
          <p>Empty</p>
        ) : (
          sim.queue.deadLetters.map((m, i) => <p key={i}>booking {m.bookingId}: could not be processed</p>)
        )}
      </div>
    </div>
  );
}
