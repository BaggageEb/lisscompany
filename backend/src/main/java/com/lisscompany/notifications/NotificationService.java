package com.lisscompany.notifications;

import java.util.UUID;

import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;

/**
 * Notificações de saída. O canal de envio (e-mail/SMS) é uma decisão pendente
 * da proprietária: enquanto não existir, a notificação fica registada com o
 * estado {@code PENDING_CHANNEL}. O corpo/tokens nunca são guardados.
 */
@Service
public class NotificationService {

    private final JdbcTemplate jdbc;

    public NotificationService(JdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    public void queue(UUID userId, String kind, String recipient, String subject) {
        jdbc.update("INSERT INTO notification (user_id, kind, recipient, subject, status) VALUES (?, ?, ?, ?, 'PENDING_CHANNEL')",
                userId, kind, recipient, subject);
    }
}
