package com.lisscompany.administration;

import java.util.List;
import java.util.UUID;

import org.springframework.http.HttpStatus;
import org.springframework.security.core.Authentication;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

import com.lisscompany.identity.AppUser;
import com.lisscompany.identity.AppUserRepository;
import com.lisscompany.identity.CustomerPrincipal;
import com.lisscompany.loyalty.LoyaltyService;
import com.lisscompany.promotions.DiscountService;
import com.lisscompany.shared.error.NotFoundException;
import com.lisscompany.shared.error.UnauthorizedException;
import com.lisscompany.shared.security.OwnerGuard;

import jakarta.validation.Valid;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;

/**
 * Configuração administrativa da fidelização (fase 6 — painel da loja na
 * fase 7, aqui a API que o painel vai usar).
 *
 * <p>Regra de ouro desta fase: <strong>nada vem por omissão</strong>. As
 * taxas, arredondamentos, valores de recompensa e prioridades de desconto são
 * escolhas explícitas da proprietária, guardadas na configuração e com
 * histórico no {@code audit_log}. Todos os endpoints exigem conta autorizada
 * ({@link OwnerGuard}) — um cliente comum nunca configura o programa.
 */
@RestController
@RequestMapping("/api/v1/admin/loyalty")
public class AdminLoyaltyController {

    public record AdjustmentRequest(
            @NotNull(message = "Indique os pontos a ajustar (positivo ou negativo).") Integer points,
            @Size(max = 200, message = "Nota demasiado longa.") String note) {}

    private final LoyaltyService loyaltyService;
    private final DiscountService discountService;
    private final OwnerGuard ownerGuard;
    private final AppUserRepository userRepository;

    public AdminLoyaltyController(
            LoyaltyService loyaltyService,
            DiscountService discountService,
            OwnerGuard ownerGuard,
            AppUserRepository userRepository) {
        this.loyaltyService = loyaltyService;
        this.discountService = discountService;
        this.ownerGuard = ownerGuard;
        this.userRepository = userRepository;
    }

    /** Configuração em vigor: regra de fidelização + recompensas. */
    @GetMapping("/config")
    public LoyaltyService.ConfigView config() {
        ownerGuard.requireOwner(principal().id());
        return loyaltyService.config();
    }

    /** Regra de descontos (boas-vindas/recompensas) com prioridades (#11). */
    @GetMapping("/config/discounts")
    public List<DiscountService.RuleView> discounts() {
        ownerGuard.requireOwner(principal().id());
        return discountService.list();
    }

    /** Cria/actualiza a regra de fidelização (linha única — todos os campos). */
    @PutMapping("/config/rule")
    public LoyaltyService.RuleView configureRule(@Valid @RequestBody LoyaltyService.RuleInput input) {
        AppUser actor = ownerGuard.requireOwner(principal().id());
        return loyaltyService.configureRule(input, actor);
    }

    /** Cria/actualiza uma recompensa por código (upsert). */
    @PostMapping("/config/rewards")
    @ResponseStatus(HttpStatus.OK)
    public LoyaltyService.RewardView upsertReward(@Valid @RequestBody LoyaltyService.RewardInput input) {
        AppUser actor = ownerGuard.requireOwner(principal().id());
        return loyaltyService.upsertReward(input, actor);
    }

    /** Cria/actualiza uma regra de desconto por código (upsert). */
    @PostMapping("/config/discounts")
    @ResponseStatus(HttpStatus.OK)
    public DiscountService.RuleView upsertDiscount(@Valid @RequestBody DiscountService.RuleInput input) {
        AppUser actor = ownerGuard.requireOwner(principal().id());
        return discountService.configure(input, actor);
    }

    /** Contas de fidelização e saldos — leitura do painel. */
    @GetMapping("/accounts")
    public List<LoyaltyService.AccountView> accounts() {
        ownerGuard.requireOwner(principal().id());
        return loyaltyService.accounts();
    }

    /**
     * Ajuste manual de pontos de um cliente (estorno/correção da política
     * manual de reembolso — decisão #7: nenhum estorno automático implícito).
     */
    @PostMapping("/accounts/{userId}/adjustment")
    @ResponseStatus(HttpStatus.OK)
    public LoyaltyService.TransactionView adjust(
            @PathVariable UUID userId, @RequestBody AdjustmentRequest request) {
        AppUser actor = ownerGuard.requireOwner(principal().id());
        // O alvo é uma conta REAL — nunca um identificador inventado.
        userRepository.findById(userId)
                .orElseThrow(() -> new NotFoundException("USER_NOT_FOUND", "Conta não encontrada."));
        return loyaltyService.adjust(userId, request.points(), request.note(), actor);
    }

    private CustomerPrincipal principal() {
        Authentication authentication = SecurityContextHolder.getContext().getAuthentication();
        if (authentication == null || !(authentication.getPrincipal() instanceof CustomerPrincipal principal)) {
            throw new UnauthorizedException("NOT_AUTHENTICATED", "Sessão inválida. Volte a entrar.");
        }
        return principal;
    }
}
