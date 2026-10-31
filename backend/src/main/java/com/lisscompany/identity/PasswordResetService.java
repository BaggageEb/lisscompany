package com.lisscompany.identity;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.security.SecureRandom;
import java.time.Instant;
import java.util.Base64;
import java.util.HexFormat;
import java.util.List;
import java.util.Map;
import java.util.UUID;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import com.lisscompany.audit.AuditService;
import com.lisscompany.notifications.NotificationService;
import com.lisscompany.shared.error.InvalidRequestException;

/**
 * Recuperação de palavra-passe: resposta sempre neutra (não revela se a conta
 * existe), token aleatório de uso único guardado apenas como hash SHA-256, com
 * expiração e limite de pedidos por hora. O canal de envio é pendente: sem ele,
 * a notificação fica em fila e o link só aparece no log em modo de
 * desenvolvimento explícito ({@code app.auth.dev-log-reset-links}).
 */
@Service
public class PasswordResetService {

    private static final Logger log = LoggerFactory.getLogger(PasswordResetService.class);
    private static final SecureRandom RANDOM = new SecureRandom();
    private static final int MAX_REQUESTS_PER_HOUR = 5;

    private final JdbcTemplate jdbc;
    private final AppUserRepository users;
    private final PasswordEncoder encoder;
    private final AuditService audit;
    private final NotificationService notifications;
    private final UserSessionRegistry sessions;
    private final long ttlMinutes;
    private final boolean devLog;
    private final String baseUrl;

    public PasswordResetService(
            JdbcTemplate jdbc, AppUserRepository users, PasswordEncoder encoder, AuditService audit,
            NotificationService notifications, UserSessionRegistry sessions,
            @Value("${app.auth.reset-token-minutes:60}") long ttlMinutes,
            @Value("${app.auth.dev-log-reset-links:false}") boolean devLog,
            @Value("${app.public-base-url:http://localhost:3000}") String baseUrl) {
        this.jdbc = jdbc;
        this.users = users;
        this.encoder = encoder;
        this.audit = audit;
        this.notifications = notifications;
        this.sessions = sessions;
        this.ttlMinutes = ttlMinutes;
        this.devLog = devLog;
        this.baseUrl = baseUrl;
    }

    @Transactional
    public void request(String rawEmail) {
        String email = rawEmail == null ? "" : rawEmail.trim().toLowerCase();
        AppUser user = users.findByEmail(email).orElse(null);
        if (user == null || user.getStatus() != UserStatus.ACTIVE) {
            return; // Resposta neutra: nada revelado.
        }
        Integer recent = jdbc.queryForObject(
                "SELECT COUNT(*) FROM password_reset_token WHERE user_id = ? AND created_at > NOW() - INTERVAL '1 hour'",
                Integer.class, user.getId());
        if (recent != null && recent >= MAX_REQUESTS_PER_HOUR) {
            return;
        }
        jdbc.update("UPDATE password_reset_token SET used_at = NOW() WHERE user_id = ? AND used_at IS NULL", user.getId());
        byte[] bytes = new byte[32];
        RANDOM.nextBytes(bytes);
        String token = Base64.getUrlEncoder().withoutPadding().encodeToString(bytes);
        jdbc.update("INSERT INTO password_reset_token (user_id, token_hash, expires_at) VALUES (?, ?, ?)",
                user.getId(), hash(token), java.sql.Timestamp.from(Instant.now().plusSeconds(ttlMinutes * 60)));
        notifications.queue(user.getId(), "PASSWORD_RESET", user.getEmail(), "Recuperação de palavra-passe");
        audit.record(user.getId(), user.getEmail(), "auth.password_reset_requested", "app_user",
                user.getId().toString(), "Pedido de recuperação de palavra-passe");
        if (devLog) {
            log.warn("DEV reset link para {}: {}/redefinir-palavra-passe?token={}", user.getEmail(), baseUrl, token);
        }
    }

    @Transactional
    public void reset(String token, String newPassword) {
        if (newPassword == null || newPassword.length() < 8 || newPassword.length() > 72) {
            throw new InvalidRequestException(Map.of("newPassword", "A palavra-passe deve ter entre 8 e 72 caracteres."));
        }
        List<Map<String, Object>> rows = jdbc.queryForList(
                "SELECT id, user_id FROM password_reset_token WHERE token_hash = ? AND used_at IS NULL"
                        + " AND expires_at > NOW()", hash(token == null ? "" : token));
        if (rows.isEmpty()) {
            throw new InvalidRequestException(Map.of("token", "Link inválido ou expirado. Peça um novo."));
        }
        UUID tokenId = (UUID) rows.get(0).get("id");
        UUID userId = (UUID) rows.get(0).get("user_id");
        AppUser user = users.findById(userId).orElseThrow(
                () -> new InvalidRequestException(Map.of("token", "Link inválido ou expirado. Peça um novo.")));
        user.setPasswordHash(encoder.encode(newPassword));
        user.setFailedLoginAttempts(0);
        user.setLockedUntil(null);
        users.saveAndFlush(user);
        jdbc.update("UPDATE password_reset_token SET used_at = NOW() WHERE id = ?", tokenId);
        sessions.revokeAllExcept(userId, null);
        audit.record(userId, user.getEmail(), "auth.password_reset_completed", "app_user", userId.toString(),
                "Palavra-passe redefinida por token de recuperação");
    }

    private static String hash(String token) {
        try {
            return HexFormat.of().formatHex(
                    MessageDigest.getInstance("SHA-256").digest(token.getBytes(StandardCharsets.UTF_8)));
        } catch (NoSuchAlgorithmException ex) {
            throw new IllegalStateException(ex);
        }
    }
}
