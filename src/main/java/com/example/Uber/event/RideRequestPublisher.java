package com.example.Uber.event;

import org.springframework.amqp.rabbit.connection.CorrelationData;
import org.springframework.amqp.rabbit.core.RabbitTemplate;
import org.springframework.stereotype.Component;
import org.springframework.transaction.event.TransactionPhase;
import org.springframework.transaction.event.TransactionalEventListener;

import com.example.Uber.configuration.RabbitMQConfig;

import io.micrometer.core.instrument.MeterRegistry;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;

/**
 * Publishes the ride request after the booking row is committed.
 * Sending inside the transaction lets the consumer run before the commit and fail with "booking not found".
 *
 * Known gap: if the app dies between the commit and the publish, the booking stays PENDING with no matching.
 * The usual fix is a transactional outbox (booking and event written together, a relay publishes later).
 */
@Slf4j
@Component
@RequiredArgsConstructor
public class RideRequestPublisher {

    private final RabbitTemplate rabbitTemplate;
    private final MeterRegistry meterRegistry;

    @TransactionalEventListener(phase = TransactionPhase.AFTER_COMMIT)
    public void onBookingCreated(BookingCreatedEvent event) {
        try {
            rabbitTemplate.convertAndSend(
                    RabbitMQConfig.QUEUE,
                    new RideRequestEvent(event.bookingId()),
                    new CorrelationData("booking-" + event.bookingId()));
        } catch (RuntimeException e) {
            // The booking is already saved, so the caller still gets its answer; this is made visible instead.
            meterRegistry.counter("matching.publish.failures").increment();
            log.error("Could not publish ride request bookingId={}", event.bookingId(), e);
        }
    }
}
