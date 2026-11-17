package com.example.Uber.serviceimpl;

import java.time.Duration;
import java.util.Collection;
import java.util.List;
import java.util.Set;
import java.util.stream.Collectors;

import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.stereotype.Service;

import com.example.Uber.configuration.MatchingProperties;
import com.example.Uber.dto.DriverRideRequestDTO;
import com.example.Uber.entity.Booking;
import com.example.Uber.repository.BookingRepository;
import com.example.Uber.repository.DriverRepository;
import com.example.Uber.service.LocationService;
import com.example.Uber.service.MatchingService;
import com.example.Uber.service.NotificationService;

import io.micrometer.core.instrument.MeterRegistry;
import io.micrometer.core.instrument.Timer;
import lombok.extern.slf4j.Slf4j;

/**
 * Matching flow for one booking:
 * <ol>
 *   <li>Search drivers around the pickup, tight radius first, widening only if nobody is available.</li>
 *   <li>Keep them as a queue in Redis, nearest first.</li>
 *   <li>Offer the ride to one driver at a time. Each offer has a deadline (see {@link OfferDeadlineStore}).</li>
 *   <li>Accept, reject or timeout moves on. When everyone in the ring has been asked, the search widens to the
 *       next ring and skips drivers who already had the offer; after the widest ring the booking is cancelled.</li>
 * </ol>
 */
@Slf4j
@Service
public class MatchingServiceImpl implements MatchingService {

    /** The ring a candidate list came from (index into the search radii) and the drivers in it, nearest first. */
    private record Candidates(int ring, List<Long> driverIds) {
    }

    static final String NO_DRIVERS_STATUS = "NO_DRIVERS_AVAILABLE";
    // A crashed worker cannot strand a driver: the reservation expires shortly after the offer would.
    private static final Duration RESERVATION_GRACE = Duration.ofSeconds(30);

    private final BookingRepository bookingRepository;
    private final DriverRepository driverRepository;
    private final LocationService locationService;
    private final NotificationService notificationService;
    private final StringRedisTemplate redisTemplate;
    private final OfferDeadlineStore deadlines;
    private final DriverReservationStore reservations;
    private final MatchingProperties props;
    private final MeterRegistry meterRegistry;
    private final Timer candidateSearchTimer;

    public MatchingServiceImpl(BookingRepository bookingRepository,
                               DriverRepository driverRepository,
                               LocationService locationService,
                               NotificationService notificationService,
                               StringRedisTemplate redisTemplate,
                               OfferDeadlineStore deadlines,
                               DriverReservationStore reservations,
                               MatchingProperties props,
                               MeterRegistry meterRegistry) {
        this.bookingRepository = bookingRepository;
        this.driverRepository = driverRepository;
        this.locationService = locationService;
        this.notificationService = notificationService;
        this.redisTemplate = redisTemplate;
        this.deadlines = deadlines;
        this.reservations = reservations;
        this.props = props;
        this.meterRegistry = meterRegistry;
        this.candidateSearchTimer = Timer.builder("matching.candidate.search")
                .description("Time to find available candidate drivers for one booking, including radius widening")
                .publishPercentileHistogram()
                .register(meterRegistry);
    }

    @Override
    public void findNearbyDriversAndNotify(Long bookingId) {
        Booking booking = bookingRepository.findById(bookingId)
                .orElseThrow(() -> new IllegalStateException("Booking not found: " + bookingId));

        if (booking.getStatus() != Booking.BookingStatus.PENDING) {
            log.info("Skipping matching, booking is not pending bookingId={} status={}", bookingId, booking.getStatus());
            return;
        }

        // RabbitMQ delivers at least once. Only the first delivery may start a matching session.
        Boolean first = redisTemplate.opsForValue().setIfAbsent(sessionKey(bookingId), "1", props.sessionTtl());
        if (!Boolean.TRUE.equals(first)) {
            log.info("Matching already started, ignoring duplicate delivery bookingId={}", bookingId);
            return;
        }

        try {
            Candidates candidates = candidateSearchTimer.record(() -> findCandidates(booking, 0, Set.of()));
            if (candidates.driverIds().isEmpty()) {
                finishWithoutDriver(bookingId);
                return;
            }
            queueCandidates(bookingId, candidates);
            notifyNextDriver(bookingId);
        } catch (RuntimeException e) {
            // Let the redelivery (retry / dead-letter) start over instead of being blocked by our own guard.
            redisTemplate.delete(sessionKey(bookingId));
            throw e;
        }
    }

    @Override
    public void notifyNextDriver(Long bookingId) {
        // The previous offer (rejected or timed out) is over, so that driver can receive other rides again.
        releaseCurrentOffer(bookingId);

        Booking booking = bookingRepository.findById(bookingId)
                .orElseThrow(() -> new IllegalStateException("Booking not found: " + bookingId));
        if (booking.getStatus() != Booking.BookingStatus.PENDING) {
            clearOfferState(bookingId);
            return;
        }

        Duration timeout = props.offerTimeout();

        // A driver holds one pending offer at a time; skip anyone already deciding on another ride.
        String next;
        for (;;) {
            next = redisTemplate.opsForList().leftPop(driversKey(bookingId));
            if (next == null) {
                if (widenSearch(booking)) {
                    continue;
                }
                finishWithoutDriver(bookingId);
                return;
            }
            if (reservations.tryReserve(Long.parseLong(next), bookingId, timeout.plus(RESERVATION_GRACE))) {
                break;
            }
        }

        long driverId = Long.parseLong(next);
        redisTemplate.opsForSet().add(askedKey(bookingId), next);
        redisTemplate.expire(askedKey(bookingId), props.sessionTtl());

        // State first, notification last: a driver who answers instantly must already find the offer in place.
        // The key outlives the deadline a little so an answer arriving right at the deadline is still understood.
        redisTemplate.opsForValue().set(currentKey(bookingId), next, timeout.plus(Duration.ofMinutes(1)));
        deadlines.schedule(bookingId, timeout);

        notificationService.notifyDriver(driverId, DriverRideRequestDTO.builder()
                .bookingId(bookingId)
                .pickupLat(Double.parseDouble(booking.getPickupLocationLatitude()))
                .pickupLng(Double.parseDouble(booking.getPickupLocationLongitude()))
                .offerExpiresInSeconds(timeout.toSeconds())
                .build());
        log.info("Offered booking bookingId={} driverId={}", bookingId, driverId);
    }

    /**
     * Nearest-first available drivers from the first ring (starting at fromRing) that has any, leaving out drivers
     * already asked. The ring index is past the last radius when nobody is found.
     */
    private Candidates findCandidates(Booking booking, int fromRing, Collection<Long> alreadyAsked) {
        double lat = Double.parseDouble(booking.getPickupLocationLatitude());
        double lon = Double.parseDouble(booking.getPickupLocationLongitude());
        List<Double> radii = props.searchRadiiKm();

        for (int ring = fromRing; ring < radii.size(); ring++) {
            double radiusKm = radii.get(ring);
            List<Long> ids = locationService.getNearbyDrivers(lat, lon, radiusKm, props.maxCandidates()).stream()
                    .map(d -> d.getDriverId().longValue())
                    .filter(id -> !alreadyAsked.contains(id))
                    .toList();
            if (ids.isEmpty()) {
                continue;
            }
            // One query for the whole batch; availability stays in the database as the source of truth.
            Set<Long> available = driverRepository.findAvailableIds(ids);
            List<Long> ordered = ids.stream().filter(available::contains).toList();
            if (!ordered.isEmpty()) {
                log.info("Found {} available drivers within {} km bookingId={}", ordered.size(), radiusKm, booking.getId());
                return new Candidates(ring, ordered);
            }
        }
        return new Candidates(radii.size(), List.of());
    }

    /** Everyone queued so far was asked or is busy: look one ring further out. False when no ring is left. */
    private boolean widenSearch(Booking booking) {
        Long bookingId = booking.getId();
        String ring = redisTemplate.opsForValue().get(ringKey(bookingId));
        int nextRing = ring == null ? 0 : Integer.parseInt(ring) + 1;
        Set<String> asked = redisTemplate.opsForSet().members(askedKey(bookingId));
        Set<Long> alreadyAsked = asked == null ? Set.of() : asked.stream().map(Long::valueOf).collect(Collectors.toSet());

        Candidates candidates = candidateSearchTimer.record(() -> findCandidates(booking, nextRing, alreadyAsked));
        if (candidates.driverIds().isEmpty()) {
            return false;
        }
        log.info("Everyone in the previous ring was asked, widening the search bookingId={} ring={}", bookingId, candidates.ring());
        queueCandidates(bookingId, candidates);
        return true;
    }

    private void queueCandidates(Long bookingId, Candidates candidates) {
        String queueKey = driversKey(bookingId);
        redisTemplate.delete(queueKey);
        redisTemplate.opsForList().rightPushAll(queueKey, candidates.driverIds().stream().map(String::valueOf).toList());
        redisTemplate.expire(queueKey, props.sessionTtl());
        redisTemplate.opsForValue().set(ringKey(bookingId), String.valueOf(candidates.ring()), props.sessionTtl());
    }

    private void finishWithoutDriver(Long bookingId) {
        int cancelled = bookingRepository.transitionStatus(
                bookingId, Booking.BookingStatus.PENDING, Booking.BookingStatus.CANCELLED);
        clearOfferState(bookingId);
        if (cancelled > 0) {
            notificationService.sendBookingUpdate(bookingId, NO_DRIVERS_STATUS);
        }
        meterRegistry.counter("matching.sessions", "result", "no_driver").increment();
        log.info("No driver available, booking cancelled bookingId={}", bookingId);
    }

    private void clearOfferState(Long bookingId) {
        releaseCurrentOffer(bookingId);
        redisTemplate.delete(List.of(currentKey(bookingId), driversKey(bookingId), ringKey(bookingId), askedKey(bookingId)));
        deadlines.cancel(bookingId);
    }

    private void releaseCurrentOffer(Long bookingId) {
        String previous = redisTemplate.opsForValue().get(currentKey(bookingId));
        if (previous != null) {
            reservations.release(Long.parseLong(previous), bookingId);
        }
    }

    private static String sessionKey(Long bookingId) {
        return "ride:" + bookingId + ":matching";
    }

    private static String ringKey(Long bookingId) {
        return "ride:" + bookingId + ":ring";
    }

    private static String askedKey(Long bookingId) {
        return "ride:" + bookingId + ":asked";
    }

    private static String driversKey(Long bookingId) {
        return "ride:" + bookingId + ":drivers";
    }

    private static String currentKey(Long bookingId) {
        return "ride:" + bookingId + ":current";
    }
}
