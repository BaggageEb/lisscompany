package com.lisscompany.administration;

import java.util.List;

import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

import com.lisscompany.identity.CustomerPrincipal;
import com.lisscompany.orders.OrderService;
import com.lisscompany.orders.OrderStatus;
import com.lisscompany.payments.PaymentStatus;
import com.lisscompany.shared.error.UnauthorizedException;
import com.lisscompany.shared.security.OwnerGuard;

import jakarta.validation.Valid;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;

/**
 * API administrativa de encomendas (fase 5 — a UI do painel é a fase 7).
 *
 * <p>Sessão autenticada <strong>e</strong> conta autorizada ({@link OwnerGuard}).
 * O cliente nunca chega aqui: as transições são validadas no servidor pela
 * máquina de estados e cada mudança gera auditoria. O painel lê por aqui a
 * lista, o detalhe e as transições possíveis — nenhum dado sai sem o guard.
 */
@RestController
@RequestMapping("/api/v1/admin/orders")
public class AdminOrderController {

    public record TransitionRequest(
            @NotNull(message = "Indique o estado de destino.") OrderStatus target,
            @Size(max = 500, message = "Nota demasiado longa.") String note) {}

    private final OrderService service;
    private final OwnerGuard ownerGuard;

    public AdminOrderController(OrderService service, OwnerGuard ownerGuard) {
        this.service = service;
        this.ownerGuard = ownerGuard;
    }

    /** Lista de encomendas do painel (fase 7), com filtros opcionais por estado. */
    @GetMapping
    public List<OrderService.AdminOrderSummaryView> list(
            @RequestParam(name = "status", required = false) OrderStatus status,
            @RequestParam(name = "paymentStatus", required = false) PaymentStatus paymentStatus) {
        ownerGuard.requireOwner(principal().id());
        return service.listForPanel(status, paymentStatus);
    }

    /** Detalhe de qualquer encomenda + transições que a máquina de estados aceita. */
    @GetMapping("/{orderNumber}")
    public OrderService.AdminOrderDetailView detail(@PathVariable String orderNumber) {
        ownerGuard.requireOwner(principal().id());
        return service.getForPanel(orderNumber);
    }

    @PostMapping("/{orderNumber}/status")
    @ResponseStatus(HttpStatus.OK)
    public OrderService.OrderView transition(
            @PathVariable String orderNumber, @Valid @RequestBody TransitionRequest request) {
        CustomerPrincipal principal = principal();
        ownerGuard.requireOwner(principal.id());
        return service.transition(principal, orderNumber, request.target(), request.note());
    }

    private CustomerPrincipal principal() {
        org.springframework.security.core.Authentication authentication =
                org.springframework.security.core.context.SecurityContextHolder.getContext().getAuthentication();
        if (authentication == null || !(authentication.getPrincipal() instanceof CustomerPrincipal principal)) {
            throw new UnauthorizedException("NOT_AUTHENTICATED", "Sessão inválida. Volte a entrar.");
        }
        return principal;
    }
}
