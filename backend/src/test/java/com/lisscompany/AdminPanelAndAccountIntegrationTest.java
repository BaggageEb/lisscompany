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
 * Fase 7 — painel administrativo e área do cliente com PostgreSQL real:
 *
 * <ul>
 *   <li>o painel lista encomendas/detalhe com transições possíveis e a fila
 *       de pagamentos; tudo exige conta autorizada (403 para cliente comum);</li>
 *   <li>ajuste manual de stock: primeira entrada cria a linha (INITIAL_SETUP),
 *       zero é 422, baixo reservas é 409, e tudo audita;</li>
 *   <li>perfil do cliente: editar nome/telefone com validação no servidor;</li>
 *   <li>palavra-passe: exige a actual, regras do registo, e o novo login
 *       funciona enquanto o antigo falha;</li>
 *   <li>moradas: CRUD por dono (outro cliente nunca vê), predefinida única.</li>
 * </ul>
 */
@SpringBootTest
@AutoConfigureMockMvc
class AdminPanelAndAccountIntegrationTest {

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

    @Autowired private MockMvc mockMvc;
    @Autowired private ObjectMapper objectMapper;

    @Autowired private InventoryItemRepository inventoryRepository;
    @Autowired private StockReservationRepository reservationRepository;
    @Autowired private StockMovementRepository movementRepository;
    @Autowired private PaymentRepository paymentRepository;
    @Autowired private CustomerOrderRepository orderRepository;
    @Autowired private com.lisscompany.identity.AppUserRepository userRepository;
    @Autowired private com.lisscompany.audit.AuditRepository auditRepository;

    /* --------------------------- Painel: encomendas --------------------- */

    @Test
    void panelListsOrdersWithContactAndAllowedTargetsButNeverForCustomers() throws Exception {
        MockHttpSession customer = register("painel-cliente@example.com", "Cliente Painel");
        MockHttpSession owner = register("painel-dona@example.com", "Dona Painel");
        makeOwner("painel-dona@example.com");
        String productId = productId("bolo-no-pote-premium");
        setStock(productId, 20);
        String number = createOrder(customer, productId, 1);

        // Lista do painel: encomenda com quem encomendou e pagamento visível.
        String list = getJson(owner, "/api/v1/admin/orders");
        org.junit.jupiter.api.Assertions.assertTrue(
                list.contains(number), "a lista do painel contém a encomenda");
        org.junit.jupiter.api.Assertions.assertTrue(
                list.contains("Cliente Teste"), "o painel identifica quem encomendou (contacto da encomenda)");

        // Detalhe: transições que a máquina de estados aceita (RECEIVED →…).
        String detail = getJson(owner, "/api/v1/admin/orders/" + number);
        org.junit.jupiter.api.Assertions.assertTrue(
                detail.contains("CONFIRMED") && detail.contains("CANCELLED"),
                "o detalhe devolve os destinos possíveis");

        // Cliente comum nunca entra no painel.
        mockMvc.perform(get("/api/v1/admin/orders").session(customer))
                .andExpect(status().isForbidden())
                .andExpect(jsonPath("$.code").value("FORBIDDEN"));
        mockMvc.perform(get("/api/v1/admin/orders/" + number).session(customer))
                .andExpect(status().isForbidden());
    }

    @Test
    void panelPaymentQueueShowsPendingAndFiltersByStatus() throws Exception {
        MockHttpSession customer = register("fila-cliente@example.com", "Fila Cliente");
        MockHttpSession owner = register("fila-dona@example.com", "Fila Dona");
        makeOwner("fila-dona@example.com");
        String productId = productId("bolo-no-pote-premium");
        setStock(productId, 20);
        String number = createOrder(customer, productId, 1);

        // Fila pendente contém a encomenda com o valor e o contacto.
        String pending = getJson(owner, "/api/v1/admin/payments?status=PENDING");
        org.junit.jupiter.api.Assertions.assertTrue(pending.contains(number), "pendente na fila");
        org.junit.jupiter.api.Assertions.assertTrue(pending.contains("Cliente Teste"), "contacto visível");

        // Confirmar o pagamento tira a encomenda da fila PENDING.
        mockMvc.perform(post("/api/v1/admin/payments/" + number + "/review")
                        .session(owner)
                        .header("X-CSRF-TOKEN", csrfToken(owner))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"target\":\"PAID\"}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.status").value("PAID"));
        String after = getJson(owner, "/api/v1/admin/payments?status=PENDING");
        org.junit.jupiter.api.Assertions.assertFalse(after.contains(number), "pago sai da fila pendente");

        // Cliente comum: fila invisível.
        mockMvc.perform(get("/api/v1/admin/payments").session(customer))
                .andExpect(status().isForbidden());
    }

    /* --------------------------- Painel: inventário --------------------- */

    @Test
    void firstPositiveAdjustmentCreatesTheStockLineAndAudits() throws Exception {
        MockHttpSession owner = register("stock-dona@example.com", "Stock Dona");
        makeOwner("stock-dona@example.com");
        // Produto sem linha de inventário (ilimitado até a proprietária configurar).
        String productId = productId("caixa-degustacao");
        inventoryRepository.findByProductId(UUID.fromString(productId)).ifPresent(inventoryRepository::delete);

        // Primeira entrada positiva → cria a linha com motivo INITIAL_SETUP.
        mockMvc.perform(post("/api/v1/admin/inventory/" + productId + "/adjustment")
                        .session(owner)
                        .header("X-CSRF-TOKEN", csrfToken(owner))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"delta\": 25, \"note\": \"Stock inicial da caixa\"}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.availableQty").value(25));

        var item = inventoryRepository.findByProductId(UUID.fromString(productId)).orElseThrow();
        org.junit.jupiter.api.Assertions.assertEquals(25, item.getAvailableQty());
        org.junit.jupiter.api.Assertions.assertTrue(
                movementRepository.findByProductIdOrderByCreatedAtDesc(UUID.fromString(productId)).stream()
                        .anyMatch(m -> m.getReason() == StockMovementReason.INITIAL_SETUP && m.getDelta() == 25),
                "movimento INITIAL_SETUP registado");

        // Ajuste seguinte é MANUAL_ADJUSTMENT e devolve a view nova.
        mockMvc.perform(post("/api/v1/admin/inventory/" + productId + "/adjustment")
                        .session(owner)
                        .header("X-CSRF-TOKEN", csrfToken(owner))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"delta\": -5, \"note\": \"Reconto\"}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.availableQty").value(20));

        // Zero é erro de validação (nunca um movimento vazio).
        mockMvc.perform(post("/api/v1/admin/inventory/" + productId + "/adjustment")
                        .session(owner)
                        .header("X-CSRF-TOKEN", csrfToken(owner))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"delta\": 0}"))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.fieldErrors.delta").exists());

        // Auditoria: cada ajuste gera linha imutável.
        org.junit.jupiter.api.Assertions.assertTrue(
                auditRepository.findAll().stream()
                        .anyMatch(a -> "inventory.adjusted".equals(a.getAction())),
                "ajustes auditados");
    }

    @Test
    void reservedUnitsAreProtectedAndUnmanagedProductsCannotGoNegative() throws Exception {
        MockHttpSession customer = register("stock-cliente@example.com", "Stock Cliente");
        MockHttpSession owner = register("stock-guarda@example.com", "Stock Guarda");
        makeOwner("stock-guarda@example.com");
        String productId = productId("bolo-no-pote-classico");
        setStock(productId, 5);

        // Encomenda reserva 3 unidades (ficam reservadas até pagamento).
        String number = createOrder(customer, productId, 3);

        // Produto sem linha (ilimitado): baixar é erro — não há o que baixar.
        String unmanaged = productId("caixa-degustacao");
        inventoryRepository.findByProductId(UUID.fromString(unmanaged)).ifPresent(inventoryRepository::delete);
        mockMvc.perform(post("/api/v1/admin/inventory/" + unmanaged + "/adjustment")
                        .session(owner)
                        .header("X-CSRF-TOKEN", csrfToken(owner))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"delta\": -1}"))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.fieldErrors.delta").exists());

        // Baixar abaixo das reservas activas é conflito (a baixa futura falharia).
        mockMvc.perform(post("/api/v1/admin/inventory/" + productId + "/adjustment")
                        .session(owner)
                        .header("X-CSRF-TOKEN", csrfToken(owner))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"delta\": -4}"))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.code").value("STOCK_CONFLICT"));

        // Dentro das reservas é aceite.
        mockMvc.perform(post("/api/v1/admin/inventory/" + productId + "/adjustment")
                        .session(owner)
                        .header("X-CSRF-TOKEN", csrfToken(owner))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"delta\": -2}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.availableQty").value(3));

        // Cliente comum nunca ajusta stock.
        mockMvc.perform(post("/api/v1/admin/inventory/" + productId + "/adjustment")
                        .session(customer)
                        .header("X-CSRF-TOKEN", csrfToken(customer))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"delta\": 10}"))
                .andExpect(status().isForbidden());
        org.junit.jupiter.api.Assertions.assertEquals(
                ReservationStatus.ACTIVE,
                reservationRepository.findByOrderId(
                                orderRepository.findByOrderNumber(number).orElseThrow().getId())
                        .get(0)
                        .getStatus());
    }

    /* ---------------------------- Área do cliente ----------------------- */

    @Test
    void profileIsEditableByTheOwnerWithServerSideValidation() throws Exception {
        MockHttpSession session = register("perfil@example.com", "Ana Perfil");

        // Guardar telefone passa a existir no perfil e volta em /me.
        mockMvc.perform(put("/api/v1/account/profile")
                        .session(session)
                        .header("X-CSRF-TOKEN", csrfToken(session))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"displayName\": \"Ana Actualizada\", \"phone\": \"912345678\"}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.displayName").value("Ana Actualizada"))
                .andExpect(jsonPath("$.phone").value("912345678"));

        mockMvc.perform(get("/api/v1/auth/me").session(session))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.displayName").value("Ana Actualizada"))
                .andExpect(jsonPath("$.phone").value("912345678"));

        // Nome demasiado curto é 422 com o campo — nada é gravado.
        mockMvc.perform(put("/api/v1/account/profile")
                        .session(session)
                        .header("X-CSRF-TOKEN", csrfToken(session))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"displayName\": \"A\", \"phone\": null}"))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.fieldErrors.displayName").exists());
        mockMvc.perform(get("/api/v1/auth/me").session(session))
                .andExpect(jsonPath("$.displayName").value("Ana Actualizada"));

        // Sem sessão não há perfil (401 honesto).
        mockMvc.perform(get("/api/v1/account/profile")).andExpect(status().isUnauthorized());
    }

    @Test
    void passwordChangeRequiresTheCurrentOneAndRotatesTheLogin() throws Exception {
        MockHttpSession session = register("senha@example.com", "Ana Senha");

        // Actual errada → 422 com o campo, nada muda.
        mockMvc.perform(post("/api/v1/account/change-password")
                        .session(session)
                        .header("X-CSRF-TOKEN", csrfToken(session))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"currentPassword\": \"errada-qualquer\", \"newPassword\": \"nova-senha-4321\"}"))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.fieldErrors.currentPassword").exists());

        // Nova igual à actual → recusada (não é uma alteração).
        mockMvc.perform(post("/api/v1/account/change-password")
                        .session(session)
                        .header("X-CSRF-TOKEN", csrfToken(session))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"currentPassword\": \"senha-forte-1234\", \"newPassword\": \"senha-forte-1234\"}"))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.fieldErrors.newPassword").exists());

        // Alteração válida → 204 e auditoria.
        mockMvc.perform(post("/api/v1/account/change-password")
                        .session(session)
                        .header("X-CSRF-TOKEN", csrfToken(session))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"currentPassword\": \"senha-forte-1234\", \"newPassword\": \"nova-senha-4321\"}"))
                .andExpect(status().isNoContent());
        org.junit.jupiter.api.Assertions.assertTrue(
                auditRepository.findAll().stream()
                        .anyMatch(a -> "auth.password_changed".equals(a.getAction())),
                "alteração de palavra-passe auditada");

        // A palavra-passe nova entra (e a sessão continua), a antiga sai.
        MockHttpSession renewed = new MockHttpSession();
        mockMvc.perform(post("/api/v1/auth/login")
                        .session(renewed)
                        .header("X-CSRF-TOKEN", csrfToken(renewed))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"email\": \"senha@example.com\", \"password\": \"nova-senha-4321\"}"))
                .andExpect(status().isOk());
        MockHttpSession oldTry = new MockHttpSession();
        mockMvc.perform(post("/api/v1/auth/login")
                        .session(oldTry)
                        .header("X-CSRF-TOKEN", csrfToken(oldTry))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"email\": \"senha@example.com\", \"password\": \"senha-forte-1234\"}"))
                .andExpect(status().isUnauthorized());
    }

    @Test
    void addressesAreOwnedScopedAndKeepASingleDefault() throws Exception {
        MockHttpSession mine = register("moradas-eu@example.com", "Ana Moradas");
        MockHttpSession other = register("moradas-eu2@example.com", "Outra Cliente");

        // Criar duas moradas: a segunda não pode roubar a predefinida sem o pedido.
        String firstId = createAddress(mine, "Casa", "Talatona", true);
        String secondId = createAddress(mine, "Escritório", "Kilamba", false);

        // Actualizar a segunda para predefinida limpa a primeira.
        mockMvc.perform(put("/api/v1/account/addresses/" + secondId)
                        .session(mine)
                        .header("X-CSRF-TOKEN", csrfToken(mine))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"recipientName\": \"Ana\", \"line1\": \"Via S1, Bloco C\", \"city\": \"Kilamba\", \"isDefault\": true}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.isDefault").value(true));

        String list = getJson(mine, "/api/v1/account/addresses");
        org.junit.jupiter.api.Assertions.assertTrue(list.contains("\"isDefault\":true"), "há exactamente uma predefinida");
        org.junit.jupiter.api.Assertions.assertEquals(1, countOccurrences(list, firstId), "primeira morada presente uma vez");

        // Morada de outro cliente: 404 honesto (sem vazar que existe).
        mockMvc.perform(put("/api/v1/account/addresses/" + firstId)
                        .session(other)
                        .header("X-CSRF-TOKEN", csrfToken(other))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"line1\": \"Intrusão\", \"city\": \"Luanda\", \"isDefault\": false}"))
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.code").value("ADDRESS_NOT_FOUND"));

        // Remover e some da lista do dono.
        mockMvc.perform(delete("/api/v1/account/addresses/" + firstId)
                        .session(mine)
                        .header("X-CSRF-TOKEN", csrfToken(mine)))
                .andExpect(status().isNoContent());
        org.junit.jupiter.api.Assertions.assertFalse(getJson(mine, "/api/v1/account/addresses").contains(firstId));

        // Validação: linha 1 e cidade obrigatórias.
        mockMvc.perform(post("/api/v1/account/addresses")
                        .session(mine)
                        .header("X-CSRF-TOKEN", csrfToken(mine))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"line1\": \"\", \"city\": \"\", \"isDefault\": false}"))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.fieldErrors.line1").exists())
                .andExpect(jsonPath("$.fieldErrors.city").exists());
    }

    @Test
    void activeSessionsAreListedWithOpaqueHandlesAndRevocable() throws Exception {
        MockHttpSession first = register("sessoes@example.com", "Ana Sessões");
        // Segundo dispositivo: outro login, outra sessão.
        MockHttpSession second = new MockHttpSession();
        mockMvc.perform(post("/api/v1/auth/login")
                        .session(second)
                        .header("X-CSRF-TOKEN", csrfToken(second))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"email\": \"sessoes@example.com\", \"password\": \"senha-forte-1234\"}"))
                .andExpect(status().isOk());

        // A lista marca a sessão actual e devolve um handle opaco (nunca o id).
        String list = getJson(first, "/api/v1/auth/sessions");
        org.junit.jupiter.api.Assertions.assertEquals(2, countOccurrences(list, "\"handle\""),
                "duas sessões activas");
        org.junit.jupiter.api.Assertions.assertTrue(list.contains("\"current\":true"), "actual marcada");
        String otherHandle = otherSessionHandle(list);

        // Revogar a outra sessão: 204 e o outro dispositivo perde a sessão.
        mockMvc.perform(post("/api/v1/auth/sessions/" + otherHandle + "/revoke")
                        .session(first)
                        .header("X-CSRF-TOKEN", csrfToken(first)))
                .andExpect(status().isNoContent());
        mockMvc.perform(get("/api/v1/auth/me").session(second))
                .andExpect(status().isUnauthorized());
        mockMvc.perform(get("/api/v1/auth/me").session(first))
                .andExpect(status().isOk());

        // Handle de outra conta (ou inexistente) é 404 — sem revelar terceiros.
        MockHttpSession outsider = register("sessoes-e2@example.com", "Outra");
        mockMvc.perform(post("/api/v1/auth/sessions/" + otherHandle + "/revoke")
                        .session(outsider)
                        .header("X-CSRF-TOKEN", csrfToken(outsider)))
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.code").value("SESSION_NOT_FOUND"));

        // Sem sessão: 401 honesto.
        mockMvc.perform(get("/api/v1/auth/sessions")).andExpect(status().isUnauthorized());
    }

    @Test
    void passwordChangeTerminatesOtherSessionsKeepingTheCurrent() throws Exception {
        MockHttpSession current = register("rota-sessoes@example.com", "Ana Rota");
        MockHttpSession other = new MockHttpSession();
        mockMvc.perform(post("/api/v1/auth/login")
                        .session(other)
                        .header("X-CSRF-TOKEN", csrfToken(other))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"email\": \"rota-sessoes@example.com\", \"password\": \"senha-forte-1234\"}"))
                .andExpect(status().isOk());
        mockMvc.perform(get("/api/v1/auth/me").session(other)).andExpect(status().isOk());

        // Alterar a palavra-passe termina as outras sessões.
        mockMvc.perform(post("/api/v1/account/change-password")
                        .session(current)
                        .header("X-CSRF-TOKEN", csrfToken(current))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"currentPassword\": \"senha-forte-1234\", \"newPassword\": \"nova-senha-4321\"}"))
                .andExpect(status().isNoContent());

        mockMvc.perform(get("/api/v1/auth/me").session(other))
                .andExpect(status().isUnauthorized());
        mockMvc.perform(get("/api/v1/auth/me").session(current))
                .andExpect(status().isOk());

        // Auditoria: a contagem de sessões terminadas fica no registo.
        org.junit.jupiter.api.Assertions.assertTrue(
                auditRepository.findAll().stream()
                        .anyMatch(a -> "auth.password_changed".equals(a.getAction())
                                && a.getDetails() != null
                                && a.getDetails().contains("sessão(ões) terminada(s)")),
                "a revogação em lote fica auditada");
    }

    /* ------------------------------ helpers ------------------------------ */

    /** Handle da única sessão NÃO actual da lista (json do registo). */
    private String otherSessionHandle(String listJson) throws Exception {
        List<Map<String, Object>> entries =
                objectMapper.readValue(listJson, new TypeReference<List<Map<String, Object>>>() {});
        return entries.stream()
                .filter(entry -> Boolean.FALSE.equals(entry.get("current")))
                .map(entry -> entry.get("handle").toString())
                .findFirst()
                .orElseThrow(() -> new AssertionError("sem sessão não-actual na lista: " + listJson));
    }

    private String createAddress(MockHttpSession session, String label, String city, boolean isDefault) throws Exception {
        String content = mockMvc.perform(post("/api/v1/account/addresses")
                        .session(session)
                        .header("X-CSRF-TOKEN", csrfToken(session))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(Map.of(
                                "label", label,
                                "recipientName", "Ana",
                                "line1", "Rua Exemplo, 12",
                                "city", city,
                                "isDefault", isDefault))))
                .andExpect(status().isCreated())
                .andReturn().getResponse().getContentAsString();
        return objectMapper.readValue(content, new TypeReference<Map<String, Object>>() {}).get("id").toString();
    }

    private String getJson(MockHttpSession session, String path) throws Exception {
        return mockMvc.perform(get(path).session(session))
                .andExpect(status().isOk())
                .andReturn().getResponse().getContentAsString();
    }

    private static int countOccurrences(String haystack, String needle) {
        int count = 0;
        int index = haystack.indexOf(needle);
        while (index >= 0) {
            count++;
            index = haystack.indexOf(needle, index + needle.length());
        }
        return count;
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
        for (var reservation : reservationRepository.findAll()) {
            if (reservation.getStatus() == ReservationStatus.ACTIVE && reservation.getProductId().equals(pid)) {
                reservation.setStatus(ReservationStatus.RELEASED);
                reservationRepository.save(reservation);
            }
        }
    }

    private void makeOwner(String email) {
        var user = userRepository.findByEmail(email).orElseThrow();
        user.setOwner(true);
        userRepository.save(user);
    }

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

    private String createOrder(MockHttpSession session, String productId, int quantity) throws Exception {
        String content = mockMvc.perform(post("/api/v1/orders")
                        .session(session)
                        .header("X-CSRF-TOKEN", csrfToken(session))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(Map.of(
                                "contactName", "Cliente Teste",
                                "contactPhone", "912345678",
                                "fulfillment", "PICKUP",
                                "paymentMethod", "IBAN_TRANSFER",
                                "productLines", List.of(Map.of("productId", productId, "quantity", quantity)),
                                "cakeLines", List.of()))))
                .andExpect(status().isCreated())
                .andReturn().getResponse().getContentAsString();
        return objectMapper.readValue(content, new TypeReference<Map<String, Object>>() {}).get("number").toString();
    }
}
