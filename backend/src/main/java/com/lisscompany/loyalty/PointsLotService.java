package com.lisscompany.loyalty;

import java.sql.Timestamp;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;

import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;

/**
 * Lotes de pontos e a sua validade.
 *
 * <p>Cada crédito de pontos é um <em>lote</em> com data de ganho e (se a loja
 * definiu um prazo) data de caducidade. Os gastos consomem lotes por ordem
 * de caducidade (FIFO); a expiração só retira o que sobrou de cada lote
 * vencido. Assim:
 * <ul>
 *   <li>um crédito parcialmente utilizado só expira a parte por gastar;</li>
 *   <li>pontos de lotes ainda válidos nunca são tocados;</li>
 *   <li>pontos já caducados nunca podem ser gastos — não fazem parte de
 *       {@link #usableBalance}.</li>
 * </ul>
 *
 * <p>Esta classe só trata de lotes (SQL). O saldo da conta e o livro-razão
 * ({@code loyalty_transaction}) são mantidos pelo {@link LoyaltyService},
 * que chama estes métodos na mesma transacção.
 *
 * <p>O prazo é a configuração global {@code loyalty.points_validity_days}
 * (tabela {@code business_setting}); ausente = os pontos não expiram.
 */
@Service
public class PointsLotService {

    static final String VALIDITY_KEY = "loyalty.points_validity_days";

    /** Limite superior defensivo: 10 anos. */
    public static final int MAX_VALIDITY_DAYS = 3650;

    /** Pontos que caducam numa data (para mostrar ao cliente). */
    public record Expiring(Instant at, int points) {}

    private final JdbcTemplate jdbc;

    public PointsLotService(JdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    /* ------------------------------ Configuração ------------------------------ */

    /** Prazo de validade em dias, ou {@code null} se os pontos não expiram. */
    @Transactional(readOnly = true, propagation = Propagation.SUPPORTS)
    public Integer validityDays() {
        List<String> values = jdbc.queryForList(
                "SELECT value FROM business_setting WHERE key = ?", String.class, VALIDITY_KEY);
        if (values.isEmpty() || values.get(0) == null || values.get(0).isBlank()) {
            return null;
        }
        try {
            int days = Integer.parseInt(values.get(0).trim());
            return days > 0 ? days : null;
        } catch (NumberFormatException ex) {
            return null;
        }
    }

    /** Grava (ou remove, com {@code null}) o prazo global. */
    @Transactional
    public void storeValidityDays(Integer days, UUID actorId) {
        if (days == null) {
            jdbc.update("DELETE FROM business_setting WHERE key = ?", VALIDITY_KEY);
            return;
        }
        jdbc.update(
                "INSERT INTO business_setting (key, value, value_type, updated_by, updated_at)"
                        + " VALUES (?, ?, 'NUMBER', ?, NOW())"
                        + " ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value,"
                        + " value_type = EXCLUDED.value_type, updated_by = EXCLUDED.updated_by, updated_at = NOW()",
                VALIDITY_KEY, String.valueOf(days), actorId);
    }

    /**
     * Aplica o prazo a TODOS os lotes com pontos por gastar: a caducidade passa
     * a ser «data de ganho + prazo» (ou nenhuma, sem prazo). Lotes já expirados
     * ou esgotados não são reabertos.
     */
    @Transactional
    public int applyValidityToExistingLots(Integer days) {
        if (days == null) {
            return jdbc.update(
                    "UPDATE loyalty_point_lot SET expires_at = NULL WHERE remaining_points > 0");
        }
        return jdbc.update(
                "UPDATE loyalty_point_lot SET expires_at = earned_at + (? * INTERVAL '1 day')"
                        + " WHERE remaining_points > 0",
                days);
    }

    /** Quantos pontos (e de quantas contas) caducariam já com um prazo hipotético. */
    @Transactional(readOnly = true)
    public int[] previewImmediateExpiry(Integer days, Instant now) {
        if (days == null) {
            return new int[] {0, 0};
        }
        return jdbc.queryForObject(
                "SELECT COALESCE(SUM(remaining_points), 0), COUNT(DISTINCT account_id)"
                        + " FROM loyalty_point_lot"
                        + " WHERE remaining_points > 0 AND earned_at + (? * INTERVAL '1 day') <= ?",
                (rs, row) -> new int[] {rs.getInt(1), rs.getInt(2)},
                days, Timestamp.from(now));
    }

    /* --------------------------------- Lotes ---------------------------------- */

    /** Novo lote por um crédito de pontos já gravado no livro-razão. */
    @Transactional
    public void addLot(UUID accountId, UUID sourceTransactionId, int points, Instant earnedAt) {
        if (points <= 0) {
            return;
        }
        Integer days = validityDays();
        Instant expiresAt = days == null ? null : earnedAt.plus(days, ChronoUnit.DAYS);
        jdbc.update(
                "INSERT INTO loyalty_point_lot"
                        + " (account_id, source_transaction_id, earned_points, remaining_points, earned_at, expires_at)"
                        + " VALUES (?, ?, ?, ?, ?, ?)",
                accountId, sourceTransactionId, points, points, Timestamp.from(earnedAt),
                expiresAt == null ? null : Timestamp.from(expiresAt));
    }

    /**
     * Consome {@code points} dos lotes válidos da conta (caducidade mais próxima
     * primeiro; sem caducidade por último) e regista que lotes pagaram o
     * movimento. Devolve quantos pontos conseguiu retirar dos lotes.
     */
    @Transactional
    public int consume(UUID accountId, UUID transactionId, int points, Instant now) {
        if (points <= 0) {
            return 0;
        }
        List<Object[]> lots = jdbc.query(
                "SELECT id, remaining_points FROM loyalty_point_lot"
                        + " WHERE account_id = ? AND remaining_points > 0"
                        + " AND (expires_at IS NULL OR expires_at > ?)"
                        + " ORDER BY expires_at NULLS LAST, earned_at, id FOR UPDATE",
                (rs, row) -> new Object[] {rs.getObject(1, UUID.class), rs.getInt(2)},
                accountId, Timestamp.from(now));
        int left = points;
        for (Object[] lot : lots) {
            if (left == 0) {
                break;
            }
            UUID lotId = (UUID) lot[0];
            int take = Math.min(left, (Integer) lot[1]);
            jdbc.update("UPDATE loyalty_point_lot SET remaining_points = remaining_points - ? WHERE id = ?",
                    take, lotId);
            jdbc.update(
                    "INSERT INTO loyalty_lot_consumption (lot_id, transaction_id, points) VALUES (?, ?, ?)",
                    lotId, transactionId, take);
            left -= take;
        }
        return points - left;
    }

    /**
     * Devolve os pontos de um movimento de gasto cancelado aos lotes de onde
     * saíram. Se o lote já expirou, os pontos regressam num lote novo (o
     * cliente não perde por um cancelamento que não foi culpa sua). Devolve
     * o total restituído.
     */
    @Transactional
    public int restore(UUID accountId, UUID transactionId, UUID restoredTransactionId, Instant now) {
        List<Object[]> used = jdbc.query(
                "SELECT c.lot_id, c.points, l.expired_at IS NULL FROM loyalty_lot_consumption c"
                        + " JOIN loyalty_point_lot l ON l.id = c.lot_id WHERE c.transaction_id = ?",
                (rs, row) -> new Object[] {rs.getObject(1, UUID.class), rs.getInt(2), rs.getBoolean(3)},
                transactionId);
        int total = 0;
        int toNewLot = 0;
        for (Object[] row : used) {
            UUID lotId = (UUID) row[0];
            int points = (Integer) row[1];
            total += points;
            if ((Boolean) row[2]) {
                jdbc.update(
                        "UPDATE loyalty_point_lot SET remaining_points = remaining_points + ? WHERE id = ?",
                        points, lotId);
            } else {
                toNewLot += points;
            }
        }
        if (toNewLot > 0) {
            addLot(accountId, restoredTransactionId, toNewLot, now);
        }
        return total;
    }

    /**
     * Marca como expirado o que resta de todos os lotes vencidos da conta e
     * devolve o total de pontos expirados. O saldo e o livro-razão são
     * actualizados pelo chamador.
     */
    @Transactional
    public int expireDue(UUID accountId, Instant now) {
        Integer expired = jdbc.queryForObject(
                "WITH due AS ("
                        + "  UPDATE loyalty_point_lot SET expired_points = expired_points + remaining_points,"
                        + "         remaining_points = 0, expired_at = ?"
                        + "  WHERE account_id = ? AND remaining_points > 0"
                        + "    AND expires_at IS NOT NULL AND expires_at <= ?"
                        + "  RETURNING expired_points"
                        + ") SELECT COALESCE(SUM(expired_points), 0) FROM due",
                Integer.class, Timestamp.from(now), accountId, Timestamp.from(now));
        return expired == null ? 0 : expired;
    }

    /** Contas com pelo menos um lote vencido (para o varrimento periódico). */
    @Transactional(readOnly = true)
    public List<UUID> accountsWithDueLots(Instant now) {
        return new ArrayList<>(jdbc.queryForList(
                "SELECT DISTINCT account_id FROM loyalty_point_lot"
                        + " WHERE remaining_points > 0 AND expires_at IS NOT NULL AND expires_at <= ?",
                UUID.class, Timestamp.from(now)));
    }

    /* --------------------------------- Leitura -------------------------------- */

    /** Pontos que o cliente pode realmente gastar agora (lotes não vencidos). */
    @Transactional(readOnly = true)
    public int usableBalance(UUID accountId, Instant now) {
        Integer value = jdbc.queryForObject(
                "SELECT COALESCE(SUM(remaining_points), 0) FROM loyalty_point_lot"
                        + " WHERE account_id = ? AND remaining_points > 0"
                        + " AND (expires_at IS NULL OR expires_at > ?)",
                Integer.class, accountId, Timestamp.from(now));
        return value == null ? 0 : value;
    }

    /** Pontos por gastar em todas as contas. */
    @Transactional(readOnly = true)
    public long outstandingPoints() {
        Long value = jdbc.queryForObject(
                "SELECT COALESCE(SUM(remaining_points), 0) FROM loyalty_point_lot WHERE remaining_points > 0",
                Long.class);
        return value == null ? 0 : value;
    }

    /** Pontos que caducam nos próximos {@code days} dias (todas as contas). */
    @Transactional(readOnly = true)
    public long expiringWithin(Instant from, int days) {
        Long value = jdbc.queryForObject(
                "SELECT COALESCE(SUM(remaining_points), 0) FROM loyalty_point_lot"
                        + " WHERE remaining_points > 0 AND expires_at IS NOT NULL AND expires_at > ? AND expires_at <= ?",
                Long.class, Timestamp.from(from), Timestamp.from(from.plus(days, ChronoUnit.DAYS)));
        return value == null ? 0 : value;
    }

    /** Próxima data em que caducam pontos e quantos (ou {@code null}). */
    @Transactional(readOnly = true)
    public Expiring nextExpiry(UUID accountId, Instant now) {
        List<Expiring> rows = jdbc.query(
                "SELECT expires_at, SUM(remaining_points) FROM loyalty_point_lot"
                        + " WHERE account_id = ? AND remaining_points > 0 AND expires_at IS NOT NULL AND expires_at > ?"
                        + " GROUP BY expires_at ORDER BY expires_at LIMIT 1",
                (rs, row) -> new Expiring(rs.getTimestamp(1).toInstant(), rs.getInt(2)),
                accountId, Timestamp.from(now));
        return rows.isEmpty() ? null : rows.get(0);
    }
}
