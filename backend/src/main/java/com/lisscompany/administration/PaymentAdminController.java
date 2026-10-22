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
import com.lisscompany.payments.PaymentService;
import com.lisscompany.payments.PaymentStatus;
import com.lisscompany.shared.error.UnauthorizedException;
import com.lisscompany.shared.security.OwnerGuard;

import jakarta.validation.Valid;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;

/**
 * Revisão manual de pagamentos (fase 5, decisões #4 e #5): sem fornecedor
 * automático, o pagamento só é confirmado/rejeitado por conta autorizada.
 *
 * <p>{@code POST .../review} aceita {@code target: PAID | FAILED}. O campo
 * {@code idempotencyKey} torna o pedido repetível: o reenvio devolve o estado
 * actual sem duplicar efeitos (constraint única na base).
 */
@RestController
@RequestMapping("/api/v1/admin/payments")
public class PaymentAdminController {

    public record ReviewRequest(
            @NotNull(message = "Indique o resultado da revisão.") PaymentStatus target,
            @Size(max = 500, message = "Nota demasiado longa.") String note,
            @Size(max = 120, message = "Chave de idempotência demasiado longa.") String idempotencyKey) {}

    private final PaymentService paymentService;
    private final OwnerGuard ownerGuard;

    public PaymentAdminController(PaymentService paymentService, OwnerGuard ownerGuard) {
        this.paymentService = paymentService;
        this.ownerGuard = ownerGuard;
    }

    /**
     * Fila de pagamentos para o painel (fase 7) — mais recentes primeiro,
     * com filtro opcional por estado ({@code ?status=PENDING}).
     */
    @GetMapping
    public List<PaymentService.PaymentAdminView> list(
            @RequestParam(name = "status", required = false) PaymentStatus status) {
        ownerGuard.requireOwner(principal().id());
        return paymentService.listForPanel(status);
    }

    /** Pagamento de uma encomenda (visível a contas autorizadas). */
    @GetMapping("/{orderNumber}")
    public PaymentService.PaymentView get(@PathVariable String orderNumber) {
        ownerGuard.requireOwner(principal().id());
        return paymentService.viewForOrder(orderNumber);
    }

    /** Confirma (PAID) ou rejeita (FAILED) o pagamento — decide o stock e a encomenda. */
    @PostMapping("/{orderNumber}/review")
    @ResponseStatus(HttpStatus.OK)
    public PaymentService.PaymentView review(
            @PathVariable String orderNumber, @Valid @RequestBody ReviewRequest request) {
        CustomerPrincipal principal = principal();
        ownerGuard.requireOwner(principal.id());
        return paymentService.review(new PaymentService.ReviewDecision(
                orderNumber, request.target(), request.note(), request.idempotencyKey(),
                principal.id(), principal.email()));
    }

    /** Stock gerido (painel): vive no AdminInventoryController. */

    private CustomerPrincipal principal() {
        org.springframework.security.core.Authentication authentication =
                org.springframework.security.core.context.SecurityContextHolder.getContext().getAuthentication();
        if (authentication == null || !(authentication.getPrincipal() instanceof CustomerPrincipal principal)) {
            throw new UnauthorizedException("NOT_AUTHENTICATED", "Sessão inválida. Volte a entrar.");
        }
        return principal;
    }
}
