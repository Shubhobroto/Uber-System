package com.example.Uber.serviceimpl;

import static org.mockito.ArgumentMatchers.anyInt;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.Mockito.doThrow;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import java.time.Duration;
import java.util.List;

import org.junit.jupiter.api.Test;

import com.example.Uber.service.MatchingService;

import io.micrometer.core.instrument.simple.SimpleMeterRegistry;

class TimeoutServiceImplTest {

    private final OfferDeadlineStore deadlines = mock(OfferDeadlineStore.class);
    private final MatchingService matchingService = mock(MatchingService.class);
    private final TimeoutServiceImpl service = new TimeoutServiceImpl(deadlines, matchingService, new SimpleMeterRegistry());

    @Test
    void movesEveryExpiredOfferToTheNextDriver() {
        when(deadlines.claimExpired(anyLong(), anyInt())).thenReturn(List.of(1L, 2L));

        service.checkTimeouts();

        verify(matchingService).notifyNextDriver(1L);
        verify(matchingService).notifyNextDriver(2L);
    }

    @Test
    void putsAnOfferBackAndKeepsGoingWhenOneBookingFails() {
        when(deadlines.claimExpired(anyLong(), anyInt())).thenReturn(List.of(1L, 2L));
        doThrow(new IllegalStateException("boom")).when(matchingService).notifyNextDriver(1L);

        service.checkTimeouts();

        verify(deadlines).schedule(1L, Duration.ofSeconds(1));
        verify(matchingService).notifyNextDriver(2L);
    }
}
