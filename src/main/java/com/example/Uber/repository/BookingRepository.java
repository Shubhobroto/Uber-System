package com.example.Uber.repository;

import com.example.Uber.entity.Booking;
import com.example.Uber.entity.Driver;
import com.example.Uber.entity.Passenger;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import org.springframework.stereotype.Repository;
import org.springframework.transaction.annotation.Transactional;

import java.util.List;
import java.util.Optional;

@Repository
public interface BookingRepository extends JpaRepository<Booking, Long> {
    List<Booking> findByPassenger(Passenger passenger);
    List<Booking> findByDriver(Driver driver);
    Optional<Booking> findByIdAndPassenger(Long id, Passenger passenger);
    Optional<Booking> findByIdAndDriver(Long id, Driver driver);
    @Modifying
    @Query("UPDATE Booking b SET b.driver = :driver, b.status = 'CONFIRMED' WHERE b.id = :bookingId AND b.status = 'PENDING'")
    int assignDriverIfPending(@Param("bookingId") Long bookingId, @Param("driver") Driver driver);

    // Compare-and-set on the status column: only one writer can move a booking out of the expected state.
    @Modifying
    @Transactional
    @Query("UPDATE Booking b SET b.status = :to WHERE b.id = :bookingId AND b.status = :from")
    int transitionStatus(@Param("bookingId") Long bookingId,
                         @Param("from") Booking.BookingStatus from,
                         @Param("to") Booking.BookingStatus to);
}

