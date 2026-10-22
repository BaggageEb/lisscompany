package com.lisscompany.promotions;

/** Proveniência do desconto aplicado a uma encomenda. */
public enum DiscountSource {
    /** Boas-vindas automática. */
    WELCOME,

    /** Recompensa escolhida pelo cliente. */
    REWARD,

    /** Pontos gastos pelo cliente (conversão no momento do resgate). */
    POINTS
}
