package com.example.Uber.service;

import java.util.List;

import com.example.Uber.dto.DriverLocationDTO;

public interface LocationService {

    int DEFAULT_SEARCH_LIMIT = 50;

    Boolean saveDriverLocation(Integer driverId, Double latitude, Double longitude);

    /** Drivers within radiusKm, nearest first, at most limit results. */
    List<DriverLocationDTO> getNearbyDrivers(Double latitude, Double longitude, Double radiusKm, int limit);

    default List<DriverLocationDTO> getNearbyDrivers(Double latitude, Double longitude, Double radiusKm) {
        return getNearbyDrivers(latitude, longitude, radiusKm, DEFAULT_SEARCH_LIMIT);
    }

    void removeDriver(Integer driverId);

    /** Drops drivers whose last location update is older than the cutoff. Returns how many were dropped. */
    long evictStaleDrivers(long lastSeenBeforeEpochMs);
}
