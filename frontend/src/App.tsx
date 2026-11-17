import { useState } from "react";
import { SCENARIOS, scenarioById } from "./engine/scenarios";
import { useSimulation } from "./useSimulation";
import { ControlBar } from "./components/ControlBar";
import { DriverPhone } from "./components/DriverPhone";
import { RiderPhone } from "./components/RiderPhone";
import { MapView } from "./components/MapView";
import { LogPanel } from "./components/LogPanel";
import { InfraPanel } from "./components/InfraPanel";
import { RobotGuide } from "./components/RobotGuide";

const REPO_URL = "https://github.com/Shubhobroto/Uber-System";

export default function App() {
  const [scenarioId, setScenarioId] = useState(SCENARIOS[0].id);
  const { sim, version, now, playing, setPlaying, speed, setSpeed, restart, guide } = useSimulation(scenarioId);

  return (
    <div className="min-h-screen bg-slate-100 text-slate-800">
      <header className="bg-slate-900 text-white">
        <div className="mx-auto flex max-w-[1500px] flex-wrap items-center justify-between gap-3 px-4 py-4">
          <div>
            <h1 className="text-lg font-bold sm:text-xl">Real-Time Ride-Matching Service</h1>
            <p className="text-xs text-slate-300 sm:text-sm">
              Redis GEO search, one offer at a time, atomic claims, idempotent consumers and dead-letter queues, live.
            </p>
          </div>
          <a
            href={REPO_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="rounded-md bg-white px-3 py-1.5 text-xs font-semibold text-slate-900 hover:bg-slate-200"
          >
            View code
          </a>
        </div>
      </header>

      <ControlBar
        scenarioId={scenarioId}
        onScenario={setScenarioId}
        summary={scenarioById(scenarioId).summary}
        playing={playing}
        onTogglePlay={() => setPlaying(!playing)}
        onRestart={restart}
        speed={speed}
        onSpeed={setSpeed}
        now={now}
      />

      <main className="mx-auto grid max-w-[1500px] gap-4 p-4 lg:grid-cols-[250px_1fr_290px]">
        <section className="space-y-3">
          <h2 className="text-xs font-semibold uppercase tracking-wide text-slate-500">Rider app</h2>
          {[...sim.riders.values()].map((r) => (
            <RiderPhone key={r.id} sim={sim} rider={r} />
          ))}
        </section>

        <section className="space-y-2">
          <h2 className="text-xs font-semibold uppercase tracking-wide text-slate-500">City view, Bengaluru</h2>
          <MapView sim={sim} version={version} />
          <Legend />
        </section>

        <section className="space-y-3">
          <h2 className="text-xs font-semibold uppercase tracking-wide text-slate-500">Driver app</h2>
          {[...sim.drivers.values()].map((d) => (
            <DriverPhone key={d.id} sim={sim} driver={d} now={now} />
          ))}
        </section>
      </main>

      <section className="mx-auto grid max-w-[1500px] gap-4 px-4 pb-40 lg:grid-cols-[1fr_290px]">
        <LogPanel sim={sim} version={version} />
        <InfraPanel sim={sim} version={version} />
      </section>

      <RobotGuide messages={guide} />
    </div>
  );
}

function Legend() {
  const items = [
    ["bg-emerald-500", "Free driver"],
    ["bg-amber-500", "Offer pending"],
    ["bg-blue-600", "On a ride"],
    ["bg-slate-400", "Offline / removed"],
    ["bg-fuchsia-600", "Rider pickup"],
  ];
  return (
    <div className="flex flex-wrap gap-3 text-[11px] text-slate-600">
      {items.map(([color, label]) => (
        <span key={label} className="flex items-center gap-1">
          <span className={`inline-block h-2.5 w-2.5 rounded-full ${color}`} /> {label}
        </span>
      ))}
      <span className="flex items-center gap-1">
        <span className="inline-block h-0 w-4 border-t-2 border-dashed border-sky-500" /> Search radius
      </span>
    </div>
  );
}
