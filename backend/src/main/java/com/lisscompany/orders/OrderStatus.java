package com.lisscompany.orders;

/**
 * Estados da encomenda (data-model.md): {@code RECEIVED} é o estado inicial
 * automático; as transições seguintes pertencem à revisão de pagamentos e ao
 * painel (fases 5 e 7) e são validadas no servidor nessa altura.
 */
public enum OrderStatus {
    RECEIVED,
    CONFIRMED,
    PREPARING,
    READY,
    COMPLETED,
    CANCELLED
}
