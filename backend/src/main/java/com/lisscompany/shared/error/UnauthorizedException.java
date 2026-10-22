package com.lisscompany.shared.error;

import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.ResponseStatus;

/**
 * Credenciais/estado de sessão inválido (401) com envelope {@link ApiError}.
 *
 * <p>Usado pelo login para devolver sempre a <em>mesma</em> mensagem quer o
 * e-mail exista quer não — a API nunca confirma quais registos existem.
 */
@ResponseStatus(HttpStatus.UNAUTHORIZED)
public class UnauthorizedException extends RuntimeException {

    private final String code;

    public UnauthorizedException(String code, String message) {
        super(message);
        this.code = code;
    }

    public String getCode() {
        return code;
    }
}
