package com.lisscompany.loyalty;

import java.util.List;
import java.util.UUID;

import org.springframework.data.jpa.repository.JpaRepository;

public interface RewardRedemptionRepository extends JpaRepository<RewardRedemption, UUID> {

    List<RewardRedemption> findByAccountIdOrderByCreatedAtDesc(UUID accountId);

    /** Resgates de um cliente numa recompensa — limite de utilizações (#12). */
    long countByAccountIdAndRewardRuleId(UUID accountId, UUID rewardRuleId);

    /** Devolve o resgate de uma encomenda cancelada (liberta a utilização). */
    int deleteByOrderId(UUID orderId);
}
