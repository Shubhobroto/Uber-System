package com.example.Uber.consumer;

import org.springframework.amqp.rabbit.annotation.RabbitListener;
import org.springframework.stereotype.Service;

import com.example.Uber.configuration.RabbitMQConfig;
import com.example.Uber.event.RideRequestEvent;
import com.example.Uber.service.MatchingService;

import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;

@Slf4j
@Service
@RequiredArgsConstructor
public class RideRequestConsumer {

    private final MatchingService matchingService;

    // Concurrency, prefetch and retry/backoff are set in application.properties (spring.rabbitmq.listener.simple.*).
    // An exception here is retried, then the message is dead-lettered; it is never requeued in a tight loop.
    @RabbitListener(queues = RabbitMQConfig.QUEUE)
    public void consume(RideRequestEvent event) {
        log.info("Ride request received bookingId={}", event.getBookingId());
        matchingService.findNearbyDriversAndNotify(event.getBookingId());
    }
}
