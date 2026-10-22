package com.lisscompany.shared.error;

import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.ResponseStatus;

/**
 * Autenticação válida mas permissão insuficiente (403) com envelope
 * {@link ApiError}. Distingue-se do 401: a sessão é válida, o utilizador é
 * simplesmente não autorizado (ex.: conta sem privilégio de administração).
 */
@ResponseStatus(HttpStatus.FORBIDDEN)
public class ForbiddenException extends RuntimeException {

    private final String code;

    public ForbiddenException(String code, String message) {
        super(message);
        this.code = code;
    }

    public String getCode() {
        return code;
    }
}
