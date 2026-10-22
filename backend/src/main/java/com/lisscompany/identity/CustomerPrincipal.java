package com.lisscompany.identity;

import java.io.Serializable;
import java.util.UUID;

/**
 * Sessão do cliente: o que fica guardado na sessão HTTP depois do login.
 *
 * <p>É um {@link Serializable} imutável (a sessão pode ser serializada pelo
 * contentor) e <strong>nunca</strong> contém a palavra-passe nem credenciais —
 * apenas o essencial para autorização e personalização. Todos os clientes são
 * iguais em autorização nesta fase: os papéis de administração (fase 7) entram
 * depois, pelo que a autorização continua a ser decidida no servidor.
 */
public record CustomerPrincipal(UUID id, String email, String displayName) implements Serializable {

    private static final long serialVersionUID = 1L;

    public static final String AUTHORITY = "ROLE_CUSTOMER";
}
