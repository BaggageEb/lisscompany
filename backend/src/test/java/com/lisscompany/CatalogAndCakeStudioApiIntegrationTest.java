package com.lisscompany;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import java.util.ArrayList;
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
 * Integração da API pública com PostgreSQL real (Zonky): catálogo e Cake
 * Studio acessíveis sem sessão, com preços como string decimal e validação
 * de composição no servidor.
 */
@SpringBootTest
@AutoConfigureMockMvc
class CatalogAndCakeStudioApiIntegrationTest {

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

    /* ------------------------------ Catálogo ------------------------------ */

    @Test
    void productsArePublicAndPricesArriveAsDecimalStrings() throws Exception {
        mockMvc.perform(get("/api/v1/public/catalog/products"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.length()").value(3))
                .andExpect(jsonPath("$[?(@.slug=='bolo-no-pote-classico')].basePrice").value("2500.00"))
                .andExpect(jsonPath("$[?(@.slug=='bolo-no-pote-classico')].currency").value("AOA"))
                .andExpect(jsonPath("$[?(@.slug=='bolo-no-pote-classico')].categorySlug").value("bolos-no-pote"));
    }

    @Test
    void productDetailIsPublicAndUnknownSlugReturns404Envelope() throws Exception {
        mockMvc.perform(get("/api/v1/public/catalog/products/bolo-no-pote-premium"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.slug").value("bolo-no-pote-premium"));

        mockMvc.perform(get("/api/v1/public/catalog/products/nao-existe"))
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.code").value("PRODUCT_NOT_FOUND"))
                .andExpect(jsonPath("$.message").isNotEmpty());
    }

    @Test
    void categoriesEndpointExposesSeededCategories() throws Exception {
        mockMvc.perform(get("/api/v1/public/catalog/categories"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.length()").value(2))
                .andExpect(jsonPath("$[0].slug").value("bolos-no-pote"));
    }

    /* ----------------------------- Cake Studio ---------------------------- */

    @Test
    void optionsServeBaseProductRulesAndIngredientGroups() throws Exception {
        mockMvc.perform(get("/api/v1/public/cake-studio/options"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.baseProduct.slug").value("bolo-no-pote-classico"))
                .andExpect(jsonPath("$.baseProduct.basePrice").value("2500.00"))
                .andExpect(jsonPath("$.rules.cakeLayers").value(2))
                .andExpect(jsonPath("$.rules.fillingLayers").value(2))
                .andExpect(jsonPath("$.rules.maxDistinctFillings").value(2))
                .andExpect(jsonPath("$.rules.maxExtras").value(3))
                .andExpect(jsonPath("$.rules.moistChangesPrice").value(false))
                .andExpect(jsonPath("$.cakeBases.length()").value(3))
                .andExpect(jsonPath("$.fillings.length()").value(4))
                .andExpect(jsonPath("$.extras.length()").value(5));
    }

    @Test
    void quoteIsComputedByTheServerNotTheClient() throws Exception {
        Map<String, Object> options = options();
        String baseId = idOf((List<?>) options.get("cakeBases"), "chocolate");
        String filling1 = idOf((List<?>) options.get("fillings"), "ganache-chocolate");
        String filling2 = idOf((List<?>) options.get("fillings"), "morango");
        String extra = idOf((List<?>) options.get("extras"), "folha-de-ouro");

        String body = objectMapper.writeValueAsString(Map.of(
                "cakeBaseId", baseId,
                "firstFillingId", filling1,
                "secondFillingId", filling2,
                "extraIds", List.of(extra),
                "moist", true));

        mockMvc.perform(post("/api/v1/public/cake-studio/quote")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(body))
                .andExpect(status().isOk())
                // 2500 base + 0 + 0 + 500 morango + 1500 folha = 4500.00 (molhado não conta)
                .andExpect(jsonPath("$.valid").value(true))
                .andExpect(jsonPath("$.total").value("4500.00"))
                .andExpect(jsonPath("$.currency").value("AOA"))
                .andExpect(jsonPath("$.issues").isEmpty())
                .andExpect(jsonPath("$.lines.length()").value(3));
    }

    @Test
    void quoteRejectsUnknownIdsAsIssuesInsteadOfTrustingTheClient() throws Exception {
        String body = objectMapper.writeValueAsString(Map.of(
                "cakeBaseId", "00000000-0000-0000-0000-000000000000",
                "firstFillingId", "00000000-0000-0000-0000-000000000000",
                "secondFillingId", "00000000-0000-0000-0000-000000000000",
                "extraIds", List.of(),
                "moist", false));

        mockMvc.perform(post("/api/v1/public/cake-studio/quote")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(body))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.valid").value(false))
                .andExpect(jsonPath("$.issues.length()").value(3));
    }

    @Test
    void quoteValidatesRequiredFieldsWithFieldErrors() throws Exception {
        String body = objectMapper.writeValueAsString(Map.of(
                "firstFillingId", "00000000-0000-0000-0000-000000000000",
                "secondFillingId", "00000000-0000-0000-0000-000000000000",
                "extraIds", List.of(),
                "moist", false));

        mockMvc.perform(post("/api/v1/public/cake-studio/quote")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(body))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.code").value("VALIDATION_FAILED"))
                .andExpect(jsonPath("$.fieldErrors.cakeBaseId").isNotEmpty());
    }

    @Test
    void quoteRejectsWrongIngredientKind() throws Exception {
        Map<String, Object> options = options();
        String fillingAsBase = idOf((List<?>) options.get("fillings"), "morango");
        String anyFilling = idOf((List<?>) options.get("fillings"), "ganache-chocolate");

        String body = objectMapper.writeValueAsString(Map.of(
                "cakeBaseId", fillingAsBase,
                "firstFillingId", anyFilling,
                "secondFillingId", anyFilling,
                "extraIds", List.of(),
                "moist", false));

        mockMvc.perform(post("/api/v1/public/cake-studio/quote")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(body))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.valid").value(false))
                .andExpect(jsonPath("$.issues[0]").value("Massa: tipo de ingrediente incorrecto."));
    }

    /* ------------------------------- helpers ------------------------------ */

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
