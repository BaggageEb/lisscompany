package com.lisscompany;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import org.junit.jupiter.api.AfterAll;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.test.web.servlet.MockMvc;

import io.zonky.test.db.postgres.embedded.EmbeddedPostgres;

/**
 * Verifica as regras de autorização de base: o health check é público, a
 * documentação é pública e qualquer outra rota exige autenticação (401).
 */
@SpringBootTest
@AutoConfigureMockMvc
class SecurityConfigTest {

    private static EmbeddedPostgres postgres;

    @DynamicPropertySource
    static void datasource(DynamicPropertyRegistry registry) throws Exception {
        postgres = EmbeddedPostgres.start();
        registry.add("spring.datasource.url", () -> postgres.getJdbcUrl("postgres", "postgres"));
        registry.add("spring.datasource.username", () -> "postgres");
        registry.add("spring.datasource.password", () -> "postgres");
    }

    @AfterAll
    static void stopPostgres() throws Exception {
        if (postgres != null) {
            postgres.close();
        }
    }

    @Autowired
    private MockMvc mockMvc;

    @Test
    void healthIsPublic() throws Exception {
        mockMvc.perform(get("/actuator/health")).andExpect(status().isOk());
    }

    @Test
    void openApiDocsArePublic() throws Exception {
        mockMvc.perform(get("/api/v1/docs")).andExpect(status().isOk());
    }

    @Test
    void privateRoutesRequireAuthentication() throws Exception {
        mockMvc.perform(get("/api/v1/admin/orders")).andExpect(status().isUnauthorized());
        mockMvc.perform(get("/api/v1/orders")).andExpect(status().isUnauthorized());
    }

    @Test
    void unknownApiRoutesAreProtectedNotPublic() throws Exception {
        mockMvc.perform(get("/api/v1/qualquer-coisa")).andExpect(status().isUnauthorized());
    }
}
