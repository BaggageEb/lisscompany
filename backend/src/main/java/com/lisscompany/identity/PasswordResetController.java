package com.lisscompany.identity;

import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;

@RestController
@RequestMapping("/api/v1/auth")
public class PasswordResetController {

    public record ForgotRequest(@NotBlank(message = "Indique o e-mail.") @Size(max = 320) String email) {}

    public record ResetRequest(
            @NotBlank(message = "Link inválido.") @Size(max = 200) String token,
            @NotBlank(message = "Escolha uma palavra-passe.") @Size(max = 72) String newPassword) {}

    private final PasswordResetService service;

    public PasswordResetController(PasswordResetService service) {
        this.service = service;
    }

    /** Sempre 202: nunca revela se o e-mail tem conta. */
    @PostMapping("/forgot")
    @ResponseStatus(HttpStatus.ACCEPTED)
    public void forgot(@Valid @RequestBody ForgotRequest request) {
        service.request(request.email());
    }

    @PostMapping("/reset")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void reset(@Valid @RequestBody ResetRequest request) {
        service.reset(request.token(), request.newPassword());
    }
}
