package com.lisscompany.loyalty;

/** Tipo de movimento no livro-razão de pontos. */
public enum LoyaltyTransactionType {

    /** Ganho por encomenda paga (crédito, idempotente por encomenda). */
    EARN,

    /** Gasto de pontos ao resgatar (idempotente por encomenda). */
    REDEEM,

    /** Ajuste manual do painel (ex.: estorno de encomenda cancelada). */
    ADJUSTMENT
}
