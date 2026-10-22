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
import jakarta.persistence.PreUpdate;
import jakarta.persistence.Table;

/**
 * Regra de desconto do catálogo (tabela {@code discount_rule}, V6).
 *
 * <p>Decisão #11: a hierarquia entre descontos activos é da proprietária
 * (campo {@code priority}, validado sem empates) — nenhum valor por omissão.
 * A decisão concreta de qual regra “manda” na prática também está documentada:
 * escolha explícita do cliente (pontos/recompensa) precede a automática
 * (boas-vindas); a prioridade ordena as regras entre si.
 */
@Entity
@Table(name = "discount_rule")
public class DiscountRule {

    @Id
    @GeneratedValue(strategy = GenerationType.UUID)
    private UUID id;

    @Column(nullable = false, length = 40, unique = true)
    private String code;

    /** Rótulo apresentado ao cliente. */
    @Column(nullable = false, length = 200)
    private String description;

    @Enumerated(EnumType.STRING)
    @Column(nullable = false, length = 20)
    private DiscountRuleKind kind;

    /** Percentagem sobre o subtotal (WELCOME, ou REWARD em percentagem). */
    @Column(precision = 5, scale = 2)
    private BigDecimal percent;

    /** Valor fixo em Kz (REWARD). */
    @Column(precision = 12, scale = 2)
    private BigDecimal amount;

    /** Para REWARD: a recompensa que concede este desconto. */
    @Column(name = "reward_rule_id")
    private UUID rewardRuleId;

    @Column(nullable = false)
    private int priority;

    @Column(nullable = false)
    private boolean active;

    @Column(name = "created_at", nullable = false, updatable = false)
    private Instant createdAt;

    @Column(name = "updated_at", nullable = false)
    private Instant updatedAt;

    @PrePersist
    void onCreate() {
        createdAt = Instant.now();
        updatedAt = createdAt;
    }

    @PreUpdate
    void onUpdate() {
        updatedAt = Instant.now();
    }

    public UUID getId() {
        return id;
    }

    public String getCode() {
        return code;
    }

    public void setCode(String code) {
        this.code = code;
    }

    public String getDescription() {
        return description;
    }

    public void setDescription(String description) {
        this.description = description;
    }

    public DiscountRuleKind getKind() {
        return kind;
    }

    public void setKind(DiscountRuleKind kind) {
        this.kind = kind;
    }

    public BigDecimal getPercent() {
        return percent;
    }

    public void setPercent(BigDecimal percent) {
        this.percent = percent;
    }

    public BigDecimal getAmount() {
        return amount;
    }

    public void setAmount(BigDecimal amount) {
        this.amount = amount;
    }

    public UUID getRewardRuleId() {
        return rewardRuleId;
    }

    public void setRewardRuleId(UUID rewardRuleId) {
        this.rewardRuleId = rewardRuleId;
    }

    public int getPriority() {
        return priority;
    }

    public void setPriority(int priority) {
        this.priority = priority;
    }

    public boolean isActive() {
        return active;
    }

    public void setActive(boolean active) {
        this.active = active;
    }

    public Instant getCreatedAt() {
        return createdAt;
    }

    public Instant getUpdatedAt() {
        return updatedAt;
    }
}
