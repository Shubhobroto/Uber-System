package com.example.Uber.serviceimpl;

import com.example.Uber.dto.BookingRequest;
import com.example.Uber.dto.BookingResponse;
import com.example.Uber.entity.Booking;
import com.example.Uber.entity.Driver;
import com.example.Uber.entity.Passenger;
import com.example.Uber.event.BookingCreatedEvent;
import com.example.Uber.mapper.BookingMapper;
import com.example.Uber.repository.BookingRepository;
import com.example.Uber.repository.DriverRepository;
import com.example.Uber.repository.PassengerRepository;
import com.example.Uber.service.BookingService;
import com.example.Uber.service.MatchingService;
import com.example.Uber.service.NotificationService;
import io.micrometer.core.instrument.MeterRegistry;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.context.ApplicationEventPublisher;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.math.BigDecimal;
import java.time.Duration;
import java.time.LocalDateTime;
import java.util.List;
import java.util.Optional;

@Slf4j
@Service
@RequiredArgsConstructor
@Transactional
public class BookingServiceImpl implements BookingService {

    private final BookingRepository bookingRepository;
    private final PassengerRepository passengerRepository;
    private final DriverRepository driverRepository;
    private final BookingMapper bookingMapper;
    private final ApplicationEventPublisher eventPublisher;
    private final StringRedisTemplate redisTemplate;
    private final NotificationService notificationService;
    private final MatchingService matchingService;
    private final OfferDeadlineStore offerDeadlines;
    private final DriverReservationStore driverReservations;
    private final MeterRegistry meterRegistry;


    @Override
    @Transactional(readOnly = true)
    public Optional<BookingResponse> findById(Long id) {
        return bookingRepository.findById(id)
                .map(bookingMapper::toResponse);
    }

    @Override
    @Transactional(readOnly = true)
    public List<BookingResponse> findAll() {
        return bookingRepository.findAll().stream()
                .map(bookingMapper::toResponse)
                .toList();
    }

    @Override
    @Transactional(readOnly = true)
    public List<BookingResponse> findByPassengerId(Long passengerId) {
        Passenger passenger = passengerRepository.findById(passengerId)
                .orElseThrow(() -> new IllegalArgumentException("Passenger not found with id: " + passengerId));

        return bookingRepository.findByPassenger(passenger).stream()
                .map(bookingMapper::toResponse)
                .toList();
    }

    @Override
    @Transactional(readOnly = true)
    public List<BookingResponse> findByDriverId(Long driverId) {
        Driver driver = driverRepository.findById(driverId)
                .orElseThrow(() -> new IllegalArgumentException("Driver not found with id: " + driverId));

        return bookingRepository.findByDriver(driver).stream()
                .map(bookingMapper::toResponse)
                .toList();
    }

    @Override
    public BookingResponse create(BookingRequest request) {

        // 1. Validate passenger
        Passenger passenger = passengerRepository.findById(request.getPassengerId())
                .orElseThrow(() -> new IllegalArgumentException("Passenger not found"));

        // 2. Validate pickup location
        if (request.getPickupLocationLatitude() == null || request.getPickupLocationLongitude() == null) {
            throw new IllegalArgumentException("Pickup location is required");
        }

        // 3. Default fare
        BigDecimal fare = request.getFare() != null ? request.getFare() : BigDecimal.ZERO;

        // 4. Create booking (INITIAL STATE)
        Booking booking = Booking.builder()
                .passenger(passenger)
                .pickupLocationLatitude(request.getPickupLocationLatitude().toString())
                .pickupLocationLongitude(request.getPickupLocationLongitude().toString())
                .dropoffLocation(request.getDropoffLocation())
                .status(Booking.BookingStatus.PENDING)
                .fare(fare)
                .scheduledPickupTime(request.getScheduledPickupTime())
                .build();

        // 5. Save booking
        Booking savedBooking = bookingRepository.save(booking);

        // 6. Matching runs asynchronously: the request is published to RabbitMQ only after this transaction
        //    commits, and the rider immediately gets the PENDING booking back.
        eventPublisher.publishEvent(new BookingCreatedEvent(savedBooking.getId()));

        // 7. Return response
        return bookingMapper.toResponse(savedBooking);
    }

    @Override
    public BookingResponse update(Long id, BookingRequest request) {
        return null; // skip for now
    }

    @Override
    public BookingResponse updateStatus(Long id, Booking.BookingStatus status) {

        Booking booking = bookingRepository.findById(id)
                .orElseThrow(() -> new IllegalArgumentException("Booking not found"));

        booking.setStatus(status);

        if (status == Booking.BookingStatus.IN_PROGRESS && booking.getActualPickupTime() == null) {
            booking.setActualPickupTime(LocalDateTime.now());
        }

        if (status == Booking.BookingStatus.COMPLETED || status == Booking.BookingStatus.CANCELLED) {
            booking.setCompletedAt(LocalDateTime.now());

            if (booking.getDriver() != null) {
                Driver driver = booking.getDriver();
                driver.setIsAvailable(true);
                driverRepository.save(driver);
            }
        }

        Booking updatedBooking = bookingRepository.save(booking);
        return bookingMapper.toResponse(updatedBooking);
    }

    @Override
    public void deleteById(Long id) {
        Booking booking = bookingRepository.findById(id)
                .orElseThrow(() -> new IllegalArgumentException("Booking not found"));

        if (booking.getDriver() != null) {
            Driver driver = booking.getDriver();
            driver.setIsAvailable(true);
            driverRepository.save(driver);
        }

        bookingRepository.deleteById(id);
    }

    @Transactional
    @Override
    public Boolean acceptRide(Long bookingId, Long driverId) {

        // 1. Only the driver who currently holds the offer may answer it
        String currentDriver = redisTemplate.opsForValue().get(currentKey(bookingId));
        if (currentDriver == null || !currentDriver.equals(driverId.toString())) {
            log.info("Accept ignored, not this driver's offer bookingId={} driverId={}", bookingId, driverId);
            return false;
        }

        // 2. Accept, reject and timeout race for the same offer; the atomic claim lets exactly one of them win
        if (!offerDeadlines.claim(bookingId)) {
            log.info("Accept too late, offer already expired or answered bookingId={} driverId={}", bookingId, driverId);
            return false;
        }

        try {
            Driver driver = driverRepository.findById(driverId)
                    .orElseThrow(() -> new IllegalArgumentException("Driver not found"));

            // 3. Take the driver first: if another booking already assigned them, hand this offer on.
            if (driverRepository.markBusyIfAvailable(driverId) == 0) {
                log.info("Driver already busy with another ride bookingId={} driverId={}", bookingId, driverId);
                matchingService.notifyNextDriver(bookingId);
                return false;
            }

            // 4. Atomic DB update: the second line of defence against double assignment of the booking
            int updatedRows = bookingRepository.assignDriverIfPending(bookingId, driver);
            if (updatedRows == 0) {
                log.info("Booking no longer pending bookingId={}", bookingId);
                driverRepository.markAvailable(driverId);
                driverReservations.release(driverId, bookingId);
                redisTemplate.delete(List.of(currentKey(bookingId), driversKey(bookingId)));
                return false;
            }

            notificationService.sendBookingUpdate(bookingId, "CONFIRMED");

            redisTemplate.delete(List.of(currentKey(bookingId), driversKey(bookingId)));
            driverReservations.release(driverId, bookingId);
            meterRegistry.counter("matching.sessions", "result", "matched").increment();
            log.info("Driver assigned bookingId={} driverId={}", bookingId, driverId);
            return true;
        } catch (RuntimeException e) {
            // The transaction rolls back, so the booking is still PENDING: hand the offer back so the
            // timeout job moves it on to the next driver instead of leaving the booking stuck.
            offerDeadlines.schedule(bookingId, Duration.ZERO);
            throw e;
        }
    }

    @Override
    public void rejectRide(Long bookingId, Long driverId) {

        String currentDriver = redisTemplate.opsForValue().get(currentKey(bookingId));
        if (currentDriver == null || !currentDriver.equals(driverId.toString())) {
            log.info("Reject ignored, not this driver's offer bookingId={} driverId={}", bookingId, driverId);
            return;
        }

        // If the timeout job already claimed this offer, it is moving on by itself; do not advance twice.
        if (!offerDeadlines.claim(bookingId)) {
            return;
        }

        log.info("Driver rejected bookingId={} driverId={}", bookingId, driverId);
        matchingService.notifyNextDriver(bookingId);
    }

    private static String currentKey(Long bookingId) {
        return "ride:" + bookingId + ":current";
    }

    private static String driversKey(Long bookingId) {
        return "ride:" + bookingId + ":drivers";
    }
}
