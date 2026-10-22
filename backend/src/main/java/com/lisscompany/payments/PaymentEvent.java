package com.lisscompany.payments;

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
 * Evento imutável de pagamento (tabela {@code payment_event}, V5).
 *
 * <p>A unicidade {@code (payment_id, idempotency_key)} torna o registo
 * <strong>idempotente</strong>: reenviar o mesmo comprovativo ou repetir a
 * mesma revisão nunca duplica eventos — constraint, não lógica de cliente.
 */
@Entity
@Table(name = "payment_event")
public class PaymentEvent {

    @Id
    @GeneratedValue(strategy = GenerationType.UUID)
    private UUID id;

    @Column(name = "payment_id", nullable = false)
    private UUID paymentId;

    /** Chave de idempotência (fornecida ou gerada pelo servidor). */
    @Column(name = "idempotency_key", nullable = false, length = 120)
    private String idempotencyKey;

    @Enumerated(EnumType.STRING)
    @Column(name = "from_status", length = 20)
    private PaymentStatus fromStatus;

    @Enumerated(EnumType.STRING)
    @Column(name = "to_status", nullable = false, length = 20)
    private PaymentStatus toStatus;

    @Column(name = "actor_user_id")
    private UUID actorUserId;

    @Column(name = "actor_label", length = 255)
    private String actorLabel;

    @Column(length = 500)
    private String note;

    @Column(name = "created_at", nullable = false, updatable = false)
    private Instant createdAt;

    @PrePersist
    void onCreate() {
        createdAt = Instant.now();
    }

    public UUID getId() {
        return id;
    }

    public UUID getPaymentId() {
        return paymentId;
    }

    public void setPaymentId(UUID paymentId) {
        this.paymentId = paymentId;
    }

    public String getIdempotencyKey() {
        return idempotencyKey;
    }

    public void setIdempotencyKey(String idempotencyKey) {
        this.idempotencyKey = idempotencyKey;
    }

    public PaymentStatus getFromStatus() {
        return fromStatus;
    }

    public void setFromStatus(PaymentStatus fromStatus) {
        this.fromStatus = fromStatus;
    }

    public PaymentStatus getToStatus() {
        return toStatus;
    }

    public void setToStatus(PaymentStatus toStatus) {
        this.toStatus = toStatus;
    }

    public UUID getActorUserId() {
        return actorUserId;
    }

    public void setActorUserId(UUID actorUserId) {
        this.actorUserId = actorUserId;
    }

    public String getActorLabel() {
        return actorLabel;
    }

    public void setActorLabel(String actorLabel) {
        this.actorLabel = actorLabel;
    }

    public String getNote() {
        return note;
    }

    public void setNote(String note) {
        this.note = note;
    }

    public Instant getCreatedAt() {
        return createdAt;
    }
}
