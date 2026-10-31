package com.lisscompany.payments;

import java.time.Instant;
import java.util.Collection;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;

import org.springframework.data.domain.Sort;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import com.lisscompany.audit.AuditService;
import com.lisscompany.inventory.InventoryService;
import com.lisscompany.loyalty.LoyaltyService;
import com.lisscompany.orders.CustomerOrder;
import com.lisscompany.orders.CustomerOrderRepository;
import com.lisscompany.orders.OrderStatus;
import com.lisscompany.orders.OrderStatusTransitions;
import com.lisscompany.shared.error.ConflictException;
import com.lisscompany.shared.error.InvalidRequestException;
import org.springframework.jdbc.core.JdbcTemplate;
import java.math.BigDecimal;
import java.math.RoundingMode;
import com.lisscompany.shared.error.NotFoundException;

/**
 * Pagamentos da fase 5 — sem fornecedor automático (decisão #4).
 *
 * <p>O pagamento nasce {@code PENDING} com a própria encomenda (mesma
 * transacção, atómico) e só muda por <strong>revisão manual de conta
 * autorizada</strong> (decisão #5): {@code PENDING → PAID} ou
 * {@code PENDING → FAILED}. Nenhuma rota do cliente marca «pago».
 *
 * <p>Efeitos de confirmar o pagamento (decisão #6): a encomenda passa a
 * {@code CONFIRMED} (se ainda {@code RECEIVED}) e o stock reservado é baixado
 * definitivamente — tudo na mesma transacção, com auditoria.
 *
 * <p>Cada transição gera um evento com chave de idempotência única por
 * pagamento: reenviar o mesmo pedido (rede, duplo clique) nunca duplica
 * efeitos — o segundo contacto devolve o estado actual.
 */
@Service
public class PaymentService {

    private final PaymentRepository paymentRepository;
    private final PaymentEventRepository eventRepository;
    private final CustomerOrderRepository orderRepository;
    private final InventoryService inventoryService;
    private final LoyaltyService loyaltyService;
    private final AuditService auditService;
    private final JdbcTemplate jdbc;

    public PaymentService(
            PaymentRepository paymentRepository,
            PaymentEventRepository eventRepository,
            CustomerOrderRepository orderRepository,
            InventoryService inventoryService,
            LoyaltyService loyaltyService,
            AuditService auditService,
            JdbcTemplate jdbc) {
        this.jdbc = jdbc;
        this.paymentRepository = paymentRepository;
        this.eventRepository = eventRepository;
        this.orderRepository = orderRepository;
        this.inventoryService = inventoryService;
        this.loyaltyService = loyaltyService;
        this.auditService = auditService;
    }

    /* ------------------------------- Views ------------------------------- */

    public record PaymentView(
            String orderNumber,
            String method,
            String amount,
            String currency,
            String status,
            String reviewedAt,
            String reviewNote,
            String proofReference,
            String refundedAmount) {}

    public record RefundInput(String amount, String reason, String reference, String idempotencyKey) {}

    public record ReviewDecision(
            String orderNumber,
            /** Novo estado pretendido: {@code PAID} ou {@code FAILED}. */
            PaymentStatus target,
            String note,
            /** Chave de idempotência do cliente (opcional; gera-se uma se ausente). */
            String idempotencyKey,
            UUID actorUserId,
            String actorLabel) {}

    /* ------------------------------ Abertura ----------------------------- */

    /**
     * Cria o pagamento pendente da encomenda. Chamado dentro da transacção de
     * criação da encomenda — ou existe ambos, ou nenhum.
     */
    @Transactional
    public Payment openFor(CustomerOrder order) {
        if (paymentRepository.findByOrderId(order.getId()).isPresent()) {
            throw new ConflictException("PAYMENT_EXISTS", "A encomenda já tem pagamento registado.");
        }
        Payment payment = new Payment();
        payment.setOrderId(order.getId());
        payment.setMethod(order.getPaymentMethod());
        payment.setAmount(order.getTotal());
        payment.setCurrency(order.getCurrency());
        payment.setStatus(PaymentStatus.PENDING);
        Payment saved = paymentRepository.save(payment);

        recordEvent(saved, null, PaymentStatus.PENDING,
                order.getUserId(), "cliente", "open:" + saved.getId(),
                "Pagamento aberto com a encomenda " + order.getOrderNumber());
        return saved;
    }

    /* ------------------------------ Leitura ------------------------------ */

    /** Resumo administrativo: o pagamento com a encomenda a que pertence (fase 7). */
    public record PaymentAdminView(
            String orderNumber,
            String orderStatus,
            String contactName,
            String method,
            String amount,
            String currency,
            String status,
            String createdAt,
            String reviewedAt,
            String reviewNote,
            String proofReference) {}

    /** Tamanho da fila do painel — mais recentes primeiro, sem carregar tudo. */
    private static final int PANEL_PAGE_SIZE = 200;

    /**
     * Fila de pagamentos para o painel (conta autorizada — o guard está no
     * controlador). Filtro opcional por estado; a junção com as encomendas é
     * feita em lote pequeno, nunca por linha.
     */
    @Transactional(readOnly = true)
    public List<PaymentAdminView> listForPanel(PaymentStatus status) {
        List<Payment> payments = paymentRepository.findAll(Sort.by(Sort.Direction.DESC, "createdAt")).stream()
                .filter(payment -> status == null || payment.getStatus() == status)
                .limit(PANEL_PAGE_SIZE)
                .toList();
        if (payments.isEmpty()) {
            return List.of();
        }
        Map<UUID, CustomerOrder> orders = new HashMap<>();
        for (CustomerOrder order : orderRepository.findAllById(
                payments.stream().map(Payment::getOrderId).toList())) {
            orders.put(order.getId(), order);
        }
        return payments.stream()
                .map(payment -> Optional.ofNullable(orders.get(payment.getOrderId()))
                        .map(order -> new PaymentAdminView(
                                order.getOrderNumber(),
                                order.getStatus().name(),
                                order.getContactName(),
                                payment.getMethod().name(),
                                payment.getAmount().setScale(2).toPlainString(),
                                payment.getCurrency(),
                                payment.getStatus().name(),
                                payment.getCreatedAt().toString(),
                                payment.getReviewedAt() == null ? null : payment.getReviewedAt().toString(),
                                payment.getReviewNote(),
                                payment.getProofReference())))
                .filter(Optional::isPresent)
                .map(Optional::get)
                .toList();
    }

    /** Estado do pagamento de uma encomenda (para as views do cliente). */
    @Transactional(readOnly = true)
    public PaymentStatus statusOf(UUID orderId) {
        return paymentRepository.findByOrderId(orderId).map(Payment::getStatus).orElse(null);
    }

    /** Estados em lote por encomenda — listas sem N+1. */
    @Transactional(readOnly = true)
    public Map<UUID, PaymentStatus> statusesFor(Collection<UUID> orderIds) {
        if (orderIds.isEmpty()) {
            return Map.of();
        }
        Map<UUID, PaymentStatus> byOrder = new HashMap<>();
        for (Payment payment : paymentRepository.findByOrderIdIn(orderIds)) {
            byOrder.put(payment.getOrderId(), payment.getStatus());
        }
        return byOrder;
    }

    @Transactional(readOnly = true)
    public PaymentView viewForOrder(String orderNumber) {
        CustomerOrder order = orderRepository
                .findByOrderNumber(orderNumber)
                .orElseThrow(() -> new NotFoundException("ORDER_NOT_FOUND", "Encomenda não encontrada."));
        Payment payment = paymentRepository
                .findByOrderId(order.getId())
                .orElseThrow(() -> new NotFoundException("PAYMENT_NOT_FOUND", "Pagamento não encontrado."));
        return view(payment, order.getOrderNumber());
    }

    /* ------------------------------- Revisão ----------------------------- */

    /**
     * Revisão manual (conta autorizada): confirma ou rejeita o pagamento.
     * Idempotente pela chave — repetir a mesma revisão devolve o estado sem
     * novos efeitos.
     */
    @Transactional
    public PaymentView review(ReviewDecision decision) {
        CustomerOrder order = orderRepository
                .findByOrderNumber(decision.orderNumber())
                .orElseThrow(() -> new NotFoundException("ORDER_NOT_FOUND", "Encomenda não encontrada."));
        Payment payment = paymentRepository
                .findByOrderId(order.getId())
                .orElseThrow(() -> new NotFoundException("PAYMENT_NOT_FOUND", "Pagamento não encontrado."));

        String key = decision.idempotencyKey() == null || decision.idempotencyKey().isBlank()
                ? "review:" + decision.target() + ":" + UUID.randomUUID()
                : decision.idempotencyKey().trim();
        Optional<PaymentEvent> existing = eventRepository.findByPaymentIdAndIdempotencyKey(payment.getId(), key);
        if (existing.isPresent()) {
            return view(payment, order.getOrderNumber()); // Reenvio: sem efeitos novos.
        }

        PaymentStatus from = payment.getStatus();
        validateTransition(from, decision.target());

        payment.setStatus(decision.target());
        payment.setReviewedBy(decision.actorUserId());
        payment.setReviewedAt(Instant.now());
        payment.setReviewNote(blankToNull(decision.note()));
        paymentRepository.save(payment);

        recordEvent(payment, from, decision.target(), decision.actorUserId(), decision.actorLabel(), key,
                blankToNull(decision.note()));

        if (decision.target() == PaymentStatus.PAID) {
            confirmOrder(order, decision);
            inventoryService.consumeFor(order, decision.actorUserId());
            // Fase 6: o pagamento confirmado credita pontos — mesma transacção,
            // idempotente por encomenda. Programa por configurar/pausado não
            // bloqueia o pagamento: apenas não há acumulação.
            loyaltyService.creditFor(order, decision.actorUserId(), decision.actorLabel());
        }

        auditService.record(
                decision.actorUserId(),
                decision.actorLabel(),
                "payment.reviewed",
                "payment",
                payment.getId().toString(),
                "Encomenda %s · pagamento %s → %s%s"
                        .formatted(
                                order.getOrderNumber(),
                                from,
                                decision.target(),
                                payment.getReviewNote() == null ? "" : " · " + payment.getReviewNote()));

        return view(payment, order.getOrderNumber());
    }

    /* --------------------------- Cancelamento ---------------------------- */

    /**
     * Fecha o pagamento de uma encomenda cancelada: pendentes/revisão passam
     * a {@code FAILED} (nada a cobrar). Pagamentos já {@code PAID} não são
     * tocados — o reembolso é um processo manual separado (decisão #7: sem
     * reembolso automático implícito).
     */
    @Transactional
    public void failOnCancel(CustomerOrder order, UUID actorUserId, String actorLabel) {
        Payment payment = paymentRepository.findByOrderId(order.getId()).orElse(null);
        if (payment == null) {
            return;
        }
        PaymentStatus from = payment.getStatus();
        if (from != PaymentStatus.PENDING && from != PaymentStatus.UNDER_REVIEW) {
            return; // PAID/FAILED/REEMBOLSOS: não interferir com o reembolso manual.
        }
        payment.setStatus(PaymentStatus.FAILED);
        payment.setReviewNote("Encomenda cancelada antes da confirmação do pagamento.");
        paymentRepository.save(payment);

        recordEvent(payment, from, PaymentStatus.FAILED, actorUserId, actorLabel,
                "cancel:" + order.getOrderNumber(),
                "Encomenda cancelada antes da confirmação do pagamento.");
    }

    /* ------------------------ Comprovativo (cliente) ---------------------- */

    /**
     * O cliente indica a referência do seu pagamento/transferência. Isto NUNCA
     * marca «pago»: apenas passa o pagamento a UNDER_REVIEW para a loja validar.
     */
    @Transactional
    public PaymentView submitProof(UUID userId, String userLabel, String orderNumber, String reference) {
        CustomerOrder order = orderRepository.findByOrderNumber(orderNumber)
                .filter(o -> o.getUserId().equals(userId))
                .orElseThrow(() -> new NotFoundException("ORDER_NOT_FOUND", "Encomenda não encontrada."));
        Payment payment = paymentRepository.findByOrderId(order.getId())
                .orElseThrow(() -> new NotFoundException("PAYMENT_NOT_FOUND", "Pagamento não encontrado."));
        String ref = blankToNull(reference);
        if (ref == null || ref.length() < 3 || ref.length() > 200) {
            throw new InvalidRequestException(java.util.Map.of("reference", "Indique a referência do pagamento (3 a 200 caracteres)."));
        }
        if (payment.getStatus() != PaymentStatus.PENDING && payment.getStatus() != PaymentStatus.UNDER_REVIEW) {
            throw new ConflictException("PAYMENT_CLOSED", "Este pagamento já não aceita comprovativos.");
        }
        if (order.getStatus() == OrderStatus.CANCELLED) {
            throw new ConflictException("ORDER_CANCELLED", "A encomenda está cancelada.");
        }
        PaymentStatus from = payment.getStatus();
        payment.setProofReference(ref);
        payment.setProofSubmittedAt(Instant.now());
        payment.setStatus(PaymentStatus.UNDER_REVIEW);
        paymentRepository.save(payment);
        recordEvent(payment, from, PaymentStatus.UNDER_REVIEW, userId, userLabel,
                "proof:" + UUID.randomUUID(), "Comprovativo indicado pelo cliente.");
        auditService.record(userId, userLabel, "payment.proof_submitted", "payment", payment.getId().toString(),
                "Encomenda " + order.getOrderNumber() + " · referência indicada pelo cliente");
        return view(payment, order.getOrderNumber());
    }

    /* ------------------------------ Reembolsos ---------------------------- */

    private String refundedOf(UUID paymentId) {
        BigDecimal sum = jdbc.queryForObject(
                "SELECT COALESCE(SUM(amount), 0) FROM refund WHERE payment_id = ?", BigDecimal.class, paymentId);
        return (sum == null ? BigDecimal.ZERO : sum).setScale(2, RoundingMode.HALF_UP).toPlainString();
    }

    /**
     * Reembolso (total ou parcial) de um pagamento CONFIRMADO, por conta
     * autorizada. Idempotente pela chave, nunca excede o valor pago, regista
     * quem/quando/porquê e estorna proporcionalmente os pontos ganhos.
     */
    @Transactional
    public PaymentView refund(String orderNumber, RefundInput input, UUID actorUserId, String actorLabel) {
        CustomerOrder order = orderRepository.findByOrderNumber(orderNumber)
                .orElseThrow(() -> new NotFoundException("ORDER_NOT_FOUND", "Encomenda não encontrada."));
        Payment payment = paymentRepository.findByOrderId(order.getId())
                .orElseThrow(() -> new NotFoundException("PAYMENT_NOT_FOUND", "Pagamento não encontrado."));
        String key = blankToNull(input.idempotencyKey()) == null
                ? "refund:" + UUID.randomUUID()
                : input.idempotencyKey().trim();
        if (eventRepository.findByPaymentIdAndIdempotencyKey(payment.getId(), key).isPresent()) {
            return view(payment, order.getOrderNumber());
        }
        if (payment.getStatus() != PaymentStatus.PAID && payment.getStatus() != PaymentStatus.PARTIALLY_REFUNDED) {
            throw new ConflictException("PAYMENT_NOT_REFUNDABLE", "Só pagamentos confirmados podem ser reembolsados.");
        }
        java.util.Map<String, String> errors = new java.util.LinkedHashMap<>();
        BigDecimal amount = null;
        try {
            amount = new BigDecimal(String.valueOf(input.amount()).trim()).setScale(2, RoundingMode.HALF_UP);
            if (amount.signum() <= 0) {
                errors.put("amount", "O valor do reembolso tem de ser positivo.");
            }
        } catch (NumberFormatException ex) {
            errors.put("amount", "Valor inválido.");
        }
        String reason = blankToNull(input.reason());
        if (reason == null || reason.length() < 3) {
            errors.put("reason", "Indique o motivo do reembolso.");
        }
        BigDecimal alreadyRefunded = new BigDecimal(refundedOf(payment.getId()));
        BigDecimal remaining = payment.getAmount().subtract(alreadyRefunded);
        if (amount != null && amount.signum() > 0 && amount.compareTo(remaining) > 0) {
            errors.put("amount", "O reembolso excede o valor ainda reembolsável (" + remaining.toPlainString() + " Kz).");
        }
        if (!errors.isEmpty()) {
            throw new InvalidRequestException(errors);
        }
        jdbc.update("INSERT INTO refund (payment_id, order_id, amount, reason, reference, created_by)"
                + " VALUES (?, ?, ?, ?, ?, ?)",
                payment.getId(), order.getId(), amount, reason, blankToNull(input.reference()), actorUserId);
        PaymentStatus from = payment.getStatus();
        PaymentStatus to = alreadyRefunded.add(amount).compareTo(payment.getAmount()) >= 0
                ? PaymentStatus.REFUNDED
                : PaymentStatus.PARTIALLY_REFUNDED;
        payment.setStatus(to);
        paymentRepository.save(payment);
        recordEvent(payment, from, to, actorUserId, actorLabel, key, reason);
        loyaltyService.reverseOnRefund(order, amount, payment.getAmount(), actorUserId, actorLabel);
        auditService.record(actorUserId, actorLabel, "payment.refunded", "payment", payment.getId().toString(),
                "Encomenda %s · reembolso %s Kz (%s → %s) · %s".formatted(
                        order.getOrderNumber(), amount.toPlainString(), from, to, reason));
        return view(payment, order.getOrderNumber());
    }

    /** Lista de reembolsos de uma encomenda (painel). */
    @Transactional(readOnly = true)
    public java.util.List<java.util.Map<String, Object>> refundsOf(String orderNumber) {
        return jdbc.queryForList(
                "SELECT r.amount::text AS \"amount\", r.reason AS \"reason\", r.reference AS \"reference\","
                        + " r.created_at AS \"createdAt\" FROM refund r JOIN customer_order o ON o.id = r.order_id"
                        + " WHERE o.order_number = ? ORDER BY r.created_at DESC", orderNumber);
    }

    /* ------------------------------ Internos ----------------------------- */

    /** Só PENDING/UNDER_REVIEW avança; o resto é conflito com o estado actual. */
    private static void validateTransition(PaymentStatus from, PaymentStatus to) {
        if (from == to) {
            throw new ConflictException(
                    "PAYMENT_UNCHANGED", "O pagamento já está no estado " + from + ".");
        }
        boolean allowed = (from == PaymentStatus.PENDING || from == PaymentStatus.UNDER_REVIEW)
                && (to == PaymentStatus.PAID || to == PaymentStatus.FAILED);
        if (!allowed) {
            throw new ConflictException(
                    "INVALID_PAYMENT_TRANSITION",
                    "Transição de pagamento inválida: " + from + " → " + to + ".");
        }
    }

    /** Confirmar o pagamento confirma a encomenda recebida (decisão #6). */
    private void confirmOrder(CustomerOrder order, ReviewDecision decision) {
        if (order.getStatus() == OrderStatus.RECEIVED) {
            OrderStatusTransitions.assertAllowed(OrderStatus.RECEIVED, OrderStatus.CONFIRMED);
            order.setStatus(OrderStatus.CONFIRMED);
            orderRepository.save(order);
            auditService.record(
                    decision.actorUserId(),
                    decision.actorLabel(),
                    "order.status_changed",
                    "customer_order",
                    order.getId().toString(),
                    "Encomenda %s · RECEIVED → CONFIRMED por confirmação de pagamento"
                            .formatted(order.getOrderNumber()));
        }
    }

    private void recordEvent(
            Payment payment,
            PaymentStatus from,
            PaymentStatus to,
            UUID actorUserId,
            String actorLabel,
            String idempotencyKey,
            String note) {
        PaymentEvent event = new PaymentEvent();
        event.setPaymentId(payment.getId());
        event.setIdempotencyKey(idempotencyKey);
        event.setFromStatus(from);
        event.setToStatus(to);
        event.setActorUserId(actorUserId);
        event.setActorLabel(actorLabel);
        event.setNote(note);
        eventRepository.save(event);
    }

    private PaymentView view(Payment payment, String orderNumber) {
        return new PaymentView(
                orderNumber,
                payment.getMethod().name(),
                payment.getAmount().setScale(2).toPlainString(),
                payment.getCurrency(),
                payment.getStatus().name(),
                payment.getReviewedAt() == null ? null : payment.getReviewedAt().toString(),
                payment.getReviewNote(),
                payment.getProofReference(),
                refundedOf(payment.getId()));
    }

    private static String blankToNull(String value) {
        return value == null || value.isBlank() ? null : value.trim();
    }

    /** Histórico de eventos do pagamento (leitura auxiliar para testes/painel). */
    @Transactional(readOnly = true)
    public List<PaymentEvent> eventsFor(Payment payment) {
        return eventRepository.findByPaymentIdOrderByCreatedAtDesc(payment.getId());
    }
}
