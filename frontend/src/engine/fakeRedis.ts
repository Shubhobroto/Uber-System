import { distanceKm } from "./geo";
import type { Logger } from "./events";

export interface GeoHit {
  member: string;
  distanceKm: number;
  lat: number;
  lon: number;
}

export class RedisUnavailableError extends Error {}

const fmt = (n: number) => n.toFixed(4);

/**
 * The subset of Redis the backend uses, with the same semantics: GEO set with distance-sorted search,
 * sorted sets, SET NX with expiry, lists, and the compare-and-delete release script.
 * Every command is logged in Redis syntax so the UI can show what the backend really sends.
 */
export class FakeRedis {
  private strings = new Map<string, string>();
  private lists = new Map<string, string[]>();
  private sets = new Map<string, Set<string>>();
  private zsets = new Map<string, Map<string, number>>();
  private geo = new Map<string, Map<string, { lat: number; lon: number }>>();
  private expiry = new Map<string, number>();
  /** Number of upcoming GEOSEARCH calls that fail, to simulate a short outage. */
  outages = 0;

  constructor(private readonly now: () => number, private readonly log: Logger) {}

  private expireIfDue(key: string): void {
    const at = this.expiry.get(key);
    if (at !== undefined && at <= this.now()) {
      this.strings.delete(key);
      this.lists.delete(key);
      this.sets.delete(key);
      this.expiry.delete(key);
    }
  }

  // ---------- GEO ----------

  geoAdd(key: string, lon: number, lat: number, member: string): void {
    if (!this.geo.has(key)) this.geo.set(key, new Map());
    this.geo.get(key)!.set(member, { lat, lon });
  }

  geoSearch(key: string, lon: number, lat: number, radiusKm: number, count: number, bookingId?: number): GeoHit[] {
    const command = `GEOSEARCH ${key} FROMLONLAT ${fmt(lon)} ${fmt(lat)} BYRADIUS ${radiusKm} km WITHDIST ASC COUNT ${count}`;
    if (this.outages > 0) {
      this.outages--;
      this.log({ component: "Redis", text: command, result: "ERR connection refused", level: "error", bookingId });
      throw new RedisUnavailableError("Redis connection refused");
    }
    const hits: GeoHit[] = [];
    for (const [member, p] of this.geo.get(key) ?? []) {
      const d = distanceKm({ lat, lon }, p);
      if (d <= radiusKm) hits.push({ member, distanceKm: d, lat: p.lat, lon: p.lon });
    }
    hits.sort((a, b) => a.distanceKm - b.distanceKm);
    const result = hits.slice(0, count);
    this.log({
      component: "Redis",
      text: command,
      result: result.length ? result.map((h) => `${h.member} (${h.distanceKm.toFixed(2)} km)`).join(", ") : "(empty)",
      bookingId,
    });
    return result;
  }

  geoRemove(key: string, members: string[]): void {
    for (const m of members) this.geo.get(key)?.delete(m);
    this.log({ component: "Redis", text: `ZREM ${key} ${members.join(" ")}`, result: `(integer) ${members.length}` });
  }

  geoHas(key: string, member: string): boolean {
    return this.geo.get(key)?.has(member) ?? false;
  }

  // ---------- sorted sets ----------

  zAdd(key: string, score: number, member: string, opts: { quiet?: boolean; bookingId?: number } = {}): void {
    if (!this.zsets.has(key)) this.zsets.set(key, new Map());
    this.zsets.get(key)!.set(member, score);
    if (!opts.quiet) {
      this.log({ component: "Redis", text: `ZADD ${key} ${score} ${member}`, result: "(integer) 1", bookingId: opts.bookingId });
    }
  }

  zRem(key: string, member: string, opts: { quiet?: boolean; bookingId?: number } = {}): number {
    const removed = this.zsets.get(key)?.delete(member) ? 1 : 0;
    if (!opts.quiet) {
      this.log({ component: "Redis", text: `ZREM ${key} ${member}`, result: `(integer) ${removed}`, bookingId: opts.bookingId });
    }
    return removed;
  }

  zRangeByScore(key: string, min: number, max: number, limit: number): string[] {
    const members = [...(this.zsets.get(key) ?? [])]
      .filter(([, s]) => s >= min && s <= max)
      .sort((a, b) => a[1] - b[1])
      .slice(0, limit)
      .map(([m]) => m);
    this.log({
      component: "Redis",
      text: `ZRANGEBYSCORE ${key} ${min} ${max} LIMIT 0 ${limit}`,
      result: members.length ? members.join(", ") : "(empty)",
      level: members.length ? "info" : "quiet",
    });
    return members;
  }

  zScore(key: string, member: string): number | undefined {
    return this.zsets.get(key)?.get(member);
  }

  // ---------- strings ----------

  set(key: string, value: string, opts: { nx?: boolean; ttlMs?: number; bookingId?: number } = {}): "OK" | null {
    this.expireIfDue(key);
    const parts = [`SET ${key} ${value}`];
    if (opts.nx) parts.push("NX");
    if (opts.ttlMs) parts.push(`PX ${opts.ttlMs}`);
    if (opts.nx && this.strings.has(key)) {
      this.log({ component: "Redis", text: parts.join(" "), result: "(nil)  key already exists", level: "warn", bookingId: opts.bookingId });
      return null;
    }
    this.strings.set(key, value);
    if (opts.ttlMs) this.expiry.set(key, this.now() + opts.ttlMs);
    else this.expiry.delete(key);
    this.log({ component: "Redis", text: parts.join(" "), result: "OK", bookingId: opts.bookingId });
    return "OK";
  }

  get(key: string, bookingId?: number): string | null {
    this.expireIfDue(key);
    const value = this.strings.get(key) ?? null;
    this.log({ component: "Redis", text: `GET ${key}`, result: value === null ? "(nil)" : `"${value}"`, bookingId });
    return value;
  }

  peek(key: string): string | null {
    this.expireIfDue(key);
    return this.strings.get(key) ?? null;
  }

  del(keys: string[], bookingId?: number): number {
    let removed = 0;
    for (const k of keys) {
      this.expireIfDue(k);
      if (this.strings.delete(k) || this.lists.delete(k) || this.sets.delete(k)) removed++;
      this.expiry.delete(k);
    }
    this.log({ component: "Redis", text: `DEL ${keys.join(" ")}`, result: `(integer) ${removed}`, bookingId });
    return removed;
  }

  expire(key: string, ttlMs: number, bookingId?: number): void {
    this.expiry.set(key, this.now() + ttlMs);
    this.log({ component: "Redis", text: `PEXPIRE ${key} ${ttlMs}`, result: "(integer) 1", level: "quiet", bookingId });
  }

  /** The backend's release script: delete the key only if this booking still owns it. */
  releaseIfOwner(key: string, owner: string, bookingId?: number): number {
    this.expireIfDue(key);
    const removed = this.strings.get(key) === owner ? 1 : 0;
    if (removed) {
      this.strings.delete(key);
      this.expiry.delete(key);
    }
    this.log({ component: "Redis", text: `EVAL release-if-owner ${key} ${owner}`, result: `(integer) ${removed}`, bookingId });
    return removed;
  }

  // ---------- sets ----------

  sAdd(key: string, member: string, bookingId?: number): void {
    this.expireIfDue(key);
    if (!this.sets.has(key)) this.sets.set(key, new Set());
    this.sets.get(key)!.add(member);
    this.log({ component: "Redis", text: `SADD ${key} ${member}`, result: "(integer) 1", level: "quiet", bookingId });
  }

  sMembers(key: string, bookingId?: number): string[] {
    this.expireIfDue(key);
    const members = [...(this.sets.get(key) ?? [])];
    this.log({ component: "Redis", text: `SMEMBERS ${key}`, result: members.length ? members.join(", ") : "(empty)", bookingId });
    return members;
  }

  // ---------- lists ----------

  rPushAll(key: string, values: string[], bookingId?: number): void {
    this.expireIfDue(key);
    const list = this.lists.get(key) ?? [];
    list.push(...values);
    this.lists.set(key, list);
    this.log({ component: "Redis", text: `RPUSH ${key} ${values.join(" ")}`, result: `(integer) ${list.length}`, bookingId });
  }

  lPop(key: string, bookingId?: number): string | null {
    this.expireIfDue(key);
    const value = this.lists.get(key)?.shift() ?? null;
    this.log({ component: "Redis", text: `LPOP ${key}`, result: value === null ? "(nil)" : `"${value}"`, bookingId });
    return value;
  }
}
