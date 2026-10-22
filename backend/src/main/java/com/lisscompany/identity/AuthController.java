package com.lisscompany.identity;

import java.util.List;

import org.springframework.http.HttpStatus;
import org.springframework.security.core.Authentication;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

import com.lisscompany.shared.error.UnauthorizedException;

import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import jakarta.validation.Valid;
import jakarta.validation.constraints.Email;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;

/**
 * API de identidade da fase 4 (sessão de navegador com cookies).
 *
 * <p>{@code register}/{@code login} são públicos mas <strong>continuam sujeitos
 * a CSRF</strong> (o SPA obtém o token em {@code GET /api/v1/csrf}); {@code me}
 * e toda a API privada exigem sessão autenticada.
 */
@RestController
@RequestMapping("/api/v1/auth")
public class AuthController {

    public record RegisterRequest(
            @NotBlank(message = "Indique o e-mail.")
            @Email(message = "E-mail inválido.")
            @Size(max = 320, message = "E-mail demasiado longo.")
            String email,
            @NotBlank(message = "Indique o nome a mostrar.")
            @Size(min = 2, max = 120, message = "O nome deve ter entre 2 e 120 caracteres.")
            String displayName,
            @NotBlank(message = "Escolha uma palavra-passe.")
            @Size(min = 8, max = 72, message = "A palavra-passe deve ter entre 8 e 72 caracteres.")
            String password,
            @Size(max = 30, message = "Telefone demasiado longo.") String phone) {}

    public record LoginRequest(
            @NotBlank(message = "Indique o e-mail.") String email,
            @NotBlank(message = "Indique a palavra-passe.") String password) {}

    private final AuthService service;

    public AuthController(AuthService service) {
        this.service = service;
    }

    @PostMapping("/register")
    @ResponseStatus(HttpStatus.CREATED)
    public AuthService.AuthView register(
            @Valid @RequestBody RegisterRequest request, HttpServletRequest httpRequest, HttpServletResponse httpResponse) {
        return service.register(
                new AuthService.RegisterInput(
                        request.email(), request.displayName(), request.password(), request.phone()),
                httpRequest,
                httpResponse);
    }

    @PostMapping("/login")
    public AuthService.AuthView login(
            @Valid @RequestBody LoginRequest request, HttpServletRequest httpRequest, HttpServletResponse httpResponse) {
        return service.login(
                new AuthService.LoginInput(request.email(), request.password()), httpRequest, httpResponse);
    }

    @PostMapping("/logout")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void logout(HttpServletRequest request, HttpServletResponse response) {
        service.logout(request, response);
    }

    /** Sessões activas da conta (fase 7): handle opaco + marcação da actual. */
    @GetMapping("/sessions")
    public List<UserSessionRegistry.SessionView> sessions(HttpServletRequest request) {
        return service.sessions(principal(), request);
    }

    /** Termina uma sessão desta conta (404 se o handle não for da conta). */
    @PostMapping("/sessions/{handle}/revoke")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void revokeSession(@PathVariable String handle) {
        service.revokeSession(principal(), handle);
    }

    @GetMapping("/me")
    public AuthService.AuthView me() {
        return service.me(principal());
    }

    private CustomerPrincipal principal() {
        Authentication authentication = SecurityContextHolder.getContext().getAuthentication();
        if (authentication == null || !(authentication.getPrincipal() instanceof CustomerPrincipal principal)) {
            throw new UnauthorizedException("NOT_AUTHENTICATED", "Sessão inválida. Volte a entrar.");
        }
        return principal;
    }
}
