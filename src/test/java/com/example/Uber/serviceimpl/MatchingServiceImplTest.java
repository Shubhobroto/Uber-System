package com.example.Uber.serviceimpl;

import static org.assertj.core.api.Assertions.assertThat;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyDouble;
import static org.mockito.ArgumentMatchers.anyInt;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;

import java.time.Duration;
import java.util.List;
import java.util.Optional;
import java.util.Set;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.data.redis.core.ListOperations;
import org.springframework.data.redis.core.SetOperations;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.data.redis.core.ValueOperations;

import com.example.Uber.configuration.MatchingProperties;
import com.example.Uber.dto.DriverLocationDTO;
import com.example.Uber.dto.DriverRideRequestDTO;
import com.example.Uber.entity.Booking;
import com.example.Uber.repository.BookingRepository;
import com.example.Uber.repository.DriverRepository;
import com.example.Uber.service.LocationService;
import com.example.Uber.service.NotificationService;

import io.micrometer.core.instrument.simple.SimpleMeterRegistry;

@SuppressWarnings("unchecked")
class MatchingServiceImplTest {

    private static final Duration OFFER_TIMEOUT = Duration.ofSeconds(10);

    private final BookingRepository bookingRepository = mock(BookingRepository.class);
    private final DriverRepository driverRepository = mock(DriverRepository.class);
    private final LocationService locationService = mock(LocationService.class);
    private final NotificationService notificationService = mock(NotificationService.class);
    private final StringRedisTemplate redis = mock(StringRedisTemplate.class);
    private final ValueOperations<String, String> valueOps = mock(ValueOperations.class);
    private final ListOperations<String, String> listOps = mock(ListOperations.class);
    private final SetOperations<String, String> setOps = mock(SetOperations.class);
    private final OfferDeadlineStore deadlines = mock(OfferDeadlineStore.class);
    private final DriverReservationStore reservations = mock(DriverReservationStore.class);

    private MatchingServiceImpl service;

    @BeforeEach
    void setUp() {
        MatchingProperties props = new MatchingProperties(
                List.of(2.0, 5.0), 10, OFFER_TIMEOUT, Duration.ofSeconds(30), Duration.ofMinutes(10), 25);
        when(redis.opsForValue()).thenReturn(valueOps);
        when(redis.opsForList()).thenReturn(listOps);
        when(redis.opsForSet()).thenReturn(setOps);
        service = new MatchingServiceImpl(bookingRepository, driverRepository, locationService,
                notificationService, redis, deadlines, reservations, props, new SimpleMeterRegistry());
    }

    private Booking pendingBooking() {
        return Booking.builder()
                .id(1L)
                .pickupLocationLatitude("12.9716")
                .pickupLocationLongitude("77.5946")
                .status(Booking.BookingStatus.PENDING)
                .build();
    }

    private static DriverLocationDTO driver(int id, double distanceKm) {
        return DriverLocationDTO.builder().driverId(id).distanceKm(distanceKm).build();
    }

    @Test
    void widensRadiusUntilDriversAreFoundAndOffersNearestFirst() {
        when(bookingRepository.findById(1L)).thenReturn(Optional.of(pendingBooking()));
        when(valueOps.setIfAbsent(eq("ride:1:matching"), eq("1"), any(Duration.class))).thenReturn(true);
        when(locationService.getNearbyDrivers(12.9716, 77.5946, 2.0, 10)).thenReturn(List.of());
        when(locationService.getNearbyDrivers(12.9716, 77.5946, 5.0, 10))
                .thenReturn(List.of(driver(7, 0.8), driver(3, 1.2)));
        when(driverRepository.findAvailableIds(List.of(7L, 3L))).thenReturn(Set.of(7L, 3L));
        when(listOps.leftPop("ride:1:drivers")).thenReturn("7");
        when(reservations.tryReserve(eq(7L), eq(1L), any(Duration.class))).thenReturn(true);

        service.findNearbyDriversAndNotify(1L);

        verify(listOps).rightPushAll("ride:1:drivers", List.of("7", "3"));
        verify(valueOps).set(eq("ride:1:current"), eq("7"), any(Duration.class));
        verify(deadlines).schedule(1L, OFFER_TIMEOUT);

        ArgumentCaptor<DriverRideRequestDTO> offer = ArgumentCaptor.forClass(DriverRideRequestDTO.class);
        verify(notificationService).notifyDriver(eq(7L), offer.capture());
        assertThat(offer.getValue().getOfferExpiresInSeconds()).isEqualTo(10L);
    }

    @Test
    void skipsDriversWhoAreNotAvailable() {
        when(bookingRepository.findById(1L)).thenReturn(Optional.of(pendingBooking()));
        when(valueOps.setIfAbsent(eq("ride:1:matching"), eq("1"), any(Duration.class))).thenReturn(true);
        when(locationService.getNearbyDrivers(12.9716, 77.5946, 2.0, 10))
                .thenReturn(List.of(driver(1, 0.3), driver(2, 0.9)));
        when(driverRepository.findAvailableIds(List.of(1L, 2L))).thenReturn(Set.of(2L));
        when(listOps.leftPop("ride:1:drivers")).thenReturn("2");
        when(reservations.tryReserve(eq(2L), eq(1L), any(Duration.class))).thenReturn(true);

        service.findNearbyDriversAndNotify(1L);

        verify(listOps).rightPushAll("ride:1:drivers", List.of("2"));
        verify(notificationService).notifyDriver(eq(2L), any());
    }

    @Test
    void cancelsBookingWhenNoDriverIsAvailableAnywhere() {
        when(bookingRepository.findById(1L)).thenReturn(Optional.of(pendingBooking()));
        when(valueOps.setIfAbsent(eq("ride:1:matching"), eq("1"), any(Duration.class))).thenReturn(true);
        when(locationService.getNearbyDrivers(anyDouble(), anyDouble(), anyDouble(), anyInt())).thenReturn(List.of());
        when(bookingRepository.transitionStatus(1L, Booking.BookingStatus.PENDING, Booking.BookingStatus.CANCELLED))
                .thenReturn(1);

        service.findNearbyDriversAndNotify(1L);

        verify(notificationService).sendBookingUpdate(1L, "NO_DRIVERS_AVAILABLE");
        verify(notificationService, never()).notifyDriver(anyLong(), any());
        verify(deadlines).cancel(1L);
    }

    @Test
    void ignoresDuplicateDeliveryOfTheSameRideRequest() {
        when(bookingRepository.findById(1L)).thenReturn(Optional.of(pendingBooking()));
        when(valueOps.setIfAbsent(eq("ride:1:matching"), eq("1"), any(Duration.class))).thenReturn(false);

        service.findNearbyDriversAndNotify(1L);

        verifyNoInteractions(locationService, notificationService);
    }

    @Test
    void skipsBookingThatIsNoLongerPending() {
        Booking cancelled = pendingBooking();
        cancelled.setStatus(Booking.BookingStatus.CANCELLED);
        when(bookingRepository.findById(1L)).thenReturn(Optional.of(cancelled));

        service.findNearbyDriversAndNotify(1L);

        verifyNoInteractions(locationService, notificationService);
    }

    @Test
    void releasesTheDuplicateGuardWhenSearchFailsSoARetryCanStartOver() {
        when(bookingRepository.findById(1L)).thenReturn(Optional.of(pendingBooking()));
        when(valueOps.setIfAbsent(eq("ride:1:matching"), eq("1"), any(Duration.class))).thenReturn(true);
        when(locationService.getNearbyDrivers(anyDouble(), anyDouble(), anyDouble(), anyInt()))
                .thenThrow(new IllegalStateException("redis down"));

        assertThrows(IllegalStateException.class,
                () -> service.findNearbyDriversAndNotify(1L));

        verify(redis).delete("ride:1:matching");
    }

    @Test
    void endsMatchingWhenTheQueueRunsOut() {
        when(bookingRepository.findById(1L)).thenReturn(Optional.of(pendingBooking()));
        when(listOps.leftPop("ride:1:drivers")).thenReturn(null);
        when(bookingRepository.transitionStatus(1L, Booking.BookingStatus.PENDING, Booking.BookingStatus.CANCELLED))
                .thenReturn(1);

        service.notifyNextDriver(1L);

        verify(notificationService).sendBookingUpdate(1L, "NO_DRIVERS_AVAILABLE");
    }

    @Test
    void skipsADriverWhoAlreadyHoldsAnotherPendingOffer() {
        when(bookingRepository.findById(1L)).thenReturn(Optional.of(pendingBooking()));
        when(listOps.leftPop("ride:1:drivers")).thenReturn("7", "3");
        when(reservations.tryReserve(eq(7L), eq(1L), any(Duration.class))).thenReturn(false);
        when(reservations.tryReserve(eq(3L), eq(1L), any(Duration.class))).thenReturn(true);

        service.notifyNextDriver(1L);

        verify(notificationService, never()).notifyDriver(eq(7L), any());
        verify(notificationService).notifyDriver(eq(3L), any());
        verify(valueOps).set(eq("ride:1:current"), eq("3"), any(Duration.class));
    }

    @Test
    void freesThePreviousDriverWhenTheOfferMovesOn() {
        when(bookingRepository.findById(1L)).thenReturn(Optional.of(pendingBooking()));
        when(valueOps.get("ride:1:current")).thenReturn("7");
        when(listOps.leftPop("ride:1:drivers")).thenReturn("3");
        when(reservations.tryReserve(eq(3L), eq(1L), any(Duration.class))).thenReturn(true);

        service.notifyNextDriver(1L);

        verify(reservations).release(7L, 1L);
        verify(notificationService).notifyDriver(eq(3L), any());
    }

    @Test
    void stopsOfferingWhenEveryRemainingDriverIsReservedElsewhere() {
        when(bookingRepository.findById(1L)).thenReturn(Optional.of(pendingBooking()));
        when(listOps.leftPop("ride:1:drivers")).thenReturn("7", (String) null);
        when(reservations.tryReserve(eq(7L), eq(1L), any(Duration.class))).thenReturn(false);
        when(bookingRepository.transitionStatus(1L, Booking.BookingStatus.PENDING, Booking.BookingStatus.CANCELLED))
                .thenReturn(1);

        service.notifyNextDriver(1L);

        verify(notificationService).sendBookingUpdate(1L, "NO_DRIVERS_AVAILABLE");
        verify(notificationService, never()).notifyDriver(anyLong(), any());
    }

    @Test
    void whenEveryoneInTheRingWasAskedTheSearchWidensAndSkipsDriversWhoAlreadySaidNo() {
        when(bookingRepository.findById(1L)).thenReturn(Optional.of(pendingBooking()));
        when(listOps.leftPop("ride:1:drivers")).thenReturn(null, "3");
        when(valueOps.get("ride:1:ring")).thenReturn("0");
        when(setOps.members("ride:1:asked")).thenReturn(Set.of("7"));
        when(locationService.getNearbyDrivers(12.9716, 77.5946, 5.0, 10))
                .thenReturn(List.of(driver(7, 0.8), driver(3, 3.1)));
        when(driverRepository.findAvailableIds(List.of(3L))).thenReturn(Set.of(3L));
        when(reservations.tryReserve(eq(3L), eq(1L), any(Duration.class))).thenReturn(true);

        service.notifyNextDriver(1L);

        verify(listOps).rightPushAll("ride:1:drivers", List.of("3"));
        verify(valueOps).set(eq("ride:1:ring"), eq("1"), any(Duration.class));
        verify(notificationService).notifyDriver(eq(3L), any());
        verify(setOps).add("ride:1:asked", "3");
    }

    @Test
    void cancelsOnlyAfterTheWidestRingHasBeenTried() {
        when(bookingRepository.findById(1L)).thenReturn(Optional.of(pendingBooking()));
        when(listOps.leftPop("ride:1:drivers")).thenReturn(null);
        // ring 1 (5 km) is the last one configured in this test
        when(valueOps.get("ride:1:ring")).thenReturn("1");
        when(bookingRepository.transitionStatus(1L, Booking.BookingStatus.PENDING, Booking.BookingStatus.CANCELLED))
                .thenReturn(1);

        service.notifyNextDriver(1L);

        verify(locationService, never()).getNearbyDrivers(anyDouble(), anyDouble(), anyDouble(), anyInt());
        verify(notificationService).sendBookingUpdate(1L, "NO_DRIVERS_AVAILABLE");
    }
}
