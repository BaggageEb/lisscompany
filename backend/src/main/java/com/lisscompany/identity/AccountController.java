package com.lisscompany.identity;

import java.util.List;
import java.util.UUID;

import org.springframework.http.HttpStatus;
import org.springframework.security.core.Authentication;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

import com.lisscompany.shared.error.UnauthorizedException;

import jakarta.servlet.http.HttpServletRequest;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotNull;

/**
 * API da área do cliente (fase 7): perfil, moradas guardadas e alteração de
 * palavra-passe. Todas as rotas exigem sessão autenticada (cadeia de
 * segurança) e o próprio serviço filtra por dono — o identificador vem da
 * sessão, nunca do corpo do pedido.
 */
@RestController
@RequestMapping("/api/v1/account")
public class AccountController {

    private final AccountService service;

    public AccountController(AccountService service) {
        this.service = service;
    }

    @GetMapping("/profile")
    public AccountService.ProfileView profile() {
        return service.profile(principal());
    }

    @PutMapping("/profile")
    public AccountService.ProfileView updateProfile(@Valid @RequestBody AccountService.ProfileInput input) {
        return service.updateProfile(principal(), input);
    }

    /** Alteração de palavra-passe: exige a actual; 422 com o campo se errar. */
    @PostMapping("/change-password")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void changePassword(
            @Valid @RequestBody AccountService.ChangePasswordInput input, HttpServletRequest request) {
        service.changePassword(principal(), input, request);
    }

    @GetMapping("/addresses")
    public List<AccountService.AddressView> addresses() {
        return service.addresses(principal());
    }

    @PostMapping("/addresses")
    @ResponseStatus(HttpStatus.CREATED)
    public AccountService.AddressView createAddress(@Valid @RequestBody AccountService.AddressInput input) {
        return service.createAddress(principal(), input);
    }

    @PutMapping("/addresses/{id}")
    public AccountService.AddressView updateAddress(
            @PathVariable UUID id, @Valid @RequestBody AccountService.AddressInput input) {
        return service.updateAddress(principal(), id, input);
    }

    @DeleteMapping("/addresses/{id}")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void deleteAddress(@PathVariable @NotNull UUID id) {
        service.deleteAddress(principal(), id);
    }

    private CustomerPrincipal principal() {
        Authentication authentication = SecurityContextHolder.getContext().getAuthentication();
        if (authentication == null || !(authentication.getPrincipal() instanceof CustomerPrincipal principal)) {
            throw new UnauthorizedException("NOT_AUTHENTICATED", "Sessão inválida. Volte a entrar.");
        }
        return principal;
    }
}
