package com.example.Uber.dto;

import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

@Data
@AllArgsConstructor
@NoArgsConstructor
@Builder
public class DriverRideRequestDTO {

    private Long bookingId;
    private Double pickupLat;
    private Double pickupLng;
    // Lets the driver app show a countdown instead of guessing how long the offer lasts.
    private Long offerExpiresInSeconds;
}
