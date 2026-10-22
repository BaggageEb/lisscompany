package com.lisscompany.inventory;

import java.time.Instant;
import java.util.List;
import java.util.UUID;

import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import com.lisscompany.audit.AuditService;
import com.lisscompany.catalog.ProductRepository;
import com.lisscompany.orders.CustomerOrder;
import com.lisscompany.orders.OrderItem;
import com.lisscompany.orders.OrderItemKind;
import com.lisscompany.shared.error.CartValidationException;
import com.lisscompany.shared.error.ConflictException;
import com.lisscompany.shared.error.InvalidRequestException;
import com.lisscompany.shared.error.NotFoundException;

/**
 * Inventário da fase 5 — stock por produto, reservas e baixas.
 *
 * <p>Modelo (decisão #6): ao <strong>criar</strong> a encomenda as unidades
 * dos artigos ficam reservadas ({@link ReservationStatus#ACTIVE}); a baixa
 * definitiva só acontece quando o pagamento é <strong>confirmado</strong> por
 * conta autorizada ({@link ReservationStatus#CONSUMED} + movimento
 * {@code SOLD}); cancelamento devolve as unidades ({@code RELEASED}).
 *
 * <p>Regras de honestidade (decisão #2): produtos <em>sem</em> linha de
 * inventário são ilimitados — as quantidades iniciais são configuradas pela
 * proprietária no painel (fase 7), nunca inventadas aqui. Nenhum consumo é
 * inferido por receita: bolos do Cake Studio não baixam ingredientes até a
 * proprietária configurar essas quantidades.
 *
 * <p>Expiração de reservas: a política de prazo é decisão #6 pendente — sem
 * prazo configurado nada expira. Quando configurado, o servidor expira
 * reservas activas vencidas antes de novas reservas.
 */
@Service
public class InventoryService {

    private final InventoryItemRepository itemRepository;
    private final StockReservationRepository reservationRepository;
    private final StockMovementRepository movementRepository;
    private final ProductRepository productRepository;
    private final AuditService auditService;

    public InventoryService(
            InventoryItemRepository itemRepository,
            StockReservationRepository reservationRepository,
            StockMovementRepository movementRepository,
            ProductRepository productRepository,
            AuditService auditService) {
        this.itemRepository = itemRepository;
        this.reservationRepository = reservationRepository;
        this.movementRepository = movementRepository;
        this.productRepository = productRepository;
        this.auditService = auditService;
    }

    /* ------------------------------- Views ------------------------------- */

    public record StockView(
            String productId, String productName, int availableQty, int reservedQty, String unitLabel) {}

    /* ------------------------------ Reserva ------------------------------ */

    /**
     * Reserva as unidades de todos os artigos de produto da encomenda.
     * Chamado dentro da transacção de criação: se algum artigo não tiver
     * stock suficiente, nada é persistido (422 com o motivo).
     */
    @Transactional
    public void reserveFor(CustomerOrder order) {
        expireOverdueReservations();
        for (OrderItem item : order.getItems()) {
            if (item.getKind() != OrderItemKind.PRODUCT || item.getProductId() == null) {
                // Bolos: sem consumo por receita até decisão #2 (fase 7).
                continue;
            }
            // FOR UPDATE: concorrência serializa por produto (nunca oversell).
            InventoryItem stock = itemRepository
                    .findByProductIdForUpdate(item.getProductId())
                    .orElse(null);
            if (stock == null) {
                continue; // Produto não gerido por stock → ilimitado.
            }
            int free = stock.getAvailableQty() - reservationRepository.sumReservedQuantity(
                    stock.getProductId(), ReservationStatus.ACTIVE);
            if (free < item.getQuantity()) {
                throw new CartValidationException(
                        "STOCK_INSUFFICIENT",
                        "Não há stock suficiente para todos os artigos. Ajuste as quantidades e tente novamente.",
                        List.of("%s: só há %d %s disponível.".formatted(item.getName(), Math.max(free, 0), stock.getUnitLabel())));
            }
            StockReservation reservation = new StockReservation();
            reservation.setOrderId(order.getId());
            reservation.setProductId(item.getProductId());
            reservation.setQuantity(item.getQuantity());
            reservationRepository.save(reservation);
        }
    }

    /**
     * Baixa definitiva do stock: consome as reservas activas da encomenda e
     * regista o movimento {@code SOLD}. Idempotente — reservas já consumidas
     * são ignoradas.
     */
    @Transactional
    public void consumeFor(CustomerOrder order, UUID actorUserId) {
        for (StockReservation reservation : reservationRepository.findByOrderId(order.getId())) {
            if (reservation.getStatus() != ReservationStatus.ACTIVE) {
                continue;
            }
            reservation.setStatus(ReservationStatus.CONSUMED);
            reservationRepository.save(reservation);

            InventoryItem stock = itemRepository
                    .findByProductIdForUpdate(reservation.getProductId())
                    .orElse(null);
            if (stock == null) {
                continue; // A linha desapareceu (produto apagado) — sem stock a baixar.
            }
            apply(stock, -reservation.getQuantity(), StockMovementReason.SOLD, order.getId(), actorUserId,
                    "Baixa por pagamento confirmado da encomenda.");
        }
    }

    /**
     * Devolve à venda as reservas activas da encomenda (cancelamento).
     * Idempotente: reservas fechadas não são tocadas.
     */
    @Transactional
    public void releaseFor(CustomerOrder order) {
        for (StockReservation reservation : reservationRepository.findByOrderId(order.getId())) {
            if (reservation.getStatus() != ReservationStatus.ACTIVE) {
                continue;
            }
            reservation.setStatus(ReservationStatus.RELEASED);
            reservationRepository.save(reservation);
        }
    }

    /** Expira reservas activas vencidas (política de prazo: decisão #6). */
    @Transactional
    public int expireOverdueReservations() {
        List<StockReservation> overdue =
                reservationRepository.findByStatusAndExpiresAtBefore(ReservationStatus.ACTIVE, Instant.now());
        for (StockReservation reservation : overdue) {
            reservation.setStatus(ReservationStatus.RELEASED);
            reservationRepository.save(reservation);
        }
        return overdue.size();
    }

    /* ------------------------------ Leitura ------------------------------ */

    /**
     * Unidades livres de um produto para o orçamento público: disponível menos
     * reservas activas. {@code null} = produto não gerido por stock (ilimitado,
     * decisão #2).
     */
    @Transactional(readOnly = true)
    public Integer availableFor(UUID productId) {
        InventoryItem item = itemRepository.findByProductId(productId).orElse(null);
        if (item == null) {
            return null;
        }
        return item.getAvailableQty()
                - reservationRepository.sumReservedQuantity(productId, ReservationStatus.ACTIVE);
    }

    /** Stock de todos os produtos geridos (painel da loja — fase 7). */
    @Transactional(readOnly = true)
    public List<StockView> listStock() {
        return itemRepository.findAllByOrderByProductId().stream().map(this::stockView).toList();
    }

    /* --------------------------- Ajuste do painel (fase 7) --------------- */

    /**
     * Ajuste manual de stock pelo painel (decisão #2): a primeira ajuste
     * positiva <em>cria</em> a linha de inventário (quantidade inicial — motivo
     * {@code INITIAL_SETUP}); a partir daí é {@code MANUAL_ADJUSTMENT}.
     *
     * <p>Regras: delta nunca zero nem absurdo; produto tem de existir; não se
     * baixa um produto sem linha (é ilimitado — não há o que baixar); e o
     * resultado nunca fica abaixo das unidades já <strong>reservadas</strong>
     * por encomendas pendentes, senão a baixa futura falharia.
     */
    @Transactional
    public StockView adjustStock(UUID productId, int delta, String note, com.lisscompany.identity.AppUser actor) {
        if (delta == 0) {
            throw new InvalidRequestException(java.util.Map.of(
                    "delta", "O ajuste não pode ser zero: indique quantas unidades a somar ou a subtrair."));
        }
        if (Math.abs(delta) > 1_000_000) {
            throw new InvalidRequestException(java.util.Map.of(
                    "delta", "Ajuste demasiado grande (máximo 1 000 000 unidades por movimento)."));
        }
        if (!productRepository.existsById(productId)) {
            throw new NotFoundException("PRODUCT_NOT_FOUND", "Produto não encontrado.");
        }

        InventoryItem stock = itemRepository.findByProductIdForUpdate(productId).orElse(null);
        String details;
        if (stock == null) {
            if (delta < 0) {
                throw new InvalidRequestException(java.util.Map.of(
                        "delta",
                        "Este produto ainda não tem linha de inventário (é ilimitado). "
                                + "Comece por registar a quantidade inicial com um valor positivo."));
            }
            stock = new InventoryItem();
            stock.setProductId(productId);
            stock.setAvailableQty(0);
            stock.setUnitLabel("un");
            itemRepository.save(stock);
            apply(stock, delta, StockMovementReason.INITIAL_SETUP, null, actor.getId(),
                    note == null || note.isBlank() ? "Quantidade inicial configurada no painel." : note.trim());
            details = "quantidade inicial %d".formatted(delta);
        } else {
            int reserved = reservationRepository.sumReservedQuantity(productId, ReservationStatus.ACTIVE);
            if (stock.getAvailableQty() + delta < reserved) {
                throw new ConflictException(
                        "STOCK_CONFLICT",
                        "O ajuste deixaria o stock livre (%d) abaixo das %d unidade(s) já reservadas por encomendas pendentes."
                                .formatted(Math.max(stock.getAvailableQty() + delta, 0), reserved));
            }
            apply(stock, delta, StockMovementReason.MANUAL_ADJUSTMENT, null, actor.getId(),
                    note == null || note.isBlank() ? null : note.trim());
            details = "ajuste %s%d → disponível %d".formatted(delta > 0 ? "+" : "", delta, stock.getAvailableQty());
        }

        auditService.record(
                actor.getId(),
                actor.getEmail(),
                "inventory.adjusted",
                "inventory_item",
                stock.getId().toString(),
                "Produto %s · %s%s"
                        .formatted(
                                productId,
                                details,
                                note == null || note.isBlank() ? "" : " · " + note.trim()));
        return stockView(stock);
    }

    /* ------------------------------ Internos ----------------------------- */

    /** Visão de um produto gerido — a mesma usada pela lista do painel. */
    private StockView stockView(InventoryItem item) {
        return new StockView(
                item.getProductId().toString(),
                productRepository.findById(item.getProductId()).map(p -> p.getName()).orElse("Produto removido"),
                item.getAvailableQty(),
                reservationRepository.sumReservedQuantity(item.getProductId(), ReservationStatus.ACTIVE),
                item.getUnitLabel());
    }

    /** Aplica um Δ ao stock e regista o movimento (nunca negativo — CHECK). */
    private void apply(
            InventoryItem stock, int delta, StockMovementReason reason, UUID orderId, UUID actorUserId, String note) {
        int next = stock.getAvailableQty() + delta;
        if (next < 0) {
            throw new ConflictException(
                    "STOCK_CONFLICT", "Stock insuficiente para a operação pedida. Verifique o inventário.");
        }
        stock.setAvailableQty(next);
        stock.setUpdatedBy(actorUserId);
        itemRepository.save(stock);

        StockMovement movement = new StockMovement();
        movement.setProductId(stock.getProductId());
        movement.setDelta(delta);
        movement.setReason(reason);
        movement.setOrderId(orderId);
        movement.setActorUserId(actorUserId);
        movement.setNote(note);
        movementRepository.save(movement);
    }
}
