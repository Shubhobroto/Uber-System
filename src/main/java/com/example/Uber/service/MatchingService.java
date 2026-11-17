package com.example.Uber.service;

public interface MatchingService {

    /** Finds available drivers around the pickup point and offers the ride to the nearest one. */
    void findNearbyDriversAndNotify(Long bookingId);

    /** Moves the offer to the next driver in line, or ends matching when nobody is left. */
    void notifyNextDriver(Long bookingId);
}
