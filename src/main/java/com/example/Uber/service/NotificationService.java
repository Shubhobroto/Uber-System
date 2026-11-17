package com.example.Uber.service;

import com.example.Uber.dto.DriverRideRequestDTO;

public interface NotificationService {
    void sendBookingUpdate(Long bookingId, String status);
    void notifyDriver(Long driverId, DriverRideRequestDTO request);
}
