package com.example.Uber.event;

/** Raised inside the booking transaction; the ride request is published only after that transaction commits. */
public record BookingCreatedEvent(Long bookingId) {
}
