package com.lisscompany.shared.config;

import java.util.Arrays;
import java.util.List;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.http.HttpStatus;
import org.springframework.security.config.Customizer;
import org.springframework.security.config.annotation.web.builders.HttpSecurity;
import org.springframework.security.config.http.SessionCreationPolicy;
import org.springframework.security.web.SecurityFilterChain;
import org.springframework.security.web.authentication.HttpStatusEntryPoint;
import org.springframework.security.web.csrf.CsrfTokenRepository;
import org.springframework.security.web.csrf.CsrfTokenRequestAttributeHandler;
import org.springframework.security.web.csrf.HttpSessionCsrfTokenRepository;
import org.springframework.security.web.context.HttpSessionSecurityContextRepository;
import org.springframework.web.cors.CorsConfiguration;
import org.springframework.web.cors.CorsConfigurationSource;
import org.springframework.web.cors.UrlBasedCorsConfigurationSource;

/**
 * Configuração de segurança de base.
 *
 * <p>Estratégia de autenticação (fase 4): sessões HTTP com cookies seguros e
 * proteção CSRF activa — adequada a uma loja com sessão de navegador. As rotas
 * privadas devolvem 401 e nenhuma regra é dispensável: qualquer endpoint novo
 * entra autenticado por defeito ({@code anyRequest()}).
 *
 * <p>Autorização declarada explicitamente; nunca assumir que um endpoint novo é
 * público.
 */
@Configuration
public class SecurityConfig {

    /**
     * Token CSRF de sessão. É a <em>mesma</em> instância usada pela cadeia e pelo
     * {@code CsrfController}: o cliente lê o token uma vez e ecoa-o no cabeçalho
     * {@code X-CSRF-TOKEN}.
     */
    @Bean
    CsrfTokenRepository csrfTokenRepository() {
        return new HttpSessionCsrfTokenRepository();
    }

    /**
     * Contexto de segurança guardado na sessão HTTP: depois do login o AuthService
     * grava aqui o contexto e os pedidos seguintes da mesma sessão ficam
     * autenticados.
     */
    @Bean
    HttpSessionSecurityContextRepository securityContextRepository() {
        return new HttpSessionSecurityContextRepository();
    }

    @Bean
    SecurityFilterChain securityFilterChain(
            HttpSecurity http,
            CorsConfigurationSource corsConfigurationSource,
            CsrfTokenRepository csrfTokenRepository,
            HttpSessionSecurityContextRepository securityContextRepository) throws Exception {
        http
                .cors(cors -> cors.configurationSource(corsConfigurationSource))
                .authorizeHttpRequests(auth -> auth
                        // Liveness do serviço — sem dados sensíveis
                        .requestMatchers("/actuator/health", "/actuator/health/**").permitAll()
                        // Documentação da API (só em desenvolvimento/interior; rever antes da produção)
                        .requestMatchers("/api/v1/docs/**", "/v3/api-docs/**", "/swagger-ui/**").permitAll()
                        // Endpoints públicos da loja (catálogo, contactos) — crescem por fase
                        .requestMatchers("/api/v1/public/**").permitAll()
                        // Fase 4 — identidade: estas rotas são públicas mas continuam
                        // sujeitas a CSRF (o token obtém-se em GET /api/v1/csrf)
                        .requestMatchers(
                                "/api/v1/csrf",
                                "/api/v1/auth/register",
                                "/api/v1/auth/login",
                                "/api/v1/auth/logout")
                        .permitAll()
                        // Tudo o resto exige sessão autenticada
                        .anyRequest().authenticated())
                // CSRF activo por defeito: a autenticação por cookie de sessão da fase 4
                // exige token CSRF em mutações. Única excepção: os POSTs públicos do
                // catálogo/Cake Studio são cálculos puros, sem qualquer efeito
                // secundário no servidor (nenhuma sessão nem estado é alterado).
                .csrf(csrf -> csrf
                        .ignoringRequestMatchers("/api/v1/public/**")
                        .csrfTokenRepository(csrfTokenRepository)
                        // Handler "legado": o token trafega sem máscara porque o SPA não o
                        // reflecte em HTML — lê uma vez do JSON e ecoa-o no cabeçalho.
                        .csrfTokenRequestHandler(new CsrfTokenRequestAttributeHandler()))
                .securityContext(securityContext -> securityContext.securityContextRepository(securityContextRepository))
                .sessionManagement(session -> session.sessionCreationPolicy(SessionCreationPolicy.IF_REQUIRED))
                .exceptionHandling(handling -> handling
                        .authenticationEntryPoint(new HttpStatusEntryPoint(HttpStatus.UNAUTHORIZED)));
        return http.build();
    }

    /**
     * CORS restritivo: apenas as origens do frontend configuradas por ambiente
     * podem falar com a API em modo cross-origin. Em produção o mesmo-origin
     * via proxy torna isto opcional, mas mantemo-lo explícito e limitado.
     */
    @Bean
    CorsConfigurationSource corsConfigurationSource(@Value("${app.cors.allowed-origins}") String allowedOrigins) {
        CorsConfiguration configuration = new CorsConfiguration();
        configuration.setAllowedOrigins(
                Arrays.stream(allowedOrigins.split(",")).map(String::trim).filter(s -> !s.isEmpty()).toList());
        configuration.setAllowedMethods(List.of("GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"));
        configuration.setAllowedHeaders(List.of("Authorization", "Content-Type", "X-Requested-With"));
        configuration.setAllowCredentials(true);
        configuration.setMaxAge(3600L);

        UrlBasedCorsConfigurationSource source = new UrlBasedCorsConfigurationSource();
        source.registerCorsConfiguration("/api/**", configuration);
        return source;
    }
}
