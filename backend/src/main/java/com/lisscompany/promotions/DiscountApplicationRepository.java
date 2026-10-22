package com.lisscompany.promotions;

import java.util.Optional;
import java.util.UUID;

import org.springframework.data.jpa.repository.JpaRepository;

public interface DiscountApplicationRepository extends JpaRepository<DiscountApplication, UUID> {

    Optional<DiscountApplication> findByOrderId(UUID orderId);

    boolean existsByOrderId(UUID orderId);
}
