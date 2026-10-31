package com.lisscompany;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import java.util.List;
import java.util.Map;
import java.util.UUID;

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

import com.lisscompany.inventory.InventoryItemRepository;
import com.lisscompany.inventory.ReservationStatus;
import com.lisscompany.inventory.StockMovementReason;
import com.lisscompany.inventory.StockMovementRepository;
import com.lisscompany.inventory.StockReservationRepository;
import com.lisscompany.orders.CustomerOrderRepository;
import com.lisscompany.payments.PaymentRepository;
import com.lisscompany.payments.PaymentStatus;

import io.zonky.test.db.postgres.embedded.EmbeddedPostgres;
import tools.jackson.core.type.TypeReference;
import tools.jackson.databind.ObjectMapper;

/**
 * Sistema de gestão (V7) com PostgreSQL real: RBAC granular sem escalada,
 * definições privadas (IBAN nunca público), zonas de entrega no servidor,
 * gestão de catálogo com validação de imagens, regra E das recompensas e
 * reembolsos auditados e limitados ao valor pago.
 */
@SpringBootTest
@AutoConfigureMockMvc
class ManagementSystemIntegrationTest {

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
    @Autowired private com.lisscompany.identity.AppUserRepository userRepository;

    /* ------------------------------ Definições -------------------------- */

    @Test
    void bankDetailsAreNeverPublicAndNeverWrittenToTheAudit() throws Exception {
        MockHttpSession owner = register("def-dona@example.com", "Dona");
        makeOwner("def-dona@example.com");
        MockHttpSession customer = register("def-cliente@example.com", "Cliente");

        putJson(owner, "/api/v1/admin/settings", Map.of(
                "payment.iban", "AO06 0040 0000 1234 5678 9012 3",
                "payment.holder", "Titular Teste",
                "contact.phone", "923000000"));

        String publicView = mockMvc.perform(get("/api/v1/public/store"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.settings.contacts.phone").value("923000000"))
                .andReturn().getResponse().getContentAsString();
        org.junit.jupiter.api.Assertions.assertFalse(publicView.contains("0040"), "IBAN nunca é público");
        org.junit.jupiter.api.Assertions.assertFalse(publicView.contains("Titular Teste"));

        // O dono da encomenda vê as instruções; o IBAN não vai para a auditoria.
        String productId = productId("bolo-no-pote-premium");
        setStock(productId, 10);
        String number = createOrder(customer, productId, 1, Map.of());
        mockMvc.perform(get("/api/v1/orders/" + number + "/payment").session(customer))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.instructions.iban").value("AO06 0040 0000 1234 5678 9012 3"));
        String audit = getJson(owner, "/api/v1/admin/audit?q=settings");
        org.junit.jupiter.api.Assertions.assertTrue(audit.contains("settings.updated"));
        org.junit.jupiter.api.Assertions.assertFalse(audit.contains("0040 0000"), "valores privados fora da auditoria");

        mockMvc.perform(get("/api/v1/admin/settings").session(customer)).andExpect(status().isForbidden());
    }

    /* --------------------------------- Entrega -------------------------- */

    @Test
    void deliveryFeeComesFromTheConfiguredZoneOnTheServer() throws Exception {
        MockHttpSession owner = register("ent-dona@example.com", "Dona");
        makeOwner("ent-dona@example.com");
        MockHttpSession customer = register("ent-cliente@example.com", "Cliente");
        String zoneId = objectMapper.readTree(postJson(owner, "/api/v1/admin/delivery-zones",
                Map.of("name", "Centro", "fee", "1500", "active", true), 201)).get("id").asText();
        String productId = productId("bolo-no-pote-premium");
        setStock(productId, 10);

        Map<String, Object> base = new java.util.LinkedHashMap<>();
        base.put("contactName", "Cliente");
        base.put("contactPhone", "912345678");
        base.put("fulfillment", "DELIVERY");
        base.put("addressLine1", "Rua 1");
        base.put("addressCity", "Luanda");
        base.put("paymentMethod", "ON_DELIVERY");
        base.put("productLines", List.of(Map.of("productId", productId, "quantity", 1)));
        base.put("cakeLines", List.of());

        // Com zonas activas a zona é obrigatória.
        mockMvc.perform(post("/api/v1/orders").session(customer).header("X-CSRF-TOKEN", csrfToken(customer))
                        .contentType(MediaType.APPLICATION_JSON).content(objectMapper.writeValueAsString(base)))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.fieldErrors.deliveryZoneId").exists());

        base.put("deliveryZoneId", zoneId);
        mockMvc.perform(post("/api/v1/orders").session(customer).header("X-CSRF-TOKEN", csrfToken(customer))
                        .contentType(MediaType.APPLICATION_JSON).content(objectMapper.writeValueAsString(base)))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.deliveryFee").value("1500.00"))
                .andExpect(jsonPath("$.deliveryZone").value("Centro"));
    }

    /* ---------------------------- RBAC / contas secundárias ------------- */

    @Test
    void staffAccountsGetOnlyTheirPermissionsAndCannotEscalate() throws Exception {
        MockHttpSession owner = register("rbac-dona@example.com", "Dona");
        makeOwner("rbac-dona@example.com");

        String roles = getJson(owner, "/api/v1/admin/roles");
        String orderManagerId = null;
        for (var role : objectMapper.readTree(roles)) {
            if ("ORDER_MANAGER".equals(role.get("code").asText())) {
                orderManagerId = role.get("id").asText();
            }
        }
        org.junit.jupiter.api.Assertions.assertNotNull(orderManagerId);

        String created = postJson(owner, "/api/v1/admin/staff", Map.of(
                "email", "colab@example.com", "displayName", "Colaborador", "roleIds", List.of(orderManagerId)), 201);
        String staffId = objectMapper.readTree(created).get("user").get("id").asText();
        String temporary = objectMapper.readTree(created).get("temporaryPassword").asText();

        MockHttpSession staff = new MockHttpSession();
        mockMvc.perform(post("/api/v1/auth/login").session(staff).header("X-CSRF-TOKEN", csrfToken(staff))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(Map.of("email", "colab@example.com", "password", temporary))))
                .andExpect(status().isOk());

        // Tem encomendas; não tem definições, catálogo nem contas.
        mockMvc.perform(get("/api/v1/admin/orders").session(staff)).andExpect(status().isOk());
        mockMvc.perform(get("/api/v1/admin/settings").session(staff)).andExpect(status().isForbidden());
        mockMvc.perform(get("/api/v1/admin/staff").session(staff)).andExpect(status().isForbidden());
        mockMvc.perform(post("/api/v1/admin/catalog/categories").session(staff).header("X-CSRF-TOKEN", csrfToken(staff))
                        .contentType(MediaType.APPLICATION_JSON).content("{\"name\":\"X\"}"))
                .andExpect(status().isForbidden());

        // A proprietária principal nunca é alterada por terceiros; a conta não se auto-edita.
        mockMvc.perform(put("/api/v1/admin/staff/" + userRepository.findByEmail("rbac-dona@example.com").orElseThrow().getId())
                        .session(owner).header("X-CSRF-TOKEN", csrfToken(owner))
                        .contentType(MediaType.APPLICATION_JSON).content("{\"status\":\"DISABLED\"}"))
                .andExpect(status().isForbidden());

        // Desactivar termina o acesso de imediato, mesmo com sessão aberta.
        mockMvc.perform(put("/api/v1/admin/staff/" + staffId).session(owner).header("X-CSRF-TOKEN", csrfToken(owner))
                        .contentType(MediaType.APPLICATION_JSON).content("{\"status\":\"DISABLED\"}"))
                .andExpect(status().isOk());
        mockMvc.perform(get("/api/v1/admin/orders").session(staff)).andExpect(status().is4xxClientError());
    }

    /* -------------------------------- Catálogo -------------------------- */

    @Test
    void ownerManagesProductsWithValidatedImages() throws Exception {
        MockHttpSession owner = register("cat-dona@example.com", "Dona");
        makeOwner("cat-dona@example.com");

        // Só imagens reais (PNG/JPEG/WebP) — decidido pelos bytes, não pelo nome.
        mockMvc.perform(org.springframework.test.web.servlet.request.MockMvcRequestBuilders.multipart("/api/v1/admin/media")
                        .file(new org.springframework.mock.web.MockMultipartFile(
                                "file", "malicioso.png", "image/png", "<script>alert(1)</script>".getBytes()))
                        .session(owner).header("X-CSRF-TOKEN", csrfToken(owner)))
                .andExpect(status().isBadRequest());

        byte[] png = {(byte) 0x89, 'P', 'N', 'G', 0x0D, 0x0A, 0x1A, 0x0A, 0, 0, 0, 0};
        String url = objectMapper.readTree(mockMvc.perform(
                        org.springframework.test.web.servlet.request.MockMvcRequestBuilders.multipart("/api/v1/admin/media")
                                .file(new org.springframework.mock.web.MockMultipartFile("file", "x.png", "image/png", png))
                                .session(owner).header("X-CSRF-TOKEN", csrfToken(owner)))
                .andExpect(status().isOk()).andReturn().getResponse().getContentAsString()).get("url").asText();
        mockMvc.perform(get(url)).andExpect(status().isOk());
        mockMvc.perform(get("/api/v1/public/media/..%2F..%2Fetc%2Fpasswd")).andExpect(status().is4xxClientError());

        String categoryId = objectMapper.readTree(postJson(owner, "/api/v1/admin/catalog/categories",
                Map.of("name", "Bolos de Aniversário"), 201)).get("id").asText();
        postJson(owner, "/api/v1/admin/catalog/products", Map.of(
                "name", "Bolo de Chocolate", "description", "Feito à encomenda", "basePrice", "12000",
                "categoryId", categoryId, "status", "ACTIVE", "imageUrl", url, "gallery", List.of(url)), 201);

        String publicProducts = mockMvc.perform(get("/api/v1/public/catalog/products"))
                .andExpect(status().isOk()).andReturn().getResponse().getContentAsString();
        org.junit.jupiter.api.Assertions.assertTrue(publicProducts.contains("bolo-de-chocolate"));
        org.junit.jupiter.api.Assertions.assertTrue(publicProducts.contains(url));

        // Preço inválido é rejeitado no servidor.
        postJson(owner, "/api/v1/admin/catalog/products", Map.of(
                "name", "Sem preço", "basePrice", "abc", "categoryId", categoryId), 400);
    }

    /* ------------------------------ Fidelização -------------------------- */

    @Test
    void rewardsRequireBothPointsAndOrders() throws Exception {
        MockHttpSession owner = register("fid-dona@example.com", "Dona");
        makeOwner("fid-dona@example.com");
        Map<String, Object> onlyPoints = new java.util.LinkedHashMap<>();
        onlyPoints.put("code", "SO_PONTOS");
        onlyPoints.put("description", "Só pontos");
        onlyPoints.put("minPoints", 1000);
        onlyPoints.put("discountAmount", "500");
        onlyPoints.put("maxPerCustomer", 1);
        onlyPoints.put("active", true);
        mockMvc.perform(post("/api/v1/admin/loyalty/config/rewards").session(owner)
                        .header("X-CSRF-TOKEN", csrfToken(owner)).contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(onlyPoints)))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.fieldErrors.minOrders").exists());
    }

    /* ------------------------------ Reembolsos --------------------------- */

    @Test
    void refundsArePartialCappedAndAudited() throws Exception {
        MockHttpSession owner = register("ref-dona@example.com", "Dona");
        makeOwner("ref-dona@example.com");
        MockHttpSession customer = register("ref-cliente@example.com", "Cliente");
        String productId = productId("bolo-no-pote-premium");
        setStock(productId, 10);
        String number = createOrder(customer, productId, 1, Map.of());

        // Antes de pago não há reembolso.
        postJson(owner, "/api/v1/admin/orders/" + number + "/refund", Map.of("amount", "100", "reason", "teste"), 409);

        postJson(owner, "/api/v1/admin/payments/" + number + "/review", Map.of("target", "PAID"), 200);
        // Reembolso parcial.
        mockMvc.perform(post("/api/v1/admin/orders/" + number + "/refund").session(owner)
                        .header("X-CSRF-TOKEN", csrfToken(owner)).contentType(MediaType.APPLICATION_JSON)
                        .content("{\"amount\":\"1000\",\"reason\":\"Cliente desistiu de parte\"}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.status").value("PARTIALLY_REFUNDED"))
                .andExpect(jsonPath("$.refundedAmount").value("1000.00"));
        // Nunca mais do que o valor pago.
        postJson(owner, "/api/v1/admin/orders/" + number + "/refund", Map.of("amount", "999999", "reason", "excesso"), 400);
        // Cliente nunca reembolsa.
        mockMvc.perform(post("/api/v1/admin/orders/" + number + "/refund").session(customer)
                        .header("X-CSRF-TOKEN", csrfToken(customer)).contentType(MediaType.APPLICATION_JSON)
                        .content("{\"amount\":\"1\",\"reason\":\"x\"}"))
                .andExpect(status().isForbidden());
        String audit = getJson(owner, "/api/v1/admin/audit?q=payment.refunded");
        org.junit.jupiter.api.Assertions.assertTrue(audit.contains("payment.refunded"));
    }

    /* ------------------------------- Helpers ----------------------------- */

    private String postJson(MockHttpSession session, String path, Object body, int expected) throws Exception {
        return mockMvc.perform(post(path).session(session).header("X-CSRF-TOKEN", csrfToken(session))
                        .contentType(MediaType.APPLICATION_JSON).content(objectMapper.writeValueAsString(body)))
                .andExpect(status().is(expected)).andReturn().getResponse().getContentAsString();
    }

    private void putJson(MockHttpSession session, String path, Object body) throws Exception {
        mockMvc.perform(put(path).session(session).header("X-CSRF-TOKEN", csrfToken(session))
                        .contentType(MediaType.APPLICATION_JSON).content(objectMapper.writeValueAsString(body)))
                .andExpect(status().isOk());
    }

    private String getJson(MockHttpSession session, String path) throws Exception {
        return mockMvc.perform(get(path).session(session))
                .andExpect(status().isOk()).andReturn().getResponse().getContentAsString();
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

    private MockHttpSession register(String email, String displayName) throws Exception {
        MockHttpSession session = new MockHttpSession();
        mockMvc.perform(post("/api/v1/auth/register").session(session).header("X-CSRF-TOKEN", csrfToken(session))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(Map.of(
                                "email", email, "displayName", displayName, "password", "senha-forte-1234"))))
                .andExpect(status().isCreated());
        return session;
    }

    private String csrfToken(MockHttpSession session) throws Exception {
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

    private String createOrder(MockHttpSession session, String productId, int quantity, Map<String, Object> extra)
            throws Exception {
        Map<String, Object> body = new java.util.LinkedHashMap<>();
        body.put("contactName", "Cliente Teste");
        body.put("contactPhone", "912345678");
        body.put("fulfillment", "PICKUP");
        body.put("paymentMethod", "IBAN_TRANSFER");
        body.put("productLines", List.of(Map.of("productId", productId, "quantity", quantity)));
        body.put("cakeLines", List.of());
        body.putAll(extra);
        String content = mockMvc.perform(post("/api/v1/orders").session(session)
                        .header("X-CSRF-TOKEN", csrfToken(session)).contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(body)))
                .andExpect(status().isCreated()).andReturn().getResponse().getContentAsString();
        return objectMapper.readValue(content, new TypeReference<Map<String, Object>>() {}).get("number").toString();
    }
}
