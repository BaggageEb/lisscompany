package com.lisscompany.inventory;

import java.util.List;
import java.util.UUID;

import org.springframework.data.jpa.repository.JpaRepository;

public interface StockMovementRepository extends JpaRepository<StockMovement, UUID> {

    List<StockMovement> findTop100ByOrderByCreatedAtDesc();

    /** Histórico de um produto (painel e testes verificam o motivo de cada Δ). */
    List<StockMovement> findByProductIdOrderByCreatedAtDesc(UUID productId);
}
