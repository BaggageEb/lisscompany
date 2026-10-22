package com.lisscompany.payments;

import java.util.List;
import java.util.Optional;
import java.util.UUID;

import org.springframework.data.jpa.repository.JpaRepository;

public interface PaymentEventRepository extends JpaRepository<PaymentEvent, UUID> {

    Optional<PaymentEvent> findByPaymentIdAndIdempotencyKey(UUID paymentId, String idempotencyKey);

    List<PaymentEvent> findByPaymentIdOrderByCreatedAtDesc(UUID paymentId);
}
