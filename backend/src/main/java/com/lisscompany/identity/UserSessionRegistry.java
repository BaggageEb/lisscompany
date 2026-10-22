package com.lisscompany.identity;

import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;

import org.springframework.stereotype.Component;

import jakarta.servlet.http.HttpSession;
import jakarta.servlet.http.HttpSessionEvent;
import jakarta.servlet.http.HttpSessionListener;

/**
 * Sessões activas por conta (fase 7 — «Segurança da conta»).
 *
 * <p>O registo é em memória e acompanha a sessão HTTP do contentor: o cliente
 * vê as suas sessões com um <em>handle</em> opaco (nunca o id real da sessão,
 * que é segredo) e pode terminar as outras. Quando uma sessão termina —
 * logout, expiração ou revogação — o listener limpa a entrada; numa reinicialização
 * o contentor também perde as sessões, pelo que registo e realidade
 * mantêm-se coerentes.
 */
@Component
public class UserSessionRegistry {

    /** Vista para o cliente: handle opaco, quando começou e se é a actual. */
    public record SessionView(String handle, String createdAt, boolean current) {}

    private record Entry(UUID userId, String sessionId, Instant createdAt, HttpSession session) {}

    private final Map<UUID, Entry> entries = new ConcurrentHashMap<>();

    /** Regista a sessão depois de o id estar definitivo (pós-`changeSessionId`). */
    public void register(UUID userId, String sessionId, HttpSession session) {
        // Re-login na mesma sessão não deve duplicar entradas.
        removeBySessionId(sessionId);
        entries.put(UUID.randomUUID(), new Entry(userId, sessionId, Instant.now(), session));
    }

    /** Chamado quando qualquer sessão termina (logout, timeout, invalidate). */
    public void removeBySessionId(String sessionId) {
        entries.entrySet().removeIf(entry -> entry.getValue().sessionId().equals(sessionId));
    }

    /** Sessões da conta, com a actual marcada — mais recentes primeiro. */
    public List<SessionView> list(UUID userId, String currentSessionId) {
        List<SessionView> views = new ArrayList<>();
        for (Map.Entry<UUID, Entry> entry : entries.entrySet()) {
            Entry value = entry.getValue();
            if (value.userId().equals(userId)) {
                views.add(new SessionView(
                        entry.getKey().toString(),
                        value.createdAt().toString(),
                        value.sessionId().equals(currentSessionId)));
            }
        }
        views.sort((a, b) -> b.createdAt().compareTo(a.createdAt()));
        return views;
    }

    /**
     * Termina uma sessão da conta pelo handle. Devolve {@code false} quando o
     * handle não existe ou pertence a outra conta (o chamador responde 404 —
     * sem revelar terceiros).
     */
    public boolean revoke(UUID userId, String handle) {
        UUID handleId;
        try {
            handleId = UUID.fromString(handle);
        } catch (IllegalArgumentException invalid) {
            return false;
        }
        Entry entry = entries.get(handleId);
        if (entry == null || !entry.userId().equals(userId)) {
            return false;
        }
        entries.remove(handleId);
        try {
            entry.session().invalidate();
        } catch (IllegalStateException alreadyGone) {
            // Já terminou entretanto — o efeito pedido cumpriu-se.
        }
        return true;
    }

    /** Termina todas as sessões da conta excepto a indicada (ex.: após alterar palavra-passe). */
    public int revokeAllExcept(UUID userId, String keepSessionId) {
        List<UUID> doomed = new ArrayList<>();
        for (Map.Entry<UUID, Entry> entry : entries.entrySet()) {
            Entry value = entry.getValue();
            if (value.userId().equals(userId) && !value.sessionId().equals(keepSessionId)) {
                doomed.add(entry.getKey());
            }
        }
        for (UUID handle : doomed) {
            Entry entry = entries.remove(handle);
            if (entry != null) {
                try {
                    entry.session().invalidate();
                } catch (IllegalStateException alreadyGone) {
                    // Sessão já terminada — nada a fazer.
                }
            }
        }
        return doomed.size();
    }

    /**
     * Registado automaticamente pelo Spring Boot (beans `EventListener` são
     * servlet listeners): garante que logout/expiração limpam o registo.
     */
    @Component
    public static class SessionCleanupListener implements HttpSessionListener {

        private final UserSessionRegistry registry;

        public SessionCleanupListener(UserSessionRegistry registry) {
            this.registry = registry;
        }

        @Override
        public void sessionDestroyed(HttpSessionEvent event) {
            registry.removeBySessionId(event.getSession().getId());
        }
    }
}
