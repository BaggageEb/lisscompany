package com.lisscompany.loyalty;

import java.math.BigDecimal;
import java.math.RoundingMode;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;

import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import com.lisscompany.audit.AuditService;
import com.lisscompany.identity.AppUser;
import com.lisscompany.identity.AppUserRepository;
import com.lisscompany.identity.CustomerPrincipal;
import com.lisscompany.orders.CustomerOrder;
import com.lisscompany.orders.CustomerOrderRepository;
import com.lisscompany.orders.OrderStatus;
import com.lisscompany.promotions.DiscountApplication;
import com.lisscompany.promotions.DiscountApplicationRepository;
import com.lisscompany.promotions.DiscountRule;
import com.lisscompany.promotions.DiscountService;
import com.lisscompany.promotions.DiscountSource;
import com.lisscompany.shared.error.ConflictException;
import com.lisscompany.shared.error.InvalidRequestException;
import com.lisscompany.shared.error.NotFoundException;
import com.lisscompany.shared.error.ResourceNotConfiguredException;

/**
 * Fidelização (fase 6 — decisões #8–#14).
 *
 * <p>O princípio de ouro desta fase: <strong>nenhum valor de negócio é
 * presumido</strong>. As taxas, conversões, valores e limiares vivem em
 * regras configuradas pela proprietária; enquanto não existem, o programa
 * está “por configurar”, ninguém ganha nem gasta pontos e a API diz isso em
 * vez de fingir que calcula.
 *
 * <p>Os três momentos do ciclo:
 * <ol>
 *   <li><strong>Resgate na encomenda</strong> ({@link #evaluate} +
 *       {@link #recordRedemption}): o cliente usa pontos OU uma recompensa;
 *       exactamente UM desconto pega na encomenda (#11).</li>
 *   <li><strong>Crédito no pagamento</strong> ({@link #creditFor}): confirmado
 *       o pagamento (PAID), o valor elegível (após descontos, sem entrega)
 *       converte-se em pontos pela taxa em vigor — idempotente por encomenda.</li>
 *   <li><strong>Leitura</strong> ({@link #summaryFor}): saldo, regras em
 *       vigor e elegibilidade, sempre em estados honestos (não configurado,
 *       inactivo, elegível, não elegível).</li>
 * </ol>
 *
 * <p>Pontos invariantes (decisão #9): o saldo é sempre pontos inteiros e cada
 * movimento arquiva a taxa em vigor naquele momento — mudar a conversão
 * posteriormente nunca reescreve histórico nem balanços.
 */
@Service
public class LoyaltyService {

    /** Rótulo do desconto feito com pontos (gerado no servidor). */
    static final String POINTS_LABEL = "Pontos de fidelização";

    private final LoyaltyRuleRepository ruleRepository;
    private final LoyaltyAccountRepository accountRepository;
    private final LoyaltyTransactionRepository transactionRepository;
    private final RewardRuleRepository rewardRuleRepository;
    private final RewardRedemptionRepository redemptionRepository;
    private final DiscountService discountService;
    private final DiscountApplicationRepository applicationRepository;
    private final CustomerOrderRepository orderRepository;
    private final AppUserRepository userRepository;
    private final AuditService auditService;

    public LoyaltyService(
            LoyaltyRuleRepository ruleRepository,
            LoyaltyAccountRepository accountRepository,
            LoyaltyTransactionRepository transactionRepository,
            RewardRuleRepository rewardRuleRepository,
            RewardRedemptionRepository redemptionRepository,
            DiscountService discountService,
            DiscountApplicationRepository applicationRepository,
            CustomerOrderRepository orderRepository,
            AppUserRepository userRepository,
            AuditService auditService) {
        this.ruleRepository = ruleRepository;
        this.accountRepository = accountRepository;
        this.transactionRepository = transactionRepository;
        this.rewardRuleRepository = rewardRuleRepository;
        this.redemptionRepository = redemptionRepository;
        this.discountService = discountService;
        this.applicationRepository = applicationRepository;
        this.orderRepository = orderRepository;
        this.userRepository = userRepository;
        this.auditService = auditService;
    }

    /* ------------------------------- Views ------------------------------- */

    public record RuleView(
            String earnPercent,
            String pointValueKz,
            String rounding,
            boolean allowPartialRedemption,
            boolean active,
            String updatedAt) {}

    public record RuleInput(
            String earnPercent,
            String pointValueKz,
            String rounding,
            Boolean allowPartialRedemption,
            Boolean active) {}

    public record RewardView(
            String code,
            String description,
            Integer minPoints,
            Integer minOrders,
            String discountAmount,
            int maxPerCustomer,
            boolean active) {}

    public record RewardInput(
            String code,
            String description,
            Integer minPoints,
            Integer minOrders,
            String discountAmount,
            Integer maxPerCustomer,
            Boolean active) {}

    /** Estado de uma recompensa para UM cliente (resumo do painel de cliente). */
    public record RewardStatusView(RewardView reward, boolean eligible, String reason, int redeemedCount) {}

    public record WelcomeView(boolean eligible, String percent, String label) {}

    public record SummaryView(
            boolean configured,
            boolean active,
            Integer pointsBalance,
            Integer lifetimePoints,
            String earnPercent,
            String pointValueKz,
            String rounding,
            Boolean allowPartialRedemption,
            WelcomeView welcome,
            List<RewardStatusView> rewards) {}

    public record TransactionView(
            String type,
            int points,
            String amountKz,
            String rateKind,
            String rateUsed,
            String orderNumber,
            String note,
            String createdAt) {}

    public record AccountView(
            String userId,
            String email,
            String displayName,
            int pointsBalance,
            int lifetimePoints,
            String updatedAt) {}

    public record ConfigView(RuleView rule, List<RewardView> rewards) {}

    /** Desconto escolhido na avaliação — levado até à gravação na encomenda. */
    public record AppliedDiscount(
            DiscountSource source,
            String label,
            UUID discountRuleId,
            UUID rewardRuleId,
            BigDecimal amount,
            int pointsSpent) {}

    /* ------------------------------ Resumo ------------------------------- */

    /**
     * Resumo do programa para um cliente: estado honesto da configuração,
     * saldo, boas-vindas e elegibilidade de cada recompensa (com o motivo de
     * indisponibilidade — nunca uma promessa vazia).
     */
    @Transactional(readOnly = true)
    public SummaryView summaryFor(UUID userId) {
        Optional<LoyaltyRule> maybeRule = ruleRepository.findTopByOrderByIdDesc();
        LoyaltyRule rule = maybeRule.orElse(null);
        RuleView ruleView = rule == null ? null : ruleView(rule);
        LoyaltyAccount account = accountRepository.findByUserId(userId).orElse(null);
        int balance = account == null ? 0 : account.getPointsBalance();
        long orders = orderRepository.countByUserIdAndStatusNot(userId, OrderStatus.CANCELLED);
        boolean programActive = rule != null && rule.isActive();

        WelcomeView welcome = welcomeView(userId, orders);

        List<RewardStatusView> rewards = rewardRuleRepository.findByActiveTrueOrderByCodeAsc().stream()
                .map(reward -> {
                    int redeemed = redeemedCount(account, reward);
                    String reason = programActive ? null : inactiveReason(rule);
                    if (reason == null) {
                        reason = ineligibleReason(reward, balance, orders, redeemed);
                    }
                    return new RewardStatusView(rewardView(reward), reason == null, reason, redeemed);
                })
                .toList();

        return new SummaryView(
                rule != null,
                programActive,
                account == null ? 0 : account.getPointsBalance(),
                account == null ? 0 : account.getLifetimePoints(),
                ruleView == null ? null : ruleView.earnPercent(),
                ruleView == null ? null : ruleView.pointValueKz(),
                ruleView == null ? null : ruleView.rounding(),
                ruleView == null ? null : ruleView.allowPartialRedemption(),
                welcome,
                rewards);
    }

    /** Histórico de pontos do cliente (mais recente primeiro). */
    @Transactional(readOnly = true)
    public List<TransactionView> transactionsFor(UUID userId) {
        Optional<LoyaltyAccount> account = accountRepository.findByUserId(userId);
        if (account.isEmpty()) {
            return List.of();
        }
        List<LoyaltyTransaction> transactions =
                transactionRepository.findByAccountIdOrderByCreatedAtDesc(account.get().getId());
        // Números das encomendas em lote — a lista do cliente nunca faz N+1.
        Map<UUID, String> orderNumbers = new LinkedHashMap<>();
        List<UUID> orderIds = transactions.stream()
                .map(LoyaltyTransaction::getOrderId)
                .filter(java.util.Objects::nonNull)
                .toList();
        if (!orderIds.isEmpty()) {
            orderRepository.findAllById(orderIds)
                    .forEach(order -> orderNumbers.put(order.getId(), order.getOrderNumber()));
        }
        List<TransactionView> views = new ArrayList<>(transactions.size());
        for (LoyaltyTransaction transaction : transactions) {
            views.add(new TransactionView(
                    transaction.getType().name(),
                    transaction.getPoints(),
                    transaction.getAmountKz().setScale(2, RoundingMode.HALF_UP).toPlainString(),
                    transaction.getRateKind().name(),
                    transaction.getRateUsed().toPlainString(),
                    transaction.getOrderId() == null ? null : orderNumbers.get(transaction.getOrderId()),
                    transaction.getNote(),
                    transaction.getCreatedAt().toString()));
        }
        return views;
    }

    /* ----------------------------- Configuração -------------------------- */

    /** Configuração em vigor + recompensas (leitura administrativa). */
    @Transactional(readOnly = true)
    public ConfigView config() {
        RuleView rule = ruleRepository.findTopByOrderByIdDesc().map(this::ruleView).orElse(null);
        List<RewardView> rewards = rewardRuleRepository.findAllByOrderByCodeAsc().stream()
                .map(this::rewardView)
                .toList();
        return new ConfigView(rule, rewards);
    }

    /**
     * Cria/actualiza a regra de fidelização (upsert da linha única). Todos os
     * campos são obrigatórios e validados — nenhum default é inventado aqui
     * nem na base.
     */
    @Transactional
    public RuleView configureRule(RuleInput input, AppUser actor) {
        Map<String, String> errors = new LinkedHashMap<>();

        BigDecimal earnPercent = decimal(input.earnPercent(), "earnPercent", errors);
        if (earnPercent != null
                && (earnPercent.signum() <= 0 || earnPercent.compareTo(new BigDecimal("100")) > 0)) {
            errors.put("earnPercent", "A acumulação tem de estar entre 0 e 100%.");
        }
        BigDecimal pointValue = decimal(input.pointValueKz(), "pointValueKz", errors);
        if (pointValue != null && pointValue.signum() <= 0) {
            errors.put("pointValueKz", "O valor do ponto tem de ser positivo.");
        }
        String rounding = input.rounding() == null ? null : input.rounding().trim().toUpperCase();
        if (!"DOWN".equals(rounding) && !"HALF_UP".equals(rounding)) {
            errors.put("rounding", "Arredondamento inválido: escolha DOWN ou HALF_UP.");
        }
        if (input.allowPartialRedemption() == null) {
            errors.put("allowPartialRedemption", "Indique se o resgate parcial é permitido (sim/não).");
        }
        if (input.active() == null) {
            errors.put("active", "Indique se o programa está activo (sim/não).");
        }
        if (!errors.isEmpty()) {
            throw new InvalidRequestException(errors);
        }

        LoyaltyRule rule = ruleRepository.findTopByOrderByIdDesc().orElseGet(LoyaltyRule::new);
        if (rule.getId() == null) {
            rule.setCreatedBy(actor.getId());
        }
        rule.setEarnPercent(earnPercent);
        rule.setPointValueKz(pointValue);
        rule.setRounding(rounding);
        rule.setAllowPartialRedemption(input.allowPartialRedemption());
        rule.setActive(input.active());
        rule.setUpdatedBy(actor.getId());
        LoyaltyRule saved = ruleRepository.save(rule);

        auditService.record(
                actor.getId(),
                actor.getEmail(),
                "loyalty.rule_changed",
                "loyalty_rule",
                saved.getId().toString(),
                "Acumulação %s%% · ponto %s Kz · arredondamento %s · resgate parcial %s · programa %s"
                        .formatted(
                                saved.getEarnPercent().toPlainString(),
                                saved.getPointValueKz().toPlainString(),
                                saved.getRounding(),
                                saved.isAllowPartialRedemption() ? "permitido" : "total",
                                saved.isActive() ? "activado" : "desactivado"));

        return ruleView(saved);
    }

    /** Cria/actualiza uma recompensa por código (upsert do painel). */
    @Transactional
    public RewardView upsertReward(RewardInput input, AppUser actor) {
        Map<String, String> errors = new LinkedHashMap<>();
        String code = input.code() == null || input.code().isBlank() ? null : input.code().trim().toUpperCase();
        String description =
                input.description() == null || input.description().isBlank() ? null : input.description().trim();
        if (code == null) {
            errors.put("code", "O código da recompensa é obrigatório.");
        }
        if (description == null) {
            errors.put("description", "A descrição é obrigatória (é o rótulo que o cliente vê).");
        }
        if (input.minPoints() == null && input.minOrders() == null) {
            errors.put("minPoints", "Defina um limiar de pontos, de encomendas, ou ambos.");
        }
        if (input.minPoints() != null && input.minPoints() < 1) {
            errors.put("minPoints", "O limiar de pontos tem de ser pelo menos 1.");
        }
        if (input.minOrders() != null && input.minOrders() < 1) {
            errors.put("minOrders", "O limiar de encomendas tem de ser pelo menos 1.");
        }
        BigDecimal discountAmount = decimal(input.discountAmount(), "discountAmount", errors);
        if (discountAmount != null && discountAmount.signum() <= 0) {
            errors.put("discountAmount", "O valor da recompensa tem de ser positivo.");
        }
        if (input.maxPerCustomer() == null || input.maxPerCustomer() < 1) {
            errors.put("maxPerCustomer", "Utilizações por cliente: pelo menos 1 (1 = utilização única).");
        }
        if (input.active() == null) {
            errors.put("active", "Indique se a recompensa está activa (sim/não).");
        }
        if (!errors.isEmpty()) {
            throw new InvalidRequestException(errors);
        }

        RewardRule reward = rewardRuleRepository.findByCode(code).orElseGet(RewardRule::new);
        reward.setCode(code);
        reward.setDescription(description);
        reward.setMinPoints(input.minPoints());
        reward.setMinOrders(input.minOrders());
        reward.setDiscountAmount(discountAmount);
        reward.setMaxPerCustomer(input.maxPerCustomer());
        reward.setActive(input.active());
        RewardRule saved = rewardRuleRepository.save(reward);

        auditService.record(
                actor.getId(),
                actor.getEmail(),
                "loyalty.reward_rule_changed",
                "reward_rule",
                saved.getId().toString(),
                "Recompensa %s · desconto %s Kz · pontos mínimos %s · encomendas mínimas %s · limite %d · %s"
                        .formatted(
                                saved.getCode(),
                                saved.getDiscountAmount(),
                                saved.getMinPoints(),
                                saved.getMinOrders(),
                                saved.getMaxPerCustomer(),
                                saved.isActive() ? "activa" : "inactiva"));

        return rewardView(saved);
    }

    /* ----------------------- Contas (leitura/ajuste) --------------------- */

    @Transactional(readOnly = true)
    public List<AccountView> accounts() {
        List<LoyaltyAccount> accounts = accountRepository.findAll();
        Map<UUID, AppUser> users = new LinkedHashMap<>();
        userRepository.findAllById(accounts.stream().map(LoyaltyAccount::getUserId).toList())
                .forEach(user -> users.put(user.getId(), user));
        return accounts.stream()
                .map(account -> {
                    AppUser user = users.get(account.getUserId());
                    return new AccountView(
                            account.getUserId().toString(),
                            user == null ? null : user.getEmail(),
                            user == null ? null : user.getDisplayName(),
                            account.getPointsBalance(),
                            account.getLifetimePoints(),
                            account.getUpdatedAt().toString());
                })
                .toList();
    }

    /**
     * Ajuste manual de pontos (painel) — a ferramenta de correção/estorno da
     * política manual de reembolso (#7): nenhum estorno automático está
     * implícito, o operador decide e fica registado no livro-razão.
     */
    @Transactional
    public TransactionView adjust(UUID userId, int points, String note, AppUser actor) {
        if (points == 0) {
            throw new InvalidRequestException(Map.of("points", "Indique um número de pontos diferente de zero."));
        }
        // O movimento precisa de uma taxa em vigor para se arquivar honestamente:
        // sem programa configurado não há valor de ponto que arquivar.
        LoyaltyRule rule = ruleRepository.findTopByOrderByIdDesc()
                .orElseThrow(() -> new ResourceNotConfiguredException(
                        "LOYALTY_NOT_CONFIGURED",
                        "Configure o programa de fidelização antes de fazer ajustes manuais."));
        LoyaltyAccount account = accountFor(userId);
        int resulting = account.getPointsBalance() + points;
        if (resulting < 0) {
            throw new InvalidRequestException(Map.of(
                    "points",
                    "O ajuste deixaria o saldo negativo (saldo actual: " + account.getPointsBalance() + " pontos)."));
        }

        account.apply(points);
        accountRepository.save(account);

        LoyaltyTransaction saved = saveTransaction(account, null, LoyaltyTransactionType.ADJUSTMENT,
                points, LoyaltyRateKind.POINT_VALUE, rule.getPointValueKz(),
                pointsValue(points, rule.getPointValueKz()),
                note == null || note.isBlank() ? "Ajuste manual do painel" : note.trim(),
                actor.getId());

        auditService.record(
                actor.getId(),
                actor.getEmail(),
                "loyalty.adjustment",
                "loyalty_account",
                account.getId().toString(),
                "Ajuste de %+d pontos · saldo %d · %s"
                        .formatted(points, account.getPointsBalance(), saved.getNote()));

        return new TransactionView(
                saved.getType().name(),
                saved.getPoints(),
                saved.getAmountKz().setScale(2, RoundingMode.HALF_UP).toPlainString(),
                saved.getRateKind().name(),
                saved.getRateUsed().toPlainString(),
                null,
                saved.getNote(),
                saved.getCreatedAt().toString());
    }

    /* ------------------------- Resgate na encomenda ---------------------- */

    /**
     * Avalia o desconto de fidelização pedido numa nova encomenda, <em>antes</em>
     * de ela existir. Puro: valida e devolve — nada é mutado (a gravação é
     * {@link #recordRedemption} depois da encomenda persistida).
     *
     * <p>Regra de precedência documentada: escolha explícita do cliente
     * (pontos ou recompensa) vence a automática (boas-vindas); dois pedidos
     * explícitos são rejeitados — a encomenda só aceita UM desconto (#11).
     */
    @Transactional
    public AppliedDiscount evaluate(UUID userId, BigDecimal subtotal, int pointsRequested, String rewardCode) {
        boolean wantsPoints = pointsRequested > 0;
        boolean wantsReward = rewardCode != null && !rewardCode.isBlank();
        LoyaltyRule rule = ruleRepository.findTopByOrderByIdDesc().orElse(null);

        if (wantsPoints || wantsReward) {
            if (rule == null) {
                throw new ResourceNotConfiguredException(
                        "LOYALTY_NOT_CONFIGURED",
                        "O programa de fidelização ainda não foi configurado pela loja.");
            }
            if (!rule.isActive()) {
                throw new ConflictException(
                        "LOYALTY_INACTIVE", "O programa de fidelização está actualmente pausado.");
            }
            if (wantsPoints && wantsReward) {
                throw new InvalidRequestException(Map.of(
                        "pointsToSpend",
                        "Só é possível um desconto por encomenda: escolha usar os pontos OU a recompensa."));
            }
        }

        if (wantsPoints) {
            return pointsDiscount(userId, subtotal, pointsRequested, rule);
        }
        if (wantsReward) {
            return rewardDiscount(userId, subtotal, rewardCode.trim(), rule);
        }
        // Sem pedido explícito: desconto automático de boas-vindas, se elegível.
        return welcomeDiscount(userId, subtotal);
    }

    /**
     * Grava o desconto escolhido numa encomenda já persistida (mesma
     * transacção da criação): livro-razão de pontos, aplicação do desconto e
     * resgate da recompensa — ou tudo, ou nada.
     */
    @Transactional
    public void recordRedemption(CustomerOrder order, AppliedDiscount applied, CustomerPrincipal principal) {
        if (applied == null) {
            return;
        }
        if (applied.pointsSpent() > 0) {
            LoyaltyRule rule = ruleRepository
                    .findTopByOrderByIdDesc()
                    .orElseThrow(() -> new ResourceNotConfiguredException(
                            "LOYALTY_NOT_CONFIGURED", "O programa de fidelização não está configurado."));
            LoyaltyAccount account = accountFor(principal.id());
            account.apply(-applied.pointsSpent());
            accountRepository.save(account);

            saveTransaction(
                    account,
                    order.getId(),
                    LoyaltyTransactionType.REDEEM,
                    -applied.pointsSpent(),
                    LoyaltyRateKind.POINT_VALUE,
                    rule.getPointValueKz(),
                    applied.amount(),
                    "Resgate na encomenda " + order.getOrderNumber(),
                    principal.id());

            auditService.record(
                    principal.id(),
                    principal.email(),
                    "loyalty.points_redeemed",
                    "customer_order",
                    order.getId().toString(),
                    "Encomenda %s · −%d pontos · desconto %s Kz · saldo %d"
                            .formatted(
                                    order.getOrderNumber(),
                                    applied.pointsSpent(),
                                    applied.amount().setScale(2, RoundingMode.HALF_UP),
                                    account.getPointsBalance()));
        }

        discountService.recordApplication(
                order.getId(),
                applied.discountRuleId(),
                applied.source(),
                applied.label(),
                applied.amount(),
                applied.pointsSpent());

        if (applied.source() == DiscountSource.REWARD) {
            LoyaltyAccount account = accountFor(principal.id());
            RewardRedemption redemption = new RewardRedemption();
            redemption.setOrderId(order.getId());
            redemption.setAccountId(account.getId());
            redemption.setRewardRuleId(applied.rewardRuleId());
            redemption.setDiscountAmount(applied.amount());
            redemptionRepository.save(redemption);

            auditService.record(
                    principal.id(),
                    principal.email(),
                    "reward.redeemed",
                    "reward_rule",
                    applied.rewardRuleId().toString(),
                    "Recompensa usada na encomenda %s · desconto %s Kz"
                            .formatted(order.getOrderNumber(), applied.amount().setScale(2, RoundingMode.HALF_UP)));
        }
    }

    /* --------------------------- Cancelamento ---------------------------- */

    /**
     * A encomenda foi cancelada ANTES da confirmação (decisão #7): o que o
     * cliente gastou na resgate volta — pontos devolvidos e recompensa uma
     * vez mais disponível. Nada disto é um reembolso de pagamento (que
     * continua manual); é simplesmente não consumir o que nunca chegou a
     * acontecer. Um estorno de encomenda já PAGA continua a ser ajuste
     * manual do painel — nunca automático.
     */
    @Transactional
    public void refundOnCancel(CustomerOrder order, UUID actorUserId, String actorLabel) {
        redemptionRepository.deleteByOrderId(order.getId());
        if (order.getPointsSpent() <= 0) {
            return;
        }
        // No fluxo da API, pontos só podem ter sido gastos com uma regra em
        // vigor — mas o ajuste não pode nunca bloquear um cancelamento.
        LoyaltyRule rule = ruleRepository.findTopByOrderByIdDesc().orElse(null);
        BigDecimal rate = rule == null ? BigDecimal.ONE : rule.getPointValueKz();

        LoyaltyAccount account = accountFor(order.getUserId());
        account.apply(order.getPointsSpent());
        accountRepository.save(account);

        saveTransaction(
                account,
                order.getId(),
                LoyaltyTransactionType.ADJUSTMENT,
                order.getPointsSpent(),
                LoyaltyRateKind.POINT_VALUE,
                rate,
                pointsValue(order.getPointsSpent(), rate),
                "Devolução de pontos por cancelamento da encomenda " + order.getOrderNumber(),
                actorUserId);

        auditService.record(
                actorUserId,
                actorLabel,
                "loyalty.points_refunded",
                "customer_order",
                order.getId().toString(),
                "Encomenda %s cancelada · +%d pontos devolvidos · saldo %d"
                        .formatted(
                                order.getOrderNumber(),
                                order.getPointsSpent(),
                                account.getPointsBalance()));
    }

    /* --------------------------- Crédito no pagamento -------------------- */

    /**
     * Crédita pontos quando o pagamento é confirmado (PAID). Chamado na MESMA
     * transacção da revisão do pagamento: ou a confirmação e os pontos
     * acontecem juntos, ou nada acontece.
     *
     * <p>Idempotente por encomenda (verificação + índice único parcial na V6):
     * repetir a revisão nunca duplica pontos. Programa não configurado ou
     * inactivo não bloqueia o pagamento — simplesmente não há acumulação.
     */
    @Transactional
    public void creditFor(CustomerOrder order, UUID actorUserId, String actorLabel) {
        Optional<LoyaltyRule> maybeRule = ruleRepository.findTopByOrderByIdDesc();
        if (maybeRule.isEmpty() || !maybeRule.get().isActive()) {
            return; // Programa por configurar/pausado: o pagamento nunca falha por isso.
        }
        LoyaltyRule rule = maybeRule.get();

        if (transactionRepository.existsByOrderIdAndType(order.getId(), LoyaltyTransactionType.EARN)) {
            return; // Já creditado (idempotência de duplicação).
        }

        // Valor elegível: após descontos, sem entrega — ou seja, o subtotal
        // menos o desconto (o total já é subtotal + entrega − desconto).
        BigDecimal eligible = order.getSubtotal().subtract(order.getDiscountAmount());
        if (eligible.signum() <= 0) {
            return;
        }

        int points = earnPoints(eligible, rule);
        if (points <= 0) {
            return; // Arredondamento a zero: nada a creditar, sem movimento falso.
        }

        LoyaltyAccount account = accountFor(order.getUserId());
        account.apply(points);
        accountRepository.save(account);

        saveTransaction(
                account,
                order.getId(),
                LoyaltyTransactionType.EARN,
                points,
                LoyaltyRateKind.EARN_PERCENT,
                rule.getEarnPercent(),
                eligible,
                "Encomenda " + order.getOrderNumber() + " paga",
                actorUserId);

        auditService.record(
                actorUserId,
                actorLabel,
                "loyalty.points_earned",
                "customer_order",
                order.getId().toString(),
                "Encomenda %s · valor elegível %s Kz · +%d pontos · saldo %d"
                        .formatted(
                                order.getOrderNumber(),
                                eligible.setScale(2, RoundingMode.HALF_UP),
                                points,
                                account.getPointsBalance()));
    }

    /* ------------------------------ Internos ----------------------------- */

    private AppliedDiscount pointsDiscount(UUID userId, BigDecimal subtotal, int pointsRequested, LoyaltyRule rule) {
        LoyaltyAccount account = accountRepository.findByUserId(userId).orElse(null);
        int balance = account == null ? 0 : account.getPointsBalance();
        if (pointsRequested > balance) {
            throw new InvalidRequestException(Map.of(
                    "pointsToSpend", "Saldo insuficiente: só tem " + balance + " ponto(s)."));
        }
        if (!rule.isAllowPartialRedemption() && pointsRequested != balance) {
            throw new InvalidRequestException(Map.of(
                    "pointsToSpend",
                    "Este programa só permite resgatar a totalidade do saldo ("
                            + balance + " pontos)."));
        }
        // Teto de pontos que esta encomenda consegue absorver (nunca um
        // desconto acima do subtotal — o cliente também não perde pontos).
        int maxAffordable = maxAffordablePoints(subtotal, rule.getPointValueKz());
        if (maxAffordable <= 0) {
            throw new InvalidRequestException(Map.of(
                    "pointsToSpend", "O valor desta encomenda não permite desconto por pontos."));
        }
        if (pointsRequested > maxAffordable) {
            throw new InvalidRequestException(Map.of(
                    "pointsToSpend",
                    "Os pontos indicados excedem o desconto possível nesta encomenda: no máximo pode usar "
                            + maxAffordable + " ponto(s)."));
        }
        BigDecimal amount = pointsValue(pointsRequested, rule.getPointValueKz());
        return new AppliedDiscount(
                DiscountSource.POINTS, POINTS_LABEL, null, null, amount, pointsRequested);
    }

    private AppliedDiscount rewardDiscount(UUID userId, BigDecimal subtotal, String rewardCode, LoyaltyRule rule) {
        // O cliente referencia a recompensa pelo seu CÓDIGO público; o
        // servidor só aceita códigos activos — inactivos nem existem aqui.
        RewardRule reward = rewardRuleRepository.findByCodeAndActiveTrue(rewardCode.toUpperCase())
                .orElseThrow(() -> new NotFoundException("REWARD_NOT_FOUND", "Recompensa não encontrada."));

        LoyaltyAccount account = accountRepository.findByUserId(userId).orElse(null);
        int balance = account == null ? 0 : account.getPointsBalance();
        long orders = orderRepository.countByUserIdAndStatusNot(userId, OrderStatus.CANCELLED);
        int redeemed = redeemedCount(account, reward);

        String reason = ineligibleReason(reward, balance, orders, redeemed);
        if (reason != null) {
            throw new InvalidRequestException(Map.of("rewardCode", reason));
        }

        // Nunca acima do subtotal: a recompensa aplica-se no máximo ao valor
        // dos artigos desta encomenda (o excedente não é desperdiçado em
        // descontos negativos — fica registado o valor efectivamente aplicado).
        BigDecimal amount = reward.getDiscountAmount().min(subtotal);
        UUID discountRuleId = discountService.activeRuleForReward(reward.getId())
                .map(DiscountRule::getId)
                .orElse(null);
        return new AppliedDiscount(
                DiscountSource.REWARD, reward.getDescription(), discountRuleId, reward.getId(), amount, 0);
    }

    private AppliedDiscount welcomeDiscount(UUID userId, BigDecimal subtotal) {
        DiscountRule welcome = discountService.activeWelcomeRule().orElse(null);
        if (welcome == null || welcome.getPercent() == null) {
            return null;
        }
        long previousOrders = orderRepository.countByUserIdAndStatusNot(userId, OrderStatus.CANCELLED);
        if (previousOrders > 0) {
            return null; // Boas-vindas consumidas pela primeira compra.
        }
        BigDecimal amount = subtotal.multiply(welcome.getPercent())
                .divide(new BigDecimal("100"), 2, RoundingMode.HALF_UP)
                .min(subtotal);
        if (amount.signum() <= 0) {
            return null;
        }
        return new AppliedDiscount(
                DiscountSource.WELCOME, welcome.getDescription(), welcome.getId(), null, amount, 0);
    }

    private WelcomeView welcomeView(UUID userId, long previousOrders) {
        DiscountRule welcome = discountService.activeWelcomeRule().orElse(null);
        if (welcome == null || welcome.getPercent() == null) {
            return null;
        }
        return new WelcomeView(
                previousOrders == 0,
                welcome.getPercent().setScale(2, RoundingMode.HALF_UP).toPlainString(),
                welcome.getDescription());
    }

    /** Motivo de indisponibilidade de uma recompensa, ou {@code null} se elegível. */
    private String ineligibleReason(RewardRule reward, int balance, long orders, int redeemed) {
        List<String> missing = new ArrayList<>(2);
        if (reward.getMinPoints() != null && balance < reward.getMinPoints()) {
            missing.add("ainda precisa de " + (reward.getMinPoints() - balance) + " ponto(s)");
        }
        if (reward.getMinOrders() != null && orders < reward.getMinOrders()) {
            missing.add("ainda precisa de " + (reward.getMinOrders() - orders) + " encomenda(s)");
        }
        // Condição cumulativa: pontos E encomendas quando ambas definidas (#13).
        if (!missing.isEmpty()) {
            return "Recompensa indisponível: " + String.join(" e ", missing) + ".";
        }
        if (redeemed >= reward.getMaxPerCustomer()) {
            return "Recompensa já resgatada (limite de " + reward.getMaxPerCustomer() + " por cliente).";
        }
        return null;
    }

    private String inactiveReason(LoyaltyRule rule) {
        if (rule == null) {
            return "O programa de fidelização ainda não está configurado.";
        }
        return "O programa de fidelização está actualmente pausado.";
    }

    private int redeemedCount(LoyaltyAccount account, RewardRule reward) {
        return account == null ? 0 : (int) redemptionRepository.countByAccountIdAndRewardRuleId(
                account.getId(), reward.getId());
    }

    private LoyaltyAccount accountFor(UUID userId) {
        return accountRepository.findByUserId(userId).orElseGet(() -> {
            LoyaltyAccount account = new LoyaltyAccount();
            account.setUserId(userId);
            return accountRepository.save(account);
        });
    }

    private LoyaltyTransaction saveTransaction(
            LoyaltyAccount account,
            UUID orderId,
            LoyaltyTransactionType type,
            int points,
            LoyaltyRateKind rateKind,
            BigDecimal rateUsed,
            BigDecimal amountKz,
            String note,
            UUID createdBy) {
        LoyaltyTransaction transaction = new LoyaltyTransaction();
        transaction.setAccountId(account.getId());
        transaction.setOrderId(orderId);
        transaction.setType(type);
        transaction.setPoints(points);
        transaction.setRateKind(rateKind);
        transaction.setRateUsed(rateUsed);
        transaction.setAmountKz(amountKz);
        transaction.setNote(note);
        transaction.setCreatedBy(createdBy);
        return transactionRepository.save(transaction);
    }

    /** Pontos creditados pelo valor elegível, com a regra de arredondamento configurada. */
    private static int earnPoints(BigDecimal eligible, LoyaltyRule rule) {
        BigDecimal raw = eligible.multiply(rule.getEarnPercent()).divide(new BigDecimal("100"), 6, RoundingMode.HALF_UP);
        RoundingMode mode = "DOWN".equals(rule.getRounding()) ? RoundingMode.DOWN : RoundingMode.HALF_UP;
        return raw.setScale(0, mode).intValueExact();
    }

    /** Valor em Kz de N pontos (HALF_UP a 2 casas — decisão #8 escolhida na configuração). */
    private static BigDecimal pointsValue(int points, BigDecimal pointValueKz) {
        return new BigDecimal(points).multiply(pointValueKz).setScale(2, RoundingMode.HALF_UP);
    }

    /** Quantos pontos cabem no subtotal (truncagem para nunca exceder o total). */
    private static int maxAffordablePoints(BigDecimal subtotal, BigDecimal pointValueKz) {
        return subtotal.divide(pointValueKz, 0, RoundingMode.DOWN).intValueExact();
    }

    private RuleView ruleView(LoyaltyRule rule) {
        // Sempre na escala da coluna — a API devolve as mesmas strings quer a
        // regra tenha acabado de ser gravada quer venha da base.
        return new RuleView(
                rule.getEarnPercent().setScale(2, RoundingMode.HALF_UP).toPlainString(),
                rule.getPointValueKz().setScale(4, RoundingMode.HALF_UP).toPlainString(),
                rule.getRounding(),
                rule.isAllowPartialRedemption(),
                rule.isActive(),
                rule.getUpdatedAt().toString());
    }

    private RewardView rewardView(RewardRule reward) {
        return new RewardView(
                reward.getCode(),
                reward.getDescription(),
                reward.getMinPoints(),
                reward.getMinOrders(),
                reward.getDiscountAmount().setScale(2, RoundingMode.HALF_UP).toPlainString(),
                reward.getMaxPerCustomer(),
                reward.isActive());
    }

    private static BigDecimal decimal(String raw, String field, Map<String, String> errors) {
        if (raw == null || raw.isBlank()) {
            errors.put(field, "O valor é obrigatório.");
            return null;
        }
        try {
            return new BigDecimal(raw.trim());
        } catch (NumberFormatException ex) {
            errors.put(field, "Valor numérico inválido.");
            return null;
        }
    }
}
