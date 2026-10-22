package com.lisscompany;

import static org.assertj.core.api.Assertions.assertThat;

import java.util.UUID;

import org.junit.jupiter.api.AfterAll;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;

import com.lisscompany.audit.AuditLog;
import com.lisscompany.audit.AuditService;

import io.zonky.test.db.postgres.embedded.EmbeddedPostgres;

/**
 * Teste de integração com PostgreSQL real (binários Zonky, sem Docker nem
 * privilégios de root): as migrações do Flyway aplicam-se de raiz e o módulo
 * de auditoria escreve e lê contra a base de dados verdadeira.
 */
@SpringBootTest
class AuditPersistenceIntegrationTest {

    private static EmbeddedPostgres postgres;

    @DynamicPropertySource
    static void datasource(DynamicPropertyRegistry registry) throws Exception {
        postgres = EmbeddedPostgres.start();
        registry.add("spring.datasource.url", () -> postgres.getJdbcUrl("postgres", "postgres"));
        registry.add("spring.datasource.username", () -> "postgres");
        registry.add("spring.datasource.password", () -> "postgres");
    }

    @AfterAll
    static void stopPostgres() throws Exception {
        if (postgres != null) {
            postgres.close();
        }
    }

    @Autowired
    private AuditService auditService;

    @Autowired
    private JdbcTemplate jdbc;

    @Autowired
    private org.springframework.transaction.support.TransactionTemplate transactionTemplate;

    @Test
    void flywayAppliedAllMigrationsSuccessfully() {
        Integer applied = jdbc.queryForObject(
                "SELECT COUNT(*) FROM flyway_schema_history WHERE success = TRUE", Integer.class);
        Integer failed = jdbc.queryForObject(
                "SELECT COUNT(*) FROM flyway_schema_history WHERE success = FALSE", Integer.class);
        assertThat(applied).isNotNull().isGreaterThanOrEqualTo(1);
        assertThat(failed).isZero();
    }

    @Test
    void phaseOneTablesExist() {
        var tables = jdbc.queryForList(
                """
                SELECT table_name FROM information_schema.tables
                WHERE table_schema = 'public'
                ORDER BY table_name
                """, String.class);
        assertThat(tables).contains(
                "address", "app_user", "audit_log", "business_setting",
                "customer_profile", "permission", "role", "role_permission", "user_role");
    }

    @Test
    void auditEntryRoundTrip() {
        UUID actor = UUID.randomUUID();

        // O AuditService exige transacção activa (propagação MANDATORY) — correcto:
        // o registo de auditoria pertence à mesma transacção da acção que descreve.
        AuditLog saved = transactionTemplate.execute(status -> auditService.record(
                actor, "Ana Admin", "SETTING_UPDATED",
                "BusinessSetting", "payment.iban", "IBAN actualizado pela proprietária"));

        assertThat(saved.getId()).isNotNull();
        assertThat(saved.getCreatedAt()).isNotNull();

        var rows = jdbc.queryForList(
                "SELECT action, actor_user_id::text AS actor, details FROM audit_log WHERE id = ?",
                saved.getId());
        assertThat(rows).hasSize(1);
        var row = rows.get(0);
        assertThat(row.get("action")).isEqualTo("SETTING_UPDATED");
        assertThat(row.get("actor").toString()).isEqualTo(actor.toString());
        assertThat(row.get("details")).isEqualTo("IBAN actualizado pela proprietária");
    }

    @Test
    void appUserEnforcesUniqueEmail() {
        UUID dup = UUID.randomUUID();
        jdbc.update("""
                INSERT INTO app_user (id, email, display_name)
                VALUES (?, 'cliente@exemplo.ao', 'Cliente Teste')
                """, dup);
        org.assertj.core.api.Assertions
                .assertThatThrownBy(() -> jdbc.update("""
                        INSERT INTO app_user (id, email, display_name)
                        VALUES (?, 'cliente@exemplo.ao', 'Outro Cliente')
                        """, UUID.randomUUID()))
                .isInstanceOf(org.springframework.dao.DataIntegrityViolationException.class);
    }
}
