import { Scheduler, type Cancellable } from "./clock";
import { CONFIG, type SimConfig } from "./config";
import { FakeDb } from "./fakeDb";
import { FakeQueue, type RideRequestMessage } from "./fakeQueue";
import { FakeRedis } from "./fakeRedis";
import type { AppEvent, LogEntry, LogInput, SimEvent } from "./events";

const GEO_KEY = "driver:geo";
const SEEN_KEY = "driver:seen";
const DEADLINES_KEY = "ride:offer:deadlines";
const sessionKey = (bookingId: number) => `ride:${bookingId}:matching`;
const driversKey = (bookingId: number) => `ride:${bookingId}:drivers`;
const currentKey = (bookingId: number) => `ride:${bookingId}:current`;
const ringKey = (bookingId: number) => `ride:${bookingId}:ring`;
const askedKey = (bookingId: number) => `ride:${bookingId}:asked`;
const reservationKey = (driverId: number) => `driver:${driverId}:offer`;

export type DriverBehaviour =
  | { kind: "manual" }
  | { kind: "accept"; afterMs: number }
  | { kind: "reject"; afterMs: number }
  | { kind: "ignore" }
  | { kind: "acceptAtDeadline" };

export interface DriverSpec {
  id: number;
  name: string;
  lat: number;
  lon: number;
  online?: boolean;
  behaviour?: DriverBehaviour;
}

export interface RiderSpec {
  id: number;
  name: string;
  place: string;
  lat: number;
  lon: number;
}

export type OfferOutcome = "accepted" | "rejected" | "expired" | "taken" | "lost";

export interface DriverState {
  id: number;
  name: string;
  lat: number;
  lon: number;
  online: boolean;
  inIndex: boolean;
  behaviour: DriverBehaviour;
  offer?: { bookingId: number; expiresAt: number; pickupLat: number; pickupLon: number; delivered: boolean };
  lastOutcome?: { bookingId: number; outcome: OfferOutcome; at: number };
  ping?: Cancellable;
}

export type RiderStatus = "IDLE" | "PENDING" | "CONFIRMED" | "NO_DRIVERS_AVAILABLE";

export interface RiderState extends RiderSpec {
  bookingId?: number;
  status: RiderStatus;
  driverId?: number;
}

export interface SearchCircle {
  bookingId: number;
  lat: number;
  lon: number;
  radiusKm: number;
}

/**
 * The ride-matching backend, running in the browser.
 * Method by method this follows the Spring Boot services (BookingServiceImpl, MatchingServiceImpl,
 * RedisLocationServiceImpl, OfferDeadlineStore, DriverReservationStore, TimeoutServiceImpl,
 * DriverPresenceSweeper) against in-memory Redis, RabbitMQ and SQL that keep the same semantics.
 */
export class Simulator {
  readonly clock = new Scheduler();
  readonly redis: FakeRedis;
  readonly db: FakeDb;
  readonly queue: FakeQueue;
  readonly drivers = new Map<number, DriverState>();
  readonly riders = new Map<number, RiderState>();
  readonly searches = new Map<number, SearchCircle>();
  readonly logs: LogEntry[] = [];
  readonly events: { t: number; event: AppEvent }[] = [];
  version = 0;

  private readonly listeners = new Set<(e: SimEvent) => void>();
  private logSeq = 0;
  private corruptNext = false;

  constructor(readonly cfg: SimConfig = CONFIG) {
    const log = (entry: LogInput) => this.pushLog(entry);
    this.redis = new FakeRedis(() => this.clock.time(), log);
    this.db = new FakeDb(log);
    this.queue = new FakeQueue(this.clock, log, (m) => this.consume(m), (e) => this.emit(e), cfg);
    this.clock.every(cfg.timeoutPollMs, () => this.pollTimeouts());
    this.clock.every(cfg.staleSweepMs, () => this.sweepStaleDrivers());
  }

  // ============ plumbing ============

  now(): number {
    return this.clock.time();
  }

  advanceBy(ms: number): void {
    this.clock.advanceBy(ms);
  }

  subscribe(listener: (e: SimEvent) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private pushLog(input: LogInput): void {
    const entry: LogEntry = { id: this.logSeq++, t: this.now(), level: "info", ...input };
    this.logs.push(entry);
    this.version++;
    this.listeners.forEach((l) => l({ kind: "log", entry }));
  }

  private emit(event: AppEvent): void {
    this.events.push({ t: this.now(), event });
    this.version++;
    this.listeners.forEach((l) => l({ kind: "app", t: this.now(), event }));
  }

  driverName(id: number | undefined): string {
    return id === undefined ? "a driver" : this.drivers.get(id)?.name ?? `driver ${id}`;
  }

  isDriverAvailable(id: number): boolean {
    return this.db.drivers.get(id)?.available ?? false;
  }

  // ============ setup and outside actions (what apps and testers do) ============

  addDriver(spec: DriverSpec): void {
    this.db.insertDriver(spec.id, spec.name);
    const driver: DriverState = {
      id: spec.id,
      name: spec.name,
      lat: spec.lat,
      lon: spec.lon,
      online: false,
      inIndex: false,
      behaviour: spec.behaviour ?? { kind: "manual" },
    };
    this.drivers.set(spec.id, driver);
    if (spec.online !== false) this.setDriverOnline(spec.id, true);
  }

  addRider(spec: RiderSpec): void {
    this.riders.set(spec.id, { ...spec, status: "IDLE" });
  }

  setDriverOnline(driverId: number, online: boolean): void {
    const driver = this.drivers.get(driverId);
    if (!driver || driver.online === online) return;
    driver.online = online;
    if (online) {
      this.saveDriverLocation(driver);
      driver.ping = this.clock.every(this.cfg.pingIntervalMs, () => this.saveDriverLocation(driver));
    } else {
      driver.ping?.cancel();
      driver.ping = undefined;
      this.pushLog({ component: "Driver", text: `${driver.name}'s phone went offline`, result: "no more location updates", level: "warn" });
      this.emit({ type: "driverOffline", driverId });
    }
  }

  /** POST /api/bookings */
  bookRide(riderId: number): number | undefined {
    const rider = this.riders.get(riderId);
    if (!rider || rider.status === "PENDING") return undefined;
    this.pushLog({ component: "API", text: `POST /api/bookings  {"passengerId":${riderId}}`, result: `${rider.name} requests a ride from ${rider.place}` });
    const booking = this.db.insertBooking(riderId, rider.lat, rider.lon);
    rider.bookingId = booking.id;
    rider.status = "PENDING";
    rider.driverId = undefined;
    this.pushLog({ component: "API", text: "201 Created", result: `booking ${booking.id} is PENDING, rider is not kept waiting`, bookingId: booking.id });
    // RideRequestPublisher: @TransactionalEventListener(AFTER_COMMIT)
    this.queue.publish({ bookingId: booking.id, corrupt: this.corruptNext });
    this.corruptNext = false;
    this.emit({ type: "publishedAfterCommit", bookingId: booking.id });
    return booking.id;
  }

  /** POST /api/bookings/accept */
  driverAccept(driverId: number, bookingId: number): boolean {
    return this.acceptRide(driverId, bookingId);
  }

  /** POST /api/bookings/reject */
  driverReject(driverId: number, bookingId: number): void {
    this.rejectRide(driverId, bookingId);
  }

  /**
   * The driver taps Accept at the instant the deadline passes. The accept request has checked that it
   * holds the offer, then the timeout poller claims the offer before the accept tries to.
   */
  raceAcceptAgainstTimeout(driverId: number, bookingId: number): void {
    this.pushLog({
      component: "Driver",
      text: `${this.driverName(driverId)} taps Accept just as the 10 s timer runs out`,
      result: "accept request and timeout poller now race",
      level: "warn",
      bookingId,
    });
    let claimedByTimeout: number[] = [];
    this.acceptRide(driverId, bookingId, () => {
      claimedByTimeout = this.claimExpired();
    });
    this.advanceOffers(claimedByTimeout);
  }

  duplicateNextDelivery(): void {
    this.queue.duplicateNext = true;
  }

  failNextSearches(count: number): void {
    this.redis.outages = count;
  }

  corruptNextMessage(): void {
    this.corruptNext = true;
  }

  isCorruptNextArmed(): boolean {
    return this.corruptNext;
  }

  // ============ RedisLocationServiceImpl ============

  private saveDriverLocation(driver: DriverState): void {
    // GEOADD + ZADD in one pipeline: position and last-seen time.
    this.redis.geoAdd(GEO_KEY, driver.lon, driver.lat, String(driver.id));
    this.redis.zAdd(SEEN_KEY, this.now(), String(driver.id), { quiet: true });
    driver.inIndex = true;
    this.pushLog({
      component: "Redis",
      text: `GEOADD ${GEO_KEY} ${driver.lon.toFixed(4)} ${driver.lat.toFixed(4)} ${driver.id} + ZADD ${SEEN_KEY} ${this.now()} ${driver.id}`,
      result: `${driver.name} location ping (pipelined)`,
      level: "quiet",
    });
  }

  private getNearbyDrivers(lat: number, lon: number, radiusKm: number, limit: number, bookingId: number) {
    const radius = Math.min(radiusKm, this.cfg.maxRadiusKm);
    return this.redis.geoSearch(GEO_KEY, lon, lat, radius, limit, bookingId);
  }

  // ============ DriverPresenceSweeper ============

  private sweepStaleDrivers(): void {
    const cutoff = this.now() - this.cfg.driverStaleAfterMs;
    const stale = this.redis.zRangeByScore(SEEN_KEY, 0, cutoff, 500);
    if (!stale.length) return;
    this.redis.geoRemove(GEO_KEY, stale);
    for (const member of stale) {
      this.redis.zRem(SEEN_KEY, member, { quiet: true });
      const driver = this.drivers.get(Number(member));
      if (driver) driver.inIndex = false;
      this.emit({ type: "driverEvicted", driverId: Number(member) });
    }
    this.pushLog({ component: "Scheduler", text: "DriverPresenceSweeper", result: `evicted ${stale.length} stale driver(s)`, level: "warn" });
  }

  // ============ RideRequestConsumer + MatchingServiceImpl ============

  private consume(message: RideRequestMessage): void {
    this.findNearbyDriversAndNotify(message.bookingId);
  }

  private findNearbyDriversAndNotify(bookingId: number): void {
    const booking = this.db.findBooking(bookingId);
    if (!booking) throw new Error(`Booking not found: ${bookingId}`);
    if (booking.status !== "PENDING") {
      this.pushLog({ component: "Scheduler", text: "matching skipped", result: `booking is ${booking.status}`, bookingId });
      return;
    }
    // Delivery is at least once: only the first delivery may start a matching session.
    if (!this.redis.set(sessionKey(bookingId), "1", { nx: true, ttlMs: this.cfg.sessionTtlMs, bookingId })) {
      this.emit({ type: "duplicateIgnored", bookingId });
      return;
    }
    try {
      const candidates = this.findCandidates(bookingId, booking.pickupLat, booking.pickupLon, 0, new Set());
      if (!candidates.driverIds.length) {
        this.finishWithoutDriver(bookingId);
        return;
      }
      this.queueCandidates(bookingId, candidates.ring, candidates.driverIds);
      this.notifyNextDriver(bookingId);
    } catch (error) {
      // Release the guard so the retry can start over instead of being blocked by it.
      this.redis.del([sessionKey(bookingId)], bookingId);
      throw error;
    }
  }

  /** Nearest-first free drivers from the first ring (from fromRing on) that has any, leaving out drivers already asked. */
  private findCandidates(
    bookingId: number,
    lat: number,
    lon: number,
    fromRing: number,
    alreadyAsked: Set<number>,
  ): { ring: number; driverIds: number[] } {
    const radii = this.cfg.searchRadiiKm;
    for (let ring = fromRing; ring < radii.length; ring++) {
      const radiusKm = radii[ring];
      this.searches.set(bookingId, { bookingId, lat, lon, radiusKm });
      const nearby = this.getNearbyDrivers(lat, lon, radiusKm, this.cfg.maxCandidates, bookingId);
      const ids = nearby.map((h) => Number(h.member)).filter((id) => !alreadyAsked.has(id));
      const available = ids.length ? this.db.findAvailableIds(ids, bookingId) : new Set<number>();
      const ordered = ids.filter((id) => available.has(id));
      this.emit({ type: "radiusSearched", bookingId, radiusKm, found: ids, available: ordered, reason: fromRing > 0 ? "widened" : "initial" });
      if (ordered.length) return { ring, driverIds: ordered };
    }
    return { ring: radii.length, driverIds: [] };
  }

  /** Everyone queued so far was asked or is busy: look one ring further out. False when no ring is left. */
  private widenSearch(bookingId: number, lat: number, lon: number): boolean {
    const ring = this.redis.get(ringKey(bookingId), bookingId);
    const nextRing = ring === null ? 0 : Number(ring) + 1;
    const alreadyAsked = new Set(this.redis.sMembers(askedKey(bookingId), bookingId).map(Number));
    const candidates = this.findCandidates(bookingId, lat, lon, nextRing, alreadyAsked);
    if (!candidates.driverIds.length) return false;
    this.queueCandidates(bookingId, candidates.ring, candidates.driverIds);
    return true;
  }

  private queueCandidates(bookingId: number, ring: number, driverIds: number[]): void {
    this.redis.del([driversKey(bookingId)], bookingId);
    this.redis.rPushAll(driversKey(bookingId), driverIds.map(String), bookingId);
    this.redis.expire(driversKey(bookingId), this.cfg.sessionTtlMs, bookingId);
    this.redis.set(ringKey(bookingId), String(ring), { ttlMs: this.cfg.sessionTtlMs, bookingId });
  }

  notifyNextDriver(bookingId: number): void {
    // The previous offer (rejected or timed out) is over, so that driver can receive other rides again.
    this.releaseCurrentOffer(bookingId);

    const booking = this.db.findBooking(bookingId);
    if (!booking) throw new Error(`Booking not found: ${bookingId}`);
    if (booking.status !== "PENDING") {
      this.clearOfferState(bookingId);
      return;
    }

    const timeout = this.cfg.offerTimeoutMs;
    let next: string | null;
    // A driver holds one pending offer at a time; skip anyone already deciding on another ride.
    for (;;) {
      next = this.redis.lPop(driversKey(bookingId), bookingId);
      if (next === null) {
        if (this.widenSearch(bookingId, booking.pickupLat, booking.pickupLon)) continue;
        this.finishWithoutDriver(bookingId);
        return;
      }
      const driverId = Number(next);
      if (this.redis.set(reservationKey(driverId), String(bookingId), { nx: true, ttlMs: timeout + this.cfg.reservationGraceMs, bookingId })) break;
      this.emit({ type: "driverSkippedReserved", bookingId, driverId });
    }

    const driverId = Number(next);
    this.redis.sAdd(askedKey(bookingId), next, bookingId);
    this.redis.expire(askedKey(bookingId), this.cfg.sessionTtlMs, bookingId);
    // State first, notification last: a driver who answers instantly must already find the offer in place.
    this.redis.set(currentKey(bookingId), next, { ttlMs: timeout + 60_000, bookingId });
    this.redis.zAdd(DEADLINES_KEY, this.now() + timeout, String(bookingId), { bookingId });
    this.sendOffer(driverId, bookingId, booking.pickupLat, booking.pickupLon);
  }

  private finishWithoutDriver(bookingId: number): void {
    const cancelled = this.db.transitionStatus(bookingId, "PENDING", "CANCELLED");
    this.clearOfferState(bookingId);
    this.searches.delete(bookingId);
    if (cancelled) {
      this.sendBookingUpdate(bookingId, "NO_DRIVERS_AVAILABLE");
      this.emit({ type: "bookingCancelled", bookingId, reason: "NO_DRIVERS_AVAILABLE" });
    }
  }

  private clearOfferState(bookingId: number): void {
    this.releaseCurrentOffer(bookingId);
    this.redis.del([currentKey(bookingId), driversKey(bookingId), ringKey(bookingId), askedKey(bookingId)], bookingId);
    this.redis.zRem(DEADLINES_KEY, String(bookingId), { bookingId });
  }

  private releaseCurrentOffer(bookingId: number): void {
    const previous = this.redis.get(currentKey(bookingId), bookingId);
    if (previous !== null) {
      this.redis.releaseIfOwner(reservationKey(Number(previous)), String(bookingId), bookingId);
      this.clearDriverOffer(Number(previous), bookingId, "expired");
    }
  }

  // ============ OfferDeadlineStore + TimeoutServiceImpl ============

  private claim(bookingId: number): boolean {
    return this.redis.zRem(DEADLINES_KEY, String(bookingId), { bookingId }) === 1;
  }

  private claimExpired(): number[] {
    const due = this.redis.zRangeByScore(DEADLINES_KEY, 0, this.now(), 100);
    return due.map(Number).filter((id) => this.claim(id));
  }

  private pollTimeouts(): void {
    this.advanceOffers(this.claimExpired());
  }

  private advanceOffers(bookingIds: number[]): void {
    for (const bookingId of bookingIds) {
      const holder = this.redis.peek(currentKey(bookingId));
      this.pushLog({ component: "Scheduler", text: "TimeoutService", result: `offer for booking ${bookingId} timed out, moving to the next driver`, level: "warn", bookingId });
      this.emit({ type: "offerTimedOut", bookingId, driverId: holder === null ? undefined : Number(holder) });
      try {
        this.notifyNextDriver(bookingId);
      } catch {
        // The offer was already claimed, so put it back to be retried instead of losing the booking.
        this.redis.zAdd(DEADLINES_KEY, this.now() + 1_000, String(bookingId), { bookingId });
      }
    }
  }

  // ============ BookingServiceImpl ============

  private acceptRide(driverId: number, bookingId: number, afterOwnershipCheck?: () => void): boolean {
    this.pushLog({ component: "API", text: `POST /api/bookings/accept?bookingId=${bookingId}&driverId=${driverId}`, result: `${this.driverName(driverId)} taps Accept`, bookingId });
    const current = this.redis.get(currentKey(bookingId), bookingId);
    if (current !== String(driverId)) {
      this.pushLog({ component: "API", text: "400 Ride not accepted", result: "this driver no longer holds the offer", level: "warn", bookingId });
      this.clearDriverOffer(driverId, bookingId, "lost");
      this.emit({ type: "acceptIgnored", bookingId, driverId });
      return false;
    }
    afterOwnershipCheck?.();
    // Accept, reject and timeout race for the same offer; the atomic claim lets exactly one of them win.
    if (!this.claim(bookingId)) {
      this.pushLog({ component: "API", text: "400 Ride not accepted", result: "too late: the offer was already claimed", level: "warn", bookingId });
      this.clearDriverOffer(driverId, bookingId, "lost");
      this.emit({ type: "claimLost", bookingId, driverId, by: "accept" });
      return false;
    }
    // Take the driver first: if another booking already assigned them, hand this offer on.
    if (this.db.markBusyIfAvailable(driverId, bookingId) === 0) {
      this.clearDriverOffer(driverId, bookingId, "taken");
      this.emit({ type: "driverBusyElsewhere", bookingId, driverId });
      this.notifyNextDriver(bookingId);
      return false;
    }
    if (this.db.assignDriverIfPending(bookingId, driverId) === 0) {
      this.db.markAvailable(driverId, bookingId);
      this.redis.releaseIfOwner(reservationKey(driverId), String(bookingId), bookingId);
      this.redis.del([currentKey(bookingId), driversKey(bookingId)], bookingId);
      this.clearDriverOffer(driverId, bookingId, "lost");
      return false;
    }
    this.sendBookingUpdate(bookingId, "CONFIRMED", driverId);
    this.redis.del([currentKey(bookingId), driversKey(bookingId)], bookingId);
    this.redis.releaseIfOwner(reservationKey(driverId), String(bookingId), bookingId);
    this.clearDriverOffer(driverId, bookingId, "accepted");
    this.searches.delete(bookingId);
    this.pushLog({ component: "API", text: "200 Ride accepted", result: `${this.driverName(driverId)} assigned to booking ${bookingId}`, bookingId });
    this.emit({ type: "bookingConfirmed", bookingId, driverId });
    return true;
  }

  private rejectRide(driverId: number, bookingId: number): void {
    this.pushLog({ component: "API", text: `POST /api/bookings/reject?bookingId=${bookingId}&driverId=${driverId}`, result: `${this.driverName(driverId)} taps Reject`, bookingId });
    const current = this.redis.get(currentKey(bookingId), bookingId);
    if (current !== String(driverId)) {
      this.clearDriverOffer(driverId, bookingId, "lost");
      return;
    }
    // If the timeout job already claimed this offer, it is moving on by itself; do not advance twice.
    if (!this.claim(bookingId)) {
      this.clearDriverOffer(driverId, bookingId, "lost");
      this.emit({ type: "claimLost", bookingId, driverId, by: "reject" });
      return;
    }
    this.clearDriverOffer(driverId, bookingId, "rejected");
    this.emit({ type: "driverRejected", bookingId, driverId });
    this.notifyNextDriver(bookingId);
  }

  // ============ NotificationServiceImpl (WebSocket) ============

  private sendOffer(driverId: number, bookingId: number, pickupLat: number, pickupLon: number): void {
    const driver = this.drivers.get(driverId);
    const expiresAt = this.now() + this.cfg.offerTimeoutMs;
    // A WebSocket message to a phone that is off is simply lost; the backend can't tell until the offer times out.
    const delivered = driver?.online ?? false;
    this.pushLog({
      component: "WebSocket",
      text: `SEND /topic/driver/${driverId}  {"bookingId":${bookingId},"offerExpiresInSeconds":${this.cfg.offerTimeoutMs / 1000}}`,
      result: delivered ? `ride offered to ${this.driverName(driverId)}` : `not delivered: ${this.driverName(driverId)}'s phone is offline`,
      level: delivered ? "info" : "warn",
      bookingId,
    });
    if (driver) {
      driver.offer = { bookingId, expiresAt, pickupLat, pickupLon, delivered };
      driver.lastOutcome = undefined;
      if (delivered) this.scheduleBehaviour(driver, bookingId, expiresAt);
    }
    this.emit({ type: "offerSent", bookingId, driverId, expiresAt });
    if (!delivered) this.emit({ type: "offerNotDelivered", bookingId, driverId });
  }

  private sendBookingUpdate(bookingId: number, status: "CONFIRMED" | "NO_DRIVERS_AVAILABLE", driverId?: number): void {
    this.pushLog({ component: "WebSocket", text: `SEND /topic/bookings/${bookingId}  "${status}"`, bookingId });
    for (const rider of this.riders.values()) {
      if (rider.bookingId === bookingId) {
        rider.status = status;
        rider.driverId = driverId;
      }
    }
  }

  private clearDriverOffer(driverId: number, bookingId: number, outcome: OfferOutcome): void {
    const driver = this.drivers.get(driverId);
    if (driver?.offer?.bookingId === bookingId) {
      driver.offer = undefined;
      driver.lastOutcome = { bookingId, outcome, at: this.now() };
    }
  }

  private scheduleBehaviour(driver: DriverState, bookingId: number, expiresAt: number): void {
    // A phone switched off after the offer arrived can't tap anything either.
    const stillOffered = () => driver.offer?.bookingId === bookingId && driver.online;
    const b = driver.behaviour;
    if (b.kind === "accept") this.clock.after(b.afterMs, () => stillOffered() && this.acceptRide(driver.id, bookingId));
    else if (b.kind === "reject") this.clock.after(b.afterMs, () => stillOffered() && this.rejectRide(driver.id, bookingId));
    else if (b.kind === "acceptAtDeadline") this.clock.at(expiresAt, () => stillOffered() && this.raceAcceptAgainstTimeout(driver.id, bookingId));
  }
}
