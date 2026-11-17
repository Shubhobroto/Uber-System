/** Same values as the backend's application.properties (app.matching.* and the RabbitMQ listener retry). */
export const CONFIG = {
  searchRadiiKm: [2, 5, 10],
  maxCandidates: 20,
  maxRadiusKm: 25,
  offerTimeoutMs: 10_000,
  // The reservation outlives the offer a little so a crashed worker cannot strand a driver for long.
  reservationGraceMs: 30_000,
  sessionTtlMs: 10 * 60_000,
  // Backend default is 30 s; shortened here so a dead phone is removed quickly enough to watch in the demo.
  driverStaleAfterMs: 10_000,
  timeoutPollMs: 1_000,
  staleSweepMs: 10_000,
  pingIntervalMs: 5_000,
  retry: { maxAttempts: 3, initialMs: 500, multiplier: 2 },
  // Not in the backend: simulated network/broker latency so steps are visible.
  deliveryDelayMs: 120,
} as const;

export type SimConfig = typeof CONFIG;
