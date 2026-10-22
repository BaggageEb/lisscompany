package com.lisscompany;

import static org.hamcrest.Matchers.containsString;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

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
import org.springframework.mock.web.MockHttpSession;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.test.web.servlet.MockMvc;

import io.zonky.test.db.postgres.embedded.EmbeddedPostgres;

import com.lisscompany.audit.AuditLog;
import com.lisscompany.audit.AuditRepository;
import com.lisscompany.orders.CustomerOrder;
import com.lisscompany.orders.CustomerOrderRepository;
import com.lisscompany.orders.OrderItem;

/**
 * Integração das encomendas (fase 4) com PostgreSQL real: criar exige sessão e
 * CSRF, os preços vêm do servidor (nunca do cliente), o carrinho inválido é
 * 422 sem criar nada, e cada encomenda só é visível ao seu dono.
 */
@SpringBootTest
@AutoConfigureMockMvc
class OrderApiIntegrationTest {

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

    @Autowired
    private CustomerOrderRepository orderRepository;

    @Autowired
    private AuditRepository auditRepository;

    /* ---------------------------- Protecções ----------------------------- */

    @Test
    void creatingAnOrderRequiresAnAuthenticatedSession() throws Exception {
        // Com CSRF válido mas sem login: quem decide é a autorização (401), não o CSRF.
        MockHttpSession session = new MockHttpSession();

        mockMvc.perform(post("/api/v1/orders")
                        .session(session)
                        .header("X-CSRF-TOKEN", csrfToken(session))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{}"))
                .andExpect(status().isUnauthorized());
    }

    @Test
    void creatingAnOrderRequiresACsrfToken() throws Exception {
        MockHttpSession session = register("csrf-order@example.com", "CSRF");

        mockMvc.perform(post("/api/v1/orders")
                        .session(session)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(orderBody("Ana", "912345678", "PICKUP", null, "ON_DELIVERY", null, List.of(), List.of())))
                .andExpect(status().isForbidden());
    }

    /* ----------------------------- Criação ------------------------------- */

    @Test
    void orderUsesServerConfirmedPricesAndStoresAnImmutableSnapshot() throws Exception {
        MockHttpSession session = register("encomenda@example.com", "Ana Compradora");
        String premiumId = productId("bolo-no-pote-premium");

        Map<String, Object> cake = cakeLine("chocolate", "ganache-chocolate", "morango", List.of("folha-de-ouro"), true, 1);
        String body = orderBody(
                "Ana Compradora",
                "912345678",
                "PICKUP",
                null,
                "ON_DELIVERY",
                null,
                List.of(Map.of("productId", premiumId, "quantity", 2)),
                List.of(cake));

        String content = mockMvc.perform(post("/api/v1/orders")
                        .session(session)
                        .header("X-CSRF-TOKEN", csrfToken(session))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(body))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.number").value(containsString("LC-")))
                .andExpect(jsonPath("$.status").value("RECEIVED"))
                .andExpect(jsonPath("$.fulfillment").value("PICKUP"))
                .andExpect(jsonPath("$.paymentMethod").value("ON_DELIVERY"))
                // 3500×2 + (2500 base + 500 morango + 1500 folha) = 11500.00 — calculado pelo SERVIDOR
                .andExpect(jsonPath("$.subtotal").value("11500.00"))
                .andExpect(jsonPath("$.deliveryFee").value("0.00"))
                .andExpect(jsonPath("$.total").value("11500.00"))
                .andExpect(jsonPath("$.currency").value("AOA"))
                .andExpect(jsonPath("$.items.length()").value(2))
                .andExpect(jsonPath("$.items[0].kind").value("PRODUCT"))
                .andExpect(jsonPath("$.items[0].name").value("Bolo no Pote Premium"))
                .andExpect(jsonPath("$.items[0].unitPrice").value("3500.00"))
                .andExpect(jsonPath("$.items[0].lineTotal").value("7000.00"))
                .andExpect(jsonPath("$.items[1].kind").value("CAKE"))
                .andExpect(jsonPath("$.items[1].lineTotal").value("4500.00"))
                // Rótulos do bolo gerados pelo SERVIDOR (o cliente não escreve texto)
                .andExpect(jsonPath("$.items[1].summary[0]").value("Massa Chocolate"))
                .andExpect(jsonPath("$.items[1].summary[1]").value("1º recheio: Ganache de chocolate"))
                .andExpect(jsonPath("$.items[1].summary[3]").value("Extra: Folha de ouro"))
                .andExpect(jsonPath("$.items[1].summary[4]").value("Bolo molhado"))
                .andReturn().getResponse().getContentAsString();

        String number = objectMapper.readValue(content, new TypeReference<Map<String, Object>>() {}).get("number").toString();

        // A composição fica gravada em SNAPSHOT (jsonb) na base — o histórico
        // descreve o bolo vendido mesmo que o catálogo mude depois.
        CustomerOrder persisted = orderRepository.findByOrderNumberWithItems(number).orElseThrow();
        OrderItem cakeItem = persisted.getItems().get(1);
        org.junit.jupiter.api.Assertions.assertTrue(
                cakeItem.getComposition() != null
                        && cakeItem.getComposition().contains("Ganache de chocolate")
                        && cakeItem.getComposition().contains("Folha de ouro"),
                "composição do bolo deve ficar em snapshot: " + cakeItem.getComposition());

        // A criação gera registo de auditoria atómico à encomenda (mesma transacção).
        List<AuditLog> audit = auditRepository.findByEntityTypeAndEntityIdOrderByCreatedAtDesc(
                "customer_order", persisted.getId().toString());
        org.junit.jupiter.api.Assertions.assertEquals(1, audit.size(), "auditoria da criação");
        org.junit.jupiter.api.Assertions.assertEquals("order.created", audit.get(0).getAction());
        org.junit.jupiter.api.Assertions.assertEquals(persisted.getUserId(), audit.get(0).getActorUserId());

        // A lista e o detalhe pertencem ao próprio cliente.
        mockMvc.perform(get("/api/v1/orders").session(session))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.length()").value(1))
                .andExpect(jsonPath("$[0].number").value(number));

        mockMvc.perform(get("/api/v1/orders/" + number).session(session))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.number").value(number));
    }

    @Test
    void aPriceSentByTheClientNeverReachesTheOrder() throws Exception {
        MockHttpSession session = register("fraude@example.com", "Precavida");
        String premiumId = productId("bolo-no-pote-premium");

        String body = "{\"contactName\":\"Precavida\",\"contactPhone\":\"912000111\",\"fulfillment\":\"PICKUP\","
                + "\"paymentMethod\":\"ON_DELIVERY\",\"productLines\":[{\"productId\":\"" + premiumId
                + "\",\"quantity\":1,\"unitPrice\":\"1.00\"}]}";

        mockMvc.perform(post("/api/v1/orders")
                        .session(session)
                        .header("X-CSRF-TOKEN", csrfToken(session))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(body))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.total").value("3500.00"))
                .andExpect(jsonPath("$.items[0].unitPrice").value("3500.00"));
    }

    @Test
    void invalidCartIsRejectedWith422AndNothingIsPersisted() throws Exception {
        MockHttpSession session = register("invalido@example.com", "Inês");

        String body = orderBody(
                "Inês",
                "933333333",
                "PICKUP",
                null,
                "ON_DELIVERY",
                null,
                List.of(Map.of("productId", "00000000-0000-0000-0000-000000000000", "quantity", 1)),
                List.of());

        mockMvc.perform(post("/api/v1/orders")
                        .session(session)
                        .header("X-CSRF-TOKEN", csrfToken(session))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(body))
                .andExpect(status().isUnprocessableEntity())
                .andExpect(jsonPath("$.code").value("CART_INVALID"))
                .andExpect(jsonPath("$.issues[0]").value("Produto: já não está disponível."));

        mockMvc.perform(get("/api/v1/orders").session(session))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.length()").value(0));
    }

    @Test
    void deliveryRequiresACompleteAddress() throws Exception {
        MockHttpSession session = register("entrega@example.com", "Eduarda");
        String premiumId = productId("bolo-no-pote-premium");

        String body = orderBody(
                "Eduarda",
                "922222222",
                "DELIVERY",
                Map.of("addressCity", "Luanda"),
                "MULTICAIXA_EXPRESS",
                null,
                List.of(Map.of("productId", premiumId, "quantity", 1)),
                List.of());

        mockMvc.perform(post("/api/v1/orders")
                        .session(session)
                        .header("X-CSRF-TOKEN", csrfToken(session))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(body))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.code").value("VALIDATION_FAILED"))
                .andExpect(jsonPath("$.fieldErrors.addressLine1").value("A morada é obrigatória para entrega."));
    }

    @Test
    void ordersAreOnlyVisibleToTheirOwner() throws Exception {
        MockHttpSession owner = register("dona@example.com", "Dona");
        String premiumId = productId("bolo-no-pote-premium");
        String content = mockMvc.perform(post("/api/v1/orders")
                        .session(owner)
                        .header("X-CSRF-TOKEN", csrfToken(owner))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(orderBody("Dona", "911111111", "PICKUP", null, "ON_DELIVERY", null,
                                List.of(Map.of("productId", premiumId, "quantity", 1)), List.of())))
                .andExpect(status().isCreated())
                .andReturn().getResponse().getContentAsString();
        String number = objectMapper.readValue(content, new TypeReference<Map<String, Object>>() {}).get("number").toString();

        MockHttpSession other = register("vizinha@example.com", "Vizinha");

        mockMvc.perform(get("/api/v1/orders/" + number).session(other))
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.code").value("ORDER_NOT_FOUND"));

        mockMvc.perform(get("/api/v1/orders").session(other))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.length()").value(0));
    }

    /* ------------------------------- helpers ------------------------------ */

    /** Regista uma conta e devolve a sessão JÁ autenticada (com token CSRF). */
    private MockHttpSession register(String email, String displayName) throws Exception {
        MockHttpSession session = new MockHttpSession();
        String token = csrfToken(session);
        String body = objectMapper.writeValueAsString(Map.of(
                "email", email,
                "displayName", displayName,
                "password", "senha-forte-1234"));
        mockMvc.perform(post("/api/v1/auth/register")
                        .session(session)
                        .header("X-CSRF-TOKEN", token)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(body))
                .andExpect(status().isCreated());
        return session;
    }

    private String csrfToken(MockHttpSession session) throws Exception {
        String content = mockMvc.perform(get("/api/v1/csrf").session(session))
                .andExpect(status().isOk())
                .andReturn().getResponse().getContentAsString();
        return objectMapper.readValue(content, new TypeReference<Map<String, Object>>() {}).get("token").toString();
    }

    private String productId(String slug) throws Exception {
        String content = mockMvc.perform(get("/api/v1/public/catalog/products"))
                .andExpect(status().isOk())
                .andReturn().getResponse().getContentAsString();
        List<Map<String, Object>> items =
                objectMapper.readValue(content, new TypeReference<List<Map<String, Object>>>() {});
        return items.stream()
                .filter(item -> slug.equals(item.get("slug")))
                .map(item -> item.get("id").toString())
                .findFirst()
                .orElseThrow(() -> new AssertionError("produto não encontrado no seed: " + slug));
    }

    private String orderBody(
            String contactName,
            String contactPhone,
            String fulfillment,
            Map<String, Object> extraAddress,
            String paymentMethod,
            String notes,
            List<Object> productLines,
            List<Object> cakeLines) throws Exception {
        Map<String, Object> body = new java.util.LinkedHashMap<>();
        body.put("contactName", contactName);
        body.put("contactPhone", contactPhone);
        body.put("fulfillment", fulfillment);
        if (extraAddress != null) {
            body.putAll(extraAddress);
        }
        body.put("paymentMethod", paymentMethod);
        if (notes != null) {
            body.put("notes", notes);
        }
        body.put("productLines", productLines);
        body.put("cakeLines", cakeLines);
        return objectMapper.writeValueAsString(body);
    }

    private Map<String, Object> cakeLine(
            String base, String first, String second, List<String> extras, boolean moist, int quantity)
            throws Exception {
        // Loop simples: uma lambda não pode lançar excepções checked.
        java.util.List<String> extraIds = new java.util.ArrayList<>();
        for (String slug : extras) {
            extraIds.add(ingredientId("EXTRA", slug));
        }
        return Map.of(
                "cakeBaseId", ingredientId("CAKE_BASE", base),
                "firstFillingId", ingredientId("FILLING", first),
                "secondFillingId", ingredientId("FILLING", second),
                "extraIds", extraIds,
                "moist", moist,
                "quantity", quantity);
    }

    @SuppressWarnings("unchecked")
    private String ingredientId(String kind, String slug) throws Exception {
        String content = mockMvc.perform(get("/api/v1/public/cake-studio/options"))
                .andExpect(status().isOk())
                .andReturn().getResponse().getContentAsString();
        Map<String, Object> options = objectMapper.readValue(content, new TypeReference<Map<String, Object>>() {});
        String group = switch (kind) {
            case "CAKE_BASE" -> "cakeBases";
            case "FILLING" -> "fillings";
            default -> "extras";
        };
        List<Map<String, Object>> items = (List<Map<String, Object>>) options.get(group);
        return items.stream()
                .filter(item -> slug.equals(item.get("slug")))
                .map(item -> item.get("id").toString())
                .findFirst()
                .orElseThrow(() -> new AssertionError("ingrediente não encontrado no seed: " + slug));
    }
}
