package com.example.Uber.serviceimpl;

import java.time.Duration;
import java.util.ArrayList;
import java.util.List;
import java.util.Set;

import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.stereotype.Component;

/**
 * Tracks when each ride offer expires, in one Redis sorted set (member = bookingId, score = deadline in epoch ms).
 *
 * Accept, reject and timeout all end the current offer, and they can fire at the same moment. ZREM is atomic and
 * returns 1 for exactly one caller, so whoever gets 1 owns the transition; everyone else backs off. The same trick
 * works across several app instances without any lock.
 */
@Component
public class OfferDeadlineStore {

    static final String KEY = "ride:offer:deadlines";

    private final StringRedisTemplate redis;

    public OfferDeadlineStore(StringRedisTemplate redis) {
        this.redis = redis;
    }

    public void schedule(Long bookingId, Duration after) {
        redis.opsForZSet().add(KEY, bookingId.toString(), System.currentTimeMillis() + after.toMillis());
    }

    /** Takes ownership of the current offer. True only for the single caller that removed it. */
    public boolean claim(Long bookingId) {
        Long removed = redis.opsForZSet().remove(KEY, bookingId.toString());
        return removed != null && removed > 0;
    }

    /** Drops the deadline when a booking is finished; the result does not matter. */
    public void cancel(Long bookingId) {
        redis.opsForZSet().remove(KEY, bookingId.toString());
    }

    /** Claims offers whose deadline has passed. Each id is returned to one caller only. */
    public List<Long> claimExpired(long nowEpochMs, int limit) {
        Set<String> due = redis.opsForZSet().rangeByScore(KEY, 0, nowEpochMs, 0, limit);
        if (due == null || due.isEmpty()) {
            return List.of();
        }
        List<Long> claimed = new ArrayList<>();
        for (String id : due) {
            Long bookingId = Long.valueOf(id);
            if (claim(bookingId)) {
                claimed.add(bookingId);
            }
        }
        return claimed;
    }
}
