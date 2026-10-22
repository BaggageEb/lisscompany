package com.lisscompany.promotions;

import java.math.BigDecimal;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;

import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import com.lisscompany.audit.AuditService;
import com.lisscompany.identity.AppUser;
import com.lisscompany.loyalty.RewardRule;
import com.lisscompany.loyalty.RewardRuleRepository;
import com.lisscompany.shared.error.ConflictException;
import com.lisscompany.shared.error.InvalidRequestException;
import com.lisscompany.shared.error.NotFoundException;

/**
 * Catálogo de descontos (fase 6, decisões #11–#12).
 *
 * <p>Nenhum desconto vem por omissão: cada regra é configurada pela
 * proprietária (percentagem/valor, prioridade, activa) e o histórico fica no
 * {@code audit_log}. Duas invariantes são da base de dados, não da memória do
 * programador:
 * <ul>
 *   <li><strong>um desconto por encomenda</strong> — {@code discount_application}
 *       é único por encomenda (decisão #11);</li>
 *   <li><strong>sem empates de prioridade</strong> entre regras activas — a
 *       configuração é rejeitada em 409, em vez de decidir “à toa” quem ganha.</li>
 * </ul>
 */
@Service
public class DiscountService {

    private final DiscountRuleRepository ruleRepository;
    private final RewardRuleRepository rewardRuleRepository;
    private final DiscountApplicationRepository applicationRepository;
    private final AuditService auditService;

    public DiscountService(
            DiscountRuleRepository ruleRepository,
            RewardRuleRepository rewardRuleRepository,
            DiscountApplicationRepository applicationRepository,
            AuditService auditService) {
        this.ruleRepository = ruleRepository;
        this.rewardRuleRepository = rewardRuleRepository;
        this.applicationRepository = applicationRepository;
        this.auditService = auditService;
    }

    /* ------------------------------- Views ------------------------------- */

    public record RuleView(
            String code,
            String description,
            String kind,
            String percent,
            String amount,
            String rewardCode,
            int priority,
            boolean active) {}

    public record RuleInput(
            String code,
            String description,
            String kind,
            String percent,
            String amount,
            /** Código público da recompensa ligada (REWARD) — o painel não manipula UUIDs. */
            String rewardCode,
            Integer priority,
            boolean active) {}

    /* ------------------------------ Configuração ------------------------- */

    /**
     * Cria ou actualiza uma regra por código (upsert do painel). Tudo é
     * validado aqui: o shape por tipo de regra, a existência da recompensa
     * ligada e a unicidade de prioridade entre regras activas (#11).
     */
    @Transactional
    public RuleView configure(RuleInput input, AppUser actor) {
        Map<String, String> errors = new LinkedHashMap<>();
        String code = blankToNull(input.code());
        String description = blankToNull(input.description());
        if (code == null) {
            errors.put("code", "O código da regra é obrigatório.");
        }
        if (description == null) {
            errors.put("description", "A descrição é obrigatória (é o rótulo que o cliente vê).");
        }
        if (input.priority() == null || input.priority() < 1) {
            errors.put("priority", "A prioridade começa em 1 (1 = maior precedência).");
        }

        DiscountRuleKind kind = parseKind(input.kind(), errors);
        BigDecimal percent = parsePositive(input.percent(), "percent", errors);
        BigDecimal amount = parsePositive(input.amount(), "amount", errors);
        UUID rewardRuleId = null;

        if (kind == DiscountRuleKind.WELCOME) {
            if (percent == null) {
                errors.put("percent", "O desconto de boas-vindas é uma percentagem (obrigatória).");
            }
            if (amount != null) {
                errors.put("amount", "Regras de boas-vindas usam percentagem, não valor fixo.");
            }
        } else if (kind == DiscountRuleKind.REWARD) {
            // O painel liga a recompensa pelo CÓDIGO público — o servidor
            // resolve para o registo interno (o id nunca sai daqui).
            String rewardCode = blankToNull(input.rewardCode());
            if (rewardCode == null) {
                errors.put("rewardCode", "A regra de desconto de recompensa precisa da recompensa ligada.");
            } else {
                Optional<RewardRule> linked = rewardRuleRepository.findByCode(rewardCode.toUpperCase());
                if (linked.isEmpty()) {
                    errors.put("rewardCode", "A recompensa indicada não existe.");
                } else {
                    rewardRuleId = linked.get().getId();
                }
            }
            if ((percent == null) == (amount == null)) {
                errors.put("amount", "Indique percentagem OU valor fixo — exactamente um dos dois.");
            }
        }

        // Prioridade sem empates entre activas: quem decide é a configuração,
        // nunca a ordem das consultas (decisão #11 — hierarquia explícita).
        if (kind != null && input.active() && input.priority() != null) {
            Optional<DiscountRule> existing = code == null ? Optional.empty() : ruleRepository.findByCode(code);
            UUID selfId = existing.map(DiscountRule::getId).orElse(null);
            boolean taken = selfId == null
                    ? ruleRepository.existsByPriorityAndActiveTrue(input.priority())
                    : ruleRepository.existsByPriorityAndActiveTrueAndIdNot(input.priority(), selfId);
            if (taken) {
                errors.put("priority", "Já existe uma regra activa com a prioridade " + input.priority() + ".");
            }
        }

        if (!errors.isEmpty()) {
            throw new InvalidRequestException(errors);
        }

        // `code` é obrigatório (validado acima) — aqui existe sempre.
        DiscountRule rule = ruleRepository.findByCode(code).orElseGet(DiscountRule::new);
        rule.setCode(code);
        rule.setDescription(description);
        rule.setKind(kind);
        rule.setPercent(percent);
        rule.setAmount(amount);
        rule.setRewardRuleId(rewardRuleId);
        rule.setPriority(input.priority());
        rule.setActive(input.active());
        DiscountRule saved = ruleRepository.save(rule);

        auditService.record(
                actor.getId(),
                actor.getEmail(),
                "discount.rule_changed",
                "discount_rule",
                saved.getId().toString(),
                "Regra %s · %s · prioridade %d · %s · %s"
                        .formatted(
                                saved.getCode(),
                                saved.getKind(),
                                saved.getPriority(),
                                saved.isActive() ? "activa" : "inactiva",
                                saved.getDescription()));

        return view(saved, rewardCodeOf(saved));
    }

    @Transactional(readOnly = true)
    public List<RuleView> list() {
        return ruleRepository.findAllByOrderByPriorityAsc().stream()
                .map(rule -> view(rule, rewardCodeOf(rule)))
                .toList();
    }

    /* ------------------------------- Consulta ---------------------------- */

    /** Regra activa de boas-vindas (a de maior precedência), se existir. */
    @Transactional(readOnly = true)
    public Optional<DiscountRule> activeWelcomeRule() {
        return ruleRepository.findTopByKindAndActiveTrueOrderByPriorityAsc(DiscountRuleKind.WELCOME);
    }

    /** Regra de desconto ligada a uma recompensa (pode não existir). */
    @Transactional(readOnly = true)
    public Optional<DiscountRule> activeRuleForReward(UUID rewardRuleId) {
        return ruleRepository.findTopByRewardRuleIdAndActiveTrueOrderByPriorityAsc(rewardRuleId);
    }

    /* --------------------------- Gravação ------------------------------- */

    /**
     * Grava o desconto escolhido numa encomenda já persistida. A constraint
     * única {@code (order_id)} garante que só um desconto alguma vez pegou.
     */
    @Transactional
    public void recordApplication(
            UUID orderId,
            UUID discountRuleId,
            DiscountSource source,
            String label,
            BigDecimal amount,
            int pointsSpent) {
        if (applicationRepository.existsByOrderId(orderId)) {
            throw new ConflictException(
                    "DISCOUNT_ALREADY_APPLIED", "A encomenda já tem um desconto aplicado.");
        }
        DiscountApplication application = new DiscountApplication();
        application.setOrderId(orderId);
        application.setDiscountRuleId(discountRuleId);
        application.setSource(source);
        application.setLabel(label);
        application.setAmount(amount);
        application.setPointsSpent(pointsSpent);
        applicationRepository.save(application);
    }

    /* ------------------------------ Internos ----------------------------- */

    private String rewardCodeOf(DiscountRule rule) {
        if (rule.getRewardRuleId() == null) {
            return null;
        }
        return rewardRuleRepository.findById(rule.getRewardRuleId()).map(RewardRule::getCode).orElse(null);
    }

    private static RuleView view(DiscountRule rule, String rewardCode) {
        // Escala da coluna — strings idênticas na gravação e na leitura.
        return new RuleView(
                rule.getCode(),
                rule.getDescription(),
                rule.getKind().name(),
                rule.getPercent() == null
                        ? null
                        : rule.getPercent().setScale(2, java.math.RoundingMode.HALF_UP).toPlainString(),
                rule.getAmount() == null
                        ? null
                        : rule.getAmount().setScale(2, java.math.RoundingMode.HALF_UP).toPlainString(),
                rewardCode,
                rule.getPriority(),
                rule.isActive());
    }

    private static DiscountRuleKind parseKind(String raw, Map<String, String> errors) {
        if (raw == null || raw.isBlank()) {
            errors.put("kind", "Indique o tipo de regra (WELCOME ou REWARD).");
            return null;
        }
        try {
            return DiscountRuleKind.valueOf(raw.trim().toUpperCase());
        } catch (IllegalArgumentException ex) {
            errors.put("kind", "Tipo de regra desconhecido: " + raw + ".");
            return null;
        }
    }

    private static BigDecimal parsePositive(String raw, String field, Map<String, String> errors) {
        if (raw == null || raw.isBlank()) {
            return null;
        }
        try {
            BigDecimal value = new BigDecimal(raw.trim());
            if (value.signum() <= 0) {
                errors.put(field, "O valor tem de ser positivo.");
                return null;
            }
            return value;
        } catch (NumberFormatException ex) {
            errors.put(field, "Valor numérico inválido.");
            return null;
        }
    }

    private static String blankToNull(String value) {
        return value == null || value.isBlank() ? null : value.trim();
    }
}
