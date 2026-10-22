package com.lisscompany.loyalty;

import java.util.List;

import org.springframework.security.core.Authentication;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import com.lisscompany.identity.CustomerPrincipal;
import com.lisscompany.shared.error.UnauthorizedException;

/**
 * API de fidelização do cliente (fase 6).
 *
 * <p>Dois leituras, ambas privadas (o cliente vê apenas a própria conta):
 * o <em>resumo</em> — estado honesto do programa (não configurado, pausado,
 * activo), saldo, boas-vindas e elegibilidade de cada recompensa — e o
 * <em>histórico</em> de movimentos com a taxa em vigor em cada um.
 */
@RestController
@RequestMapping("/api/v1/loyalty")
public class LoyaltyController {

    private final LoyaltyService service;

    public LoyaltyController(LoyaltyService service) {
        this.service = service;
    }

    @GetMapping
    public LoyaltyService.SummaryView summary() {
        return service.summaryFor(principal().id());
    }

    @GetMapping("/transactions")
    public List<LoyaltyService.TransactionView> transactions() {
        return service.transactionsFor(principal().id());
    }

    private CustomerPrincipal principal() {
        Authentication authentication = SecurityContextHolder.getContext().getAuthentication();
        if (authentication == null || !(authentication.getPrincipal() instanceof CustomerPrincipal principal)) {
            throw new UnauthorizedException("NOT_AUTHENTICATED", "Sessão inválida. Volte a entrar.");
        }
        return principal;
    }
}
