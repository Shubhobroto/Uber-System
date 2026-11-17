package com.example.Uber.service;

import org.springframework.transaction.annotation.Transactional;

/**
 * Main service interface for Booking operations
 * Extends both read and write interfaces
 * Following Dependency Inversion Principle
 */
public interface BookingService extends BookingReadService, BookingWriteService {
}

