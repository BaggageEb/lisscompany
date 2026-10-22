package com.lisscompany.inventory;

/** Estado de uma reserva de stock (V5). */
public enum ReservationStatus {
    /** Reserva activa: unidades seguras para a encomenda. */
    ACTIVE,
    /** Pagamento confirmado — a reserva foi consumida (stock baixado). */
    CONSUMED,
    /** Encomenda cancelada ou reserva expirada — unidades devolvidas. */
    RELEASED
}
