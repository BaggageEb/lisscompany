package com.lisscompany.administration;

import java.util.List;
import java.util.Map;

import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

import com.lisscompany.audit.AuditService;
import com.lisscompany.identity.AppUser;
import com.lisscompany.orders.CustomerOrder;
import com.lisscompany.orders.CustomerOrderRepository;
import com.lisscompany.payments.PaymentService;
import com.lisscompany.shared.error.InvalidRequestException;
import com.lisscompany.shared.error.NotFoundException;
import com.lisscompany.shared.security.OwnerGuard;
import com.lisscompany.shared.security.Permissions;

/** Notas operacionais, histórico e reembolsos de uma encomenda (painel). */
@RestController
@RequestMapping("/api/v1/admin/orders/{orderNumber}")
public class AdminOrderOpsController {

    public record NoteRequest(String body) {}

    private final JdbcTemplate jdbc;
    private final CustomerOrderRepository orders;
    private final AuditService audit;
    private final PaymentService payments;
    private final OwnerGuard guard;

    public AdminOrderOpsController(
            JdbcTemplate jdbc, CustomerOrderRepository orders, AuditService audit, PaymentService payments,
            OwnerGuard guard) {
        this.jdbc = jdbc;
        this.orders = orders;
        this.audit = audit;
        this.payments = payments;
        this.guard = guard;
    }

    private CustomerOrder order(String number) {
        return orders.findByOrderNumber(number)
                .orElseThrow(() -> new NotFoundException("ORDER_NOT_FOUND", "Encomenda não encontrada."));
    }

    @GetMapping("/notes")
    @Transactional(readOnly = true)
    public List<Map<String, Object>> notes(@PathVariable String orderNumber) {
        guard.current(Permissions.ORDERS_VIEW);
        return jdbc.queryForList(
                "SELECT author AS \"author\", body AS \"body\", created_at AS \"createdAt\" FROM order_note"
                        + " WHERE order_id = ? ORDER BY created_at DESC", order(orderNumber).getId());
    }

    @PostMapping("/notes")
    @ResponseStatus(HttpStatus.CREATED)
    @Transactional
    public List<Map<String, Object>> addNote(@PathVariable String orderNumber, @RequestBody NoteRequest request) {
        AppUser actor = guard.current(Permissions.ORDERS_MANAGE);
        String body = request.body() == null ? "" : request.body().trim();
        if (body.length() < 2 || body.length() > 1000) {
            throw new InvalidRequestException(Map.of("body", "A nota deve ter entre 2 e 1000 caracteres."));
        }
        CustomerOrder order = order(orderNumber);
        jdbc.update("INSERT INTO order_note (order_id, author_id, author, body) VALUES (?, ?, ?, ?)",
                order.getId(), actor.getId(), actor.getDisplayName(), body);
        audit.record(actor.getId(), actor.getEmail(), "order.note_added", "customer_order", order.getId().toString(),
                "Nota operacional adicionada à encomenda " + order.getOrderNumber());
        return notes(orderNumber);
    }

    @GetMapping("/history")
    @Transactional(readOnly = true)
    public List<Map<String, Object>> history(@PathVariable String orderNumber) {
        guard.current(Permissions.ORDERS_VIEW);
        CustomerOrder order = order(orderNumber);
        return jdbc.queryForList(
                "SELECT action AS \"action\", actor_label AS \"actor\", details AS \"details\","
                        + " created_at AS \"createdAt\" FROM audit_log WHERE entity_type = 'customer_order'"
                        + " AND entity_id = ? ORDER BY id DESC", order.getId().toString());
    }

    @GetMapping("/refunds")
    public List<Map<String, Object>> refunds(@PathVariable String orderNumber) {
        guard.current(Permissions.ORDERS_VIEW);
        return payments.refundsOf(orderNumber);
    }

    @PostMapping("/refund")
    public PaymentService.PaymentView refund(
            @PathVariable String orderNumber, @RequestBody PaymentService.RefundInput input) {
        AppUser actor = guard.current(Permissions.PAYMENTS_REFUND);
        return payments.refund(orderNumber, input, actor.getId(), actor.getEmail());
    }
}
