package com.lisscompany.loyalty;

import java.math.BigDecimal;
import java.time.Instant;
import java.util.UUID;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.PrePersist;
import jakarta.persistence.Table;

/**
 * Resgate de uma recompensa numa encomenda (tabela {@code reward_redemption},
 * V6). Único por encomenda — reforça a decisão #11 de um desconto por
 * encomenda — e o limite de utilizações por cliente é verificado por contagem
 * destes registos.
 */
@Entity
@Table(name = "reward_redemption")
public class RewardRedemption {

    @Id
    @GeneratedValue(strategy = GenerationType.UUID)
    private UUID id;

    @Column(name = "order_id", nullable = false, unique = true)
    private UUID orderId;

    @Column(name = "account_id", nullable = false)
    private UUID accountId;

    @Column(name = "reward_rule_id", nullable = false)
    private UUID rewardRuleId;

    @Column(name = "discount_amount", nullable = false, precision = 12, scale = 2)
    private BigDecimal discountAmount;

    @Column(name = "created_at", nullable = false, updatable = false)
    private Instant createdAt;

    @PrePersist
    void onCreate() {
        createdAt = Instant.now();
    }

    public UUID getId() {
        return id;
    }

    public UUID getOrderId() {
        return orderId;
    }

    public void setOrderId(UUID orderId) {
        this.orderId = orderId;
    }

    public UUID getAccountId() {
        return accountId;
    }

    public void setAccountId(UUID accountId) {
        this.accountId = accountId;
    }

    public UUID getRewardRuleId() {
        return rewardRuleId;
    }

    public void setRewardRuleId(UUID rewardRuleId) {
        this.rewardRuleId = rewardRuleId;
    }

    public BigDecimal getDiscountAmount() {
        return discountAmount;
    }

    public void setDiscountAmount(BigDecimal discountAmount) {
        this.discountAmount = discountAmount;
    }

    public Instant getCreatedAt() {
        return createdAt;
    }
}
