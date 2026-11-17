import { SCENARIOS } from "../engine/scenarios";

interface Props {
  scenarioId: string;
  onScenario: (id: string) => void;
  summary: string;
  playing: boolean;
  onTogglePlay: () => void;
  onRestart: () => void;
  speed: number;
  onSpeed: (speed: number) => void;
  now: number;
}

const SPEEDS = [0.5, 1, 2, 4];

export function ControlBar(p: Props) {
  return (
    <div className="border-b border-slate-200 bg-white">
      <div className="mx-auto flex max-w-[1500px] flex-wrap items-center gap-3 px-4 py-3">
        <label className="text-xs font-semibold text-slate-600" htmlFor="scenario">
          Try a scenario
        </label>
        <select
          id="scenario"
          value={p.scenarioId}
          onChange={(e) => p.onScenario(e.target.value)}
          className="rounded-md border border-slate-300 bg-white px-2 py-1.5 text-sm"
        >
          {SCENARIOS.map((s) => (
            <option key={s.id} value={s.id}>
              {s.title}
            </option>
          ))}
        </select>

        <button
          onClick={p.onTogglePlay}
          className="rounded-md bg-slate-900 px-3 py-1.5 text-xs font-semibold text-white hover:bg-slate-700"
        >
          {p.playing ? "Pause" : "Play"}
        </button>
        <button
          onClick={p.onRestart}
          className="rounded-md border border-slate-300 px-3 py-1.5 text-xs font-semibold hover:bg-slate-100"
        >
          Restart
        </button>

        <div className="flex overflow-hidden rounded-md border border-slate-300">
          {SPEEDS.map((s) => (
            <button
              key={s}
              onClick={() => p.onSpeed(s)}
              className={`px-2 py-1.5 text-xs font-semibold ${p.speed === s ? "bg-sky-600 text-white" : "hover:bg-slate-100"}`}
            >
              {s}x
            </button>
          ))}
        </div>

        <span className="font-mono text-xs text-slate-500">t = {(p.now / 1000).toFixed(1)} s</span>
        <p className="w-full text-sm text-slate-600">{p.summary}</p>
      </div>
    </div>
  );
}
