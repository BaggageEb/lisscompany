package com.lisscompany.delivery;

import java.math.BigDecimal;
import java.math.RoundingMode;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;

import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import com.lisscompany.audit.AuditService;
import com.lisscompany.identity.AppUser;
import com.lisscompany.settings.SettingsService;
import com.lisscompany.shared.error.InvalidRequestException;
import com.lisscompany.shared.error.NotFoundException;

/**
 * Configuração de entregas — preços definidos pela proprietária, nunca
 * inventados, e SEMPRE calculados no servidor.
 *
 * <p>Três modos globais ({@code delivery.mode}):
 * <ul>
 *   <li>{@code FLAT} — preço fixo para qualquer entrega ao domicílio
 *       ({@code delivery.flat_fee}, com limiar opcional de entrega gratuita);</li>
 *   <li>{@code ZONES} — preço por zona (cada zona tem o seu preço, ou é
 *       gratuita, e pode ser activada/desactivada);</li>
 *   <li>{@code FREE} — entrega gratuita em todo o lado.</li>
 * </ul>
 * Sem modo configurado, mantém-se o comportamento anterior quando já há zonas
 * activas (modo por zonas); sem zonas, a entrega ao domicílio <strong>não</strong>
 * pode ser confirmada — nunca se mostra «0 Kz» por falta de configuração.
 */
@Service
public class DeliveryService {

    public static final String MODE_FLAT = "FLAT";
    public static final String MODE_ZONES = "ZONES";
    public static final String MODE_FREE = "FREE";

    /**
     * Zona de entrega. {@code fee} é nulo quando o preço ainda não foi definido;
     * {@code priced} diz se a zona tem preço (ou é gratuita) e, portanto, pode
     * ser escolhida pelo cliente.
     */
    public record Zone(
            String id,
            String name,
            String fee,
            String freeOver,
            String leadTime,
            String schedule,
            boolean active,
            int displayOrder,
            boolean freeDelivery,
            boolean priced) {}

    public record ZoneInput(
            String name, String fee, String freeOver, String leadTime, String schedule, Boolean active,
            Integer displayOrder, Boolean freeDelivery) {}

    /** Modo global de entrega e preço fixo (painel). */
    public record ConfigInput(String mode, String flatFee, String flatFreeOver) {}

    /**
     * Configuração vista pelo painel: o que está definido e se a entrega ao
     * domicílio já pode ser confirmada pelos clientes (com os motivos, se não).
     */
    public record ConfigView(
            String mode, String flatFee, String flatFreeOver, boolean ready, List<String> problems) {}

    /** Resumo público da entrega (checkout). */
    public record PublicDelivery(String mode, String flatFee, String flatFreeOver, boolean available, String issue) {}

    /**
     * Resultado do preço de uma entrega. Quando {@code available} é falso, o
     * cliente NÃO pode confirmar a entrega: {@code issue} explica porquê e
     * {@code field} diz a que campo do formulário pertence.
     */
    public record Quote(
            boolean available,
            BigDecimal fee,
            boolean free,
            String zoneId,
            String zoneName,
            String issue,
            String field) {

        static Quote unavailable(String issue, String field) {
            return new Quote(false, null, false, null, null, issue, field);
        }
    }

    private static final String SELECT =
            "SELECT id::text, name, fee::text, free_over::text, lead_time, schedule, active, display_order,"
                    + " free_delivery FROM delivery_zone";

    private final JdbcTemplate jdbc;
    private final AuditService auditService;
    private final SettingsService settings;

    public DeliveryService(JdbcTemplate jdbc, AuditService auditService, SettingsService settings) {
        this.jdbc = jdbc;
        this.auditService = auditService;
        this.settings = settings;
    }

    private static Zone map(java.sql.ResultSet rs, int row) throws java.sql.SQLException {
        String fee = rs.getString(3);
        boolean free = rs.getBoolean(9);
        return new Zone(
                rs.getString(1), rs.getString(2), fee == null ? null : money(fee),
                rs.getString(4) == null ? null : money(rs.getString(4)),
                rs.getString(5), rs.getString(6), rs.getBoolean(7), rs.getInt(8),
                free, free || fee != null);
    }

    private static String money(String raw) {
        return new BigDecimal(raw).setScale(2, RoundingMode.HALF_UP).toPlainString();
    }

    @Transactional(readOnly = true)
    public List<Zone> list(boolean onlyActive) {
        return jdbc.query(
                SELECT + (onlyActive ? " WHERE active" : "") + " ORDER BY display_order, name",
                DeliveryService::map);
    }

    /* ------------------------- Modo e preço fixo ------------------------- */

    private static final String KEY_MODE = "delivery.mode";
    private static final String KEY_FLAT_FEE = "delivery.flat_fee";
    private static final String KEY_FLAT_FREE_OVER = "delivery.flat_free_over";

    private String setting(String key) {
        List<String> values = jdbc.queryForList("SELECT value FROM business_setting WHERE key = ?", String.class, key);
        return values.isEmpty() || values.get(0) == null || values.get(0).isBlank() ? null : values.get(0).trim();
    }

    private void storeSetting(String key, String value, AppUser actor) {
        if (value == null) {
            jdbc.update("DELETE FROM business_setting WHERE key = ?", key);
            return;
        }
        jdbc.update(
                "INSERT INTO business_setting (key, value, value_type, updated_by, updated_at)"
                        + " VALUES (?, ?, ?, ?, NOW())"
                        + " ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value,"
                        + " value_type = EXCLUDED.value_type, updated_by = EXCLUDED.updated_by, updated_at = NOW()",
                key, value, KEY_MODE.equals(key) ? "STRING" : "NUMBER", actor.getId());
    }

    /** Modo efectivo: o configurado; sem configuração, «por zonas» se já houver zonas activas. */
    private String effectiveMode(List<Zone> activeZones) {
        String mode = setting(KEY_MODE);
        if (mode != null) {
            return mode;
        }
        return activeZones.isEmpty() ? null : MODE_ZONES;
    }

    private BigDecimal flatFee() {
        String raw = setting(KEY_FLAT_FEE);
        return raw == null ? null : new BigDecimal(raw).setScale(2, RoundingMode.HALF_UP);
    }

    private BigDecimal flatFreeOver() {
        String raw = setting(KEY_FLAT_FREE_OVER);
        return raw == null ? null : new BigDecimal(raw).setScale(2, RoundingMode.HALF_UP);
    }

    private boolean deliveryEnabled() {
        String value = settings.get("delivery.enabled");
        return value == null || value.isBlank() || "true".equalsIgnoreCase(value);
    }

    @Transactional(readOnly = true)
    public ConfigView config() {
        List<Zone> active = list(true);
        String mode = setting(KEY_MODE);
        BigDecimal flat = flatFee();
        BigDecimal flatFree = flatFreeOver();
        List<String> problems = readinessProblems(effectiveMode(active), active, flat);
        return new ConfigView(
                mode, flat == null ? null : flat.toPlainString(), flatFree == null ? null : flatFree.toPlainString(),
                problems.isEmpty(), problems);
    }

    private List<String> readinessProblems(String mode, List<Zone> activeZones, BigDecimal flat) {
        List<String> problems = new java.util.ArrayList<>();
        if (!deliveryEnabled()) {
            problems.add("A entrega ao domicílio está desactivada nas definições da loja.");
        }
        if (mode == null) {
            problems.add("Escolha como cobrar a entrega: preço fixo, preço por zona ou entrega gratuita.");
        } else if (MODE_FLAT.equals(mode) && flat == null) {
            problems.add("Defina o preço fixo da entrega ao domicílio.");
        } else if (MODE_ZONES.equals(mode) && activeZones.stream().noneMatch(Zone::priced)) {
            problems.add("Crie e active pelo menos uma zona com preço (ou marcada como entrega gratuita).");
        }
        return problems;
    }

    @Transactional
    public ConfigView updateConfig(ConfigInput input, AppUser actor) {
        Map<String, String> errors = new LinkedHashMap<>();
        String mode = input.mode() == null ? "" : input.mode().trim().toUpperCase();
        if (!MODE_FLAT.equals(mode) && !MODE_ZONES.equals(mode) && !MODE_FREE.equals(mode)) {
            errors.put("mode", "Escolha preço fixo, preço por zona ou entrega gratuita.");
        }
        BigDecimal flat = decimal(input.flatFee(), "flatFee", errors, false);
        BigDecimal flatFree = decimal(input.flatFreeOver(), "flatFreeOver", errors, false);
        if (MODE_FLAT.equals(mode)) {
            if (flat == null) {
                errors.putIfAbsent("flatFee", "Indique o preço fixo da entrega.");
            } else if (flat.signum() <= 0) {
                errors.put("flatFee", "O preço fixo tem de ser positivo (para entrega gratuita escolha esse modo).");
            }
        }
        if (flatFree != null && flatFree.signum() <= 0) {
            errors.put("flatFreeOver", "O limiar de entrega gratuita tem de ser positivo.");
        }
        if (!errors.isEmpty()) {
            throw new InvalidRequestException(errors);
        }
        storeSetting(KEY_MODE, mode, actor);
        // O preço fixo e o limiar só fazem sentido no modo FLAT; ficam guardados para não se perderem ao alternar.
        storeSetting(KEY_FLAT_FEE, flat == null ? null : flat.toPlainString(), actor);
        storeSetting(KEY_FLAT_FREE_OVER, flatFree == null ? null : flatFree.toPlainString(), actor);
        auditService.record(actor.getId(), actor.getEmail(), "delivery.config_changed", "business_setting", null,
                "Entrega: modo %s%s%s".formatted(
                        mode,
                        MODE_FLAT.equals(mode) && flat != null ? " · preço fixo " + flat.toPlainString() + " Kz" : "",
                        MODE_FLAT.equals(mode) && flatFree != null ? " · grátis a partir de " + flatFree.toPlainString() + " Kz" : ""));
        return config();
    }

    /** Resumo público: modo, preço fixo e se a entrega ao domicílio está operacional. */
    @Transactional(readOnly = true)
    public PublicDelivery publicDelivery() {
        List<Zone> active = list(true);
        String mode = effectiveMode(active);
        BigDecimal flat = flatFee();
        BigDecimal flatFree = flatFreeOver();
        List<String> problems = readinessProblems(mode, active, flat);
        return new PublicDelivery(
                mode,
                MODE_FLAT.equals(mode) && flat != null ? flat.toPlainString() : null,
                MODE_FLAT.equals(mode) && flatFree != null ? flatFree.toPlainString() : null,
                problems.isEmpty(),
                problems.isEmpty() ? null : publicIssue(mode, deliveryEnabled()));
    }

    private static String publicIssue(String mode, boolean enabled) {
        return !enabled
                ? "A entrega ao domicílio não está disponível de momento."
                : "A entrega ao domicílio ainda não está configurada pela loja. Escolha levantamento ou contacte a loja.";
    }

    /* ------------------------------ Preço da entrega ------------------------------ */

    /**
     * Preço da entrega ao domicílio para um subtotal e uma zona (opcional).
     * É a ÚNICA fonte do valor da entrega: o checkout mostra-o antes de
     * confirmar e a criação da encomenda usa exactamente o mesmo cálculo.
     * Nunca devolve «0 Kz» por falta de configuração — devolve «indisponível».
     */
    @Transactional(readOnly = true)
    public Quote quote(String rawZoneId, BigDecimal subtotal) {
        if (!deliveryEnabled()) {
            return Quote.unavailable("A entrega ao domicílio não está disponível de momento.", "fulfillment");
        }
        List<Zone> active = list(true);
        String mode = effectiveMode(active);
        String zoneId = rawZoneId == null || rawZoneId.isBlank() ? null : rawZoneId.trim();
        Zone chosen = zoneId == null ? null
                : active.stream().filter(zone -> zone.id().equals(zoneId)).findFirst().orElse(null);

        if (mode == null) {
            return Quote.unavailable(publicIssue(null, true), "fulfillment");
        }
        switch (mode) {
            case MODE_FREE:
                return new Quote(true, zero(), true, chosen == null ? null : chosen.id(),
                        chosen == null ? null : chosen.name(), null, null);
            case MODE_FLAT: {
                BigDecimal flat = flatFee();
                if (flat == null) {
                    return Quote.unavailable(publicIssue(mode, true), "fulfillment");
                }
                BigDecimal freeOver = flatFreeOver();
                boolean free = freeOver != null && subtotal.compareTo(freeOver) >= 0;
                return new Quote(true, free ? zero() : flat, free, chosen == null ? null : chosen.id(),
                        chosen == null ? null : chosen.name(), null, null);
            }
            default: {
                if (active.stream().noneMatch(Zone::priced)) {
                    return Quote.unavailable(publicIssue(mode, true), "fulfillment");
                }
                if (zoneId == null) {
                    return Quote.unavailable("Escolha a zona de entrega.", "deliveryZoneId");
                }
                if (chosen == null) {
                    return Quote.unavailable("A zona de entrega escolhida não está disponível.", "deliveryZoneId");
                }
                if (!chosen.priced()) {
                    return Quote.unavailable(
                            "A zona «" + chosen.name() + "» ainda não tem preço de entrega configurado.", "deliveryZoneId");
                }
                boolean free = chosen.freeDelivery()
                        || (chosen.freeOver() != null && subtotal.compareTo(new BigDecimal(chosen.freeOver())) >= 0);
                BigDecimal fee = free ? zero() : new BigDecimal(chosen.fee()).setScale(2, RoundingMode.HALF_UP);
                return new Quote(true, fee, free, chosen.id(), chosen.name(), null, null);
            }
        }
    }

    private static BigDecimal zero() {
        return BigDecimal.ZERO.setScale(2);
    }

    @Transactional
    public Zone create(ZoneInput input, AppUser actor) {
        Validated v = validate(input);
        String id = jdbc.queryForObject(
                "INSERT INTO delivery_zone (name, fee, free_over, lead_time, schedule, active, display_order, free_delivery)"
                        + " VALUES (?, ?, ?, ?, ?, ?, ?, ?) RETURNING id::text",
                String.class, v.name, v.fee, v.freeOver, v.leadTime, v.schedule, v.active, v.order, v.free);
        auditService.record(actor.getId(), actor.getEmail(), "delivery.zone_created", "delivery_zone", id,
                "Zona «" + v.name + "» · " + describe(v));
        return get(id);
    }

    @Transactional
    public Zone update(UUID id, ZoneInput input, AppUser actor) {
        Validated v = validate(input);
        int rows = jdbc.update(
                "UPDATE delivery_zone SET name = ?, fee = ?, free_over = ?, lead_time = ?, schedule = ?,"
                        + " active = ?, display_order = ?, free_delivery = ?, updated_at = NOW() WHERE id = ?",
                v.name, v.fee, v.freeOver, v.leadTime, v.schedule, v.active, v.order, v.free, id);
        if (rows == 0) {
            throw new NotFoundException("ZONE_NOT_FOUND", "Zona não encontrada.");
        }
        auditService.record(actor.getId(), actor.getEmail(), "delivery.zone_updated", "delivery_zone", id.toString(),
                "Zona «" + v.name + "» · " + describe(v) + " · " + (v.active ? "activa" : "inactiva"));
        return get(id.toString());
    }

    @Transactional
    public void delete(UUID id, AppUser actor) {
        int rows = jdbc.update("DELETE FROM delivery_zone WHERE id = ?", id);
        if (rows == 0) {
            throw new NotFoundException("ZONE_NOT_FOUND", "Zona não encontrada.");
        }
        auditService.record(actor.getId(), actor.getEmail(), "delivery.zone_deleted", "delivery_zone", id.toString(),
                "Zona removida (as encomendas antigas mantêm o nome no snapshot).");
    }

    private Zone get(String id) {
        return jdbc.query(SELECT + " WHERE id = ?::uuid", DeliveryService::map, id).get(0);
    }

    private record Validated(
            String name, BigDecimal fee, BigDecimal freeOver, String leadTime, String schedule, boolean active,
            int order, boolean free) {}

    private static String describe(Validated v) {
        return v.free ? "entrega gratuita" : v.fee == null ? "sem preço" : "tarifa " + v.fee.toPlainString() + " Kz";
    }

    private static Validated validate(ZoneInput input) {
        Map<String, String> errors = new LinkedHashMap<>();
        String name = input.name() == null ? "" : input.name().trim();
        if (name.length() < 2 || name.length() > 160) {
            errors.put("name", "Indique o nome da zona (2 a 160 caracteres).");
        }
        boolean free = Boolean.TRUE.equals(input.freeDelivery());
        boolean active = input.active() == null || input.active();
        BigDecimal fee = decimal(input.fee(), "fee", errors, false);
        if (free) {
            fee = BigDecimal.ZERO.setScale(2);
        } else if (fee != null && fee.signum() == 0) {
            free = true; // preço 0 significa entrega gratuita
        } else if (fee == null && active) {
            errors.put("fee", "Defina o preço da zona ou marque entrega gratuita antes de a activar.");
        }
        BigDecimal freeOver = decimal(input.freeOver(), "freeOver", errors, false);
        if (freeOver != null && freeOver.signum() <= 0) {
            errors.put("freeOver", "O limiar de entrega gratuita tem de ser positivo.");
        }
        if (!errors.isEmpty()) {
            throw new InvalidRequestException(errors);
        }
        return new Validated(
                name, fee, freeOver, blank(input.leadTime(), 160), blank(input.schedule(), 300),
                active, input.displayOrder() == null ? 0 : input.displayOrder(), free);
    }

    private static BigDecimal decimal(String raw, String field, Map<String, String> errors, boolean required) {
        if (raw == null || raw.isBlank()) {
            if (required) {
                errors.put(field, "Indique a tarifa (0 para entrega gratuita).");
            }
            return null;
        }
        try {
            BigDecimal value = new BigDecimal(raw.trim()).setScale(2, RoundingMode.HALF_UP);
            if (value.signum() < 0) {
                errors.put(field, "O valor não pode ser negativo.");
            }
            return value;
        } catch (NumberFormatException ex) {
            errors.put(field, "Valor numérico inválido.");
            return null;
        }
    }

    private static String blank(String value, int max) {
        if (value == null || value.isBlank()) {
            return null;
        }
        String trimmed = value.trim();
        return trimmed.length() > max ? trimmed.substring(0, max) : trimmed;
    }
}
