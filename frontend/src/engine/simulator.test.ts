import { describe, expect, it } from "vitest";
import { loadScenario, scenarioById } from "./scenarios";
import type { AppEvent } from "./events";
import type { Simulator } from "./simulator";

function run(id: string, ms: number): Simulator {
  const sim = loadScenario(scenarioById(id));
  sim.advanceBy(ms);
  return sim;
}

const types = (sim: Simulator) => sim.events.map((e) => e.event.type);
const of = <T extends AppEvent["type"]>(sim: Simulator, type: T) =>
  sim.events.map((e) => e.event).filter((e): e is Extract<AppEvent, { type: T }> => e.type === type);

describe("ride-matching scenarios", () => {
  it("happy ride: the nearest free driver gets the offer and the booking is confirmed", () => {
    const sim = run("happy", 10_000);
    expect(of(sim, "offerSent").map((e) => e.driverId)).toEqual([7]);
    expect(sim.riders.get(1)).toMatchObject({ status: "CONFIRMED", driverId: 7 });
    expect(sim.db.bookings.get(41)).toMatchObject({ status: "CONFIRMED", driverId: 7 });
    expect(sim.isDriverAvailable(7)).toBe(false);
  });

  it("the search widens from 2 km to 5 km when nobody is close", () => {
    const sim = run("widen", 10_000);
    expect(of(sim, "radiusSearched").map((e) => [e.radiusKm, e.available])).toEqual([
      [2, []],
      [5, [3]],
    ]);
    expect(sim.riders.get(1)).toMatchObject({ status: "CONFIRMED", driverId: 3 });
  });

  it("after a decline the search widens to the next ring and the next driver gets the offer", () => {
    const sim = run("reject", 10_000);
    expect(of(sim, "offerSent").map((e) => e.driverId)).toEqual([7, 3]);
    expect(of(sim, "radiusSearched").map((e) => [e.radiusKm, e.reason])).toEqual([
      [2, "initial"],
      [5, "widened"],
    ]);
    expect(types(sim)).not.toContain("offerTimedOut");
    expect(sim.riders.get(1)).toMatchObject({ status: "CONFIRMED", driverId: 3 });
  });

  it("when everyone declines, every ring is tried, nobody is asked twice, then the rider is told", () => {
    const sim = run("everyone-declines", 20_000);
    expect(of(sim, "offerSent").map((e) => e.driverId)).toEqual([7, 3, 5, 8]);
    expect(of(sim, "radiusSearched").map((e) => e.radiusKm)).toEqual([2, 5, 10]);
    expect(sim.riders.get(1)?.status).toBe("NO_DRIVERS_AVAILABLE");
    expect(sim.db.bookings.get(41)?.status).toBe("CANCELLED");
  });

  it("an ignored offer times out after 10 seconds and the search moves on", () => {
    const sim = run("timeout", 9_000);
    expect(of(sim, "offerSent").map((e) => e.driverId)).toEqual([7]);
    sim.advanceBy(10_000);
    expect(of(sim, "offerTimedOut")[0]).toMatchObject({ driverId: 7 });
    expect(sim.riders.get(1)).toMatchObject({ status: "CONFIRMED", driverId: 3 });
  });

  it("accept racing the timeout: exactly one wins and the booking is never assigned twice", () => {
    const sim = run("race", 20_000);
    expect(of(sim, "claimLost")).toHaveLength(1);
    expect(of(sim, "offerTimedOut")).toHaveLength(1);
    expect(of(sim, "bookingConfirmed")).toHaveLength(1);
    expect(sim.riders.get(1)).toMatchObject({ status: "CONFIRMED", driverId: 3 });
    expect(sim.isDriverAvailable(7)).toBe(true);
  });

  it("a duplicate delivery is ignored and nobody is offered the ride twice", () => {
    const sim = run("duplicate", 10_000);
    expect(of(sim, "duplicateIgnored")).toHaveLength(1);
    expect(of(sim, "offerSent")).toHaveLength(1);
    expect(sim.riders.get(1)?.status).toBe("CONFIRMED");
  });

  it("a driver holds one offer at a time, so the second rider's search widens to the next driver", () => {
    const sim = run("two-riders", 10_000);
    const skips = of(sim, "driverSkippedReserved");
    expect(skips.length).toBeGreaterThan(0);
    expect(skips.every((e) => e.bookingId === 42 && e.driverId === 7)).toBe(true);
    expect(sim.riders.get(1)).toMatchObject({ status: "CONFIRMED", driverId: 7 });
    expect(sim.riders.get(2)).toMatchObject({ status: "CONFIRMED", driverId: 3 });
  });

  it("with nobody within 10 km the booking is cancelled and the rider told", () => {
    const sim = run("nobody", 5_000);
    expect(of(sim, "radiusSearched").map((e) => e.radiusKm)).toEqual([2, 5, 10]);
    expect(sim.riders.get(1)?.status).toBe("NO_DRIVERS_AVAILABLE");
    expect(sim.db.bookings.get(41)?.status).toBe("CANCELLED");
  });

  it("a phone that is off but not yet evicted gets an offer it never sees; it times out and moves on", () => {
    const sim = run("phone-dies", 5_000);
    sim.bookRide(1);
    sim.advanceBy(500);
    const arjun = sim.drivers.get(7)!;
    expect(arjun.offer).toMatchObject({ bookingId: 41, delivered: false });
    expect(of(sim, "offerNotDelivered")).toEqual([{ type: "offerNotDelivered", bookingId: 41, driverId: 7 }]);

    // switching the phone back on does not bring back a message that was lost
    sim.setDriverOnline(7, true);
    expect(arjun.offer?.delivered).toBe(false);

    sim.advanceBy(15_000);
    expect(of(sim, "offerTimedOut")[0]).toMatchObject({ driverId: 7 });
    expect(sim.riders.get(1)).toMatchObject({ status: "CONFIRMED", driverId: 3 });
  });

  it("a silent driver is evicted by the sweeper and never offered the ride", () => {
    const sim = run("phone-dies", 20_000);
    expect(of(sim, "driverEvicted").map((e) => e.driverId)).toEqual([7]);
    expect(of(sim, "offerSent").map((e) => e.driverId)).toEqual([3]);
    expect(sim.riders.get(1)).toMatchObject({ status: "CONFIRMED", driverId: 3 });
  });

  it("a Redis hiccup is retried with backoff and the third attempt succeeds", () => {
    const sim = run("redis-blip", 10_000);
    expect(of(sim, "retryScheduled").map((e) => e.delayMs)).toEqual([500, 1_000]);
    expect(sim.queue.deadLetters).toHaveLength(0);
    expect(sim.riders.get(1)?.status).toBe("CONFIRMED");
  });

  it("a poison message is dead-lettered after 3 attempts and the booking stays pending", () => {
    const sim = run("poison", 10_000);
    expect(of(sim, "matchingFailed")).toHaveLength(3);
    expect(sim.queue.deadLetters).toEqual([{ bookingId: 41, corrupt: true }]);
    expect(sim.riders.get(1)?.status).toBe("PENDING");
  });
});

describe("manual actions", () => {
  it("only the driver holding the offer can accept it", () => {
    const sim = run("free", 0);
    sim.bookRide(1);
    sim.advanceBy(500);
    expect(sim.drivers.get(7)?.offer?.bookingId).toBe(41);

    expect(sim.driverAccept(3, 41)).toBe(false);
    expect(of(sim, "acceptIgnored")).toHaveLength(1);
    expect(sim.driverAccept(7, 41)).toBe(true);
    expect(sim.riders.get(1)).toMatchObject({ status: "CONFIRMED", driverId: 7 });
  });

  it("a confirmed driver is not offered the next booking", () => {
    const sim = run("free", 0);
    sim.bookRide(1);
    sim.advanceBy(500);
    sim.driverAccept(7, 41);
    sim.bookRide(2);
    sim.advanceBy(500);
    expect(sim.drivers.get(3)?.offer?.bookingId).toBe(42);
    expect(sim.drivers.get(7)?.offer).toBeUndefined();
  });

  it("in free play the first 2 km ring around Priya holds only Arjun", () => {
    const sim = run("free", 0);
    sim.bookRide(1);
    sim.advanceBy(500);
    expect(of(sim, "radiusSearched")).toEqual([
      { type: "radiusSearched", bookingId: 41, radiusKm: 2, found: [7], available: [7], reason: "initial" },
    ]);
  });

  it("the reservation is released when an offer ends, so the driver can get the next ride", () => {
    const sim = run("free", 0);
    sim.bookRide(1);
    sim.advanceBy(500);
    sim.driverReject(7, 41);
    expect(sim.redis.peek("driver:7:offer")).toBeNull();

    sim.bookRide(2);
    sim.advanceBy(500);
    expect(sim.drivers.get(7)?.offer?.bookingId).toBe(42);
  });
});
