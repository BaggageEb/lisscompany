package com.lisscompany;

import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;
import org.springframework.boot.context.properties.ConfigurationPropertiesScan;
import org.springframework.scheduling.annotation.EnableScheduling;

/**
 * Ponto de entrada da API LISSCOMPANY.
 *
 * <p>Monólito modular: cada domínio de negócio vive no seu próprio pacote
 * ({@code identity}, {@code catalog}, {@code cakebuilder}, {@code inventory},
 * {@code orders}, {@code payments}, {@code delivery}, {@code loyalty},
 * {@code promotions}, {@code notifications}, {@code administration},
 * {@code audit}). A regra de negócio fica nos serviços de domínio, nunca nos
 * controladores HTTP.
 */
@SpringBootApplication
@ConfigurationPropertiesScan
@EnableScheduling
public class LissCompanyApplication {

    public static void main(String[] args) {
        SpringApplication.run(LissCompanyApplication.class, args);
    }
}
