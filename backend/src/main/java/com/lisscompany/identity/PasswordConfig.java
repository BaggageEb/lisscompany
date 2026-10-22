package com.lisscompany.identity;

import java.util.Map;

import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.security.crypto.bcrypt.BCryptPasswordEncoder;
import org.springframework.security.crypto.password.DelegatingPasswordEncoder;
import org.springframework.security.crypto.password.PasswordEncoder;

/**
 * Hash de palavras-passe conforme {@code docs/architecture.md}: BCrypt através
 * do {@code DelegatingPasswordEncoder}. O delegador grava o identificador do
 * algoritmo no próprio hash ({@code {bcrypt}$2a$…}), o que permite trocar o
 * algoritmo no futuro sem invalidar as contas existentes.
 *
 * <p>Só BCrypt está registado porque o esquema nasce agora (não há hashes
 * legados de outros algoritmos); acrescentar um algoritmo é adicionar uma
 * entrada ao mapa.
 */
@Configuration
public class PasswordConfig {

    @Bean
    PasswordEncoder passwordEncoder() {
        return new DelegatingPasswordEncoder("bcrypt", Map.of("bcrypt", new BCryptPasswordEncoder()));
    }
}
