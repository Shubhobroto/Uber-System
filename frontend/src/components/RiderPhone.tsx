import type { RiderState, Simulator } from "../engine/simulator";

export function RiderPhone({ sim, rider }: { sim: Simulator; rider: RiderState }) {
  return (
    <div className="rounded-3xl border-4 border-slate-800 bg-white p-3 shadow-md">
      <div className="mb-2 flex items-center justify-between">
        <span className="text-sm font-bold">{rider.name}</span>
        <span className="text-[11px] text-slate-500">Pickup: {rider.place}</span>
      </div>

      {rider.status === "IDLE" && (
        <button
          onClick={() => sim.bookRide(rider.id)}
          className="w-full rounded-xl bg-fuchsia-600 py-2 text-sm font-semibold text-white hover:bg-fuchsia-700"
        >
          Book a ride
        </button>
      )}

      {rider.status === "PENDING" && (
        <div className="rounded-xl bg-fuchsia-50 p-3 text-center">
          <div className="mx-auto mb-2 h-6 w-6 animate-spin rounded-full border-2 border-fuchsia-300 border-t-fuchsia-700" />
          <p className="text-sm font-semibold text-fuchsia-900">Finding your driver...</p>
          <p className="text-[11px] text-fuchsia-700">Booking #{rider.bookingId} is PENDING</p>
        </div>
      )}

      {rider.status === "CONFIRMED" && (
        <div className="space-y-2">
          <div className="rounded-xl bg-emerald-50 p-3 text-center">
            <p className="text-sm font-semibold text-emerald-900">{sim.driverName(rider.driverId)} is on the way</p>
            <p className="text-[11px] text-emerald-700">Booking #{rider.bookingId} CONFIRMED</p>
          </div>
          <button onClick={() => sim.bookRide(rider.id)} className="w-full text-xs text-slate-500 underline">
            Book another ride
          </button>
        </div>
      )}

      {rider.status === "NO_DRIVERS_AVAILABLE" && (
        <div className="space-y-2">
          <div className="rounded-xl bg-amber-50 p-3 text-center">
            <p className="text-sm font-semibold text-amber-900">No drivers available nearby</p>
            <p className="text-[11px] text-amber-700">Booking #{rider.bookingId} CANCELLED</p>
          </div>
          <button onClick={() => sim.bookRide(rider.id)} className="w-full text-xs text-slate-500 underline">
            Try again
          </button>
        </div>
      )}
    </div>
  );
}
