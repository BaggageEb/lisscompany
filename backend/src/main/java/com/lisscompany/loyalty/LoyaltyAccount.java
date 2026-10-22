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
 * Conta de fidelização de um cliente (tabela {@code loyalty_account}, V6).
 *
 * <p>Criada sob procura no primeiro movimento. O saldo é sempre em <strong>
 * pontos inteiros</strong> (decisão #9: pontos invariantes — mudar a taxa de
 * conversão nunca reescreve o saldo); a conversão para Kz usa a taxa vigente
 * no momento do resgate.
 */
@Entity
@Table(name = "loyalty_account")
public class LoyaltyAccount {

    @Id
    @GeneratedValue(strategy = GenerationType.UUID)
    private UUID id;

    @Column(name = "user_id", nullable = false)
    private UUID userId;

    @Column(name = "points_balance", nullable = false)
    private int pointsBalance;

    @Column(name = "lifetime_points", nullable = false)
    private int lifetimePoints;

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

    public UUID getUserId() {
        return userId;
    }

    public void setUserId(UUID userId) {
        this.userId = userId;
    }

    public int getPointsBalance() {
        return pointsBalance;
    }

    public void setPointsBalance(int pointsBalance) {
        this.pointsBalance = pointsBalance;
    }

    public int getLifetimePoints() {
        return lifetimePoints;
    }

    public void setLifetimePoints(int lifetimePoints) {
        this.lifetimePoints = lifetimePoints;
    }

    /** Regista um movimento de pontos no saldo e no acumulado de sempre. */
    public void apply(int delta) {
        pointsBalance += delta;
        if (delta > 0) {
            lifetimePoints += delta;
        }
    }

    public Instant getCreatedAt() {
        return createdAt;
    }

    public Instant getUpdatedAt() {
        return updatedAt;
    }
}
