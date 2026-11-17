import { distanceKm } from "../engine/geo";
import type { DriverBehaviour, DriverState, OfferOutcome, Simulator } from "../engine/simulator";

const OUTCOME_TEXT: Record<OfferOutcome, string> = {
  accepted: "Ride confirmed. Head to the pickup.",
  rejected: "You declined the ride.",
  expired: "The offer expired and moved on.",
  taken: "You were already assigned another ride.",
  lost: "Too late: the offer had already moved on.",
};

function behaviourHint(b: DriverBehaviour): string | null {
  switch (b.kind) {
    case "accept":
      return `Scripted: accepts after ${b.afterMs / 1000} s`;
    case "reject":
      return `Scripted: declines after ${b.afterMs / 1000} s`;
    case "ignore":
      return "Scripted: never answers";
    case "acceptAtDeadline":
      return "Scripted: accepts at the last moment";
    case "manual":
      return null;
  }
}

export function DriverPhone({ sim, driver, now }: { sim: Simulator; driver: DriverState; now: number }) {
  const available = sim.isDriverAvailable(driver.id);
  const status = !driver.inIndex
    ? { text: driver.online ? "Connecting" : "Offline, removed from search", cls: "bg-slate-200 text-slate-600" }
    : !driver.online
      ? { text: "Phone silent, still in search", cls: "bg-slate-200 text-slate-700" }
      : !available
        ? { text: "On a ride", cls: "bg-blue-100 text-blue-800" }
        : { text: "Available", cls: "bg-emerald-100 text-emerald-800" };

  const offer = driver.offer?.delivered && driver.online ? driver.offer : undefined;
  const remaining = offer ? Math.max(0, offer.expiresAt - now) : 0;
  const pct = offer ? (remaining / sim.cfg.offerTimeoutMs) * 100 : 0;
  const hint = behaviourHint(driver.behaviour);

  return (
    <div className="rounded-3xl border-4 border-slate-800 bg-white p-3 shadow-md">
      <div className="mb-2 flex items-center justify-between gap-2">
        <span className="text-sm font-bold">{driver.name}</span>
        <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${status.cls}`}>{status.text}</span>
      </div>

      {offer ? (
        <div className="rounded-xl border-2 border-amber-400 bg-amber-50 p-2.5">
          <p className="text-sm font-bold text-amber-900">New ride request</p>
          <p className="text-[11px] text-amber-800">
            Booking #{offer.bookingId}, pickup{" "}
            {distanceKm(driver, { lat: offer.pickupLat, lon: offer.pickupLon }).toFixed(1)} km away
          </p>
          <div className="my-2 h-1.5 overflow-hidden rounded-full bg-amber-200">
            <div className="h-full bg-amber-600" style={{ width: `${pct}%` }} />
          </div>
          <p className="mb-2 text-[11px] font-mono text-amber-900">{(remaining / 1000).toFixed(1)} s left</p>
          <div className="flex gap-2">
            <button
              onClick={() => sim.driverAccept(driver.id, offer.bookingId)}
              className="flex-1 rounded-lg bg-emerald-600 py-1.5 text-xs font-semibold text-white hover:bg-emerald-700"
            >
              Accept
            </button>
            <button
              onClick={() => sim.driverReject(driver.id, offer.bookingId)}
              className="flex-1 rounded-lg bg-slate-200 py-1.5 text-xs font-semibold hover:bg-slate-300"
            >
              Decline
            </button>
          </div>
        </div>
      ) : (
        <p className="rounded-xl bg-slate-50 p-2.5 text-xs text-slate-600">
          {driver.lastOutcome ? OUTCOME_TEXT[driver.lastOutcome.outcome] : driver.online ? "Waiting for ride requests..." : "Phone is off."}
        </p>
      )}

      <div className="mt-2 flex items-center justify-between gap-2">
        <span className="text-[10px] text-slate-400">{hint}</span>
        <button
          onClick={() => sim.setDriverOnline(driver.id, !driver.online)}
          className="text-[11px] text-slate-500 underline"
        >
          {driver.online ? "Switch phone off" : "Switch phone on"}
        </button>
      </div>
    </div>
  );
}
