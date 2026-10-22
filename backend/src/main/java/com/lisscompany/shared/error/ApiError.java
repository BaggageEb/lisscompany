package com.lisscompany.shared.error;

import java.time.Instant;
import java.util.List;
import java.util.Map;

/**
 * Envelope de erro da API.
 *
 * <p>Todas as respostas de erro usam este formato previsível para o cliente:
 * código estável para programação, mensagem legível para humanos e detalhes de
 * campo quando aplicável. Nunca expõe stack traces nem dados sensíveis.
 */
public record ApiError(
        Instant timestamp,
        int status,
        String error,
        String code,
        String message,
        String path,
        Map<String, String> fieldErrors,
        List<String> issues) {

    /** Envelope sem motivos de regra de domínio (a maioria dos erros). */
    public ApiError(
            Instant timestamp,
            int status,
            String error,
            String code,
            String message,
            String path,
            Map<String, String> fieldErrors) {
        this(timestamp, status, error, code, message, path, fieldErrors, List.of());
    }
}
