package com.lisscompany.orders;

import java.util.EnumMap;
import java.util.EnumSet;
import java.util.Map;
import java.util.Set;

import com.lisscompany.shared.error.ConflictException;

/**
 * Máquina de estados da encomenda (data-model.md), validada SEMPRE no
 * servidor: {@code RECEIVED → CONFIRMED → PREPARING → READY → COMPLETED},
 * com {@code CANCELLED} acessível a partir de qualquer estado não terminal.
 *
 * <p>Regras de negócio embutidas (decisão #7): o cliente só cancela enquanto
 * a encomenda está {@code RECEIVED} (cancelamento automático antes de
 * confirmada); depois disso só uma conta autorizada cancela, e nenhum
 * reembolso é automático. {@code COMPLETED} e {@code CANCELLED} são terminais.
 */
public final class OrderStatusTransitions {

    private static final Map<OrderStatus, Set<OrderStatus>> ALLOWED = new EnumMap<>(OrderStatus.class);

    static {
        ALLOWED.put(OrderStatus.RECEIVED, EnumSet.of(OrderStatus.CONFIRMED, OrderStatus.CANCELLED));
        ALLOWED.put(OrderStatus.CONFIRMED, EnumSet.of(OrderStatus.PREPARING, OrderStatus.CANCELLED));
        ALLOWED.put(OrderStatus.PREPARING, EnumSet.of(OrderStatus.READY, OrderStatus.CANCELLED));
        ALLOWED.put(OrderStatus.READY, EnumSet.of(OrderStatus.COMPLETED, OrderStatus.CANCELLED));
        ALLOWED.put(OrderStatus.COMPLETED, EnumSet.noneOf(OrderStatus.class));
        ALLOWED.put(OrderStatus.CANCELLED, EnumSet.noneOf(OrderStatus.class));
    }

    private OrderStatusTransitions() {}

    /** Valida a transição ou lança 409 com o motivo legível. */
    public static void assertAllowed(OrderStatus from, OrderStatus to) {
        if (from == to) {
            throw new ConflictException(
                    "ORDER_STATUS_UNCHANGED", "A encomenda já está no estado " + from + ".");
        }
        if (!ALLOWED.get(from).contains(to)) {
            throw new ConflictException(
                    "INVALID_ORDER_STATUS",
                    "Transição inválida: a encomenda não pode passar de " + from + " para " + to + ".");
        }
    }

    /** Transição permitida? (para decidir efeitos secundários, ex.: cancelamento). */
    public static boolean isAllowed(OrderStatus from, OrderStatus to) {
        return from != to && ALLOWED.get(from).contains(to);
    }

    /**
     * Destinos possíveis a partir de um estado — devolvidos ao painel para
     * mostrar só os botões que a máquina de estados aceita (a validação
     * continua a acontecer no servidor em qualquer pedido).
     */
    public static Set<OrderStatus> targetsFrom(OrderStatus from) {
        return Set.copyOf(ALLOWED.get(from));
    }
}
