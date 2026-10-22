package com.lisscompany.loyalty;

/** Taxa arquivada num movimento de pontos (decisão #9 — histórico imutável). */
public enum LoyaltyRateKind {
    /** Percentagem de acumulação em vigor no momento do ganho. */
    EARN_PERCENT,

    /** Valor em Kz de um ponto em vigor no momento do resgate. */
    POINT_VALUE
}
