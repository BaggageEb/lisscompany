package com.lisscompany.loyalty;

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
 * Regra de fidelização em vigor (tabela {@code loyalty_rule}, V6).
 *
 * <p>Linha única de configuração. <strong>Nenhum valor é presumido</strong>:
 * enquanto não existir, o programa está “por configurar” e ninguém ganha nem
 * gasta pontos. As decisões comerciais #8 (taxa conversão) e #10 (resgate
 * parcial) são escolhas explícitas da proprietária, guardadas aqui — cada
 * movimento de pontos arquiva a taxa em vigor no momento (decisão #9).
 */
@Entity
@Table(name = "loyalty_rule")
public class LoyaltyRule {

    @Id
    @GeneratedValue(strategy = GenerationType.UUID)
    @Column(nullable = false)
    private UUID id;

    /** Percentagem do valor elegível creditada em pontos (acumulação). */
    @Column(name = "earn_percent", nullable = false, precision = 5, scale = 2)
    private java.math.BigDecimal earnPercent;

    /** Valor em Kz de um ponto ao resgatar (conversão, decisão #8). */
    @Column(name = "point_value_kz", nullable = false, precision = 12, scale = 4)
    private java.math.BigDecimal pointValueKz;

    /** Arredondamento da acumulação em pontos (decisão #8). */
    @Column(nullable = false, length = 10)
    private String rounding;

    /** Permite resgatar parte do saldo ou só tudo/nada (decisão #10). */
    @Column(name = "allow_partial_redemption", nullable = false)
    private boolean allowPartialRedemption;

    /** Programa activo: só então há acumulação e resgate. */
    @Column(nullable = false)
    private boolean active;

    @Column(name = "created_by")
    private UUID createdBy;

    @Column(name = "updated_by")
    private UUID updatedBy;

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

    public void setId(UUID id) {
        this.id = id;
    }

    public java.math.BigDecimal getEarnPercent() {
        return earnPercent;
    }

    public void setEarnPercent(java.math.BigDecimal earnPercent) {
        this.earnPercent = earnPercent;
    }

    public java.math.BigDecimal getPointValueKz() {
        return pointValueKz;
    }

    public void setPointValueKz(java.math.BigDecimal pointValueKz) {
        this.pointValueKz = pointValueKz;
    }

    public String getRounding() {
        return rounding;
    }

    public void setRounding(String rounding) {
        this.rounding = rounding;
    }

    public boolean isAllowPartialRedemption() {
        return allowPartialRedemption;
    }

    public void setAllowPartialRedemption(boolean allowPartialRedemption) {
        this.allowPartialRedemption = allowPartialRedemption;
    }

    public boolean isActive() {
        return active;
    }

    public void setActive(boolean active) {
        this.active = active;
    }

    public UUID getCreatedBy() {
        return createdBy;
    }

    public void setCreatedBy(UUID createdBy) {
        this.createdBy = createdBy;
    }

    public UUID getUpdatedBy() {
        return updatedBy;
    }

    public void setUpdatedBy(UUID updatedBy) {
        this.updatedBy = updatedBy;
    }

    public Instant getCreatedAt() {
        return createdAt;
    }

    public Instant getUpdatedAt() {
        return updatedAt;
    }
}
