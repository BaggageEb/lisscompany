package com.lisscompany.identity;

import java.security.SecureRandom;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;

import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import com.lisscompany.audit.AuditService;
import com.lisscompany.shared.error.ConflictException;
import com.lisscompany.shared.error.ForbiddenException;
import com.lisscompany.shared.error.InvalidRequestException;
import com.lisscompany.shared.error.NotFoundException;
import com.lisscompany.shared.security.OwnerGuard;
import com.lisscompany.shared.security.Permissions;

/**
 * Contas secundárias (colaboradores), papéis e permissões.
 *
 * <p>Protecções contra escalada de privilégios (sempre no servidor): ninguém
 * altera a própria conta, a proprietária principal nunca é alterada por
 * terceiros, uma conta só atribui papéis cujas permissões ela própria tem e
 * apenas a proprietária concede {@code STAFF_MANAGE}. Desactivar uma conta
 * termina as suas sessões. Palavras-passe temporárias são geradas no servidor
 * e mostradas uma única vez.
 */
@Service
public class StaffService {

    public record RoleView(String id, String code, String name, boolean system, List<String> permissions) {}

    public record StaffView(
            String id, String email, String displayName, String status, boolean owner, List<String> roles,
            String lastLoginAt, String createdAt) {}

    public record CreatedStaff(StaffView user, String temporaryPassword) {}

    public record CreateInput(String email, String displayName, List<String> roleIds) {}

    public record UpdateInput(String displayName, String status, List<String> roleIds) {}

    public record RoleInput(String name, List<String> permissions) {}

    private static final String ALPHABET = "abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789";
    private static final SecureRandom RANDOM = new SecureRandom();

    private final JdbcTemplate jdbc;
    private final AppUserRepository users;
    private final PasswordEncoder encoder;
    private final AuditService audit;
    private final OwnerGuard guard;
    private final UserSessionRegistry sessions;

    public StaffService(
            JdbcTemplate jdbc, AppUserRepository users, PasswordEncoder encoder, AuditService audit,
            OwnerGuard guard, UserSessionRegistry sessions) {
        this.jdbc = jdbc;
        this.users = users;
        this.encoder = encoder;
        this.audit = audit;
        this.guard = guard;
        this.sessions = sessions;
    }

    /* -------------------------------- Leitura ---------------------------- */

    @Transactional(readOnly = true)
    public List<RoleView> roles() {
        return jdbc.query("SELECT id::text, code, name, is_system FROM role ORDER BY is_system DESC, name",
                (rs, n) -> new RoleView(rs.getString(1), rs.getString(2), rs.getString(3), rs.getBoolean(4),
                        jdbc.queryForList("SELECT p.code FROM role_permission rp JOIN permission p ON p.id = rp.permission_id"
                                + " WHERE rp.role_id = ?::uuid ORDER BY p.code", String.class, rs.getString(1))));
    }

    @Transactional(readOnly = true)
    public List<Map<String, Object>> permissions() {
        return jdbc.queryForList("SELECT code AS \"code\", description AS \"description\" FROM permission ORDER BY code");
    }

    @Transactional(readOnly = true)
    public List<StaffView> staff() {
        return jdbc.queryForList(
                        "SELECT u.id FROM app_user u WHERE u.is_owner OR EXISTS"
                                + " (SELECT 1 FROM user_role r WHERE r.user_id = u.id) ORDER BY u.is_owner DESC, u.display_name",
                        UUID.class)
                .stream().map(this::view).toList();
    }

    private StaffView view(UUID id) {
        AppUser u = users.findById(id).orElseThrow(() -> new NotFoundException("USER_NOT_FOUND", "Conta não encontrada."));
        List<String> roles = jdbc.queryForList(
                "SELECT r.name FROM user_role ur JOIN role r ON r.id = ur.role_id WHERE ur.user_id = ? ORDER BY r.name",
                String.class, id);
        return new StaffView(
                id.toString(), u.getEmail(), u.getDisplayName(), u.getStatus().name(), u.isOwner(), roles,
                u.getLastLoginAt() == null ? null : u.getLastLoginAt().toString(), u.getCreatedAt().toString());
    }

    /* ------------------------------- Contas ------------------------------ */

    @Transactional
    public CreatedStaff create(CreateInput input, AppUser actor) {
        Map<String, String> errors = new LinkedHashMap<>();
        String email = input.email() == null ? "" : input.email().trim().toLowerCase();
        if (!email.matches("^[^@\\s]+@[^@\\s]+\\.[^@\\s]+$") || email.length() > 320) {
            errors.put("email", "E-mail inválido.");
        }
        String name = input.displayName() == null ? "" : input.displayName().trim();
        if (name.length() < 2 || name.length() > 120) {
            errors.put("displayName", "Indique o nome (2 a 120 caracteres).");
        }
        List<String> roleIds = input.roleIds() == null ? List.of() : input.roleIds();
        if (roleIds.isEmpty()) {
            errors.put("roleIds", "Escolha pelo menos um papel.");
        }
        if (!errors.isEmpty()) {
            throw new InvalidRequestException(errors);
        }
        if (users.existsByEmail(email)) {
            throw new ConflictException("EMAIL_TAKEN", "Já existe uma conta com este e-mail.");
        }
        assertCanGrant(actor, roleIds);

        String temporary = generatePassword();
        AppUser user = new AppUser();
        user.setEmail(email);
        user.setDisplayName(name);
        user.setPasswordHash(encoder.encode(temporary));
        user.setStatus(UserStatus.ACTIVE);
        users.saveAndFlush(user);
        grant(user.getId(), roleIds, actor.getId());
        audit.record(actor.getId(), actor.getEmail(), "staff.created", "app_user", user.getId().toString(),
                "Conta secundária criada: " + email + " · papéis: " + roleNames(roleIds));
        return new CreatedStaff(view(user.getId()), temporary);
    }

    @Transactional
    public StaffView update(UUID id, UpdateInput input, AppUser actor) {
        AppUser target = users.findById(id).orElseThrow(() -> new NotFoundException("USER_NOT_FOUND", "Conta não encontrada."));
        assertEditable(target, actor);
        if (input.displayName() != null && !input.displayName().isBlank()) {
            String name = input.displayName().trim();
            if (name.length() < 2 || name.length() > 120) {
                throw new InvalidRequestException(Map.of("displayName", "Nome inválido (2 a 120 caracteres)."));
            }
            target.setDisplayName(name);
        }
        String details = "";
        if (input.status() != null) {
            UserStatus status;
            try {
                status = UserStatus.valueOf(input.status().trim().toUpperCase());
            } catch (IllegalArgumentException ex) {
                throw new InvalidRequestException(Map.of("status", "Estado inválido."));
            }
            if (status == UserStatus.PENDING) {
                throw new InvalidRequestException(Map.of("status", "Estado inválido."));
            }
            target.setStatus(status);
            details += " · estado " + status;
            if (status == UserStatus.DISABLED) {
                sessions.revokeAllExcept(id, null);
            }
        }
        users.saveAndFlush(target);
        if (input.roleIds() != null) {
            if (input.roleIds().isEmpty()) {
                throw new InvalidRequestException(Map.of("roleIds", "Escolha pelo menos um papel."));
            }
            assertCanGrant(actor, input.roleIds());
            jdbc.update("DELETE FROM user_role WHERE user_id = ?", id);
            grant(id, input.roleIds(), actor.getId());
            details += " · papéis: " + roleNames(input.roleIds());
        }
        audit.record(actor.getId(), actor.getEmail(), "staff.updated", "app_user", id.toString(),
                "Conta " + target.getEmail() + details);
        return view(id);
    }

    @Transactional
    public CreatedStaff resetPassword(UUID id, AppUser actor) {
        AppUser target = users.findById(id).orElseThrow(() -> new NotFoundException("USER_NOT_FOUND", "Conta não encontrada."));
        assertEditable(target, actor);
        String temporary = generatePassword();
        target.setPasswordHash(encoder.encode(temporary));
        target.setFailedLoginAttempts(0);
        target.setLockedUntil(null);
        users.saveAndFlush(target);
        sessions.revokeAllExcept(id, null);
        audit.record(actor.getId(), actor.getEmail(), "staff.password_reset", "app_user", id.toString(),
                "Palavra-passe temporária gerada para " + target.getEmail());
        return new CreatedStaff(view(id), temporary);
    }

    /* -------------------------------- Papéis ----------------------------- */

    @Transactional
    public RoleView saveRole(UUID id, RoleInput input, AppUser actor) {
        String name = input.name() == null ? "" : input.name().trim();
        if (name.length() < 2 || name.length() > 120) {
            throw new InvalidRequestException(Map.of("name", "Indique o nome do papel (2 a 120 caracteres)."));
        }
        List<String> perms = input.permissions() == null ? List.of() : input.permissions();
        if (perms.isEmpty() || !Permissions.ALL.containsAll(perms)) {
            throw new InvalidRequestException(Map.of("permissions", "Escolha permissões válidas (pelo menos uma)."));
        }
        Set<String> mine = guard.permissionsOf(actor);
        if (!mine.containsAll(perms)) {
            throw new ForbiddenException("PRIVILEGE_ESCALATION", "Não pode conceder permissões que a sua conta não tem.");
        }
        if (!actor.isOwner() && perms.contains(Permissions.STAFF_MANAGE)) {
            throw new ForbiddenException("PRIVILEGE_ESCALATION", "Só a proprietária concede a gestão de contas.");
        }
        String roleId;
        if (id == null) {
            String code = "CUSTOM_" + UUID.randomUUID().toString().substring(0, 8).toUpperCase();
            roleId = jdbc.queryForObject(
                    "INSERT INTO role (code, name, is_system) VALUES (?, ?, FALSE) RETURNING id::text", String.class, code, name);
        } else {
            List<Boolean> system = jdbc.queryForList("SELECT is_system FROM role WHERE id = ?", Boolean.class, id);
            if (system.isEmpty()) {
                throw new NotFoundException("ROLE_NOT_FOUND", "Papel não encontrado.");
            }
            if (system.get(0)) {
                throw new ConflictException("ROLE_SYSTEM", "Os papéis de sistema não podem ser alterados.");
            }
            roleId = id.toString();
            jdbc.update("UPDATE role SET name = ?, updated_at = NOW() WHERE id = ?::uuid", name, roleId);
            jdbc.update("DELETE FROM role_permission WHERE role_id = ?::uuid", roleId);
        }
        for (String code : perms) {
            jdbc.update("INSERT INTO role_permission (role_id, permission_id)"
                    + " SELECT ?::uuid, id FROM permission WHERE code = ?", roleId, code);
        }
        audit.record(actor.getId(), actor.getEmail(), id == null ? "role.created" : "role.updated", "role", roleId,
                "Papel «" + name + "» · " + String.join(", ", perms));
        return roles().stream().filter(r -> r.id().equals(roleId)).findFirst().orElseThrow();
    }

    /* ------------------------------ Protecções --------------------------- */

    private void assertEditable(AppUser target, AppUser actor) {
        if (target.isOwner()) {
            throw new ForbiddenException("OWNER_PROTECTED", "A conta da proprietária principal não pode ser alterada aqui.");
        }
        if (target.getId().equals(actor.getId())) {
            throw new ForbiddenException("SELF_EDIT", "Não pode alterar a sua própria conta de acesso.");
        }
        Integer staffRoles = jdbc.queryForObject("SELECT COUNT(*) FROM user_role WHERE user_id = ?", Integer.class, target.getId());
        if (staffRoles == null || staffRoles == 0) {
            throw new NotFoundException("USER_NOT_FOUND", "Conta secundária não encontrada.");
        }
    }

    /** Uma conta só atribui papéis cujas permissões ela própria tem; STAFF_MANAGE só a proprietária. */
    private void assertCanGrant(AppUser actor, List<String> roleIds) {
        Set<String> mine = guard.permissionsOf(actor);
        for (String roleId : roleIds) {
            List<String> perms;
            try {
                perms = jdbc.queryForList("SELECT p.code FROM role_permission rp JOIN permission p ON p.id = rp.permission_id"
                        + " WHERE rp.role_id = ?::uuid", String.class, roleId);
                Integer exists = jdbc.queryForObject("SELECT COUNT(*) FROM role WHERE id = ?::uuid", Integer.class, roleId);
                if (exists == null || exists == 0) {
                    throw new NotFoundException("ROLE_NOT_FOUND", "Papel não encontrado.");
                }
            } catch (org.springframework.dao.DataAccessException ex) {
                throw new NotFoundException("ROLE_NOT_FOUND", "Papel não encontrado.");
            }
            if (!mine.containsAll(perms) || (!actor.isOwner() && perms.contains(Permissions.STAFF_MANAGE))) {
                throw new ForbiddenException("PRIVILEGE_ESCALATION", "Não pode atribuir um papel com permissões superiores às suas.");
            }
        }
    }

    private void grant(UUID userId, List<String> roleIds, UUID grantedBy) {
        for (String roleId : roleIds) {
            jdbc.update("INSERT INTO user_role (user_id, role_id, granted_by) VALUES (?, ?::uuid, ?)"
                    + " ON CONFLICT DO NOTHING", userId, roleId, grantedBy);
        }
    }

    private String roleNames(List<String> roleIds) {
        List<String> names = new java.util.ArrayList<>();
        for (String id : roleIds) {
            List<String> found = jdbc.queryForList("SELECT name FROM role WHERE id = ?::uuid", String.class, id);
            if (!found.isEmpty()) {
                names.add(found.get(0));
            }
        }
        return String.join(", ", names);
    }

    private static String generatePassword() {
        StringBuilder sb = new StringBuilder();
        for (int i = 0; i < 14; i++) {
            sb.append(ALPHABET.charAt(RANDOM.nextInt(ALPHABET.length())));
        }
        return sb.toString();
    }
}
