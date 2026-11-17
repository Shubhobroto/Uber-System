import { offsetKm } from "./geo";
import { Simulator, type DriverBehaviour, type DriverSpec, type RiderSpec } from "./simulator";

export const MG_ROAD = { lat: 12.9756, lon: 77.6066 };
const at = (northKm: number, eastKm: number) => offsetKm(MG_ROAD, northKm, eastKm);

// Distances from Priya's pickup at MG Road. Search rings are 2, 5 and 10 km.
const arjun = (behaviour: DriverBehaviour): DriverSpec => ({ id: 7, name: "Arjun", ...at(0.8, 0.6), behaviour }); // 1.0 km
const meera = (behaviour: DriverBehaviour): DriverSpec => ({ id: 3, name: "Meera", ...at(-2.4, 1.6), behaviour }); // 2.9 km
const ravi = (behaviour: DriverBehaviour): DriverSpec => ({ id: 5, name: "Ravi", ...at(2.6, -2.4), behaviour }); // 3.5 km
const farhan = (behaviour: DriverBehaviour): DriverSpec => ({ id: 8, name: "Farhan", ...at(-5.6, -4.2), behaviour }); // 7.0 km
const kiran = (behaviour: DriverBehaviour): DriverSpec => ({ id: 9, name: "Kiran", ...at(0.4, 15), behaviour }); // 15 km

const priya: RiderSpec = { id: 1, name: "Priya", place: "MG Road", ...MG_ROAD };
const kabir: RiderSpec = { id: 2, name: "Kabir", place: "Ulsoor", ...at(0.2, 1.6) };
const ananya: RiderSpec = { id: 3, name: "Ananya", place: "Koramangala", ...at(-4.5, -0.4) };

const accept = (afterMs: number): DriverBehaviour => ({ kind: "accept", afterMs });
const reject = (afterMs: number): DriverBehaviour => ({ kind: "reject", afterMs });
const manual: DriverBehaviour = { kind: "manual" };

export interface ScenarioAction {
  at: number;
  run: (sim: Simulator) => void;
}

export interface Scenario {
  id: string;
  title: string;
  summary: string;
  riders: RiderSpec[];
  drivers: DriverSpec[];
  setup?: (sim: Simulator) => void;
  actions: ScenarioAction[];
}

const book = (riderId: number, atMs = 1_000): ScenarioAction => ({ at: atMs, run: (sim) => sim.bookRide(riderId) });

export const SCENARIOS: Scenario[] = [
  {
    id: "free",
    title: "Free play",
    summary: "You are in control: book rides for Priya, Kabir or Ananya, answer offers on the driver phones, switch phones off, or break the infrastructure.",
    riders: [priya, kabir, ananya],
    drivers: [arjun(manual), meera(manual), ravi(manual), farhan(manual), kiran(manual)],
    actions: [],
  },
  {
    id: "happy",
    title: "1. Happy ride",
    summary: "Priya books. Arjun, the only driver within 2 km, gets the offer and accepts.",
    riders: [priya],
    drivers: [arjun(accept(3_000)), meera(manual), ravi(manual)],
    actions: [book(1)],
  },
  {
    id: "widen",
    title: "2. Nobody close, the search widens",
    summary: "Nobody within 2 km, so the first search grows to 5 km and finds Meera.",
    riders: [priya],
    drivers: [meera(accept(3_000)), farhan(manual)],
    actions: [book(1)],
  },
  {
    id: "reject",
    title: "3. A driver declines, the search widens",
    summary: "Arjun declines. Nobody else is within 2 km, so the search grows to 5 km and Meera gets the offer.",
    riders: [priya],
    drivers: [arjun(reject(2_000)), meera(accept(2_000)), farhan(manual)],
    actions: [book(1)],
  },
  {
    id: "everyone-declines",
    title: "4. Everyone declines",
    summary: "Arjun (2 km ring), then Meera and Ravi (5 km ring), then Farhan (10 km ring) all decline. Only then is Priya told no driver is available.",
    riders: [priya],
    drivers: [arjun(reject(2_000)), meera(reject(2_000)), ravi(reject(2_000)), farhan(reject(2_000))],
    actions: [book(1)],
  },
  {
    id: "timeout",
    title: "5. A driver doesn't answer",
    summary: "Arjun ignores the offer. After 10 seconds the timeout poller moves on, the search widens and Meera gets it.",
    riders: [priya],
    drivers: [arjun({ kind: "ignore" }), meera(accept(2_000))],
    actions: [book(1)],
  },
  {
    id: "race",
    title: "6. Accept at the last millisecond",
    summary: "Arjun taps Accept exactly when the timer runs out. Accept and timeout race; exactly one wins.",
    riders: [priya],
    drivers: [arjun({ kind: "acceptAtDeadline" }), meera(accept(2_000))],
    actions: [book(1)],
  },
  {
    id: "duplicate",
    title: "7. Message delivered twice",
    summary: "RabbitMQ redelivers the ride request. The idempotent consumer ignores the copy.",
    riders: [priya],
    drivers: [arjun(accept(3_000)), meera(manual)],
    setup: (sim) => sim.duplicateNextDelivery(),
    actions: [book(1)],
  },
  {
    id: "two-riders",
    title: "8. Two riders, one nearest driver",
    summary: "Priya and Kabir book at almost the same time. Arjun is nearest to both but can only hold one offer, so Kabir's search widens to Meera.",
    riders: [priya, kabir],
    drivers: [arjun(accept(4_000)), meera(accept(2_000))],
    actions: [book(1, 1_000), book(2, 1_300)],
  },
  {
    id: "nobody",
    title: "9. Nobody nearby",
    summary: "The only driver is 15 km away. The search stops at 10 km and the booking ends cleanly.",
    riders: [priya],
    drivers: [kiran(manual)],
    actions: [book(1)],
  },
  {
    id: "phone-dies",
    title: "10. A driver's phone dies",
    summary: "Arjun's phone goes offline. After 10 s without location pings the sweeper removes him, so Priya's ride goes to Meera.",
    riders: [priya],
    drivers: [arjun(manual), meera(accept(2_000))],
    actions: [{ at: 500, run: (sim) => sim.setDriverOnline(7, false) }, book(1, 12_000)],
  },
  {
    id: "redis-blip",
    title: "11. Redis hiccup",
    summary: "The first two searches fail. RabbitMQ retries with backoff and the third attempt succeeds.",
    riders: [priya],
    drivers: [arjun(accept(2_000))],
    setup: (sim) => sim.failNextSearches(2),
    actions: [book(1)],
  },
  {
    id: "poison",
    title: "12. Poison message",
    summary: "A ride request can't be read. After 3 attempts it is parked in the dead-letter queue.",
    riders: [priya],
    drivers: [arjun(manual)],
    setup: (sim) => sim.corruptNextMessage(),
    actions: [book(1)],
  },
];

export function loadScenario(scenario: Scenario): Simulator {
  const sim = new Simulator();
  scenario.drivers.forEach((d) => sim.addDriver(d));
  scenario.riders.forEach((r) => sim.addRider(r));
  scenario.setup?.(sim);
  scenario.actions.forEach((a) => sim.clock.at(a.at, () => a.run(sim)));
  return sim;
}

export function scenarioById(id: string): Scenario {
  return SCENARIOS.find((s) => s.id === id) ?? SCENARIOS[0];
}
