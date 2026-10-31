package com.lisscompany.shared.security;

import java.util.HashSet;
import java.util.List;
import java.util.Set;
import java.util.UUID;

import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.core.Authentication;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.stereotype.Component;

import com.lisscompany.identity.AppUser;
import com.lisscompany.identity.AppUserRepository;
import com.lisscompany.identity.CustomerPrincipal;
import com.lisscompany.identity.UserStatus;
import com.lisscompany.shared.error.ForbiddenException;
import com.lisscompany.shared.error.UnauthorizedException;

/**
 * Autorização do painel (RBAC granular, sempre no servidor).
 *
 * <p>A proprietária ({@code is_owner}) tem todas as permissões. As contas
 * secundárias recebem permissões através dos papéis ({@code user_role} →
 * {@code role_permission}). Uma conta desactivada perde o acesso de imediato,
 * mesmo com sessão aberta. Negar devolve 403 — nunca 401 nem 500.
 */
@Component
public class OwnerGuard {

    private final AppUserRepository userRepository;
    private final JdbcTemplate jdbc;

    public OwnerGuard(AppUserRepository userRepository, JdbcTemplate jdbc) {
        this.userRepository = userRepository;
        this.jdbc = jdbc;
    }

    /** Principal da sessão actual (401 se não houver). */
    public CustomerPrincipal principal() {
        Authentication authentication = SecurityContextHolder.getContext().getAuthentication();
        if (authentication == null || !(authentication.getPrincipal() instanceof CustomerPrincipal principal)) {
            throw new UnauthorizedException("NOT_AUTHENTICATED", "Sessão inválida. Volte a entrar.");
        }
        return principal;
    }

    /** Exige a permissão para a conta da sessão actual e devolve-a. */
    public AppUser current(String permission) {
        return require(principal().id(), permission);
    }

    /** Apenas a proprietária principal. */
    public AppUser requireOwner(UUID userId) {
        AppUser user = load(userId);
        if (!user.isOwner()) {
            throw new ForbiddenException(
                    "FORBIDDEN", "A sua conta não tem permissão para esta operação. Contacte a loja.");
        }
        return user;
    }

    /** Exige uma permissão concreta (a proprietária tem todas). */
    public AppUser require(UUID userId, String permission) {
        AppUser user = load(userId);
        if (user.isOwner()) {
            return user;
        }
        if (!permissionsOf(user).contains(permission)) {
            throw new ForbiddenException(
                    "FORBIDDEN", "A sua conta não tem permissão para esta operação. Contacte a loja.");
        }
        return user;
    }

    /** Permissões efectivas da conta (vazio para clientes comuns). */
    public Set<String> permissionsOf(AppUser user) {
        if (user.isOwner()) {
            return new HashSet<>(Permissions.ALL);
        }
        List<String> codes = jdbc.queryForList(
                "SELECT DISTINCT p.code FROM user_role ur"
                        + " JOIN role_permission rp ON rp.role_id = ur.role_id"
                        + " JOIN permission p ON p.id = rp.permission_id"
                        + " WHERE ur.user_id = ?",
                String.class,
                user.getId());
        return new HashSet<>(codes);
    }

    private AppUser load(UUID userId) {
        AppUser user = userRepository.findById(userId)
                .orElseThrow(() -> new UnauthorizedException("NOT_AUTHENTICATED", "Sessão inválida. Volte a entrar."));
        if (user.getStatus() != UserStatus.ACTIVE) {
            throw new ForbiddenException("FORBIDDEN", "A sua conta não está activa.");
        }
        return user;
    }
}
