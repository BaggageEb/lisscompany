package com.lisscompany;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import java.util.Map;

import tools.jackson.core.type.TypeReference;
import tools.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.AfterAll;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.http.MediaType;
import org.springframework.mock.web.MockHttpSession;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.test.web.servlet.MockMvc;

import io.zonky.test.db.postgres.embedded.EmbeddedPostgres;

import com.lisscompany.identity.AuthService;

/**
 * Integração da identidade (fase 4) com PostgreSQL real: registo cria sessão,
 * login protegido por CSRF, e-mail normalizado, mensagens únicas de falha e
 * protecção contra força bruta.
 */
@SpringBootTest
@AutoConfigureMockMvc
class AuthApiIntegrationTest {

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

    @Autowired
    private ObjectMapper objectMapper;

    /* -------------------------------- CSRF -------------------------------- */

    @Test
    void mutationsOutsideThePublicApiRequireCsrfToken() throws Exception {
        MockHttpSession session = new MockHttpSession();
        String body = registerBody("csrf@example.com", "CSRF", "senha-forte-1234", null);

        mockMvc.perform(post("/api/v1/auth/register")
                        .session(session)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(body))
                .andExpect(status().isForbidden());

        mockMvc.perform(post("/api/v1/auth/login")
                        .session(session)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(body))
                .andExpect(status().isForbidden());
    }

    @Test
    void csrfEndpointHandsOutAUsableToken() throws Exception {
        MockHttpSession session = new MockHttpSession();
        String token = csrfToken(session);

        mockMvc.perform(post("/api/v1/auth/login")
                        .session(session)
                        .header("X-CSRF-TOKEN", token)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(loginBody("ninguem@example.com", "qualquer-senha")))
                // Token válido: passa o CSRF e responde com a falha de credenciais.
                .andExpect(status().isUnauthorized());
    }

    /* ------------------------------- Registo ------------------------------ */

    @Test
    void registerCreatesTheAccountAndAnAuthenticatedSession() throws Exception {
        MockHttpSession session = new MockHttpSession();
        String token = csrfToken(session);

        mockMvc.perform(post("/api/v1/auth/register")
                        .session(session)
                        .header("X-CSRF-TOKEN", token)
                        .contentType(MediaType.APPLICATION_JSON)
                        // O e-mail é normalizado para minúsculas.
                        .content(registerBody("ANA@Example.com", "Ana", "senha-forte-1234", "912345678")))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.email").value("ana@example.com"))
                .andExpect(jsonPath("$.displayName").value("Ana"))
                .andExpect(jsonPath("$.phone").value("912345678"));

        // A mesma sessão fica autenticada sem novo login.
        mockMvc.perform(get("/api/v1/auth/me").session(session))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.email").value("ana@example.com"))
                .andExpect(jsonPath("$.displayName").value("Ana"));
    }

    @Test
    void duplicateEmailIsRejectedWithAStableCode() throws Exception {
        MockHttpSession session = new MockHttpSession();
        String token = csrfToken(session);
        String body = registerBody("dup@example.com", "Primeira", "senha-forte-1234", null);

        mockMvc.perform(post("/api/v1/auth/register")
                        .session(session)
                        .header("X-CSRF-TOKEN", token)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(body))
                .andExpect(status().isCreated());

        mockMvc.perform(post("/api/v1/auth/register")
                        .session(session)
                        .header("X-CSRF-TOKEN", token)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(body))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.code").value("EMAIL_TAKEN"))
                .andExpect(jsonPath("$.message").isNotEmpty());
    }

    @Test
    void weakPasswordIsRejectedWithFieldErrors() throws Exception {
        MockHttpSession session = new MockHttpSession();
        String token = csrfToken(session);

        mockMvc.perform(post("/api/v1/auth/register")
                        .session(session)
                        .header("X-CSRF-TOKEN", token)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(registerBody("curta@example.com", "Ana", "123", null)))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.code").value("VALIDATION_FAILED"))
                .andExpect(jsonPath("$.fieldErrors.password").isNotEmpty());
    }

    /* -------------------------------- Login ------------------------------- */

    @Test
    void failedLoginNeverRevealsWhetherTheAccountExists() throws Exception {
        MockHttpSession registerSession = new MockHttpSession();
        String token = csrfToken(registerSession);
        mockMvc.perform(post("/api/v1/auth/register")
                        .session(registerSession)
                        .header("X-CSRF-TOKEN", token)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(registerBody("existe@example.com", "Ana", "senha-forte-1234", null)))
                .andExpect(status().isCreated());

        String wrongPassword = loginBody("existe@example.com", "password-errada");
        String unknownEmail = loginBody("nao-existe@example.com", "password-errada");

        String messageWrongPassword = login(registerSession, token, wrongPassword);
        String messageUnknownEmail = login(registerSession, token, unknownEmail);

        // A mesma mensagem e o mesmo código: a API não confirma quais e-mails existem.
        org.junit.jupiter.api.Assertions.assertEquals(messageUnknownEmail, messageWrongPassword);
    }

    @Test
    void repeatedFailuresLockTheAccountEvenWithTheRightPassword() throws Exception {
        MockHttpSession session = new MockHttpSession();
        String token = csrfToken(session);
        mockMvc.perform(post("/api/v1/auth/register")
                        .session(session)
                        .header("X-CSRF-TOKEN", token)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(registerBody("bloqueio@example.com", "Bloq", "senha-forte-1234", null)))
                .andExpect(status().isCreated());

        for (int i = 0; i < AuthService.MAX_FAILED_ATTEMPTS; i++) {
            login(session, token, loginBody("bloqueio@example.com", "errada-" + i));
        }

        // Password CERTA mas conta bloqueada pela força bruta.
        mockMvc.perform(post("/api/v1/auth/login")
                        .session(session)
                        .header("X-CSRF-TOKEN", token)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(loginBody("bloqueio@example.com", "senha-forte-1234")))
                .andExpect(status().isUnauthorized())
                .andExpect(jsonPath("$.code").value("ACCOUNT_LOCKED"));
    }

    @Test
    void successfulLoginAuthenticatesTheSession() throws Exception {
        MockHttpSession session = new MockHttpSession();
        String token = csrfToken(session);
        mockMvc.perform(post("/api/v1/auth/register")
                        .session(session)
                        .header("X-CSRF-TOKEN", token)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(registerBody("login@example.com", "Login", "senha-forte-1234", null)))
                .andExpect(status().isCreated());

        // Login com credenciais correctas autentica a mesma sessão.
        mockMvc.perform(post("/api/v1/auth/login")
                        .session(session)
                        .header("X-CSRF-TOKEN", token)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(loginBody("login@example.com", "senha-forte-1234")))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.email").value("login@example.com"));

        mockMvc.perform(get("/api/v1/auth/me").session(session))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.email").value("login@example.com"));

        // Terminar sessão invalida-a: o pedido seguinte já não tem acesso privado.
        mockMvc.perform(post("/api/v1/auth/logout").session(session).header("X-CSRF-TOKEN", token))
                .andExpect(status().isNoContent());

        mockMvc.perform(get("/api/v1/auth/me").session(session))
                .andExpect(status().isUnauthorized());
    }

    @Test
    void privateRoutesStillRequireAuthentication() throws Exception {
        mockMvc.perform(get("/api/v1/auth/me").session(new MockHttpSession()))
                .andExpect(status().isUnauthorized());
    }

    /* ------------------------------- helpers ------------------------------ */

    /** Devolve a MESMA sessão depois de o token CSRF a ter criado. */
    private String csrfToken(MockHttpSession session) throws Exception {
        String content = mockMvc.perform(get("/api/v1/csrf").session(session))
                .andExpect(status().isOk())
                .andReturn().getResponse().getContentAsString();
        return objectMapper.readValue(content, new TypeReference<Map<String, Object>>() {}).get("token").toString();
    }

    /** Executa um login e devolve a mensagem do envelope de erro (ou falha o teste). */
    private String login(MockHttpSession session, String token, String body) throws Exception {
        String content = mockMvc.perform(post("/api/v1/auth/login")
                        .session(session)
                        .header("X-CSRF-TOKEN", token)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(body))
                .andExpect(status().isUnauthorized())
                .andReturn().getResponse().getContentAsString();
        return objectMapper.readValue(content, new TypeReference<Map<String, Object>>() {}).get("message").toString();
    }

    private String registerBody(String email, String displayName, String password, String phone) throws Exception {
        java.util.Map<String, Object> body = new java.util.LinkedHashMap<>();
        body.put("email", email);
        body.put("displayName", displayName);
        body.put("password", password);
        if (phone != null) {
            body.put("phone", phone);
        }
        return objectMapper.writeValueAsString(body);
    }

    private String loginBody(String email, String password) throws Exception {
        return objectMapper.writeValueAsString(Map.of("email", email, "password", password));
    }
}
