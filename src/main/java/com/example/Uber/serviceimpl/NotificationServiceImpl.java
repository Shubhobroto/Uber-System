package com.example.Uber.serviceimpl;

import com.example.Uber.dto.DriverRideRequestDTO;
import com.example.Uber.service.NotificationService;
import lombok.RequiredArgsConstructor;
import org.springframework.messaging.simp.SimpMessagingTemplate;
import org.springframework.stereotype.Service;

@Service
@RequiredArgsConstructor
public class NotificationServiceImpl implements NotificationService {

    private final SimpMessagingTemplate messagingTemplate;

    @Override
    public void sendBookingUpdate(Long bookingId, String status) {

        messagingTemplate.convertAndSend(
                "/topic/bookings/" + bookingId,
                status
        );
    }

    @Override
    public void notifyDriver(Long driverId, DriverRideRequestDTO request) {
        messagingTemplate.convertAndSend(
                "/topic/driver/" + driverId,
                request
        );
    }
}