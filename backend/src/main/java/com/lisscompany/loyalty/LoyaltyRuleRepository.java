package com.lisscompany.loyalty;

import java.util.Optional;
import java.util.UUID;

import org.springframework.data.jpa.repository.JpaRepository;

public interface LoyaltyRuleRepository extends JpaRepository<LoyaltyRule, UUID> {

    /** A configuração é linha única (índice único em V6). */
    Optional<LoyaltyRule> findTopByOrderByIdDesc();
}
