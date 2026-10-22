package com.lisscompany.loyalty;

import java.util.List;
import java.util.Optional;
import java.util.UUID;

import org.springframework.data.jpa.repository.JpaRepository;

public interface LoyaltyTransactionRepository extends JpaRepository<LoyaltyTransaction, UUID> {

    /** Idempotência por encomenda: existe no máximo um EARN/REDEEM por encomenda. */
    Optional<LoyaltyTransaction> findByOrderIdAndType(UUID orderId, LoyaltyTransactionType type);

    List<LoyaltyTransaction> findByAccountIdOrderByCreatedAtDesc(UUID accountId);

    boolean existsByOrderIdAndType(UUID orderId, LoyaltyTransactionType type);
}
