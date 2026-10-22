package com.lisscompany.loyalty;

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
 * Movimento imutável de pontos (tabela {@code loyalty_transaction}, V6).
 *
 * <p>Livro-razão: pontos assinados (+gasto/−gasto) e a <strong>taxa em
 * vigor</strong> no momento (decisão #9 — mudar a conversão nunca reescreve
 * movimentos antigos). A unicidade parcial {@code (order_id, type)} torna o
 * crédito e o resgate <strong>idempotentes por encomenda</strong>, por
 * constraint, não por lógica de cliente.
 */
@Entity
@Table(name = "loyalty_transaction")
public class LoyaltyTransaction {

    @Id
    @GeneratedValue(strategy = GenerationType.UUID)
    private UUID id;

    @Column(name = "account_id", nullable = false)
    private UUID accountId;

    /** Nulo apenas em ajustes manuais do painel. */
    @Column(name = "order_id")
    private UUID orderId;

    @Enumerated(EnumType.STRING)
    @Column(nullable = false, length = 20)
    private LoyaltyTransactionType type;

    @Column(nullable = false)
    private int points;

    @Enumerated(EnumType.STRING)
    @Column(name = "rate_kind", nullable = false, length = 20)
    private LoyaltyRateKind rateKind;

    @Column(name = "rate_used", nullable = false, precision = 12, scale = 4)
    private BigDecimal rateUsed;

    /** Valor em Kz que este movimento representava naquele momento. */
    @Column(name = "amount_kz", nullable = false, precision = 12, scale = 2)
    private BigDecimal amountKz;

    @Column(length = 200)
    private String note;

    @Column(name = "created_by")
    private UUID createdBy;

    @Column(name = "created_at", nullable = false, updatable = false)
    private Instant createdAt;

    @PrePersist
    void onCreate() {
        createdAt = Instant.now();
    }

    public UUID getId() {
        return id;
    }

    public UUID getAccountId() {
        return accountId;
    }

    public void setAccountId(UUID accountId) {
        this.accountId = accountId;
    }

    public UUID getOrderId() {
        return orderId;
    }

    public void setOrderId(UUID orderId) {
        this.orderId = orderId;
    }

    public LoyaltyTransactionType getType() {
        return type;
    }

    public void setType(LoyaltyTransactionType type) {
        this.type = type;
    }

    public int getPoints() {
        return points;
    }

    public void setPoints(int points) {
        this.points = points;
    }

    public LoyaltyRateKind getRateKind() {
        return rateKind;
    }

    public void setRateKind(LoyaltyRateKind rateKind) {
        this.rateKind = rateKind;
    }

    public BigDecimal getRateUsed() {
        return rateUsed;
    }

    public void setRateUsed(BigDecimal rateUsed) {
        this.rateUsed = rateUsed;
    }

    public BigDecimal getAmountKz() {
        return amountKz;
    }

    public void setAmountKz(BigDecimal amountKz) {
        this.amountKz = amountKz;
    }

    public String getNote() {
        return note;
    }

    public void setNote(String note) {
        this.note = note;
    }

    public UUID getCreatedBy() {
        return createdBy;
    }

    public void setCreatedBy(UUID createdBy) {
        this.createdBy = createdBy;
    }

    public Instant getCreatedAt() {
        return createdAt;
    }
}
