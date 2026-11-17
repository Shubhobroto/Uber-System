package com.example.Uber.configuration;

import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.boot.context.properties.bind.DefaultValue;

import java.time.Duration;
import java.util.List;

/**
 * Tunables for driver matching. Kept in config so they can be changed per environment
 * without a code change.
 */
@ConfigurationProperties(prefix = "app.matching")
public record MatchingProperties(
        // Search tight first; widen only when nobody is available. Nearest drivers are offered first.
        @DefaultValue({"2", "5", "10"}) List<Double> searchRadiiKm,
        // Upper bound on candidates per search, so a dense city cannot produce a huge offer queue.
        @DefaultValue("20") int maxCandidates,
        // How long one driver has to answer before the offer moves to the next driver.
        @DefaultValue("10s") Duration offerTimeout,
        // A driver who has not sent a location for this long is treated as offline.
        @DefaultValue("30s") Duration driverStaleAfter,
        // Lifetime of per-booking matching state in Redis (idempotency guard, candidate list).
        @DefaultValue("10m") Duration sessionTtl,
        // Hard cap on the radius a caller can request from the nearby-drivers API.
        @DefaultValue("25") double maxRadiusKm
) {
}
