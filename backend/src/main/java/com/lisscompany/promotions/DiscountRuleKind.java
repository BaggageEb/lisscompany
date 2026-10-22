package com.lisscompany.promotions;

/** Tipo de desconto do catálogo. */
public enum DiscountRuleKind {
    /** Boas-vindas: aplicado automaticamente à primeira compra. */
    WELCOME,

    /** Recompensa de fidelização: aplicada a pedido explícito do cliente. */
    REWARD
}
