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
import com.lisscompany.shared.error.InvalidRequestException;
import com.lisscompany.shared.error.NotFoundException;

/**
 * Zonas e tarifas de entrega — configuradas pela proprietária, nunca
 * inventadas. Sem zonas activas, a entrega continua possível «a combinar»
 * (tarifa 0) e a UI diz isso; com zonas, a zona é obrigatória e a tarifa é
 * sempre a do servidor.
 */
@Service
public class DeliveryService {

    public record Zone(
            String id,
            String name,
            String fee,
            String freeOver,
            String leadTime,
            String schedule,
            boolean active,
            int displayOrder) {}

    public record ZoneInput(
            String name, String fee, String freeOver, String leadTime, String schedule, Boolean active,
            Integer displayOrder) {}

    private static final String SELECT =
            "SELECT id::text, name, fee::text, free_over::text, lead_time, schedule, active, display_order"
                    + " FROM delivery_zone";

    private final JdbcTemplate jdbc;
    private final AuditService auditService;

    public DeliveryService(JdbcTemplate jdbc, AuditService auditService) {
        this.jdbc = jdbc;
        this.auditService = auditService;
    }

    private static Zone map(java.sql.ResultSet rs, int row) throws java.sql.SQLException {
        return new Zone(
                rs.getString(1), rs.getString(2), money(rs.getString(3)), rs.getString(4) == null ? null : money(rs.getString(4)),
                rs.getString(5), rs.getString(6), rs.getBoolean(7), rs.getInt(8));
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

    /**
     * Zona escolhida na encomenda. Sem zonas activas devolve {@code null}
     * (entrega «a combinar»); com zonas, a escolha é obrigatória e válida.
     */
    @Transactional(readOnly = true)
    public Zone resolveForOrder(String rawZoneId) {
        List<Zone> active = list(true);
        if (active.isEmpty()) {
            return null;
        }
        if (rawZoneId == null || rawZoneId.isBlank()) {
            throw new InvalidRequestException(Map.of("deliveryZoneId", "Escolha a zona de entrega."));
        }
        return active.stream()
                .filter(zone -> zone.id().equals(rawZoneId.trim()))
                .findFirst()
                .orElseThrow(() -> new InvalidRequestException(
                        Map.of("deliveryZoneId", "A zona de entrega escolhida não está disponível.")));
    }

    /** Tarifa: a da zona, ou zero quando o subtotal atinge o limiar de entrega gratuita. */
    public BigDecimal feeFor(Zone zone, BigDecimal subtotal) {
        if (zone.freeOver() != null && subtotal.compareTo(new BigDecimal(zone.freeOver())) >= 0) {
            return BigDecimal.ZERO.setScale(2);
        }
        return new BigDecimal(zone.fee()).setScale(2, RoundingMode.HALF_UP);
    }

    @Transactional
    public Zone create(ZoneInput input, AppUser actor) {
        Validated v = validate(input);
        String id = jdbc.queryForObject(
                "INSERT INTO delivery_zone (name, fee, free_over, lead_time, schedule, active, display_order)"
                        + " VALUES (?, ?, ?, ?, ?, ?, ?) RETURNING id::text",
                String.class, v.name, v.fee, v.freeOver, v.leadTime, v.schedule, v.active, v.order);
        auditService.record(actor.getId(), actor.getEmail(), "delivery.zone_created", "delivery_zone", id,
                "Zona «" + v.name + "» · tarifa " + v.fee.toPlainString() + " Kz");
        return get(id);
    }

    @Transactional
    public Zone update(UUID id, ZoneInput input, AppUser actor) {
        Validated v = validate(input);
        int rows = jdbc.update(
                "UPDATE delivery_zone SET name = ?, fee = ?, free_over = ?, lead_time = ?, schedule = ?,"
                        + " active = ?, display_order = ?, updated_at = NOW() WHERE id = ?",
                v.name, v.fee, v.freeOver, v.leadTime, v.schedule, v.active, v.order, id);
        if (rows == 0) {
            throw new NotFoundException("ZONE_NOT_FOUND", "Zona não encontrada.");
        }
        auditService.record(actor.getId(), actor.getEmail(), "delivery.zone_updated", "delivery_zone", id.toString(),
                "Zona «" + v.name + "» · tarifa " + v.fee.toPlainString() + " Kz · " + (v.active ? "activa" : "inactiva"));
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
            String name, BigDecimal fee, BigDecimal freeOver, String leadTime, String schedule, boolean active, int order) {}

    private static Validated validate(ZoneInput input) {
        Map<String, String> errors = new LinkedHashMap<>();
        String name = input.name() == null ? "" : input.name().trim();
        if (name.length() < 2 || name.length() > 160) {
            errors.put("name", "Indique o nome da zona (2 a 160 caracteres).");
        }
        BigDecimal fee = decimal(input.fee(), "fee", errors, true);
        BigDecimal freeOver = decimal(input.freeOver(), "freeOver", errors, false);
        if (freeOver != null && freeOver.signum() <= 0) {
            errors.put("freeOver", "O limiar de entrega gratuita tem de ser positivo.");
        }
        if (!errors.isEmpty()) {
            throw new InvalidRequestException(errors);
        }
        return new Validated(
                name, fee, freeOver, blank(input.leadTime(), 160), blank(input.schedule(), 300),
                input.active() == null || input.active(), input.displayOrder() == null ? 0 : input.displayOrder());
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
