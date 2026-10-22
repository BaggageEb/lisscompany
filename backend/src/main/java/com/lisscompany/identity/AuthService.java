package com.lisscompany.identity;

import java.time.Duration;
import java.time.Instant;
import java.util.List;
import java.util.UUID;

import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.authority.SimpleGrantedAuthority;
import org.springframework.security.core.context.SecurityContext;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.security.web.context.HttpSessionSecurityContextRepository;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import com.lisscompany.shared.error.ConflictException;
import com.lisscompany.shared.error.NotFoundException;
import com.lisscompany.shared.error.UnauthorizedException;

import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;

/**
 * Registo, login e sessão do cliente (fase 4).
 *
 * <p>Regras:
 * <ul>
 *   <li>palavra-passe apenas como hash (BCrypt via {@link PasswordEncoder});</li>
 *   <li>login cria contexto na <em>sessão</em> partilhada com a cadeia de
 *       segurança e roda o id da sessão (protecção contra fixação);</li>
 *   <li>falhas contam para protecção contra força bruta: após
 *       {@value #MAX_FAILED_ATTEMPTS} tentativas a conta fica bloqueada durante
 *       {@link #LOCK_DURATION} (os controlos existem no esquema desde a V1);</li>
 *   <li>o login nunca revela se o e-mail existe — a mensagem é única.</li>
 * </ul>
 */
@Service
public class AuthService {

    /** Público: o teste de integração verifica o comportamento com este limiar. */
    public static final int MAX_FAILED_ATTEMPTS = 5;
    static final Duration LOCK_DURATION = Duration.ofMinutes(15);

    private static final String INVALID_CREDENTIALS_MESSAGE =
            "Credenciais inválidas. Verifique o e-mail e a palavra-passe.";

    private final AppUserRepository userRepository;
    private final CustomerProfileRepository profileRepository;
    private final PasswordEncoder passwordEncoder;
    private final HttpSessionSecurityContextRepository securityContextRepository;
    private final UserSessionRegistry sessionRegistry;
    private final com.lisscompany.audit.AuditService auditService;

    public AuthService(
            AppUserRepository userRepository,
            CustomerProfileRepository profileRepository,
            PasswordEncoder passwordEncoder,
            HttpSessionSecurityContextRepository securityContextRepository,
            UserSessionRegistry sessionRegistry,
            com.lisscompany.audit.AuditService auditService) {
        this.userRepository = userRepository;
        this.profileRepository = profileRepository;
        this.passwordEncoder = passwordEncoder;
        this.securityContextRepository = securityContextRepository;
        this.sessionRegistry = sessionRegistry;
        this.auditService = auditService;
    }

    /* ------------------------------- Views ------------------------------- */

    /**
     * `owner` diz à UI (a autorização continua no servidor) se a conta pode
     * entrar no painel — sem ele o link do painel não existia para clientes.
     */
    public record AuthView(String id, String email, String displayName, String phone, boolean owner) {}

    public record RegisterInput(String email, String displayName, String password, String phone) {}

    public record LoginInput(String email, String password) {}

    /* ------------------------------ Registo ------------------------------ */

    @Transactional
    public AuthView register(RegisterInput input, HttpServletRequest request, HttpServletResponse response) {
        String email = normalizeEmail(input.email());
        if (userRepository.existsByEmail(email)) {
            throw new ConflictException("EMAIL_TAKEN", "Já existe uma conta com este e-mail.");
        }

        AppUser user = new AppUser();
        user.setEmail(email);
        user.setDisplayName(input.displayName().trim());
        user.setPasswordHash(passwordEncoder.encode(input.password()));
        user.setStatus(UserStatus.ACTIVE);
        userRepository.save(user);

        String phone = input.phone() == null || input.phone().isBlank() ? null : input.phone().trim();
        if (phone != null) {
            CustomerProfile profile = new CustomerProfile();
            profile.setId(user.getId());
            profile.setPhone(phone);
            profileRepository.save(profile);
        }

        // O registo entra já autenticado — o cliente não repete credenciais.
        openSession(user, request, response);
        return new AuthView(user.getId().toString(), user.getEmail(), user.getDisplayName(), phone, user.isOwner());
    }

    /* -------------------------------- Login ------------------------------- */

    /**
     * O login falha lançando {@link UnauthorizedException}, mas os contadores de
     * força bruta escritos <em>antes</em> de lançar têm de persistir — sem
     * {@code noRollbackFor} o bloqueio seria desfeito pelo rollback da própria
     * excepção que o originou.
     */
    @Transactional(noRollbackFor = UnauthorizedException.class)
    public AuthView login(LoginInput input, HttpServletRequest request, HttpServletResponse response) {
        String email = normalizeEmail(input.email());
        AppUser user = userRepository.findByEmail(email).orElse(null);
        if (user == null) {
            throw new UnauthorizedException("INVALID_CREDENTIALS", INVALID_CREDENTIALS_MESSAGE);
        }

        Instant now = Instant.now();
        if (user.getLockedUntil() != null && user.getLockedUntil().isAfter(now)) {
            throw new UnauthorizedException(
                    "ACCOUNT_LOCKED",
                    "Conta temporariamente bloqueada por tentativas repetidas. Tente novamente mais tarde.");
        }

        String hash = user.getPasswordHash();
        if (hash == null || !passwordEncoder.matches(input.password(), hash)) {
            int attempts = user.getFailedLoginAttempts() + 1;
            user.setFailedLoginAttempts(attempts >= MAX_FAILED_ATTEMPTS ? 0 : attempts);
            if (attempts >= MAX_FAILED_ATTEMPTS) {
                user.setLockedUntil(now.plus(LOCK_DURATION));
            }
            userRepository.save(user);
            throw new UnauthorizedException("INVALID_CREDENTIALS", INVALID_CREDENTIALS_MESSAGE);
        }

        if (user.getStatus() != UserStatus.ACTIVE) {
            throw new UnauthorizedException("ACCOUNT_DISABLED", "A sua conta não está activa. Contacte a loja.");
        }

        user.setFailedLoginAttempts(0);
        user.setLockedUntil(null);
        user.setLastLoginAt(now);
        userRepository.save(user);

        openSession(user, request, response);
        return new AuthView(
                user.getId().toString(), user.getEmail(), user.getDisplayName(), phoneOf(user.getId()),
                user.isOwner());
    }

    /* ------------------------------- Sessão ------------------------------ */

    @Transactional(readOnly = true)
    public AuthView me(CustomerPrincipal principal) {
        AppUser user = userRepository.findById(principal.id())
                .orElseThrow(() -> new UnauthorizedException("NOT_AUTHENTICATED", "Sessão inválida. Volte a entrar."));
        return new AuthView(
                user.getId().toString(), user.getEmail(), user.getDisplayName(), phoneOf(user.getId()),
                user.isOwner());
    }

    /** Termina a sessão: contexto limpo e cookie de sessão invalidado. */
    public void logout(HttpServletRequest request, HttpServletResponse response) {
        SecurityContextHolder.clearContext();
        var session = request.getSession(false);
        if (session != null) {
            // O listener do registo limpa a entrada no mesmo evento.
            session.invalidate();
        }
    }

    /* ------------------------ Sessões activas (fase 7) ------------------ */

    /** Sessões da conta com handle opaco — a actual está marcada. */
    public List<UserSessionRegistry.SessionView> sessions(CustomerPrincipal principal, HttpServletRequest request) {
        var session = request.getSession(false);
        return sessionRegistry.list(principal.id(), session == null ? null : session.getId());
    }

    /**
     * Termina uma sessão da conta pelo handle. Handles de outras contas dão
     * 404 (sem revelar que existem) — nunca é possível revogar de terceiros.
     */
    @Transactional
    public void revokeSession(CustomerPrincipal principal, String handle) {
        if (!sessionRegistry.revoke(principal.id(), handle)) {
            throw new NotFoundException("SESSION_NOT_FOUND", "Sessão não encontrada.");
        }
        auditService.record(
                principal.id(), principal.email(), "auth.session_revoked", "session", handle,
                "Sessão terminada pela própria conta.");
    }

    /* ------------------------------ Internos ----------------------------- */

    private void openSession(AppUser user, HttpServletRequest request, HttpServletResponse response) {
        // Fixação de sessão: a autenticação roda o id de sessão (os atributos,
        // incluindo o token CSRF, são preservados pelo contentor).
        request.getSession(true);
        request.changeSessionId();

        // Registo de sessões activas com o id JÁ definitivo (pós-rotação).
        var registeredSession = request.getSession(false);
        if (registeredSession != null) {
            sessionRegistry.register(user.getId(), registeredSession.getId(), registeredSession);
        }

        CustomerPrincipal principal = new CustomerPrincipal(user.getId(), user.getEmail(), user.getDisplayName());
        SecurityContext context = SecurityContextHolder.createEmptyContext();
        context.setAuthentication(UsernamePasswordAuthenticationToken.authenticated(
                principal,
                null,
                List.of(new SimpleGrantedAuthority(CustomerPrincipal.AUTHORITY))));
        SecurityContextHolder.setContext(context);
        // Exactamente o repositório configurado na cadeia de segurança: o que é
        // guardado aqui é o que os pedidos seguintes da sessão vão ler.
        securityContextRepository.saveContext(context, request, response);
    }

    private String phoneOf(UUID userId) {
        return profileRepository.findById(userId).map(CustomerProfile::getPhone).orElse(null);
    }

    /** E-mail sempre em minúsculas: a unicidade só faz sentido normalizada. */
    private static String normalizeEmail(String email) {
        return email == null ? null : email.trim().toLowerCase();
    }
}
