package com.lisscompany.shared.security;

import java.util.Map;

import org.springframework.security.web.csrf.CsrfToken;
import org.springframework.security.web.csrf.CsrfTokenRepository;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;

/**
 * Entrega o token CSRF ao SPA (fase 4).
 *
 * <p>Todas as mutações fora de {@code /api/v1/public/**} exigem o cabeçalho
 * {@code X-CSRF-TOKEN}. Como a aplicação é uma SPA sem template que reflita o
 * token, o cliente lê <strong>uma vez</strong> deste endpoint (guardado em
 * memória) e ecoa o valor no cabeçalho de cada POST/PUT/PATCH/DELETE. Se o
 * token expirar (sessão nova), um 403 do servidor faz o cliente renová-lo.
 */
@RestController
@RequestMapping("/api/v1")
public class CsrfController {

    private final CsrfTokenRepository csrfTokenRepository;

    public CsrfController(CsrfTokenRepository csrfTokenRepository) {
        this.csrfTokenRepository = csrfTokenRepository;
    }

    @GetMapping("/csrf")
    public Map<String, String> token(HttpServletRequest request, HttpServletResponse response) {
        CsrfToken token = csrfTokenRepository.loadToken(request);
        if (token == null) {
            token = csrfTokenRepository.generateToken(request);
            csrfTokenRepository.saveToken(token, request, response);
        }
        return Map.of("token", token.getToken());
    }
}
