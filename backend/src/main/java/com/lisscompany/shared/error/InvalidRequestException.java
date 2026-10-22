package com.lisscompany.shared.error;

import java.util.Map;

/**
 * Requisição rejeitada por validações <em>condicionais</em> que o bean
 * validation não expressa (ex.: morada obrigatória só em entregas).
 *
 * <p>Responde 400 com o mesmo envelope {@code VALIDATION_FAILED} e erros por
 * campo, para a UI tratar todos os erros de formulário de forma uniforme.
 */
public class InvalidRequestException extends RuntimeException {

    private final Map<String, String> fieldErrors;

    public InvalidRequestException(Map<String, String> fieldErrors) {
        super("Dados inválidos.");
        this.fieldErrors = Map.copyOf(fieldErrors);
    }

    public Map<String, String> getFieldErrors() {
        return fieldErrors;
    }
}
