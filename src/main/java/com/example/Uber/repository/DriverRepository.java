package com.example.Uber.repository;

import com.example.Uber.entity.Driver;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import org.springframework.stereotype.Repository;
import org.springframework.transaction.annotation.Transactional;

import java.util.Collection;
import java.util.Optional;
import java.util.Set;

@Repository
public interface DriverRepository extends JpaRepository<Driver, Long> {
    Optional<Driver> findById(Integer id);
    Optional<Driver> findByEmail(String email);
    Optional<Driver> findByLicenseNumber(String licenseNumber);
    boolean existsByEmail(String email);
    boolean existsByLicenseNumber(String licenseNumber);

    // One query for a whole candidate batch instead of one lookup per driver.
    @Query("select d.id from Driver d where d.id in :ids and d.isAvailable = true")
    Set<Long> findAvailableIds(@Param("ids") Collection<Long> ids);

    // Compare-and-set on the driver: only one booking can take a driver who is still free.
    @Modifying
    @Transactional
    @Query("UPDATE Driver d SET d.isAvailable = false WHERE d.id = :id AND d.isAvailable = true")
    int markBusyIfAvailable(@Param("id") Long id);

    @Modifying
    @Transactional
    @Query("UPDATE Driver d SET d.isAvailable = true WHERE d.id = :id")
    int markAvailable(@Param("id") Long id);
}

