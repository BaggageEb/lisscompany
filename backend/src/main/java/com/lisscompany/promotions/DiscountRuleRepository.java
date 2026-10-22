package com.lisscompany.promotions;

import java.util.List;
import java.util.Optional;
import java.util.UUID;

import org.springframework.data.jpa.repository.JpaRepository;

public interface DiscountRuleRepository extends JpaRepository<DiscountRule, UUID> {

    Optional<DiscountRule> findByCode(String code);

    List<DiscountRule> findAllByOrderByPriorityAsc();

    Optional<DiscountRule> findTopByKindAndActiveTrueOrderByPriorityAsc(DiscountRuleKind kind);

    Optional<DiscountRule> findTopByRewardRuleIdAndActiveTrueOrderByPriorityAsc(UUID rewardRuleId);

    boolean existsByPriorityAndActiveTrueAndIdNot(int priority, UUID id);

    boolean existsByPriorityAndActiveTrue(int priority);
}
