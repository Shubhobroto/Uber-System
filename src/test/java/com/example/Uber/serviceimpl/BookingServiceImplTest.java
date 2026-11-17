package com.example.Uber.serviceimpl;

import static org.assertj.core.api.Assertions.assertThat;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;

import java.time.Duration;
import java.util.Optional;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.context.ApplicationEventPublisher;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.data.redis.core.ValueOperations;

import com.example.Uber.entity.Driver;
import com.example.Uber.mapper.BookingMapper;
import com.example.Uber.repository.BookingRepository;
import com.example.Uber.repository.DriverRepository;
import com.example.Uber.repository.PassengerRepository;
import com.example.Uber.service.MatchingService;
import com.example.Uber.service.NotificationService;

import io.micrometer.core.instrument.simple.SimpleMeterRegistry;

@SuppressWarnings("unchecked")
class BookingServiceImplTest {

    private final BookingRepository bookingRepository = mock(BookingRepository.class);
    private final DriverRepository driverRepository = mock(DriverRepository.class);
    private final StringRedisTemplate redis = mock(StringRedisTemplate.class);
    private final ValueOperations<String, String> valueOps = mock(ValueOperations.class);
    private final NotificationService notificationService = mock(NotificationService.class);
    private final MatchingService matchingService = mock(MatchingService.class);
    private final OfferDeadlineStore deadlines = mock(OfferDeadlineStore.class);
    private final DriverReservationStore reservations = mock(DriverReservationStore.class);

    private BookingServiceImpl service;

    @BeforeEach
    void setUp() {
        when(redis.opsForValue()).thenReturn(valueOps);
        service = new BookingServiceImpl(bookingRepository, mock(PassengerRepository.class), driverRepository,
                mock(BookingMapper.class), mock(ApplicationEventPublisher.class), redis, notificationService,
                matchingService, deadlines, reservations, new SimpleMeterRegistry());
    }

    @Test
    void acceptIsIgnoredWhenTheOfferBelongsToAnotherDriver() {
        when(valueOps.get("ride:1:current")).thenReturn("9");

        assertThat(service.acceptRide(1L, 5L)).isFalse();

        verifyNoInteractions(deadlines, bookingRepository);
    }

    @Test
    void acceptLosesWhenTheTimeoutAlreadyClaimedTheOffer() {
        when(valueOps.get("ride:1:current")).thenReturn("5");
        when(deadlines.claim(1L)).thenReturn(false);

        assertThat(service.acceptRide(1L, 5L)).isFalse();

        verify(bookingRepository, never()).assignDriverIfPending(any(), any());
    }

    @Test
    void acceptAssignsTheDriverAndConfirmsTheBooking() {
        Driver driver = Driver.builder().id(5L).isAvailable(true).build();
        when(valueOps.get("ride:1:current")).thenReturn("5");
        when(deadlines.claim(1L)).thenReturn(true);
        when(driverRepository.findById(5L)).thenReturn(Optional.of(driver));
        when(driverRepository.markBusyIfAvailable(5L)).thenReturn(1);
        when(bookingRepository.assignDriverIfPending(1L, driver)).thenReturn(1);

        assertThat(service.acceptRide(1L, 5L)).isTrue();

        verify(notificationService).sendBookingUpdate(1L, "CONFIRMED");
        verify(reservations).release(5L, 1L);
    }

    @Test
    void acceptHandsTheOfferOnWhenTheDriverWasAlreadyAssignedElsewhere() {
        Driver driver = Driver.builder().id(5L).isAvailable(true).build();
        when(valueOps.get("ride:1:current")).thenReturn("5");
        when(deadlines.claim(1L)).thenReturn(true);
        when(driverRepository.findById(5L)).thenReturn(Optional.of(driver));
        when(driverRepository.markBusyIfAvailable(5L)).thenReturn(0);

        assertThat(service.acceptRide(1L, 5L)).isFalse();

        verify(matchingService).notifyNextDriver(1L);
        verify(bookingRepository, never()).assignDriverIfPending(any(), any());
    }

    @Test
    void acceptFreesTheDriverAgainWhenTheBookingIsNoLongerPending() {
        Driver driver = Driver.builder().id(5L).isAvailable(true).build();
        when(valueOps.get("ride:1:current")).thenReturn("5");
        when(deadlines.claim(1L)).thenReturn(true);
        when(driverRepository.findById(5L)).thenReturn(Optional.of(driver));
        when(driverRepository.markBusyIfAvailable(5L)).thenReturn(1);
        when(bookingRepository.assignDriverIfPending(1L, driver)).thenReturn(0);

        assertThat(service.acceptRide(1L, 5L)).isFalse();

        verify(driverRepository).markAvailable(5L);
        verify(reservations).release(5L, 1L);
        verify(notificationService, never()).sendBookingUpdate(any(), any());
    }

    @Test
    void failureAfterTheClaimHandsTheOfferBackSoMatchingDoesNotStall() {
        when(valueOps.get("ride:1:current")).thenReturn("5");
        when(deadlines.claim(1L)).thenReturn(true);
        when(driverRepository.findById(5L)).thenThrow(new IllegalStateException("db down"));

        assertThrows(IllegalStateException.class, () -> service.acceptRide(1L, 5L));

        verify(deadlines).schedule(1L, Duration.ZERO);
    }

    @Test
    void rejectMovesToTheNextDriverOnlyIfItWonTheClaim() {
        when(valueOps.get("ride:1:current")).thenReturn("5");
        when(deadlines.claim(1L)).thenReturn(true);

        service.rejectRide(1L, 5L);

        verify(matchingService).notifyNextDriver(1L);
    }

    @Test
    void rejectDoesNotAdvanceTwiceWhenTheTimeoutGotThereFirst() {
        when(valueOps.get("ride:1:current")).thenReturn("5");
        when(deadlines.claim(1L)).thenReturn(false);

        service.rejectRide(1L, 5L);

        verify(matchingService, never()).notifyNextDriver(any());
    }
}
