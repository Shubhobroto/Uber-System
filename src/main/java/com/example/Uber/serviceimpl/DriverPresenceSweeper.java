package com.example.Uber.serviceimpl;

import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

import com.example.Uber.configuration.MatchingProperties;
import com.example.Uber.service.LocationService;

import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;

/** Removes drivers who stopped sending locations, so a crashed app never leaves a ghost driver to be offered rides. */
@Slf4j
@Component
@RequiredArgsConstructor
public class DriverPresenceSweeper {

    private final LocationService locationService;
    private final MatchingProperties props;

    @Scheduled(fixedDelayString = "${app.matching.stale-sweep-ms:10000}")
    public void sweep() {
        long cutoff = System.currentTimeMillis() - props.driverStaleAfter().toMillis();
        long evicted = locationService.evictStaleDrivers(cutoff);
        if (evicted > 0) {
            log.info("Evicted {} stale drivers", evicted);
        }
    }
}
