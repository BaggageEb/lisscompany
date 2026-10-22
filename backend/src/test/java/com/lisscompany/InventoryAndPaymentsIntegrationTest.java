package com.lisscompany;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import java.math.BigDecimal;
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

import com.lisscompany.inventory.InventoryItem;
import com.lisscompany.inventory.InventoryItemRepository;
import com.lisscompany.inventory.InventoryService;
import com.lisscompany.inventory.ReservationStatus;
import com.lisscompany.inventory.StockMovementReason;
import com.lisscompany.inventory.StockMovementRepository;
import com.lisscompany.inventory.StockReservationRepository;
import com.lisscompany.orders.CustomerOrderRepository;
import com.lisscompany.orders.OrderStatus;
import com.lisscompany.payments.Payment;
import com.lisscompany.payments.PaymentEventRepository;
import com.lisscompany.payments.PaymentRepository;
import com.lisscompany.payments.PaymentStatus;

import io.zonky.test.db.postgres.embedded.EmbeddedPostgres;
import tools.jackson.core.type.TypeReference;
import tools.jackson.databind.ObjectMapper;

/**
 * Fase 5 — inventário e pagamentos com PostgreSQL real:
 *
 * <ul>
 *   <li>criar encomenda reserva stock e abre pagamento PENDING (atómico);</li>
 *   <li>stock insuficiente bloqueia o orçamento e a criação (422);</li>
 *   <li>a revisão exige conta autorizada, sessão e CSRF;</li>
 *   <li>confirmar pagamento confirma a encomenda e baixa stock (SOLD);</li>
 *   <li>revisão idempotente: repetir a mesma chave não duplica efeitos;</li>
 *   <li>cancelamento devolve stock e fecha o pagamento; transições são
 *       validadas no servidor (409 em saltos inválidos).</li>
 * </ul>
 */
@SpringBootTest
@AutoConfigureMockMvc
class InventoryAndPaymentsIntegrationTest {

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
    @Autowired private PaymentEventRepository paymentEventRepository;
    @Autowired private CustomerOrderRepository orderRepository;
    @Autowired private com.lisscompany.identity.AppUserRepository userRepository;
    @Autowired private com.lisscompany.audit.AuditRepository auditRepository;
    @Autowired private InventoryService inventoryService;

    /* ------------------------- Stock e catálogo -------------------------- */

    @Test
    void creatingAnOrderReservesStockAndOpensAPendingPaymentAtomically() throws Exception {
        MockHttpSession session = register("stock1@example.com", "Reservadora");
        String productId = productId("bolo-no-pote-premium");
        setStock(productId, 10);
        int before = availableFor(productId);

        String number = createOrder(session, productId, 2);

        // Reserva ACTIVA: unidades seguras, sem baixa ainda (decisão #6).
        var order = orderRepository.findByOrderNumberWithItems(number).orElseThrow();
        var reservations = reservationRepository.findByOrderId(order.getId());
        org.junit.jupiter.api.Assertions.assertEquals(1, reservations.size(), "uma reserva por encomenda");
        org.junit.jupiter.api.Assertions.assertEquals(ReservationStatus.ACTIVE, reservations.get(0).getStatus());
        org.junit.jupiter.api.Assertions.assertEquals(2, reservations.get(0).getQuantity());

        // Stock bruto intacto — a baixa só acontece com o pagamento.
        org.junit.jupiter.api.Assertions.assertEquals(
                before - 2, availableFor(productId), "disponível desce pela reserva");

        // Pagamento aberto PENDING com o total exacto da encomenda.
        Payment payment = paymentRepository.findByOrderId(order.getId()).orElseThrow();
        org.junit.jupiter.api.Assertions.assertEquals(PaymentStatus.PENDING, payment.getStatus());
        org.junit.jupiter.api.Assertions.assertEquals(new BigDecimal("7000.00"), payment.getAmount());

        // A view do cliente mostra o estado de pagamento.
        mockMvc.perform(get("/api/v1/orders/" + number).session(session))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.paymentStatus").value("PENDING"))
                .andExpect(jsonPath("$.status").value("RECEIVED"));
    }

    @Test
    void outOfStockIsRejectedByQuoteAndNothingIsPersisted() throws Exception {
        MockHttpSession session = register("stock2@example.com", "SemStock");
        String productId = productId("bolo-no-pote-classico");
        setStock(productId, 1);

        // Orçamento público: linha inválida com o motivo.
        String quoteBody = objectMapper.writeValueAsString(
                Map.of("productLines", List.of(Map.of("productId", productId, "quantity", 3)), "cakeLines", List.of()));
        mockMvc.perform(post("/api/v1/public/cart/quote")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(quoteBody))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.valid").value(false))
                .andExpect(jsonPath("$.lines[0].issues[0]").value("Produto: só há 1 unidade(s) em stock."));

        // Criação: 422 e nada persiste (nem encomenda, nem pagamento).
        mockMvc.perform(post("/api/v1/orders")
                        .session(session)
                        .header("X-CSRF-TOKEN", csrfToken(session))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(orderBody(productId, 3)))
                .andExpect(status().isUnprocessableEntity())
                .andExpect(jsonPath("$.code").value("CART_INVALID"));

        mockMvc.perform(get("/api/v1/orders").session(session))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.length()").value(0));
        org.junit.jupiter.api.Assertions.assertTrue(
                paymentRepository.findAll().stream().noneMatch(p -> p.getStatus() == PaymentStatus.PENDING
                        && p.getAmount().compareTo(new BigDecimal("7500.00")) == 0),
                "nenhum pagamento órfão");
    }

    @Test
    void quoteEndpointTreatsManagedProductsAsUnlimitedWhenStockIsAbsent() throws Exception {
        // Produto sem linha de inventário = não gerido (decisão #2): ilimitado.
        String productId = productId("caixa-degustacao");
        inventoryRepository.findByProductId(UUID.fromString(productId)).ifPresent(inventoryRepository::delete);

        String quoteBody = objectMapper.writeValueAsString(
                Map.of("productLines", List.of(Map.of("productId", productId, "quantity", 99)), "cakeLines", List.of()));
        mockMvc.perform(post("/api/v1/public/cart/quote")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(quoteBody))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.valid").value(true));
    }

    /* ------------------------ Revisão de pagamento ----------------------- */

    @Test
    void paymentReviewRequiresSessionCsrfAndAnAuthorizedAccount() throws Exception {
        MockHttpSession session = register("revisora@example.com", "Revisora");
        String productId = productId("bolo-no-pote-premium");
        setStock(productId, 10);
        String number = createOrder(session, productId, 1);

        // Com CSRF válido mas sem login: quem decide é a autorização (401).
        MockHttpSession anonymous = new MockHttpSession();
        mockMvc.perform(post("/api/v1/admin/payments/" + number + "/review")
                        .session(anonymous)
                        .header("X-CSRF-TOKEN", csrfToken(anonymous))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"target\":\"PAID\"}"))
                .andExpect(status().isUnauthorized());

        // Sessão válida mas sem token CSRF → 403.
        mockMvc.perform(post("/api/v1/admin/payments/" + number + "/review")
                        .session(session)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"target\":\"PAID\"}"))
                .andExpect(status().isForbidden());

        // Sessão + CSRF mas conta não autorizada → 403 com envelope.
        mockMvc.perform(post("/api/v1/admin/payments/" + number + "/review")
                        .session(session)
                        .header("X-CSRF-TOKEN", csrfToken(session))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"target\":\"PAID\"}"))
                .andExpect(status().isForbidden())
                .andExpect(jsonPath("$.code").value("FORBIDDEN"));
    }

    @Test
    void confirmingPaymentConfirmsOrderAndWritesStockMovement() throws Exception {
        MockHttpSession session = register("dona-stock@example.com", "Dona");
        makeOwner("dona-stock@example.com");
        String productId = productId("caixa-degustacao");
        setStock(productId, 20);
        int before = availableFor(productId);
        String number = createOrder(session, productId, 3);

        mockMvc.perform(post("/api/v1/admin/payments/" + number + "/review")
                        .session(session)
                        .header("X-CSRF-TOKEN", csrfToken(session))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"target\":\"PAID\",\"note\":\"Comprovativo verificado\"}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.status").value("PAID"))
                .andExpect(jsonPath("$.orderNumber").value(number));

        // Encomenda confirmada + stock baixado definitivamente (SOLD).
        mockMvc.perform(get("/api/v1/orders/" + number).session(session))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.status").value("CONFIRMED"))
                .andExpect(jsonPath("$.paymentStatus").value("PAID"));

        org.junit.jupiter.api.Assertions.assertEquals(
                before - 3, availableFor(productId), "baixa definitiva no pagamento confirmado");

        var order = orderRepository.findByOrderNumber(number).orElseThrow();
        var reservations = reservationRepository.findByOrderId(order.getId());
        org.junit.jupiter.api.Assertions.assertEquals(ReservationStatus.CONSUMED, reservations.get(0).getStatus());

        org.junit.jupiter.api.Assertions.assertTrue(
                movementRepository.findAll().stream().anyMatch(m ->
                        m.getReason() == StockMovementReason.SOLD
                                && m.getDelta() == -3
                                && order.getId().equals(m.getOrderId())),
                "movimento SOLD com a referência da encomenda");

        // Auditoria das duas acções sensíveis (mesma transacção da revisão).
        var payment = paymentRepository.findByOrderId(order.getId()).orElseThrow();
        var paymentAudits = auditRepository.findByEntityTypeAndEntityIdOrderByCreatedAtDesc(
                "payment", payment.getId().toString());
        org.junit.jupiter.api.Assertions.assertEquals(1, paymentAudits.size());
        org.junit.jupiter.api.Assertions.assertEquals("payment.reviewed", paymentAudits.get(0).getAction());

        var orderAudits = auditRepository.findByEntityTypeAndEntityIdOrderByCreatedAtDesc(
                "customer_order", order.getId().toString());
        org.junit.jupiter.api.Assertions.assertTrue(
                orderAudits.stream().anyMatch(a -> "order.status_changed".equals(a.getAction())),
                "confirmação da encomenda audita a transição RECEIVED → CONFIRMED");
    }

    @Test
    void reviewingWithTheSameIdempotencyKeyNeverDuplicatesEffects() throws Exception {
        MockHttpSession session = register("idem@example.com", "Idempotente");
        makeOwner("idem@example.com");
        String productId = productId("bolo-no-pote-classico");
        setStock(productId, 10);
        int before = availableFor(productId);
        String number = createOrder(session, productId, 2);

        String body = "{\"target\":\"PAID\",\"idempotencyKey\":\"rev-123\"}";
        mockMvc.perform(post("/api/v1/admin/payments/" + number + "/review")
                        .session(session)
                        .header("X-CSRF-TOKEN", csrfToken(session))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(body))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.status").value("PAID"));

        // Reenvio exacto (rede/duplo clique): 200 sem novos efeitos.
        mockMvc.perform(post("/api/v1/admin/payments/" + number + "/review")
                        .session(session)
                        .header("X-CSRF-TOKEN", csrfToken(session))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(body))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.status").value("PAID"));

        org.junit.jupiter.api.Assertions.assertEquals(
                before - 2, availableFor(productId), "stock baixado UMA vez");
        var order = orderRepository.findByOrderNumber(number).orElseThrow();
        var events = paymentEventRepository.findByPaymentIdOrderByCreatedAtDesc(
                paymentRepository.findByOrderId(order.getId()).orElseThrow().getId());
        org.junit.jupiter.api.Assertions.assertEquals(
                2, events.size(), "evento open + UMA revisão (a repetição não duplica)");
    }

    @Test
    void rejectedPaymentKeepsTheOrderReceivedAndStockReserved() throws Exception {
        MockHttpSession session = register("falhada@example.com", "Falhada");
        makeOwner("falhada@example.com");
        String productId = productId("bolo-no-pote-premium");
        setStock(productId, 10);
        int before = availableFor(productId);
        String number = createOrder(session, productId, 2);

        mockMvc.perform(post("/api/v1/admin/payments/" + number + "/review")
                        .session(session)
                        .header("X-CSRF-TOKEN", csrfToken(session))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"target\":\"FAILED\",\"note\":\"Transferência não recebida\"}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.status").value("FAILED"));

        // Sem confirmação não há baixa nem mudança de estado da encomenda:
        // o stock bruto mantém-se e a reserva continua ACTIVA (a encomenda vive).
        mockMvc.perform(get("/api/v1/orders/" + number).session(session))
                .andExpect(jsonPath("$.status").value("RECEIVED"))
                .andExpect(jsonPath("$.paymentStatus").value("FAILED"));
        var order = orderRepository.findByOrderNumber(number).orElseThrow();
        org.junit.jupiter.api.Assertions.assertEquals(
                ReservationStatus.ACTIVE, reservationRepository.findByOrderId(order.getId()).get(0).getStatus(),
                "reserva mantém-se enquanto a encomenda não é cancelada");
        org.junit.jupiter.api.Assertions.assertEquals(
                10, rawStock(productId), "stock bruto intacto — sem movimento SOLD");
        org.junit.jupiter.api.Assertions.assertEquals(before - 2, availableFor(productId),
                "disponível continua a descontar a reserva activa");
        org.junit.jupiter.api.Assertions.assertFalse(
                movementRepository.findAll().stream().anyMatch(m ->
                        m.getReason() == StockMovementReason.SOLD && order.getId().equals(m.getOrderId())),
                "nenhum movimento SOLD sem pagamento confirmado");
    }

    /* --------------------------- Cancelamento ---------------------------- */

    @Test
    void customerCancelsReceivedOrderAndStockGoesBack() throws Exception {
        MockHttpSession session = register("cancela@example.com", "Canceladora");
        String productId = productId("bolo-no-pote-premium");
        setStock(productId, 10);
        int before = availableFor(productId);
        String number = createOrder(session, productId, 2);
        org.junit.jupiter.api.Assertions.assertEquals(before - 2, availableFor(productId));

        mockMvc.perform(post("/api/v1/orders/" + number + "/cancel")
                        .session(session)
                        .header("X-CSRF-TOKEN", csrfToken(session)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.status").value("CANCELLED"))
                .andExpect(jsonPath("$.paymentStatus").value("FAILED"));

        org.junit.jupiter.api.Assertions.assertEquals(before, availableFor(productId), "stock devolvido");
        var order = orderRepository.findByOrderNumber(number).orElseThrow();
        org.junit.jupiter.api.Assertions.assertEquals(
                ReservationStatus.RELEASED, reservationRepository.findByOrderId(order.getId()).get(0).getStatus());
    }

    @Test
    void aConfirmedOrderCannotBeCancelledByTheCustomer() throws Exception {
        MockHttpSession customer = register("cliente-conf@example.com", "Cliente");
        MockHttpSession owner = register("dona-conf@example.com", "Dona");
        makeOwner("dona-conf@example.com");
        String productId = productId("bolo-no-pote-premium");
        setStock(productId, 10);
        String number = createOrder(customer, productId, 1);

        // Confirmação por revisão do pagamento.
        mockMvc.perform(post("/api/v1/admin/payments/" + number + "/review")
                        .session(owner)
                        .header("X-CSRF-TOKEN", csrfToken(owner))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"target\":\"PAID\"}"))
                .andExpect(status().isOk());

        // Cliente já não pode cancelar (decisão #7: depois de CONFIRMED exige loja).
        mockMvc.perform(post("/api/v1/orders/" + number + "/cancel")
                        .session(customer)
                        .header("X-CSRF-TOKEN", csrfToken(customer)))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.code").value("ORDER_NOT_CANCELLABLE"));

        // A conta autorizada cancela — pagamento PAID não é reembolsado automaticamente.
        mockMvc.perform(post("/api/v1/admin/orders/" + number + "/status")
                        .session(owner)
                        .header("X-CSRF-TOKEN", csrfToken(owner))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"target\":\"CANCELLED\"}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.status").value("CANCELLED"));

        var order = orderRepository.findByOrderNumber(number).orElseThrow();
        Payment payment = paymentRepository.findByOrderId(order.getId()).orElseThrow();
        org.junit.jupiter.api.Assertions.assertEquals(
                PaymentStatus.PAID, payment.getStatus(), "sem reembolso automático (decisão #7)");
    }

    /* ------------------------ Transições de estado ----------------------- */

    @Test
    void orderStatusTransitionsAreValidatedOnTheServer() throws Exception {
        MockHttpSession owner = register("dona-fluxo@example.com", "Dona Fluxo");
        makeOwner("dona-fluxo@example.com");
        String productId = productId("bolo-no-pote-premium");
        setStock(productId, 10);
        String number = createOrder(owner, productId, 1);

        // Salto directo RECEIVED → PREPARING é inválido (409).
        mockMvc.perform(post("/api/v1/admin/orders/" + number + "/status")
                        .session(owner)
                        .header("X-CSRF-TOKEN", csrfToken(owner))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"target\":\"PREPARING\"}"))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.code").value("INVALID_ORDER_STATUS"));

        // Percurso válido: CONFIRMED → PREPARING → READY → COMPLETED.
        String[] path = {"CONFIRMED", "PREPARING", "READY", "COMPLETED"};
        for (String target : path) {
            mockMvc.perform(post("/api/v1/admin/orders/" + number + "/status")
                            .session(owner)
                            .header("X-CSRF-TOKEN", csrfToken(owner))
                            .contentType(MediaType.APPLICATION_JSON)
                            .content("{\"target\":\"" + target + "\"}"))
                    .andExpect(status().isOk())
                    .andExpect(jsonPath("$.status").value(target));
        }

        // Estado terminal: qualquer nova transição é 409.
        mockMvc.perform(post("/api/v1/admin/orders/" + number + "/status")
                        .session(owner)
                        .header("X-CSRF-TOKEN", csrfToken(owner))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"target\":\"PREPARING\"}"))
                .andExpect(status().isConflict());
        org.junit.jupiter.api.Assertions.assertEquals(
                OrderStatus.COMPLETED,
                orderRepository.findByOrderNumber(number).orElseThrow().getStatus());
    }

    @Test
    void adminOrderEndpointIsInvisibleToNonOwners() throws Exception {
        MockHttpSession plain = register("comum@example.com", "Comum");
        String productId = productId("bolo-no-pote-premium");
        setStock(productId, 10);
        String number = createOrder(plain, productId, 1);

        mockMvc.perform(post("/api/v1/admin/orders/" + number + "/status")
                        .session(plain)
                        .header("X-CSRF-TOKEN", csrfToken(plain))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"target\":\"CONFIRMED\"}"))
                .andExpect(status().isForbidden())
                .andExpect(jsonPath("$.code").value("FORBIDDEN"));

        mockMvc.perform(get("/api/v1/admin/inventory").session(plain))
                .andExpect(status().isForbidden());
    }

    /* ------------------------------ helpers ------------------------------ */

    private void setStock(String productId, int qty) {
        UUID pid = UUID.fromString(productId);
        InventoryItem item = inventoryRepository.findByProductId(pid).orElseGet(() -> {
            InventoryItem created = new InventoryItem();
            created.setProductId(pid);
            return created;
        });
        item.setAvailableQty(qty);
        item.setUnitLabel("un");
        inventoryRepository.save(item);
        // Libera reservas activas antigas para os testes não se interferirem.
        for (var reservation : reservationRepository.findAll()) {
            if (reservation.getStatus() == ReservationStatus.ACTIVE && reservation.getProductId().equals(pid)) {
                reservation.setStatus(ReservationStatus.RELEASED);
                reservationRepository.save(reservation);
            }
        }
    }

    private int availableFor(String productId) {
        return inventoryService.availableFor(UUID.fromString(productId));
    }

    /** Stock bruto da linha de inventário (sem descontar reservas). */
    private int rawStock(String productId) {
        return inventoryRepository.findByProductId(UUID.fromString(productId)).orElseThrow().getAvailableQty();
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
                        .content(orderBody(productId, quantity)))
                .andExpect(status().isCreated())
                .andReturn().getResponse().getContentAsString();
        return objectMapper.readValue(content, new TypeReference<Map<String, Object>>() {}).get("number").toString();
    }

    private String orderBody(String productId, int quantity) throws Exception {
        return objectMapper.writeValueAsString(Map.of(
                "contactName", "Cliente Teste",
                "contactPhone", "912345678",
                "fulfillment", "PICKUP",
                "paymentMethod", "IBAN_TRANSFER",
                "productLines", List.of(Map.of("productId", productId, "quantity", quantity)),
                "cakeLines", List.of()));
    }
}
