package com.lisscompany.administration;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import com.lisscompany.shared.security.OwnerGuard;
import com.lisscompany.shared.security.Permissions;

/**
 * Painel de resumo, clientes e auditoria. Só métricas REAIS lidas da base:
 * sem dados de demonstração apresentados como reais.
 */
@RestController
@RequestMapping("/api/v1/admin")
public class AdminDashboardController {

    private final JdbcTemplate jdbc;
    private final OwnerGuard guard;

    public AdminDashboardController(JdbcTemplate jdbc, OwnerGuard guard) {
        this.jdbc = jdbc;
        this.guard = guard;
    }

    private long count(String sql, Object... args) {
        Long value = jdbc.queryForObject(sql, Long.class, args);
        return value == null ? 0 : value;
    }

    @GetMapping("/dashboard")
    @Transactional(readOnly = true)
    public Map<String, Object> dashboard() {
        guard.current(Permissions.DASHBOARD_VIEW);
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("ordersReceived", count("SELECT COUNT(*) FROM customer_order WHERE status = 'RECEIVED'"));
        out.put("ordersConfirmed", count("SELECT COUNT(*) FROM customer_order WHERE status = 'CONFIRMED'"));
        out.put("ordersPreparing", count("SELECT COUNT(*) FROM customer_order WHERE status = 'PREPARING'"));
        out.put("ordersReady", count("SELECT COUNT(*) FROM customer_order WHERE status = 'READY'"));
        out.put("ordersCompleted", count("SELECT COUNT(*) FROM customer_order WHERE status = 'COMPLETED'"));
        out.put("paymentsToReview", count("SELECT COUNT(*) FROM payment p JOIN customer_order o ON o.id = p.order_id"
                + " WHERE p.status IN ('PENDING','UNDER_REVIEW') AND o.status <> 'CANCELLED'"));
        out.put("confirmedSales", jdbc.queryForObject(
                "SELECT COALESCE(SUM(amount),0)::text FROM payment WHERE status IN ('PAID','PARTIALLY_REFUNDED')",
                String.class));
        out.put("salesLast7Days", jdbc.queryForObject(
                "SELECT COALESCE(SUM(amount),0)::text FROM payment WHERE status IN ('PAID','PARTIALLY_REFUNDED')"
                        + " AND reviewed_at >= NOW() - INTERVAL '7 days'", String.class));
        out.put("refundedTotal", jdbc.queryForObject("SELECT COALESCE(SUM(amount),0)::text FROM refund", String.class));
        out.put("customers", count("SELECT COUNT(*) FROM app_user u WHERE u.is_owner = FALSE"
                + " AND NOT EXISTS (SELECT 1 FROM user_role r WHERE r.user_id = u.id)"));
        out.put("lowStockProducts", jdbc.queryForList(
                "SELECT p.name AS \"name\", i.available_qty AS \"qty\" FROM inventory_item i"
                        + " JOIN product p ON p.id = i.product_id WHERE i.available_qty <= 5"
                        + " ORDER BY i.available_qty, p.name LIMIT 10"));
        out.put("soldOutProducts", count("SELECT COUNT(*) FROM inventory_item WHERE available_qty = 0"));
        out.put("soldOutIngredients", count("SELECT COUNT(*) FROM ingredient WHERE active AND stock_qty = 0"));
        out.put("activeProducts", count("SELECT COUNT(*) FROM product WHERE status = 'ACTIVE'"));
        out.put("rewardsRedeemed", count("SELECT COUNT(*) FROM reward_redemption"));
        out.put("loyaltyPointsOutstanding", count("SELECT COALESCE(SUM(points_balance),0) FROM loyalty_account"));
        out.put("recentOrders", jdbc.queryForList(
                "SELECT o.order_number AS \"number\", o.status AS \"status\", o.total::text AS \"total\","
                        + " o.contact_name AS \"contactName\", o.created_at AS \"createdAt\""
                        + " FROM customer_order o ORDER BY o.created_at DESC LIMIT 8"));
        return out;
    }

    @GetMapping("/customers")
    @Transactional(readOnly = true)
    public List<Map<String, Object>> customers() {
        guard.current(Permissions.CUSTOMERS_VIEW);
        return jdbc.queryForList(
                "SELECT u.id::text AS \"id\", u.email AS \"email\", u.display_name AS \"displayName\","
                        + " cp.phone AS \"phone\", u.status AS \"status\", u.created_at AS \"createdAt\","
                        + " (SELECT COUNT(*) FROM customer_order o WHERE o.user_id = u.id) AS \"orders\","
                        + " COALESCE((SELECT SUM(o.total) FROM customer_order o JOIN payment p ON p.order_id = o.id"
                        + "   WHERE o.user_id = u.id AND p.status IN ('PAID','PARTIALLY_REFUNDED')),0)::text AS \"spent\","
                        + " COALESCE((SELECT points_balance FROM loyalty_account la WHERE la.user_id = u.id),0) AS \"points\""
                        + " FROM app_user u LEFT JOIN customer_profile cp ON cp.user_id = u.id"
                        + " WHERE u.is_owner = FALSE AND NOT EXISTS (SELECT 1 FROM user_role r WHERE r.user_id = u.id)"
                        + " ORDER BY u.created_at DESC LIMIT 500");
    }

    @GetMapping("/audit")
    @Transactional(readOnly = true)
    public List<Map<String, Object>> audit(
            @RequestParam(name = "q", required = false) String q,
            @RequestParam(name = "limit", defaultValue = "100") int limit) {
        guard.current(Permissions.AUDIT_VIEW);
        int size = Math.max(1, Math.min(limit, 300));
        String like = q == null || q.isBlank() ? "%" : "%" + q.trim().toLowerCase() + "%";
        return jdbc.queryForList(
                "SELECT id AS \"id\", action AS \"action\", entity_type AS \"entityType\", entity_id AS \"entityId\","
                        + " actor_label AS \"actor\", details AS \"details\", created_at AS \"createdAt\""
                        + " FROM audit_log WHERE LOWER(action || ' ' || COALESCE(actor_label,'') || ' ' ||"
                        + " COALESCE(details,'')) LIKE ? ORDER BY id DESC LIMIT ?",
                like, size);
    }
}
