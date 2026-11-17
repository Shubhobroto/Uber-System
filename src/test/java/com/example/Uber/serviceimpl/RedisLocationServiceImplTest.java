package com.example.Uber.serviceimpl;

import static org.assertj.core.api.Assertions.assertThat;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;

import java.time.Duration;
import java.util.List;
import java.util.Set;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.data.geo.Distance;
import org.springframework.data.redis.connection.RedisGeoCommands.GeoSearchCommandArgs;
import org.springframework.data.redis.core.GeoOperations;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.data.redis.core.ZSetOperations;
import org.springframework.data.redis.domain.geo.GeoReference;

import com.example.Uber.configuration.MatchingProperties;

import io.micrometer.core.instrument.simple.SimpleMeterRegistry;

@SuppressWarnings({"unchecked", "rawtypes"})
class RedisLocationServiceImplTest {

    private final StringRedisTemplate redis = mock(StringRedisTemplate.class);
    private final GeoOperations<String, String> geoOps = mock(GeoOperations.class);
    private final ZSetOperations<String, String> zSetOps = mock(ZSetOperations.class);
    private RedisLocationServiceImpl service;

    @BeforeEach
    void setUp() {
        MatchingProperties props = new MatchingProperties(
                List.of(2.0), 10, Duration.ofSeconds(10), Duration.ofSeconds(30), Duration.ofMinutes(10), 25);
        when(redis.opsForGeo()).thenReturn(geoOps);
        when(redis.opsForZSet()).thenReturn(zSetOps);
        service = new RedisLocationServiceImpl(redis, props, new SimpleMeterRegistry());
    }

    @Test
    void capsTheSearchRadiusSoOneRequestCannotScanAHugeArea() {
        service.getNearbyDrivers(12.97, 77.59, 5000.0, 10);

        ArgumentCaptor<Distance> radius = ArgumentCaptor.forClass(Distance.class);
        verify(geoOps).search(eq("driver:geo"), any(GeoReference.class), radius.capture(), any(GeoSearchCommandArgs.class));
        assertThat(radius.getValue().getValue()).isEqualTo(25.0);
    }

    @Test
    void rejectsCoordinatesRedisCannotStore() {
        assertThrows(IllegalArgumentException.class, () -> service.getNearbyDrivers(95.0, 77.59, 2.0, 10));
        assertThrows(IllegalArgumentException.class, () -> service.saveDriverLocation(1, 12.97, 200.0));
    }

    @Test
    void rejectsNonPositiveRadius() {
        assertThrows(IllegalArgumentException.class, () -> service.getNearbyDrivers(12.97, 77.59, 0.0, 10));
    }

    @Test
    void evictionRemovesStaleDriversFromBothStructures() {
        when(zSetOps.rangeByScore("driver:seen", 0, 5_000L, 0, 500)).thenReturn(Set.of("4"));

        long evicted = service.evictStaleDrivers(5_000L);

        assertThat(evicted).isEqualTo(1);
        verify(geoOps).remove("driver:geo", "4");
        verify(zSetOps).remove("driver:seen", "4");
    }

    @Test
    void evictionDoesNothingWhenEveryoneIsFresh() {
        when(zSetOps.rangeByScore("driver:seen", 0, 5_000L, 0, 500)).thenReturn(Set.of());

        assertThat(service.evictStaleDrivers(5_000L)).isZero();
        verifyNoInteractions(geoOps);
    }
}
