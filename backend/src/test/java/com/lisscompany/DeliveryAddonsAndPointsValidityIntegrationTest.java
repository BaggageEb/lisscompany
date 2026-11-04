package com.lisscompany;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;

import org.junit.jupiter.api.AfterAll;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.http.MediaType;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.mock.web.MockHttpSession;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.test.web.servlet.MockMvc;

import com.lisscompany.identity.AppUserRepository;
import com.lisscompany.inventory.InventoryItemRepository;

import io.zonky.test.db.postgres.embedded.EmbeddedPostgres;
import tools.jackson.core.type.TypeReference;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;

/**
 * V8 com PostgreSQL real: entrega calculada no servidor (preço fixo, por zona,
 * sem configuração), bolo personalizado só pelo Cake Studio, complementos fora
 * do limite de extras com dedicatória visível ao painel, e validade dos pontos
 * (expiração, utilização bloqueada e devolução no cancelamento).
 */
@SpringBootTest
@AutoConfigureMockMvc
class DeliveryAddonsAndPointsValidityIntegrationTest {

    private static EmbeddedPostgres postgres;

    @DynamicPropertySource
    static void datasource(DynamicPropertyRegistry registry) throws Exception {
        postgres = EmbeddedPostgres.start();
        registry.add("spring.datasource.url", () -> postgres.getJdbcUrl("postgres", "postgres"));
        registry.add("spring.datasource.username", () -> "postgres");
        registry.add("spring.datasource.password", () -> "postgres");
        registry.add("spring.flyway.locations", () -> "classpath:db/migration,classpath:db/demo");
        registry.add("app.media.dir", () -> System.getProperty("java.io.tmpdir") + "/lc-media-test");
    }

    @AfterAll
    static void stopPostgres() throws Exception {
        if (postgres != null) {
            postgres.close();
        }
    }

    @Autowired private MockMvc mockMvc;
    @Autowired private ObjectMapper objectMapper;
    @Autowired private InventoryItemRepository inventoryRepository;
    @Autowired private AppUserRepository userRepository;
    @Autowired private JdbcTemplate jdbc;

    /* ------------------------------- Entrega ------------------------------ */

    @Test
    void deliveryWithoutConfigurationIsBlockedAndFlatPriceIsAppliedToTheTotal() throws Exception {
        MockHttpSession owner = register("v8-ent-dona@example.com");
        makeOwner("v8-ent-dona@example.com");
        MockHttpSession customer = register("v8-ent-cli@example.com");
        String productId = productId("bolo-no-pote-premium");
        setStock(productId, 20);

        // Sem configuração: nunca «0 Kz» — a entrega ao domicílio não se confirma.
        mockMvc.perform(post("/api/v1/public/cart/quote").contentType(MediaType.APPLICATION_JSON)
                        .content(json(Map.of("productLines", List.of(Map.of("productId", productId, "quantity", 2)),
                                "cakeLines", List.of(), "fulfillment", "DELIVERY"))))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.delivery.available").value(false))
                .andExpect(jsonPath("$.grandTotal").value("7000.00"));
        mockMvc.perform(post("/api/v1/orders").session(customer).header("X-CSRF-TOKEN", csrf(customer))
                        .contentType(MediaType.APPLICATION_JSON).content(json(deliveryOrder(productId, 2, null))))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.fieldErrors.fulfillment").exists());

        // Preço fixo: o cliente vê o custo e o total inclui a entrega.
        putJson(owner, "/api/v1/admin/delivery/config", Map.of("mode", "FLAT", "flatFee", "2000"));
        mockMvc.perform(post("/api/v1/public/cart/quote").contentType(MediaType.APPLICATION_JSON)
                        .content(json(Map.of("productLines", List.of(Map.of("productId", productId, "quantity", 2)),
                                "cakeLines", List.of(), "fulfillment", "DELIVERY"))))
                .andExpect(jsonPath("$.delivery.available").value(true))
                .andExpect(jsonPath("$.delivery.fee").value("2000.00"))
                .andExpect(jsonPath("$.grandTotal").value("9000.00"));
        mockMvc.perform(post("/api/v1/orders").session(customer).header("X-CSRF-TOKEN", csrf(customer))
                        .contentType(MediaType.APPLICATION_JSON).content(json(deliveryOrder(productId, 2, null))))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.deliveryFee").value("2000.00"))
                .andExpect(jsonPath("$.total").value("9000.00"));

        // Por zonas: zona activa sem preço é recusada; com preço, é obrigatória e define o custo.
        putJson(owner, "/api/v1/admin/delivery/config", Map.of("mode", "ZONES"));
        postJson(owner, "/api/v1/admin/delivery-zones", Map.of("name", "Sem preço", "active", true), 400);
        String zoneId = objectMapper.readTree(postJson(owner, "/api/v1/admin/delivery-zones",
                Map.of("name", "Talatona", "fee", "3000", "active", true), 201)).get("id").asText();
        mockMvc.perform(post("/api/v1/orders").session(customer).header("X-CSRF-TOKEN", csrf(customer))
                        .contentType(MediaType.APPLICATION_JSON).content(json(deliveryOrder(productId, 1, null))))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.fieldErrors.deliveryZoneId").exists());
        mockMvc.perform(post("/api/v1/orders").session(customer).header("X-CSRF-TOKEN", csrf(customer))
                        .contentType(MediaType.APPLICATION_JSON).content(json(deliveryOrder(productId, 1, zoneId))))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.deliveryFee").value("3000.00"))
                .andExpect(jsonPath("$.deliveryZone").value("Talatona"));

        // Entrega gratuita.
        putJson(owner, "/api/v1/admin/delivery/config", Map.of("mode", "FREE"));
        mockMvc.perform(post("/api/v1/orders").session(customer).header("X-CSRF-TOKEN", csrf(customer))
                        .contentType(MediaType.APPLICATION_JSON).content(json(deliveryOrder(productId, 1, null))))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.deliveryFee").value("0.00"));
    }

    /* --------------------- Bolo personalizado e complementos --------------------- */

    @Test
    void customCakeCannotBeBoughtAsAPlainProduct() throws Exception {
        String studioBase = productId("bolo-no-pote-classico");
        mockMvc.perform(post("/api/v1/public/cart/quote").contentType(MediaType.APPLICATION_JSON)
                        .content(json(Map.of("productLines", List.of(Map.of("productId", studioBase, "quantity", 1)),
                                "cakeLines", List.of()))))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.valid").value(false));
        mockMvc.perform(get("/api/v1/public/catalog/products"))
                .andExpect(jsonPath("$[?(@.slug=='bolo-no-pote-classico')].customizable").value(true))
                .andExpect(jsonPath("$[?(@.slug=='bolo-no-pote-premium')].customizable").value(false));
    }

    @Test
    void addonsAreOutsideTheExtrasLimitAndTheDedicationReachesThePanel() throws Exception {
        MockHttpSession owner = register("v8-add-dona@example.com");
        makeOwner("v8-add-dona@example.com");
        MockHttpSession customer = register("v8-add-cli@example.com");
        postJson(owner, "/api/v1/admin/catalog/ingredients",
                Map.of("kind", "ADDON", "name", "Cartão", "priceDelta", "500", "allowsMessage", true), 201);

        JsonNode options = objectMapper.readTree(mockMvc.perform(get("/api/v1/public/cake-studio/options"))
                .andExpect(status().isOk()).andReturn().getResponse().getContentAsString());
        String cardId = idBySlug(options.get("addons"), "cartao");
        String candlesId = idBySlug(options.get("addons"), "velas");
        List<String> extraIds = new java.util.ArrayList<>();
        for (JsonNode extra : options.get("extras")) {
            if (extraIds.size() < 3) extraIds.add(extra.get("id").asText());
        }

        Map<String, Object> cake = new LinkedHashMap<>();
        cake.put("cakeBaseId", options.get("cakeBases").get(0).get("id").asText());
        cake.put("firstFillingId", options.get("fillings").get(0).get("id").asText());
        cake.put("secondFillingId", options.get("fillings").get(1).get("id").asText());
        cake.put("extraIds", extraIds); // três extras — o limite
        cake.put("moist", false);
        cake.put("quantity", 1);
        cake.put("addons", List.of(Map.of("id", cardId, "message", "Parabéns, Mãe!"), Map.of("id", candlesId)));

        // Complementos não contam para o limite de três extras.
        mockMvc.perform(post("/api/v1/public/cake-studio/quote").contentType(MediaType.APPLICATION_JSON).content(json(cake)))
                .andExpect(status().isOk()).andExpect(jsonPath("$.valid").value(true));

        // Mensagem num complemento que não a admite (velas) é recusada.
        cake.put("addons", List.of(Map.of("id", candlesId, "message", "olá")));
        mockMvc.perform(post("/api/v1/public/cake-studio/quote").contentType(MediaType.APPLICATION_JSON).content(json(cake)))
                .andExpect(jsonPath("$.valid").value(false));

        cake.put("addons", List.of(Map.of("id", cardId, "message", "Parabéns, Mãe!"), Map.of("id", candlesId)));
        Map<String, Object> order = new LinkedHashMap<>();
        order.put("contactName", "Cliente");
        order.put("contactPhone", "912345678");
        order.put("fulfillment", "PICKUP");
        order.put("paymentMethod", "IBAN_TRANSFER");
        order.put("productLines", List.of());
        order.put("cakeLines", List.of(cake));
        String created = mockMvc.perform(post("/api/v1/orders").session(customer).header("X-CSRF-TOKEN", csrf(customer))
                        .contentType(MediaType.APPLICATION_JSON).content(json(order)))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.items[0].dedications[0].message").value("Parabéns, Mãe!"))
                .andReturn().getResponse().getContentAsString();
        String number = objectMapper.readTree(created).get("number").asText();

        // A proprietária vê a dedicatória na lista e no detalhe.
        mockMvc.perform(get("/api/v1/admin/orders").session(owner))
                .andExpect(jsonPath("$[?(@.number=='" + number + "')].hasDedication").value(true));
        mockMvc.perform(get("/api/v1/admin/orders/" + number).session(owner))
                .andExpect(jsonPath("$.order.items[0].dedications[0].addon").value("Cartão"));
    }

    /* ----------------------------- Validade dos pontos ----------------------------- */

    @Test
    void pointsExpireAfterTheConfiguredValidityAndExpiredPointsCannotBeSpent() throws Exception {
        MockHttpSession owner = register("v8-pts-dona@example.com");
        makeOwner("v8-pts-dona@example.com");
        MockHttpSession customer = register("v8-pts-cli@example.com");
        UUID customerId = userRepository.findByEmail("v8-pts-cli@example.com").orElseThrow().getId();
        String productId = productId("bolo-no-pote-premium");
        setStock(productId, 20);

        putJson(owner, "/api/v1/admin/loyalty/config/rule", Map.of("earnPercent", "10", "pointValueKz", "1",
                "rounding", "DOWN", "allowPartialRedemption", true, "active", true));
        postJson(owner, "/api/v1/admin/loyalty/accounts/" + customerId + "/adjustment", Map.of("points", 100, "note", "A"), 200);
        jdbc.update("UPDATE loyalty_point_lot SET earned_at = NOW() - INTERVAL '40 days'");
        postJson(owner, "/api/v1/admin/loyalty/accounts/" + customerId + "/adjustment", Map.of("points", 50, "note", "B"), 200);

        // Pré-visualização: só os 100 pontos antigos expirariam já com 30 dias.
        mockMvc.perform(get("/api/v1/admin/loyalty/validity/preview?days=30").session(owner))
                .andExpect(jsonPath("$.pointsExpiringNow").value(100));
        putJson(owner, "/api/v1/admin/loyalty/validity", Map.of("days", 30));

        // O lote antigo expirou; o recente continua válido e utilizável.
        mockMvc.perform(get("/api/v1/loyalty").session(customer))
                .andExpect(jsonPath("$.pointsBalance").value(50))
                .andExpect(jsonPath("$.validityDays").value(30));
        mockMvc.perform(post("/api/v1/orders").session(customer).header("X-CSRF-TOKEN", csrf(customer))
                        .contentType(MediaType.APPLICATION_JSON).content(json(pickupOrder(productId, 60))))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.fieldErrors.pointsToSpend").exists());
        String number = objectMapper.readTree(mockMvc.perform(post("/api/v1/orders").session(customer)
                        .header("X-CSRF-TOKEN", csrf(customer)).contentType(MediaType.APPLICATION_JSON)
                        .content(json(pickupOrder(productId, 20))))
                .andExpect(status().isCreated()).andReturn().getResponse().getContentAsString()).get("number").asText();

        // Crédito parcialmente usado: só restam 30 por gastar naquele lote.
        org.junit.jupiter.api.Assertions.assertEquals(30,
                jdbc.queryForObject("SELECT SUM(remaining_points) FROM loyalty_point_lot WHERE remaining_points > 0", Integer.class));

        // Cancelar devolve os pontos ao lote de origem.
        mockMvc.perform(post("/api/v1/orders/" + number + "/cancel").session(customer).header("X-CSRF-TOKEN", csrf(customer)))
                .andExpect(status().isOk());
        org.junit.jupiter.api.Assertions.assertEquals(50,
                jdbc.queryForObject("SELECT SUM(remaining_points) FROM loyalty_point_lot WHERE remaining_points > 0", Integer.class));

        // Prazo fora do intervalo é recusado.
        mockMvc.perform(put("/api/v1/admin/loyalty/validity").session(owner).header("X-CSRF-TOKEN", csrf(owner))
                        .contentType(MediaType.APPLICATION_JSON).content(json(Map.of("days", 0))))
                .andExpect(status().isBadRequest());
    }

    /* -------------------------------- Helpers -------------------------------- */

    private Map<String, Object> pickupOrder(String productId, int pointsToSpend) {
        Map<String, Object> body = new LinkedHashMap<>();
        body.put("contactName", "Cliente");
        body.put("contactPhone", "912345678");
        body.put("fulfillment", "PICKUP");
        body.put("paymentMethod", "IBAN_TRANSFER");
        body.put("pointsToSpend", pointsToSpend);
        body.put("productLines", List.of(Map.of("productId", productId, "quantity", 1)));
        body.put("cakeLines", List.of());
        return body;
    }

    private Map<String, Object> deliveryOrder(String productId, int quantity, String zoneId) {
        Map<String, Object> body = new LinkedHashMap<>();
        body.put("contactName", "Cliente");
        body.put("contactPhone", "912345678");
        body.put("fulfillment", "DELIVERY");
        body.put("addressLine1", "Rua 1");
        body.put("addressCity", "Luanda");
        body.put("paymentMethod", "IBAN_TRANSFER");
        body.put("productLines", List.of(Map.of("productId", productId, "quantity", quantity)));
        body.put("cakeLines", List.of());
        if (zoneId != null) body.put("deliveryZoneId", zoneId);
        return body;
    }

    private static String idBySlug(JsonNode list, String slug) {
        for (JsonNode node : list) {
            if (slug.equals(node.get("slug").asText())) return node.get("id").asText();
        }
        throw new AssertionError("complemento não encontrado: " + slug);
    }

    private String json(Object body) {
        return objectMapper.writeValueAsString(body);
    }

    private String postJson(MockHttpSession session, String path, Object body, int expected) throws Exception {
        return mockMvc.perform(post(path).session(session).header("X-CSRF-TOKEN", csrf(session))
                        .contentType(MediaType.APPLICATION_JSON).content(json(body)))
                .andExpect(status().is(expected)).andReturn().getResponse().getContentAsString();
    }

    private void putJson(MockHttpSession session, String path, Object body) throws Exception {
        mockMvc.perform(put(path).session(session).header("X-CSRF-TOKEN", csrf(session))
                        .contentType(MediaType.APPLICATION_JSON).content(json(body)))
                .andExpect(status().isOk());
    }

    private void setStock(String productId, int qty) {
        UUID pid = UUID.fromString(productId);
        var item = inventoryRepository.findByProductId(pid).orElseGet(() -> {
            var created = new com.lisscompany.inventory.InventoryItem();
            created.setProductId(pid);
            return created;
        });
        item.setAvailableQty(qty);
        item.setUnitLabel("un");
        inventoryRepository.save(item);
    }

    private void makeOwner(String email) {
        var user = userRepository.findByEmail(email).orElseThrow();
        user.setOwner(true);
        userRepository.save(user);
    }

    private MockHttpSession register(String email) throws Exception {
        MockHttpSession session = new MockHttpSession();
        mockMvc.perform(post("/api/v1/auth/register").session(session).header("X-CSRF-TOKEN", csrf(session))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(json(Map.of("email", email, "displayName", "Teste", "password", "senha-forte-1234"))))
                .andExpect(status().isCreated());
        return session;
    }

    private String csrf(MockHttpSession session) throws Exception {
        String content = mockMvc.perform(get("/api/v1/csrf").session(session))
                .andExpect(status().isOk()).andReturn().getResponse().getContentAsString();
        return objectMapper.readValue(content, new TypeReference<Map<String, Object>>() {}).get("token").toString();
    }

    private String productId(String slug) throws Exception {
        String content = mockMvc.perform(get("/api/v1/public/catalog/products"))
                .andExpect(status().isOk()).andReturn().getResponse().getContentAsString();
        List<Map<String, Object>> items = objectMapper.readValue(content, new TypeReference<List<Map<String, Object>>>() {});
        return items.stream().filter(item -> slug.equals(item.get("slug")))
                .map(item -> item.get("id").toString()).findFirst()
                .orElseThrow(() -> new AssertionError("produto não encontrado no seed: " + slug));
    }
}
