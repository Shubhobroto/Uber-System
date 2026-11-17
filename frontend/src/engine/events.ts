export type Component = "API" | "DB" | "RabbitMQ" | "Redis" | "WebSocket" | "Scheduler" | "Driver" | "Rider";
export type Level = "info" | "warn" | "error" | "quiet";

export interface LogInput {
  component: Component;
  text: string;
  result?: string;
  level?: Level;
  bookingId?: number;
}

export interface LogEntry {
  id: number;
  t: number;
  component: Component;
  text: string;
  result?: string;
  level: Level;
  bookingId?: number;
}

export type Logger = (entry: LogInput) => void;

/** Things that happened, in business terms. The guide and tests listen to these. */
export type AppEvent =
  | { type: "publishedAfterCommit"; bookingId: number }
  | {
      type: "radiusSearched";
      bookingId: number;
      radiusKm: number;
      found: number[];
      available: number[];
      // "widened": everyone in the smaller ring was already asked or busy
      reason: "initial" | "widened";
    }
  | { type: "duplicateIgnored"; bookingId: number }
  | { type: "offerSent"; bookingId: number; driverId: number; expiresAt: number }
  | { type: "offerNotDelivered"; bookingId: number; driverId: number }
  | { type: "driverSkippedReserved"; bookingId: number; driverId: number }
  | { type: "offerTimedOut"; bookingId: number; driverId?: number }
  | { type: "driverRejected"; bookingId: number; driverId: number }
  | { type: "claimLost"; bookingId: number; driverId: number; by: "accept" | "reject" }
  | { type: "acceptIgnored"; bookingId: number; driverId: number }
  | { type: "driverBusyElsewhere"; bookingId: number; driverId: number }
  | { type: "bookingConfirmed"; bookingId: number; driverId: number }
  | { type: "bookingCancelled"; bookingId: number; reason: string }
  | { type: "matchingFailed"; bookingId: number; attempt: number; error: string }
  | { type: "retryScheduled"; bookingId: number; attempt: number; delayMs: number }
  | { type: "deadLettered"; bookingId: number }
  | { type: "driverOffline"; driverId: number }
  | { type: "driverEvicted"; driverId: number };

export type SimEvent = { kind: "log"; entry: LogEntry } | { kind: "app"; t: number; event: AppEvent };
