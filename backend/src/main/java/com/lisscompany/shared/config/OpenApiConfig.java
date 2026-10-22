package com.lisscompany.shared.config;

import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

import io.swagger.v3.oas.models.OpenAPI;
import io.swagger.v3.oas.models.info.Info;
import io.swagger.v3.oas.models.info.License;

/** Metadados OpenAPI da API LISSCOMPANY. */
@Configuration
public class OpenApiConfig {

    @Bean
    OpenAPI lissCompanyOpenApi() {
        return new OpenAPI().info(new Info()
                .title("LISSCOMPANY API")
                .description("""
                        API da loja LISSCOMPANY — bolos no pote e produtos personalizados.
                        Versão e conteúdo crescem por fases; ver README e docs/ para o estado atual.
                        """)
                .version("v1")
                .license(new License().name("Uso interno LISSCOMPANY")));
    }
}
