package com.lisscompany.payments;

/**
 * Estados do pagamento (data-model.md): {@code PENDING} é o estado inicial
 * de toda a encomenda; a revisão manual (decisão #5) leva a {@code PAID} ou
 * {@code FAILED}. Reembolsos são estados futuros — sem fornecedor automático
 * (decisão #4) nada transiciona sozinho.
 */
public enum PaymentStatus {
    PENDING,
    UNDER_REVIEW,
    PAID,
    FAILED,
    PARTIALLY_REFUNDED,
    REFUNDED
}
