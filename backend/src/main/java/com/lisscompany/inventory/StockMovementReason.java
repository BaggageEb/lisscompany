package com.lisscompany.inventory;

/**
 * Motivos de movimento de stock (V5). Cada alteração à quantidade disponível
 * tem um motivo explícito — nunca há «ajustes silenciosos».
 */
public enum StockMovementReason {
    /** Configuração inicial feita no painel (fase 7). */
    INITIAL_SETUP,
    /** Correcção manual pela loja (com nota). */
    MANUAL_ADJUSTMENT,
    /** Baixa definitiva: pagamento confirmado (decisão #6). */
    SOLD,
    /** Reposição: encomenda devolvida volta a stock. */
    RETURNED
}
