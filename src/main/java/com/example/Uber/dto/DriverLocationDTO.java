package com.example.Uber.dto;

import com.fasterxml.jackson.annotation.JsonInclude;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

@Data
@NoArgsConstructor
@AllArgsConstructor
@Builder
@JsonInclude(JsonInclude.Include.NON_NULL)
public class DriverLocationDTO {
    private Integer driverId;
    private Double latitude;
    private Double longitude;
    // Filled on search results only: straight-line distance from the search point.
    private Double distanceKm;
}
