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
import jakarta.persistence.PreUpdate;
import jakarta.persistence.Table;

/**
 * Recompensa configurável (tabela {@code reward_rule}, V6).
 *
 * <p>Decisões #12–#14: valores, validade e nº mínimo de encomendas são campos
 * <strong>configuráveis</strong> — nada aqui vem por omissão. A recompensa da
 * meta exige <em>tanto</em> os pontos <em>como</em> a condição cumulativa de
 * encomendas (#13), nunca uma das duas. O limiar pode ser reutilizado como
 * “meta” de outro tipo de recompensa — a ligação entre recompensas é
 * configuração, não código (decisão #14).
 */
@Entity
@Table(name = "reward_rule")
public class RewardRule {

    @Id
    @GeneratedValue(strategy = GenerationType.UUID)
    private UUID id;

    /** Código estável do painel (ex.: “GOAL_10K”). */
    @Column(nullable = false, length = 40, unique = true)
    private String code;

    @Column(nullable = false, length = 200)
    private String description;

    /** Limiar de pontos da meta (decisão #12: valor configurável). */
    @Column(name = "min_points")
    private Integer minPoints;

    /** Encomendas pagas mínimas, cumulativamente (decisão #13). */
    @Column(name = "min_orders")
    private Integer minOrders;

    /** Desconto em Kz concedido pela recompensa (decisão #12). */
    @Column(name = "discount_amount", nullable = false, precision = 12, scale = 2)
    private BigDecimal discountAmount;

    /** Utilizações por cliente (1 = utilização única). */
    @Column(name = "max_per_customer", nullable = false)
    private int maxPerCustomer;

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

    public Integer getMinPoints() {
        return minPoints;
    }

    public void setMinPoints(Integer minPoints) {
        this.minPoints = minPoints;
    }

    public Integer getMinOrders() {
        return minOrders;
    }

    public void setMinOrders(Integer minOrders) {
        this.minOrders = minOrders;
    }

    public BigDecimal getDiscountAmount() {
        return discountAmount;
    }

    public void setDiscountAmount(BigDecimal discountAmount) {
        this.discountAmount = discountAmount;
    }

    public int getMaxPerCustomer() {
        return maxPerCustomer;
    }

    public void setMaxPerCustomer(int maxPerCustomer) {
        this.maxPerCustomer = maxPerCustomer;
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
