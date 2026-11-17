import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { explain, WELCOME, type GuideMessage } from "./engine/narrator";
import { loadScenario, scenarioById } from "./engine/scenarios";
import type { Simulator } from "./engine/simulator";

const MAX_GUIDE_MESSAGES = 40;
// Long frames (tab in background) are capped so the simulation never jumps ahead in one step.
const MAX_FRAME_MS = 100;

export function useSimulation(scenarioId: string) {
  const [sim, setSim] = useState<Simulator>(() => loadScenario(scenarioById(scenarioId)));
  const [playing, setPlaying] = useState(true);
  const [speed, setSpeed] = useState(1);
  const [now, setNow] = useState(0);
  const [guide, setGuide] = useState<GuideMessage[]>([{ ...WELCOME, id: 0 }]);
  const messageSeq = useRef(1);
  const loadedScenario = useRef(scenarioId);

  const restart = useCallback(() => {
    const scenario = scenarioById(scenarioId);
    setSim(loadScenario(scenario));
    setNow(0);
    setPlaying(true);
    setGuide([{ id: messageSeq.current++, title: scenario.title, pattern: "Scenario", body: scenario.summary, tone: "info" }]);
  }, [scenarioId]);

  useEffect(() => {
    if (loadedScenario.current === scenarioId) return;
    loadedScenario.current = scenarioId;
    restart();
  }, [scenarioId, restart]);

  const version = useSyncExternalStore(
    useCallback((onChange: () => void) => sim.subscribe(onChange), [sim]),
    () => sim.version,
  );

  useEffect(
    () =>
      sim.subscribe((e) => {
        if (e.kind !== "app") return;
        const message = explain(e.event, (id) => sim.driverName(id));
        if (message) setGuide((g) => [...g, { ...message, id: messageSeq.current++ }].slice(-MAX_GUIDE_MESSAGES));
      }),
    [sim],
  );

  useEffect(() => {
    if (!playing) return;
    let frame = 0;
    let last = performance.now();
    const loop = (ts: number) => {
      const dt = Math.min(ts - last, MAX_FRAME_MS);
      last = ts;
      sim.advanceBy(dt * speed);
      setNow(sim.now());
      frame = requestAnimationFrame(loop);
    };
    frame = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(frame);
  }, [sim, playing, speed]);

  return { sim, version, now, playing, setPlaying, speed, setSpeed, restart, guide };
}
