package com.lisscompany.loyalty;

import java.util.List;
import java.util.Optional;
import java.util.UUID;

import org.springframework.data.jpa.repository.JpaRepository;

public interface RewardRuleRepository extends JpaRepository<RewardRule, UUID> {

    Optional<RewardRule> findByCode(String code);

    /** Código público activo — é assim que o cliente referencia a recompensa. */
    Optional<RewardRule> findByCodeAndActiveTrue(String code);

    List<RewardRule> findAllByOrderByCodeAsc();

    List<RewardRule> findByActiveTrueOrderByCodeAsc();
}
