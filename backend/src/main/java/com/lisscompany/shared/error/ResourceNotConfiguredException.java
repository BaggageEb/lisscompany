package com.lisscompany.shared.error;

import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.ResponseStatus;

/**
 * A aplicação está funcional mas falta uma peça de configuração de negócio
 * (ex.: o produto-base do Cake Studio ainda não foi definido).
 *
 * <p>Devolve 409 com um código específico: é um estado real a comunicar ao
 * operador/loja, nunca um erro 500 nem uma falha silenciosa.
 */
@ResponseStatus(HttpStatus.CONFLICT)
public class ResourceNotConfiguredException extends RuntimeException {

    private final String code;

    public ResourceNotConfiguredException(String code, String message) {
        super(message);
        this.code = code;
    }

    public String getCode() {
        return code;
    }
}
