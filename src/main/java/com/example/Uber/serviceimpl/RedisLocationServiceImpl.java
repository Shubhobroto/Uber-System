package com.example.Uber.serviceimpl;

import java.util.ArrayList;
import java.util.List;
import java.util.Set;

import org.springframework.data.geo.Distance;
import org.springframework.data.geo.GeoResult;
import org.springframework.data.geo.GeoResults;
import org.springframework.data.geo.Metrics;
import org.springframework.data.geo.Point;
import org.springframework.data.redis.connection.RedisGeoCommands.GeoLocation;
import org.springframework.data.redis.connection.RedisGeoCommands.GeoSearchCommandArgs;
import org.springframework.data.redis.core.RedisCallback;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.data.redis.domain.geo.GeoReference;
import org.springframework.data.redis.serializer.RedisSerializer;
import org.springframework.stereotype.Service;

import com.example.Uber.configuration.MatchingProperties;
import com.example.Uber.dto.DriverLocationDTO;
import com.example.Uber.service.LocationService;

import io.micrometer.core.instrument.MeterRegistry;
import io.micrometer.core.instrument.Timer;

/**
 * Driver positions live in two Redis structures:
 * <ul>
 *   <li>{@code driver:geo}  - GEO set (a sorted set under the hood, score = 52-bit geohash). GEOSEARCH
 *       returns members inside a radius, already sorted by distance, in one round trip.</li>
 *   <li>{@code driver:seen} - sorted set of last-update time per driver. GEO members cannot have a TTL,
 *       so this is how offline drivers are found and removed.</li>
 * </ul>
 */
@Service
public class RedisLocationServiceImpl implements LocationService {

    static final String GEO_KEY = "driver:geo";
    static final String SEEN_KEY = "driver:seen";

    // Redis GEO only accepts latitudes inside the Web Mercator range.
    private static final double MAX_LATITUDE = 85.05112878;
    private static final int EVICTION_BATCH_SIZE = 500;

    private final StringRedisTemplate redis;
    private final MatchingProperties props;
    private final Timer searchTimer;
    private final Timer writeTimer;

    public RedisLocationServiceImpl(StringRedisTemplate redis, MatchingProperties props, MeterRegistry registry) {
        this.redis = redis;
        this.props = props;
        this.searchTimer = Timer.builder("matching.geo.search")
                .description("Redis GEOSEARCH latency for one nearby-driver query")
                .publishPercentileHistogram()
                .register(registry);
        this.writeTimer = Timer.builder("matching.geo.write")
                .description("Latency of one driver location update (GEOADD + ZADD, pipelined)")
                .publishPercentileHistogram()
                .register(registry);
    }

    @Override
    public Boolean saveDriverLocation(Integer driverId, Double latitude, Double longitude) {
        requireValidCoordinates(latitude, longitude);
        if (driverId == null) {
            throw new IllegalArgumentException("driverId is required");
        }

        RedisSerializer<String> serializer = redis.getStringSerializer();
        byte[] geoKey = serializer.serialize(GEO_KEY);
        byte[] seenKey = serializer.serialize(SEEN_KEY);
        byte[] member = serializer.serialize(driverId.toString());
        double now = System.currentTimeMillis();

        // One round trip for both writes; drivers ping every few seconds, so this is the hot write path.
        writeTimer.record(() -> redis.executePipelined((RedisCallback<Object>) connection -> {
            connection.geoCommands().geoAdd(geoKey, new Point(longitude, latitude), member);
            connection.zSetCommands().zAdd(seenKey, now, member);
            return null;
        }));
        return true;
    }

    @Override
    public List<DriverLocationDTO> getNearbyDrivers(Double latitude, Double longitude, Double radiusKm, int limit) {
        requireValidCoordinates(latitude, longitude);
        if (radiusKm == null || radiusKm <= 0) {
            throw new IllegalArgumentException("radius must be greater than 0");
        }
        if (limit <= 0) {
            throw new IllegalArgumentException("limit must be greater than 0");
        }
        // Cost grows with the number of drivers inside the circle, so callers cannot ask for an unbounded area.
        double radius = Math.min(radiusKm, props.maxRadiusKm());

        // COUNT without ANY still scans the whole circle before trimming, so the radius cap matters more than the limit.
        GeoSearchCommandArgs args = GeoSearchCommandArgs.newGeoSearchArgs()
                .includeDistance()
                .includeCoordinates()
                .sortAscending()
                .limit(limit);

        GeoResults<GeoLocation<String>> results = searchTimer.record(() -> redis.opsForGeo().search(
                GEO_KEY,
                GeoReference.fromCoordinate(longitude, latitude),
                new Distance(radius, Metrics.KILOMETERS),
                args));

        List<DriverLocationDTO> drivers = new ArrayList<>();
        if (results == null) {
            return drivers;
        }
        for (GeoResult<GeoLocation<String>> result : results) {
            GeoLocation<String> location = result.getContent();
            Point point = location.getPoint();
            drivers.add(DriverLocationDTO.builder()
                    .driverId(Integer.parseInt(location.getName()))
                    .latitude(point.getY())
                    .longitude(point.getX())
                    .distanceKm(result.getDistance().getValue())
                    .build());
        }
        return drivers;
    }

    @Override
    public void removeDriver(Integer driverId) {
        String member = driverId.toString();
        redis.opsForGeo().remove(GEO_KEY, member);
        redis.opsForZSet().remove(SEEN_KEY, member);
    }

    @Override
    public long evictStaleDrivers(long lastSeenBeforeEpochMs) {
        Set<String> stale = redis.opsForZSet().rangeByScore(SEEN_KEY, 0, lastSeenBeforeEpochMs, 0, EVICTION_BATCH_SIZE);
        if (stale == null || stale.isEmpty()) {
            return 0;
        }
        String[] members = stale.toArray(new String[0]);
        redis.opsForGeo().remove(GEO_KEY, members);
        redis.opsForZSet().remove(SEEN_KEY, (Object[]) members);
        return members.length;
    }

    private static void requireValidCoordinates(Double latitude, Double longitude) {
        if (latitude == null || longitude == null) {
            throw new IllegalArgumentException("latitude and longitude are required");
        }
        if (latitude < -MAX_LATITUDE || latitude > MAX_LATITUDE || longitude < -180 || longitude > 180) {
            throw new IllegalArgumentException("coordinates out of range: " + latitude + ", " + longitude);
        }
    }
}
