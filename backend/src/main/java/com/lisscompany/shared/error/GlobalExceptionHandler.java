package com.lisscompany.shared.error;

import java.time.Instant;
import java.util.LinkedHashMap;
import java.util.Map;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.http.converter.HttpMessageNotReadableException;
import org.springframework.web.bind.MethodArgumentNotValidException;
import org.springframework.web.bind.MissingServletRequestParameterException;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;
import org.springframework.web.servlet.resource.NoResourceFoundException;

/**
 * Mapeia excepções para o envelope {@link ApiError}.
 *
 * <p>Regras: validação devolve 400 com erros por campo; recursos inexistentes
 * devolvem 404; qualquer erro inesperado devolve 500 genérico (o detalhe fica
 * no log do servidor, nunca na resposta).
 */
@RestControllerAdvice
public class GlobalExceptionHandler {

    private static final Logger log = LoggerFactory.getLogger(GlobalExceptionHandler.class);

    @ExceptionHandler(MethodArgumentNotValidException.class)
    ResponseEntity<ApiError> handleValidation(MethodArgumentNotValidException ex, jakarta.servlet.http.HttpServletRequest request) {
        Map<String, String> fieldErrors = new LinkedHashMap<>();
        ex.getBindingResult().getFieldErrors()
                .forEach(error -> fieldErrors.putIfAbsent(error.getField(), error.getDefaultMessage()));
        return build(HttpStatus.BAD_REQUEST, "VALIDATION_FAILED", "Dados inválidos.", request, fieldErrors);
    }

    @ExceptionHandler({HttpMessageNotReadableException.class, MissingServletRequestParameterException.class})
    ResponseEntity<ApiError> handleBadRequests(Exception ex, jakarta.servlet.http.HttpServletRequest request) {
        return build(HttpStatus.BAD_REQUEST, "MALFORMED_REQUEST", "Requisição malformada.", request, Map.of());
    }

    @ExceptionHandler(NoResourceFoundException.class)
    ResponseEntity<ApiError> handleNotFound(NoResourceFoundException ex, jakarta.servlet.http.HttpServletRequest request) {
        return build(HttpStatus.NOT_FOUND, "NOT_FOUND", "Recurso não encontrado.", request, Map.of());
    }

    @ExceptionHandler(NotFoundException.class)
    ResponseEntity<ApiError> handleDomainNotFound(NotFoundException ex, jakarta.servlet.http.HttpServletRequest request) {
        return build(HttpStatus.NOT_FOUND, ex.getCode(), ex.getMessage(), request, Map.of());
    }

    /** Falta de configuração de negócio (ex.: produto-base do Cake Studio por definir). */
    @ExceptionHandler(ResourceNotConfiguredException.class)
    ResponseEntity<ApiError> handleNotConfigured(ResourceNotConfiguredException ex, jakarta.servlet.http.HttpServletRequest request) {
        return build(HttpStatus.CONFLICT, ex.getCode(), ex.getMessage(), request, Map.of());
    }

    /** Conflito de domínio com estado existente (ex.: e-mail já registado). */
    @ExceptionHandler(ConflictException.class)
    ResponseEntity<ApiError> handleConflict(ConflictException ex, jakarta.servlet.http.HttpServletRequest request) {
        return build(HttpStatus.CONFLICT, ex.getCode(), ex.getMessage(), request, Map.of());
    }

    /** Validações condicionais fora do bean validation (mesmo envelope de 400). */
    @ExceptionHandler(InvalidRequestException.class)
    ResponseEntity<ApiError> handleInvalidRequest(InvalidRequestException ex, jakarta.servlet.http.HttpServletRequest request) {
        return build(HttpStatus.BAD_REQUEST, "VALIDATION_FAILED", ex.getMessage(), request, ex.getFieldErrors());
    }

    /** Sessão válida sem permissão (403) — distingue do 401 sem revelar dados. */
    @ExceptionHandler(ForbiddenException.class)
    ResponseEntity<ApiError> handleForbidden(ForbiddenException ex, jakarta.servlet.http.HttpServletRequest request) {
        return build(HttpStatus.FORBIDDEN, ex.getCode(), ex.getMessage(), request, Map.of());
    }

    /** Autenticação falhada — mensagem única para não revelar existência de contas. */
    @ExceptionHandler(UnauthorizedException.class)
    ResponseEntity<ApiError> handleUnauthorized(UnauthorizedException ex, jakarta.servlet.http.HttpServletRequest request) {
        return build(HttpStatus.UNAUTHORIZED, ex.getCode(), ex.getMessage(), request, Map.of());
    }

    /** Carrinho rejeitado na criação da encomenda: devolve os motivos linha a linha. */
    @ExceptionHandler(CartValidationException.class)
    ResponseEntity<ApiError> handleCartInvalid(CartValidationException ex, jakarta.servlet.http.HttpServletRequest request) {
        return ResponseEntity.status(HttpStatus.UNPROCESSABLE_ENTITY).body(new ApiError(
                Instant.now(),
                HttpStatus.UNPROCESSABLE_ENTITY.value(),
                HttpStatus.UNPROCESSABLE_ENTITY.getReasonPhrase(),
                ex.getCode(),
                ex.getMessage(),
                request.getRequestURI(),
                Map.of(),
                ex.getIssues()));
    }

    @ExceptionHandler(Exception.class)
    ResponseEntity<ApiError> handleUnexpected(Exception ex, jakarta.servlet.http.HttpServletRequest request) {
        // Detalhe completo apenas no servidor; a resposta é genérica.
        log.error("Erro inesperado ao processar {} {}", request.getMethod(), request.getRequestURI(), ex);
        return build(HttpStatus.INTERNAL_SERVER_ERROR, "INTERNAL_ERROR", "Erro interno. Tente novamente.", request, Map.of());
    }

    private ResponseEntity<ApiError> build(
            HttpStatus status, String code, String message,
            jakarta.servlet.http.HttpServletRequest request, Map<String, String> fieldErrors) {
        ApiError body = new ApiError(
                Instant.now(), status.value(), status.getReasonPhrase(), code, message, request.getRequestURI(), fieldErrors);
        return ResponseEntity.status(status).body(body);
    }
}
