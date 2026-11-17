package com.example.Uber.serviceimpl;

import java.time.Duration;

import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Service;

import com.example.Uber.service.MatchingService;
import com.example.Uber.service.TimeOutService;

import io.micrometer.core.instrument.Counter;
import io.micrometer.core.instrument.MeterRegistry;
import lombok.extern.slf4j.Slf4j;

@Slf4j
@Service
public class TimeoutServiceImpl implements TimeOutService {

    private static final int BATCH_SIZE = 100;

    private final OfferDeadlineStore deadlines;
    private final MatchingService matchingService;
    private final Counter timeouts;

    public TimeoutServiceImpl(OfferDeadlineStore deadlines, MatchingService matchingService, MeterRegistry registry) {
        this.deadlines = deadlines;
        this.matchingService = matchingService;
        this.timeouts = Counter.builder("matching.offer.timeouts")
                .description("Offers that expired without a driver answer")
                .register(registry);
    }

    // Polls the deadline set instead of scanning keys or relying on key-expiry events, which Redis may drop.
    @Scheduled(fixedDelayString = "${app.matching.timeout-poll-ms:1000}")
    @Override
    public void checkTimeouts() {
        for (Long bookingId : deadlines.claimExpired(System.currentTimeMillis(), BATCH_SIZE)) {
            timeouts.increment();
            log.info("Offer timed out, moving to next driver bookingId={}", bookingId);
            try {
                matchingService.notifyNextDriver(bookingId);
            } catch (RuntimeException e) {
                // The offer was already claimed, so put it back to be retried instead of losing the booking.
                log.error("Could not advance offer, retrying shortly bookingId={}", bookingId, e);
                deadlines.schedule(bookingId, Duration.ofSeconds(1));
            }
        }
    }
}
