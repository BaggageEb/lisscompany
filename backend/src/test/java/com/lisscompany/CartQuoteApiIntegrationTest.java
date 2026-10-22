package com.lisscompany;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

import tools.jackson.core.type.TypeReference;
import tools.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.AfterAll;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.http.MediaType;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.test.web.servlet.MockMvc;

import io.zonky.test.db.postgres.embedded.EmbeddedPostgres;

/**
 * Integração da revalidação de carrinho com PostgreSQL real (Zonky): o
 * navegador manda apenas <em>identificadores e quantidades</em> — preço,
 * validade e total são sempre recalculados no servidor a partir do catálogo e
 * do orçamento oficial do Cake Studio.
 */
@SpringBootTest
@AutoConfigureMockMvc
class CartQuoteApiIntegrationTest {

    private static final String ZERO_ID = "00000000-0000-0000-0000-000000000000";

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

    /* --------------------------- Revalidação total --------------------------- */

    @Test
    void quoteRepricesEveryLineServerSide() throws Exception {
        Map<String, String> products = productIdsBySlug();
        Map<String, Object> options = options();

        String body = objectMapper.writeValueAsString(Map.of(
                "productLines", List.of(
                        Map.<String, Object>of("productId", products.get("bolo-no-pote-premium"), "quantity", 2),
                        Map.<String, Object>of("productId", products.get("caixa-degustacao"), "quantity", 1)),
                "cakeLines", List.of(Map.<String, Object>of(
                        "cakeBaseId", idOf((List<?>) options.get("cakeBases"), "chocolate"),
                        "firstFillingId", idOf((List<?>) options.get("fillings"), "ganache-chocolate"),
                        "secondFillingId", idOf((List<?>) options.get("fillings"), "morango"),
                        "extraIds", List.of(idOf((List<?>) options.get("extras"), "folha-de-ouro")),
                        "moist", true,
                        "quantity", 1))));

        mockMvc.perform(post("/api/v1/public/cart/quote")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(body))
                .andExpect(status().isOk())
                // 3500×2 + 12000×1 + (2500 base + 500 morango + 1500 folha) = 23500.00
                .andExpect(jsonPath("$.valid").value(true))
                .andExpect(jsonPath("$.total").value("23500.00"))
                .andExpect(jsonPath("$.currency").value("AOA"))
                .andExpect(jsonPath("$.issues").isEmpty())
                .andExpect(jsonPath("$.lines.length()").value(3))
                .andExpect(jsonPath("$.lines[0].kind").value("PRODUCT"))
                .andExpect(jsonPath("$.lines[0].name").value("Bolo no Pote Premium"))
                .andExpect(jsonPath("$.lines[0].unitPrice").value("3500.00"))
                .andExpect(jsonPath("$.lines[0].quantity").value(2))
                .andExpect(jsonPath("$.lines[0].lineTotal").value("7000.00"))
                .andExpect(jsonPath("$.lines[1].lineTotal").value("12000.00"))
                .andExpect(jsonPath("$.lines[2].kind").value("CAKE"))
                .andExpect(jsonPath("$.lines[2].lineTotal").value("4500.00"))
                .andExpect(jsonPath("$.lines[2].valid").value(true));
    }

    @Test
    void pricesSentByTheClientAreNeverAccepted() throws Exception {
        Map<String, String> products = productIdsBySlug();

        // Um cliente malicioso (ou desactualizado) envia um preço próprio: o
        // contrato nem tem esse campo e o total sai do catálogo.
        String body = "{\"productLines\":[{\"productId\":\"" + products.get("bolo-no-pote-premium")
                + "\",\"quantity\":2,\"unitPrice\":\"1.00\"}],\"cakeLines\":[]}";

        mockMvc.perform(post("/api/v1/public/cart/quote")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(body))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.total").value("7000.00"))
                .andExpect(jsonPath("$.lines[0].unitPrice").value("3500.00"));
    }

    /* --------------------------- Falhas por linha ---------------------------- */

    @Test
    void unknownProductBecomesAnIssueInsteadOfATrustedPrice() throws Exception {
        String body = objectMapper.writeValueAsString(Map.of(
                "productLines", List.of(Map.<String, Object>of("productId", ZERO_ID, "quantity", 1)),
                "cakeLines", List.of()));

        mockMvc.perform(post("/api/v1/public/cart/quote")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(body))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.valid").value(false))
                .andExpect(jsonPath("$.total").value("0.00"))
                .andExpect(jsonPath("$.lines[0].valid").value(false))
                .andExpect(jsonPath("$.lines[0].issues[0]").value("Produto: já não está disponível."));
    }

    @Test
    void invalidCakeCompositionIsRevalidatedByTheServer() throws Exception {
        Map<String, String> products = productIdsBySlug();

        String body = objectMapper.writeValueAsString(Map.of(
                "productLines", List.of(Map.<String, Object>of("productId", products.get("caixa-degustacao"), "quantity", 1)),
                "cakeLines", List.of(Map.<String, Object>of(
                        "cakeBaseId", ZERO_ID,
                        "firstFillingId", ZERO_ID,
                        "secondFillingId", ZERO_ID,
                        "extraIds", List.of(),
                        "moist", false,
                        "quantity", 1))));

        mockMvc.perform(post("/api/v1/public/cart/quote")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(body))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.valid").value(false))
                // O total só soma o que é válido; a linha do bolo é marcada.
                .andExpect(jsonPath("$.total").value("12000.00"))
                .andExpect(jsonPath("$.lines[0].valid").value(true))
                .andExpect(jsonPath("$.lines[1].kind").value("CAKE"))
                .andExpect(jsonPath("$.lines[1].valid").value(false))
                .andExpect(jsonPath("$.lines[1].issues.length()").value(3));
    }

    @Test
    void emptyCartIsReportedAsAnIssue() throws Exception {
        mockMvc.perform(post("/api/v1/public/cart/quote")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.valid").value(false))
                .andExpect(jsonPath("$.total").value("0.00"))
                .andExpect(jsonPath("$.issues[0]").value("O carrinho está vazio."))
                .andExpect(jsonPath("$.lines").isEmpty());
    }

    /* -------------------------- Contrato da entrada --------------------------- */

    @Test
    void invalidQuantityIsRejectedWithFieldErrors() throws Exception {
        Map<String, String> products = productIdsBySlug();

        String body = objectMapper.writeValueAsString(Map.of(
                "productLines", List.of(Map.<String, Object>of("productId", products.get("caixa-degustacao"), "quantity", 0))));

        String content = mockMvc.perform(post("/api/v1/public/cart/quote")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(body))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.code").value("VALIDATION_FAILED"))
                .andExpect(jsonPath("$.fieldErrors").isNotEmpty())
                .andReturn().getResponse().getContentAsString();

        // O campo rejeitado é a quantidade da linha (o formato exacto do path
        // é interno ao binder; o contrato é que o erro aponta para a quantidade).
        Map<String, Object> parsed = objectMapper.readValue(content, new TypeReference<Map<String, Object>>() {});
        @SuppressWarnings("unchecked")
        Map<String, Object> errors = (Map<String, Object>) parsed.get("fieldErrors");
        boolean pointsAtQuantity = errors != null && errors.keySet().stream().anyMatch(key -> key.endsWith("quantity"));
        if (!pointsAtQuantity) {
            throw new AssertionError("fieldErrors devia apontar para a quantidade: " + errors);
        }
    }

    /* ------------------------------- helpers -------------------------------- */

    private Map<String, String> productIdsBySlug() throws Exception {
        String content = mockMvc.perform(get("/api/v1/public/catalog/products"))
                .andExpect(status().isOk())
                .andReturn().getResponse().getContentAsString();
        List<Map<String, Object>> items =
                objectMapper.readValue(content, new TypeReference<List<Map<String, Object>>>() {});
        Map<String, String> bySlug = new LinkedHashMap<>();
        for (Map<String, Object> item : items) {
            bySlug.put((String) item.get("slug"), (String) item.get("id"));
        }
        return bySlug;
    }

    private Map<String, Object> options() throws Exception {
        String content = mockMvc.perform(get("/api/v1/public/cake-studio/options"))
                .andExpect(status().isOk())
                .andReturn().getResponse().getContentAsString();
        return objectMapper.readValue(content, new TypeReference<Map<String, Object>>() {});
    }

    @SuppressWarnings("unchecked")
    private String idOf(List<?> group, String slug) {
        List<Map<String, Object>> items = new ArrayList<>((List<Map<String, Object>>) group);
        return items.stream()
                .filter(item -> slug.equals(item.get("slug")))
                .map(item -> (String) item.get("id"))
                .findFirst()
                .orElseThrow(() -> new AssertionError("slug não encontrado no seed: " + slug));
    }
}
