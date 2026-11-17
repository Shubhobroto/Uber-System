package com.example.Uber.serviceimpl;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import java.time.Duration;
import java.util.List;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.data.redis.core.ValueOperations;
import org.springframework.data.redis.core.script.RedisScript;

@SuppressWarnings({"unchecked", "rawtypes"})
class DriverReservationStoreTest {

    private final StringRedisTemplate redis = mock(StringRedisTemplate.class);
    private final ValueOperations<String, String> valueOps = mock(ValueOperations.class);
    private DriverReservationStore store;

    @BeforeEach
    void setUp() {
        when(redis.opsForValue()).thenReturn(valueOps);
        store = new DriverReservationStore(redis);
    }

    @Test
    void reservesOnlyWhenNoOtherOfferHoldsTheDriver() {
        Duration ttl = Duration.ofSeconds(40);
        when(valueOps.setIfAbsent("driver:7:offer", "1", ttl)).thenReturn(true);
        when(valueOps.setIfAbsent("driver:8:offer", "1", ttl)).thenReturn(false);

        assertThat(store.tryReserve(7L, 1L, ttl)).isTrue();
        assertThat(store.tryReserve(8L, 1L, ttl)).isFalse();
    }

    @Test
    void releaseIsScopedToTheBookingThatOwnsTheReservation() {
        store.release(7L, 1L);

        verify(redis).execute(any(RedisScript.class), eq(List.of("driver:7:offer")), eq("1"));
    }
}
