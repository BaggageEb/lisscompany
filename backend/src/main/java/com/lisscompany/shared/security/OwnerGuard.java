package com.lisscompany.shared.security;

import java.util.UUID;

import org.springframework.stereotype.Component;

import com.lisscompany.identity.AppUser;
import com.lisscompany.identity.AppUserRepository;
import com.lisscompany.shared.error.ForbiddenException;
import com.lisscompany.shared.error.UnauthorizedException;

/**
 * Guarda de autorização para as áreas administrativas (fase 5 — revisão de
 * pagamentos; a UI do painel é a fase 7).
 *
 * <p>A regra de ouro: sessão válida <strong>e</strong> conta autorizada. O
 * flag {@code is_owner} é o primeiro nível (a granularidade RBAC dos papéis V1
 * entra na fase 7); negar devolve 403 — nunca 401 nem um 500.
 */
@Component
public class OwnerGuard {

    private final AppUserRepository userRepository;

    public OwnerGuard(AppUserRepository userRepository) {
        this.userRepository = userRepository;
    }

    /** Lança 403 se a conta da sessão não for autorizada para administração. */
    public AppUser requireOwner(UUID userId) {
        AppUser user = userRepository.findById(userId)
                .orElseThrow(() -> new UnauthorizedException("NOT_AUTHENTICATED", "Sessão inválida. Volte a entrar."));
        if (!user.isOwner()) {
            throw new ForbiddenException(
                    "FORBIDDEN", "A sua conta não tem permissão para esta operação. Contacte a loja.");
        }
        return user;
    }
}
