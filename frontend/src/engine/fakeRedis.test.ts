import { describe, expect, it } from "vitest";
import { FakeRedis } from "./fakeRedis";
import { Scheduler } from "./clock";
import { offsetKm } from "./geo";

function redis() {
  const clock = new Scheduler();
  return { clock, redis: new FakeRedis(() => clock.time(), () => {}) };
}

describe("FakeRedis", () => {
  it("GEOSEARCH returns members inside the radius, nearest first, limited by COUNT", () => {
    const { redis: r } = redis();
    const center = { lat: 12.97, lon: 77.6 };
    const far = offsetKm(center, 0, 3);
    const near = offsetKm(center, 1, 0);
    const mid = offsetKm(center, 0, -1.5);
    r.geoAdd("g", far.lon, far.lat, "far");
    r.geoAdd("g", near.lon, near.lat, "near");
    r.geoAdd("g", mid.lon, mid.lat, "mid");

    expect(r.geoSearch("g", center.lon, center.lat, 2, 10).map((h) => h.member)).toEqual(["near", "mid"]);
    expect(r.geoSearch("g", center.lon, center.lat, 5, 2).map((h) => h.member)).toEqual(["near", "mid"]);
  });

  it("ZREM returns 1 to exactly one caller, which is what makes the claim atomic", () => {
    const { redis: r } = redis();
    r.zAdd("deadlines", 100, "41");
    expect(r.zRem("deadlines", "41")).toBe(1);
    expect(r.zRem("deadlines", "41")).toBe(0);
  });

  it("SET NX succeeds once, and again only after the key expires", () => {
    const { clock, redis: r } = redis();
    expect(r.set("k", "a", { nx: true, ttlMs: 1_000 })).toBe("OK");
    expect(r.set("k", "b", { nx: true, ttlMs: 1_000 })).toBeNull();
    clock.advanceBy(1_000);
    expect(r.set("k", "b", { nx: true, ttlMs: 1_000 })).toBe("OK");
  });

  it("the release script deletes the key only for its owner", () => {
    const { redis: r } = redis();
    r.set("driver:7:offer", "41", { nx: true });
    expect(r.releaseIfOwner("driver:7:offer", "42")).toBe(0);
    expect(r.releaseIfOwner("driver:7:offer", "41")).toBe(1);
    expect(r.peek("driver:7:offer")).toBeNull();
  });
});
