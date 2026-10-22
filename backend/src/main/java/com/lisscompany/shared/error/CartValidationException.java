package com.lisscompany.shared.error;

import java.util.List;

/**
 * O servidor rejeitou o carrinho no momento de criar a encomenda (422): um ou
 * mais artigos deixaram de existir, mudaram de preço de forma bloqueante ou a
 * composição de um bolo deixou de ser válida.
 *
 * <p>Devolve os <em>motivos</em> em vez de um erro genérico, para o cliente
 * mostrar exactamente o que corrigir — e nunca cria uma encomenda com preços
 * que o servidor não confirmou.
 */
public class CartValidationException extends RuntimeException {

    private final String code;
    private final List<String> issues;

    public CartValidationException(String code, String message, List<String> issues) {
        super(message);
        this.code = code;
        this.issues = List.copyOf(issues);
    }

    public String getCode() {
        return code;
    }

    public List<String> getIssues() {
        return issues;
    }
}
