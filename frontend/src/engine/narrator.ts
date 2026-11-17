import type { AppEvent } from "./events";

export interface GuideMessage {
  id: number;
  title: string;
  pattern: string;
  body: string;
  tone: "info" | "success" | "warn";
  code?: { label: string; url: string };
}

const JAVA = "https://github.com/Shubhobroto/Uber-System/blob/main/src/main/java/com/example/Uber/";
const RESOURCES = "https://github.com/Shubhobroto/Uber-System/blob/main/src/main/resources/";

const code = (path: string, base = JAVA) => ({ label: path.split("/").pop()!, url: base + path });

export const WELCOME: Omit<GuideMessage, "id"> = {
  title: "Hi, I'm Dispatch-bot",
  pattern: "Welcome",
  body: "Book a ride or pick a scenario. I'll explain what the backend does at each step and the design principle behind it.",
  tone: "info",
};

/** Turns an engine event into a short explanation of the design decision behind it. */
export function explain(event: AppEvent, name: (driverId?: number) => string): Omit<GuideMessage, "id"> | null {
  switch (event.type) {
    case "publishedAfterCommit":
      return {
        title: "Booking saved, rider not kept waiting",
        pattern: "Publish after commit + work queue",
        body: "The booking is saved as PENDING and the API answers at once. Only after the database commit does the ride request go to RabbitMQ, so the matching worker can never look for a booking that doesn't exist yet.",
        tone: "info",
        code: code("event/RideRequestPublisher.java"),
      };
    case "radiusSearched":
      if (event.reason === "widened") {
        return event.available.length
          ? {
              title: `Everyone closer passed, searching ${event.radiusKm} km`,
              pattern: "Expanding search",
              body: "Every driver in the smaller ring was asked or is busy, so the search grows to the next ring and leaves out drivers who already had this offer. Close drivers are always asked first; farther ones only when needed.",
              tone: "info",
              code: code("serviceimpl/MatchingServiceImpl.java"),
            }
          : {
              title: `Nobody new within ${event.radiusKm} km`,
              pattern: "Expanding search",
              body: "No driver in this ring who hasn't already been asked, so the search keeps widening until the 10 km limit.",
              tone: "info",
              code: code("serviceimpl/MatchingServiceImpl.java"),
            };
      }
      if (event.available.length) {
        return {
          title: `${event.available.length} free driver${event.available.length > 1 ? "s" : ""} within ${event.radiusKm} km`,
          pattern: "Redis GEOSEARCH, nearest first",
          body: "One GEOSEARCH returns the drivers inside the circle, already sorted by distance. One SQL query then checks which of them are free, instead of one query per driver.",
          tone: "info",
          code: code("serviceimpl/RedisLocationServiceImpl.java"),
        };
      }
      return {
        title: event.found.length ? `Drivers within ${event.radiusKm} km are all busy` : `Nobody within ${event.radiusKm} km`,
        pattern: "Expanding search",
        body: "Searching small first is cheap and gives short pickups. Nobody free here, so the search widens to the next ring (2, 5, then 10 km).",
        tone: "info",
        code: code("serviceimpl/MatchingServiceImpl.java"),
      };
    case "offerSent":
      return {
        title: `Offer sent to ${name(event.driverId)}`,
        pattern: "One offer at a time, with a deadline",
        body: "The offer is written to Redis first and the driver is notified over WebSocket last, so even an instant tap finds it. The 10-second deadline is stored as data in a Redis sorted set, not as a timer in memory.",
        tone: "info",
        code: code("serviceimpl/OfferDeadlineStore.java"),
      };
    case "offerNotDelivered":
      return {
        title: `${name(event.driverId)}'s phone is off, the offer is lost`,
        pattern: "Heartbeat and presence",
        body: "The backend only knows a phone is gone when its location pings stop for 10 s. Until then it still counts as nearby, so the offer is sent and lost. The 10-second deadline makes sure the ride moves on anyway; the sweeper then removes the driver.",
        tone: "warn",
        code: code("serviceimpl/DriverPresenceSweeper.java"),
      };
    case "driverSkippedReserved":
      return {
        title: `${name(event.driverId)} is deciding on another ride`,
        pattern: "Reservation with a TTL",
        body: "SET NX on the driver's reservation key failed: another booking holds this driver. They are skipped and the next nearest driver is asked. The reservation expires on its own, so a crash can never lock a driver forever.",
        tone: "info",
        code: code("serviceimpl/DriverReservationStore.java"),
      };
    case "duplicateIgnored":
      return {
        title: "The same message arrived twice",
        pattern: "Idempotent consumer",
        body: "RabbitMQ delivers at least once, so duplicates are normal. SET NX on ride:{id}:matching only succeeds for the first delivery; this copy changes nothing and no driver is asked twice.",
        tone: "success",
        code: code("serviceimpl/MatchingServiceImpl.java"),
      };
    case "offerTimedOut":
      return {
        title: `${name(event.driverId)} didn't answer in 10 s`,
        pattern: "Deadline in a sorted set",
        body: "Every second a poller asks Redis for offers past their deadline (ZRANGEBYSCORE) and claims each one with ZREM. Deadlines are data, so they survive restarts and any app instance can process them.",
        tone: "info",
        code: code("serviceimpl/TimeoutServiceImpl.java"),
      };
    case "driverRejected":
      return {
        title: `${name(event.driverId)} declined`,
        pattern: "Single arbiter",
        body: "Reject claims the offer with the same atomic ZREM that accept and timeout use, then the next driver is asked straight away instead of waiting for the timer.",
        tone: "info",
        code: code("serviceimpl/BookingServiceImpl.java"),
      };
    case "claimLost":
      return {
        title: event.by === "accept" ? "Accept and timeout at the same instant" : "Reject arrived after the timeout",
        pattern: "Atomic claim",
        body: "Both sides tried ZREM on the booking's deadline. Redis runs commands one at a time, so exactly one got 1. The timeout won here and the late answer got 0 and backed off. No lock needed, and it works across many app instances.",
        tone: "success",
        code: code("serviceimpl/OfferDeadlineStore.java"),
      };
    case "acceptIgnored":
      return {
        title: "Answer for an offer that already moved on",
        pattern: "Ownership check",
        body: "Only the driver who currently holds the offer may answer it, so a late tap can't steal a ride from the next driver.",
        tone: "info",
        code: code("serviceimpl/BookingServiceImpl.java"),
      };
    case "driverBusyElsewhere":
      return {
        title: `${name(event.driverId)} was just assigned another ride`,
        pattern: "Compare-and-set on the driver",
        body: "UPDATE drivers ... WHERE is_available = true changed 0 rows, so this booking moves to the next driver. A driver can never be assigned twice.",
        tone: "success",
        code: code("repository/DriverRepository.java"),
      };
    case "bookingConfirmed":
      return {
        title: `Ride confirmed with ${name(event.driverId)}`,
        pattern: "Compare-and-set in SQL",
        body: "The driver row is taken first, then UPDATE bookings ... WHERE status = 'PENDING'. The database is the final authority: only one writer can move a booking out of PENDING, even if Redis state were wrong.",
        tone: "success",
        code: code("repository/BookingRepository.java"),
      };
    case "bookingCancelled":
      return {
        title: "No driver available",
        pattern: "Bounded search, clean ending",
        body: "The search stops at 10 km and every candidate was asked. The booking is cancelled with a guarded update and the rider is told, instead of waiting forever.",
        tone: "warn",
        code: code("serviceimpl/MatchingServiceImpl.java"),
      };
    case "retryScheduled":
      return {
        title: `Matching failed, retry ${event.attempt} in ${event.delayMs} ms`,
        pattern: "Retry with backoff",
        body: "The worker retries with a growing delay (0.5 s, then 1 s), so a short outage heals itself without hammering Redis. The duplicate guard was released first, so the retry can start over.",
        tone: "warn",
        code: code("application.properties", RESOURCES),
      };
    case "deadLettered":
      return {
        title: "Parked in the dead-letter queue",
        pattern: "Dead-letter queue",
        body: "The message failed 3 times. Instead of retrying forever and blocking the queue, it was rejected without requeue into ride.requests.dlq. An alert on the queue lets someone fix and replay it; until then this booking stays PENDING.",
        tone: "warn",
        code: code("configuration/RabbitMQConfig.java"),
      };
    case "driverOffline":
      return {
        title: `${name(event.driverId)}'s phone died`,
        pattern: "Heartbeat and presence",
        body: "No more location pings. Their last position is still in Redis, so for now they still look nearby. Watch what the sweeper does within 10 seconds.",
        tone: "warn",
        code: code("serviceimpl/DriverPresenceSweeper.java"),
      };
    case "driverEvicted":
      return {
        title: `${name(event.driverId)} removed from the search`,
        pattern: "Heartbeat and presence",
        body: "Redis GEO members can't expire, so a second sorted set keeps each driver's last ping. The sweeper removed this driver after 10 s of silence, so no ride is offered to a dead phone.",
        tone: "success",
        code: code("serviceimpl/DriverPresenceSweeper.java"),
      };
    case "matchingFailed":
      return null;
  }
}
