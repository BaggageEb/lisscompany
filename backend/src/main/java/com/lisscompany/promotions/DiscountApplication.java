package com.lisscompany.promotions;

import java.math.BigDecimal;
import java.time.Instant;
import java.util.UUID;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.PrePersist;
import jakarta.persistence.Table;

/**
 * Desconto aplicado a uma encomenda (tabela {@code discount_application}, V6).
 *
 * <p>Único por encomenda — a decisão #11 de <strong>um</strong> desconto por
 * encomenda é uma constraint, não uma regra esquecida no código. Regista a
 * proveniência (boas-vindas, recompensa ou pontos) para auditoria e exibição.
 */
@Entity
@Table(name = "discount_application")
public class DiscountApplication {

    @Id
    @GeneratedValue(strategy = GenerationType.UUID)
    private UUID id;

    @Column(name = "order_id", nullable = false, unique = true)
    private UUID orderId;

    /** Nulo quando a origem são pontos puros (sem regra do catálogo). */
    @Column(name = "discount_rule_id")
    private UUID discountRuleId;

    @Enumerated(EnumType.STRING)
    @Column(nullable = false, length = 20)
    private DiscountSource source;

    @Column(nullable = false, length = 120)
    private String label;

    @Column(nullable = false, precision = 12, scale = 2)
    private BigDecimal amount;

    @Column(name = "points_spent", nullable = false)
    private int pointsSpent;

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

    public UUID getDiscountRuleId() {
        return discountRuleId;
    }

    public void setDiscountRuleId(UUID discountRuleId) {
        this.discountRuleId = discountRuleId;
    }

    public DiscountSource getSource() {
        return source;
    }

    public void setSource(DiscountSource source) {
        this.source = source;
    }

    public String getLabel() {
        return label;
    }

    public void setLabel(String label) {
        this.label = label;
    }

    public BigDecimal getAmount() {
        return amount;
    }

    public void setAmount(BigDecimal amount) {
        this.amount = amount;
    }

    public int getPointsSpent() {
        return pointsSpent;
    }

    public void setPointsSpent(int pointsSpent) {
        this.pointsSpent = pointsSpent;
    }

    public Instant getCreatedAt() {
        return createdAt;
    }
}
