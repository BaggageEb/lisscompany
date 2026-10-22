package com.lisscompany.orders;

/**
 * Modalidade de entrega da encomenda. Decisão #3 pendente (zonas e tarifas):
 * a fase 4 escolhe a modalidade <em>sem</em> calcular qualquer taxa —
 * {@code delivery_fee} fica a zero até a proprietária configurar tarifas.
 */
public enum OrderFulfillment {
    /** Cliente levanta na loja — sem morada nem taxa. */
    PICKUP,
    /** Entrega ao cliente — exige morada fornecida pelo cliente. */
    DELIVERY
}
