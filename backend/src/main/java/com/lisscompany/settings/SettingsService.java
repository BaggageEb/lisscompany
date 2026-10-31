package com.lisscompany.settings;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.regex.Pattern;

import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import com.lisscompany.audit.AuditService;
import com.lisscompany.identity.AppUser;
import com.lisscompany.orders.PaymentMethod;
import com.lisscompany.shared.error.InvalidRequestException;

/**
 * Definições do negócio (tabela {@code business_setting}) editáveis pela
 * proprietária sem tocar em código: contactos, dados de pagamento, levantamento
 * e textos das políticas. Os dados bancários e o número Multicaixa Express
 * <strong>nunca</strong> estão no código-fonte: vivem aqui, só saem na API
 * pública quando o cliente já tem uma encomenda (instruções de pagamento) e
 * os seus valores nunca são escritos na auditoria.
 */
@Service
public class SettingsService {

    /** Chaves permitidas → (tipo, tamanho máximo). Qualquer outra é rejeitada. */
    private static final Map<String, Spec> SPECS = new LinkedHashMap<>();

    private record Spec(String type, int max) {}

    static {
        for (String key : List.of("contact.phone", "contact.whatsapp", "contact.email", "contact.address",
                "contact.hours", "contact.instagram", "contact.facebook")) {
            SPECS.put(key, new Spec("STRING", 300));
        }
        for (String key : List.of("payment.iban_enabled", "payment.multicaixa_enabled",
                "payment.on_delivery_enabled", "pickup.enabled", "pickup.ask_slot", "delivery.enabled")) {
            SPECS.put(key, new Spec("BOOLEAN", 5));
        }
        for (String key : List.of("payment.iban", "payment.holder", "payment.multicaixa_number")) {
            SPECS.put(key, new Spec("STRING", 80));
        }
        for (String key : List.of("payment.on_delivery_note", "pickup.address", "pickup.hours",
                "pickup.instructions", "delivery.notes")) {
            SPECS.put(key, new Spec("STRING", 600));
        }
        for (String key : List.of("policy.privacy", "policy.terms", "policy.cancellation", "policy.refunds",
                "policy.delivery")) {
            SPECS.put(key, new Spec("STRING", 12000));
        }
    }

    /** Valores que nunca aparecem na auditoria nem na API pública. */
    private static final Set<String> PRIVATE_KEYS = Set.of("payment.iban", "payment.holder", "payment.multicaixa_number");

    private static final Pattern IBAN = Pattern.compile("^[A-Z0-9 ]{15,40}$");
    private static final Pattern DIGITS = Pattern.compile("^[0-9 +]{9,20}$");

    private final JdbcTemplate jdbc;
    private final AuditService auditService;

    public SettingsService(JdbcTemplate jdbc, AuditService auditService) {
        this.jdbc = jdbc;
        this.auditService = auditService;
    }

    /* ------------------------------- Leitura ----------------------------- */

    /** Todas as chaves permitidas (vazio quando não configuradas) — painel. */
    @Transactional(readOnly = true)
    public Map<String, String> all() {
        Map<String, String> result = new LinkedHashMap<>();
        for (String key : SPECS.keySet()) {
            result.put(key, "");
        }
        jdbc.query("SELECT key, value FROM business_setting", rs -> {
            String key = rs.getString(1);
            if (SPECS.containsKey(key)) {
                result.put(key, rs.getString(2));
            }
        });
        return result;
    }

    @Transactional(readOnly = true)
    public String get(String key) {
        List<String> values = jdbc.queryForList("SELECT value FROM business_setting WHERE key = ?", String.class, key);
        return values.isEmpty() ? "" : values.get(0);
    }

    private boolean bool(String key, boolean fallback) {
        String value = get(key);
        return value.isBlank() ? fallback : "true".equalsIgnoreCase(value);
    }

    /** Há termos publicados? Só então a aceitação é exigida no checkout. */
    public boolean termsRequired() {
        return !get("policy.terms").isBlank();
    }

    /** Método explicitamente desactivado pela proprietária? (ausente = activo). */
    public boolean isMethodEnabled(PaymentMethod method) {
        return switch (method) {
            case IBAN_TRANSFER -> bool("payment.iban_enabled", true);
            case MULTICAIXA_EXPRESS -> bool("payment.multicaixa_enabled", true);
            case ON_DELIVERY -> bool("payment.on_delivery_enabled", true);
        };
    }

    /* ------------------------------ Vista pública ------------------------ */

    public record MethodView(String method, boolean enabled, boolean configured) {}

    public record PublicSettings(
            Map<String, String> contacts,
            Map<String, String> pickup,
            boolean pickupEnabled,
            boolean deliveryEnabled,
            String deliveryNotes,
            List<MethodView> paymentMethods,
            Map<String, String> policies,
            boolean termsRequired) {}

    /** Só o que um visitante pode ver — nunca IBAN nem número Multicaixa. */
    @Transactional(readOnly = true)
    public PublicSettings publicView() {
        Map<String, String> all = all();
        Map<String, String> contacts = new LinkedHashMap<>();
        for (String key : List.of("phone", "whatsapp", "email", "address", "hours", "instagram", "facebook")) {
            contacts.put(key, all.get("contact." + key));
        }
        Map<String, String> pickup = new LinkedHashMap<>();
        pickup.put("address", all.get("pickup.address"));
        pickup.put("hours", all.get("pickup.hours"));
        pickup.put("instructions", all.get("pickup.instructions"));
        pickup.put("askSlot", String.valueOf("true".equalsIgnoreCase(all.get("pickup.ask_slot"))));
        Map<String, String> policies = new LinkedHashMap<>();
        for (String key : List.of("privacy", "terms", "cancellation", "refunds", "delivery")) {
            policies.put(key, all.get("policy." + key));
        }
        List<MethodView> methods = List.of(
                new MethodView("IBAN_TRANSFER", isMethodEnabled(PaymentMethod.IBAN_TRANSFER),
                        !all.get("payment.iban").isBlank()),
                new MethodView("MULTICAIXA_EXPRESS", isMethodEnabled(PaymentMethod.MULTICAIXA_EXPRESS),
                        !all.get("payment.multicaixa_number").isBlank()),
                new MethodView("ON_DELIVERY", isMethodEnabled(PaymentMethod.ON_DELIVERY), true));
        return new PublicSettings(
                contacts,
                pickup,
                bool("pickup.enabled", true),
                bool("delivery.enabled", true),
                all.get("delivery.notes"),
                methods,
                policies,
                !all.get("policy.terms").isBlank());
    }

    /** Instruções de pagamento para o dono da encomenda (dados privados da loja). */
    public record PaymentInstructions(String method, String holder, String iban, String number, String note) {}

    @Transactional(readOnly = true)
    public PaymentInstructions instructionsFor(PaymentMethod method) {
        return switch (method) {
            case IBAN_TRANSFER -> new PaymentInstructions(
                    method.name(), nullIfBlank(get("payment.holder")), nullIfBlank(get("payment.iban")), null, null);
            case MULTICAIXA_EXPRESS -> new PaymentInstructions(
                    method.name(), null, null, nullIfBlank(get("payment.multicaixa_number")), null);
            case ON_DELIVERY -> new PaymentInstructions(
                    method.name(), null, null, null, nullIfBlank(get("payment.on_delivery_note")));
        };
    }

    private static String nullIfBlank(String value) {
        return value == null || value.isBlank() ? null : value;
    }

    /* ------------------------------ Alteração ---------------------------- */

    @Transactional
    public Map<String, String> update(Map<String, String> changes, AppUser actor) {
        Map<String, String> errors = new LinkedHashMap<>();
        Map<String, String> clean = new LinkedHashMap<>();
        for (Map.Entry<String, String> entry : changes.entrySet()) {
            String key = entry.getKey();
            Spec spec = SPECS.get(key);
            if (spec == null) {
                errors.put(key, "Definição desconhecida.");
                continue;
            }
            String value = entry.getValue() == null ? "" : entry.getValue().trim();
            if (value.length() > spec.max()) {
                errors.put(key, "Texto demasiado longo (máximo " + spec.max() + " caracteres).");
                continue;
            }
            if ("BOOLEAN".equals(spec.type()) && !value.isEmpty()
                    && !"true".equals(value) && !"false".equals(value)) {
                errors.put(key, "Valor inválido (true/false).");
                continue;
            }
            if ("payment.iban".equals(key)) {
                value = value.toUpperCase();
                if (!value.isEmpty() && !IBAN.matcher(value).matches()) {
                    errors.put(key, "IBAN/NIB inválido: use apenas letras, números e espaços.");
                    continue;
                }
            }
            if ("payment.multicaixa_number".equals(key) && !value.isEmpty() && !DIGITS.matcher(value).matches()) {
                errors.put(key, "Número inválido: use apenas dígitos (9 a 15).");
                continue;
            }
            clean.put(key, value);
        }
        if (!errors.isEmpty()) {
            throw new InvalidRequestException(errors);
        }
        for (Map.Entry<String, String> entry : clean.entrySet()) {
            String type = SPECS.get(entry.getKey()).type();
            jdbc.update(
                    "INSERT INTO business_setting (key, value, value_type, updated_by, updated_at)"
                            + " VALUES (?, ?, ?, ?, NOW())"
                            + " ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value,"
                            + " value_type = EXCLUDED.value_type, updated_by = EXCLUDED.updated_by, updated_at = NOW()",
                    entry.getKey(), entry.getValue(), type, actor.getId());
        }
        // Auditoria: só os NOMES das chaves — nunca os valores (dados privados/financeiros).
        List<String> keys = clean.keySet().stream()
                .map(k -> PRIVATE_KEYS.contains(k) ? k + " (privado)" : k)
                .toList();
        auditService.record(actor.getId(), actor.getEmail(), "settings.updated", "business_setting", null,
                "Definições alteradas: " + String.join(", ", keys));
        return all();
    }
}
