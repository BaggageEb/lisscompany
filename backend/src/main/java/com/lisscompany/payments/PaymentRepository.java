package com.lisscompany.payments;

import java.util.Collection;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

import org.springframework.data.jpa.repository.JpaRepository;

public interface PaymentRepository extends JpaRepository<Payment, UUID> {

    Optional<Payment> findByOrderId(UUID orderId);

    /** Lote para as listas do cliente (evita N+1 na página de encomendas). */
    List<Payment> findByOrderIdIn(Collection<UUID> orderIds);
}
