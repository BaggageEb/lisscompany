package com.lisscompany.shared.error;

import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.ResponseStatus;

/** Recurso pedido que não existe (devolve 404 com o envelope {@link ApiError}). */
@ResponseStatus(HttpStatus.NOT_FOUND)
public class NotFoundException extends RuntimeException {

    private final String code;

    public NotFoundException(String message) {
        this("NOT_FOUND", message);
    }

    public NotFoundException(String code, String message) {
        super(message);
        this.code = code;
    }

    public String getCode() {
        return code;
    }
}
