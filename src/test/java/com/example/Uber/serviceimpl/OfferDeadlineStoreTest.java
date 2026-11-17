package com.example.Uber.serviceimpl;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

import java.util.LinkedHashSet;
import java.util.List;
import java.util.Set;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.data.redis.core.ZSetOperations;

@SuppressWarnings("unchecked")
class OfferDeadlineStoreTest {

    private final StringRedisTemplate redis = mock(StringRedisTemplate.class);
    private final ZSetOperations<String, String> zSet = mock(ZSetOperations.class);
    private OfferDeadlineStore store;

    @BeforeEach
    void setUp() {
        when(redis.opsForZSet()).thenReturn(zSet);
        store = new OfferDeadlineStore(redis);
    }

    @Test
    void claimSucceedsForOnlyTheCallerThatActuallyRemovedTheOffer() {
        when(zSet.remove(OfferDeadlineStore.KEY, "5")).thenReturn(1L, 0L);

        assertThat(store.claim(5L)).isTrue();
        assertThat(store.claim(5L)).isFalse();
    }

    @Test
    void claimExpiredReturnsOnlyOffersThisCallerWon() {
        when(zSet.rangeByScore(OfferDeadlineStore.KEY, 0, 1_000L, 0, 100)).thenReturn(new LinkedHashSet<>(List.of("1", "2")));
        when(zSet.remove(OfferDeadlineStore.KEY, "1")).thenReturn(1L);
        // another instance claimed booking 2 first
        when(zSet.remove(OfferDeadlineStore.KEY, "2")).thenReturn(0L);

        List<Long> claimed = store.claimExpired(1_000L, 100);

        assertThat(claimed).containsExactly(1L);
    }

    @Test
    void claimExpiredIsEmptyWhenNothingIsDue() {
        when(zSet.rangeByScore(OfferDeadlineStore.KEY, 0, 1_000L, 0, 100)).thenReturn(Set.of());

        assertThat(store.claimExpired(1_000L, 100)).isEmpty();
    }
}
