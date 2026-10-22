package com.lisscompany.inventory;

import java.util.List;
import java.util.Optional;
import java.util.UUID;

import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

public interface StockReservationRepository extends JpaRepository<StockReservation, UUID> {

    List<StockReservation> findByOrderId(UUID orderId);

    Optional<StockReservation> findByOrderIdAndProductIdAndStatus(
            UUID orderId, UUID productId, ReservationStatus status);

    List<StockReservation> findByStatusAndExpiresAtBefore(ReservationStatus status, java.time.Instant instant);

    /** Unidades já reservadas (activas) de um produto — para calcular disponível. */
    @Query("SELECT COALESCE(SUM(r.quantity), 0) FROM StockReservation r "
            + "WHERE r.productId = :productId AND r.status = :status")
    int sumReservedQuantity(@Param("productId") UUID productId, @Param("status") ReservationStatus status);
}
