package com.example.Uber.serviceimpl;

import java.time.Duration;
import java.util.List;

import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.data.redis.core.script.DefaultRedisScript;
import org.springframework.stereotype.Component;

/**
 * Lets a driver hold at most one pending offer at a time (SET NX with a TTL).
 * Without it, two bookings can shortlist the same free driver and both offer them a ride.
 * The SQL compare-and-set on the driver row stays as the final authority; this keeps the
 * normal case clean by skipping drivers who are already deciding on another ride.
 */
@Component
public class DriverReservationStore {

    // Delete only if this booking still owns the reservation, in one atomic step.
    private static final DefaultRedisScript<Long> RELEASE = new DefaultRedisScript<>(
            "if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) else return 0 end",
            Long.class);

    private final StringRedisTemplate redis;

    public DriverReservationStore(StringRedisTemplate redis) {
        this.redis = redis;
    }

    public boolean tryReserve(Long driverId, Long bookingId, Duration ttl) {
        return Boolean.TRUE.equals(redis.opsForValue().setIfAbsent(key(driverId), bookingId.toString(), ttl));
    }

    public void release(Long driverId, Long bookingId) {
        redis.execute(RELEASE, List.of(key(driverId)), bookingId.toString());
    }

    static String key(Long driverId) {
        return "driver:" + driverId + ":offer";
    }
}
