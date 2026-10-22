package com.lisscompany;

import static org.hamcrest.Matchers.containsString;
import static org.hamcrest.Matchers.nullValue;
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
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.http.MediaType;
import org.springframework.mock.web.MockHttpSession;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.test.web.servlet.MockMvc;

import com.lisscompany.audit.AuditRepository;
import com.lisscompany.identity.AppUserRepository;
import com.lisscompany.inventory.InventoryItem;
import com.lisscompany.inventory.InventoryItemRepository;
import com.lisscompany.inventory.ReservationStatus;
import com.lisscompany.inventory.StockReservationRepository;
import com.lisscompany.loyalty.LoyaltyAccountRepository;
import com.lisscompany.loyalty.LoyaltyRuleRepository;
import com.lisscompany.loyalty.LoyaltyTransactionRepository;
import com.lisscompany.loyalty.RewardRedemptionRepository;
import com.lisscompany.loyalty.RewardRuleRepository;
import com.lisscompany.orders.CustomerOrderRepository;
import com.lisscompany.promotions.DiscountApplicationRepository;
import com.lisscompany.promotions.DiscountRuleRepository;
import com.lisscompany.promotions.DiscountSource;

import io.zonky.test.db.postgres.embedded.EmbeddedPostgres;
import tools.jackson.core.type.TypeReference;
import tools.jackson.databind.ObjectMapper;

/**
 * Fase 6 — fidelização e promoções com PostgreSQL real.
 *
 * <p>O fio condutor: <strong>nada vem por omissão</strong>. O programa
 * não-configurado é um estado honesto (sem pontos, sem resgates), cada valor
 * de negócio é configurado pela proprietária, e as invariantes das decisões
 * #8–#14 são verificadas no comportamento:
 *
 * <ul>
 *   <li>pagamento confirmado credita pontos idempotente e exactamente uma vez;</li>
 *   <li>resgate de pontos/recompensa com validação total do servidor e UM
 *       desconto por encomenda;</li>
 *   <li>boas-vindas só na primeira compra; recompensa exige pontos E
 *       encomendas, com limite de utilizações;</li>
 *   <li>cancelamento devolve pontos e liberta a recompensa;</li>
 *   <li>configuração é exclusiva de conta autorizada, com auditoria;</li>
 *   <li>uma conta só vê a própria fidelização.</li>
 * </ul>
 */
@SpringBootTest
@AutoConfigureMockMvc
class LoyaltyPromotionsIntegrationTest {

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

    @Autowired private LoyaltyRuleRepository ruleRepository;
    @Autowired private LoyaltyAccountRepository accountRepository;
    @Autowired private LoyaltyTransactionRepository transactionRepository;
    @Autowired private RewardRuleRepository rewardRuleRepository;
    @Autowired private RewardRedemptionRepository redemptionRepository;
    @Autowired private DiscountRuleRepository discountRuleRepository;
    @Autowired private DiscountApplicationRepository applicationRepository;
    @Autowired private CustomerOrderRepository orderRepository;
    @Autowired private AppUserRepository userRepository;
    @Autowired private AuditRepository auditRepository;
    @Autowired private InventoryItemRepository inventoryRepository;
    @Autowired private StockReservationRepository reservationRepository;

    @BeforeEach
    void pristineProgram() {
        // Estado global limpo por teste: a configuração do programa é única
        // (linha única na base) e cada teste define explicitamente a sua.
        applicationRepository.deleteAll();
        redemptionRepository.deleteAll();
        transactionRepository.deleteAll();
        accountRepository.deleteAll();
        discountRuleRepository.deleteAll();
        rewardRuleRepository.deleteAll();
        ruleRepository.deleteAll();
    }

    /* ------------------------ Estado honesto à partida ------------------- */

    @Test
    void unconfiguredProgramIsHonestAndEarnsNothing() throws Exception {
        MockHttpSession owner = register("dona-fidel1@example.com", "Dona");
        makeOwner("dona-fidel1@example.com");
        MockHttpSession client = register("sem-pontos1@example.com", "Cliente Sem Pontos");

        // Sem configuração: o programa diz a verdade — não calcula nada.
        mockMvc.perform(get("/api/v1/loyalty").session(client))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.configured").value(false))
                .andExpect(jsonPath("$.active").value(false))
                .andExpect(jsonPath("$.pointsBalance").value(0))
                .andExpect(jsonPath("$.earnPercent").value(nullValue()))
                .andExpect(jsonPath("$.welcome").value(nullValue()))
                .andExpect(jsonPath("$.rewards.length()").value(0));

        String productId = unlimited("bolo-no-pote-premium");
        String number = createOrder(client, productId, 1, Map.of());
        pay(owner, number, "t1-unconf");

        // Pagamento pago, programa por configurar → ninguém ganha pontos.
        mockMvc.perform(get("/api/v1/loyalty").session(client))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.pointsBalance").value(0));
        mockMvc.perform(get("/api/v1/loyalty/transactions").session(client))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.length()").value(0));

        // A encomenda existe sem qualquer desconto — snapshot honesto.
        mockMvc.perform(get("/api/v1/orders/" + number).session(client))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.discountAmount").value("0.00"))
                .andExpect(jsonPath("$.discountLabel").value(nullValue()))
                .andExpect(jsonPath("$.pointsSpent").value(0))
                .andExpect(jsonPath("$.total").value("3500.00"));
    }

    /* ------------------------ Crédito idempotente ------------------------ */

    @Test
    void ownerConfiguresProgramAndPaidOrderEarnsPointsExactlyOnce() throws Exception {
        MockHttpSession owner = register("dona-fidel2@example.com", "Dona");
        makeOwner("dona-fidel2@example.com");
        MockHttpSession client = register("ganha-pontos2@example.com", "Cliente Pontos");

        // Conta comum não configura o programa (403) — só a proprietária.
        mockMvc.perform(put("/api/v1/admin/loyalty/config/rule").session(client)
                        .header("X-CSRF-TOKEN", csrfToken(client))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(ruleBody("10", "1.00", "HALF_UP", true, true)))
                .andExpect(status().isForbidden())
                .andExpect(jsonPath("$.code").value("FORBIDDEN"));

        // A proprietária activa o programa com valores explícitos (#8).
        configureRule(owner, true, true);

        String productId = unlimited("bolo-no-pote-premium");
        String number = createOrder(client, productId, 1, Map.of());
        pay(owner, number, "t2-key");

        // 10% de 3500 Kz = 350 pontos (HALF_UP), com a taxa arquivada.
        mockMvc.perform(get("/api/v1/loyalty").session(client))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.configured").value(true))
                .andExpect(jsonPath("$.active").value(true))
                .andExpect(jsonPath("$.pointsBalance").value(350))
                .andExpect(jsonPath("$.lifetimePoints").value(350))
                .andExpect(jsonPath("$.earnPercent").value("10.00"))
                .andExpect(jsonPath("$.pointValueKz").value("1.0000"))
                .andExpect(jsonPath("$.allowPartialRedemption").value(true));

        mockMvc.perform(get("/api/v1/loyalty/transactions").session(client))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.length()").value(1))
                .andExpect(jsonPath("$[0].type").value("EARN"))
                .andExpect(jsonPath("$[0].points").value(350))
                .andExpect(jsonPath("$[0].rateKind").value("EARN_PERCENT"))
                .andExpect(jsonPath("$[0].rateUsed").value("10.0000"))
                .andExpect(jsonPath("$[0].amountKz").value("3500.00"))
                .andExpect(jsonPath("$[0].orderNumber").value(number));

        // Reenviar a MESMA revisão não duplica pontos (idempotência real).
        pay(owner, number, "t2-key");
        mockMvc.perform(get("/api/v1/loyalty").session(client))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.pointsBalance").value(350));
        mockMvc.perform(get("/api/v1/loyalty/transactions").session(client))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.length()").value(1));

        // A auditoria regista o crédito na mesma transacção da confirmação.
        UUID orderId = orderRepository.findByOrderNumber(number).orElseThrow().getId();
        List<String> actions = auditRepository
                .findByEntityTypeAndEntityIdOrderByCreatedAtDesc("customer_order", orderId.toString())
                .stream().map(entry -> entry.getAction()).toList();
        org.junit.jupiter.api.Assertions.assertTrue(
                actions.contains("loyalty.points_earned"), "auditoria loyalty.points_earned: " + actions);
    }

    @Test
    void inactiveProgramDoesNotCreditAndRejectsRedemption() throws Exception {
        MockHttpSession owner = register("dona-fidel3@example.com", "Dona");
        makeOwner("dona-fidel3@example.com");
        MockHttpSession client = register("pausado3@example.com", "Cliente Pausado");
        configureRule(owner, false, true); // Configurado mas PAUSADO.

        String productId = unlimited("bolo-no-pote-premium");
        String number = createOrder(client, productId, 1, Map.of());
        pay(owner, number, "t3-key");

        mockMvc.perform(get("/api/v1/loyalty").session(client))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.configured").value(true))
                .andExpect(jsonPath("$.active").value(false))
                .andExpect(jsonPath("$.pointsBalance").value(0));

        // Resgatar num programa pausado é conflito honesto, não silêncio.
        mockMvc.perform(post("/api/v1/orders")
                        .session(client)
                        .header("X-CSRF-TOKEN", csrfToken(client))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(orderBody(productId, 1, Map.of("pointsToSpend", 10))))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.code").value("LOYALTY_INACTIVE"));
    }

    /* --------------------------- Resgate de pontos ----------------------- */

    @Test
    void customerSpendsPointsAndEarnsOnTheDiscountedValue() throws Exception {
        MockHttpSession owner = register("dona-fidel4@example.com", "Dona");
        makeOwner("dona-fidel4@example.com");
        MockHttpSession client = register("resgata4@example.com", "Cliente Resgata");
        configureRule(owner, true, true);
        adjustPoints(owner, userId("resgata4@example.com"), 5000, "Bónus de abertura");

        mockMvc.perform(get("/api/v1/loyalty").session(client))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.pointsBalance").value(5000));

        String productId = unlimited("bolo-no-pote-premium");
        // 1000 pontos a 1,00 Kz → desconto de 1000.00; total 2500.00.
        String number = createOrder(client, productId, 1, Map.of("pointsToSpend", 1000));

        mockMvc.perform(get("/api/v1/orders/" + number).session(client))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.subtotal").value("3500.00"))
                .andExpect(jsonPath("$.discountAmount").value("1000.00"))
                .andExpect(jsonPath("$.discountLabel").value("Pontos de fidelização"))
                .andExpect(jsonPath("$.pointsSpent").value(1000))
                .andExpect(jsonPath("$.total").value("2500.00"));

        // O débito fica no livro-razão com a taxa do momento (decisão #9).
        mockMvc.perform(get("/api/v1/loyalty").session(client))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.pointsBalance").value(4000));
        mockMvc.perform(get("/api/v1/loyalty/transactions").session(client))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.length()").value(2))
                .andExpect(jsonPath("$[0].type").value("REDEEM"))
                .andExpect(jsonPath("$[0].points").value(-1000))
                .andExpect(jsonPath("$[0].rateKind").value("POINT_VALUE"))
                .andExpect(jsonPath("$[0].amountKz").value("1000.00"))
                .andExpect(jsonPath("$[1].type").value("ADJUSTMENT"))
                .andExpect(jsonPath("$[1].points").value(5000));

        // A aplicação do desconto fica registada com proveniência (#11).
        UUID orderId = orderRepository.findByOrderNumber(number).orElseThrow().getId();
        var application = applicationRepository.findByOrderId(orderId).orElseThrow();
        org.junit.jupiter.api.Assertions.assertEquals(DiscountSource.POINTS, application.getSource());
        org.junit.jupiter.api.Assertions.assertEquals(1000, application.getPointsSpent());
        org.junit.jupiter.api.Assertions.assertEquals("1000.00", application.getAmount().toPlainString());

        // Pago: acumula sobre o valor APÓS desconto (2500 → 250 pontos).
        pay(owner, number, "t4-key");
        mockMvc.perform(get("/api/v1/loyalty").session(client))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.pointsBalance").value(4250));
        mockMvc.perform(get("/api/v1/loyalty/transactions").session(client))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.length()").value(3))
                .andExpect(jsonPath("$[0].type").value("EARN"))
                .andExpect(jsonPath("$[0].points").value(250))
                .andExpect(jsonPath("$[0].amountKz").value("2500.00"));
    }

    @Test
    void pointsRedemptionIsFullyValidatedByTheServer() throws Exception {
        MockHttpSession owner = register("dona-fidel5@example.com", "Dona");
        makeOwner("dona-fidel5@example.com");
        MockHttpSession client = register("valida5@example.com", "Cliente Valida");
        String productId = unlimited("bolo-no-pote-premium");

        // (a) Programa por configurar: o pedido explícito recebe 409 honesto.
        mockMvc.perform(post("/api/v1/orders")
                        .session(client)
                        .header("X-CSRF-TOKEN", csrfToken(client))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(orderBody(productId, 1, Map.of("pointsToSpend", 10))))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.code").value("LOYALTY_NOT_CONFIGURED"));

        // Programa activo com resgate TOTAL apenas (decisão #10 por configuração).
        configureRule(owner, true, false);
        adjustPoints(owner, userId("valida5@example.com"), 5000, "Saldo inicial");

        // (b) Resgate parcial quando não é permitido → 400 com motivo.
        expectRejectedPoints(client, productId, 100, "totalidade");

        // (c) Acima do saldo → 400 com o saldo real no motivo.
        expectRejectedPoints(client, productId, 99999, "Saldo insuficiente");

        // (d) Com resgate parcial activo: acima do desconto possível nesta
        //     encomenda → 400, sem nunca exceder o subtotal nem perder pontos.
        configureRule(owner, true, true);
        expectRejectedPoints(client, productId, 4000, "excedem o desconto");

        // (e) Pontos E recompensa no mesmo pedido → um desconto por encomenda (#11).
        Map<String, Object> reward = rewardBody("GOAL_TESTE5", "Recompensa teste", 100, null, "1000", 1, true);
        upsertReward(owner, reward);
        mockMvc.perform(post("/api/v1/orders")
                        .session(client)
                        .header("X-CSRF-TOKEN", csrfToken(client))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(orderBody(productId, 1, Map.of("pointsToSpend", 100, "rewardCode", "GOAL_TESTE5"))))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.fieldErrors.pointsToSpend", containsString("um desconto")));

        // O saldo nunca é tocado em pedidos rejeitados.
        mockMvc.perform(get("/api/v1/loyalty").session(client))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.pointsBalance").value(5000));
    }

    /* ------------------------- Boas-vindas (#11/#12) --------------------- */

    @Test
    void welcomeDiscountAppliesOnlyToFirstOrder() throws Exception {
        MockHttpSession owner = register("dona-fidel6@example.com", "Dona");
        makeOwner("dona-fidel6@example.com");
        MockHttpSession client = register("nova6@example.com", "Cliente Nova");

        // 5% é um VALOR configurado (nada por omissão) — a prioridade é explícita.
        upsertDiscount(owner, discountBody("WELCOME5", "Desconto de boas-vindas", "WELCOME", "5", null, null, 1, true));

        String productId = unlimited("bolo-no-pote-premium");

        // A boas-vindas é automática — funciona mesmo sem programa de pontos.
        String first = createOrder(client, productId, 1, Map.of());
        mockMvc.perform(get("/api/v1/orders/" + first).session(client))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.discountAmount").value("175.00"))
                .andExpect(jsonPath("$.discountLabel").value("Desconto de boas-vindas"))
                .andExpect(jsonPath("$.total").value("3325.00"));

        UUID firstId = orderRepository.findByOrderNumber(first).orElseThrow().getId();
        org.junit.jupiter.api.Assertions.assertEquals(
                DiscountSource.WELCOME, applicationRepository.findByOrderId(firstId).orElseThrow().getSource());

        // Segunda compra: a boas-vindas já foi consumida.
        String second = createOrder(client, productId, 1, Map.of());
        mockMvc.perform(get("/api/v1/orders/" + second).session(client))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.discountAmount").value("0.00"))
                .andExpect(jsonPath("$.discountLabel").value(nullValue()))
                .andExpect(jsonPath("$.total").value("3500.00"));

        // O resumo mostra o estado real da boas-vindas para a cliente.
        mockMvc.perform(get("/api/v1/loyalty").session(client))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.welcome.percent").value("5.00"))
                .andExpect(jsonPath("$.welcome.eligible").value(false));
    }

    /* --------------------------- Recompensas (#12–#14) ------------------- */

    @Test
    void rewardRequiresPointsAndOrdersAndIsOncePerCustomer() throws Exception {
        MockHttpSession owner = register("dona-fidel7@example.com", "Dona");
        makeOwner("dona-fidel7@example.com");
        MockHttpSession client = register("meta7@example.com", "Cliente Meta");
        configureRule(owner, true, true);
        adjustPoints(owner, userId("meta7@example.com"), 6000, "Saldo para a meta");

        // Recompensa com as DUAS condições obrigatórias (#13) e valor próprio (#12).
        String rewardCode = upsertReward(owner, rewardBody(
                "GOAL_5K", "Recompensa de meta", 5000, 2, "1000", 1, true));
        upsertDiscount(owner, discountBody(
                "REWARD_GOAL", "Recompensa de meta", "REWARD", null, "1000", rewardCode, 1, true));

        String productId = unlimited("bolo-no-pote-premium");

        // Pontos chegam, mas faltam encomendas → elegibilidade parcial tem motivo.
        mockMvc.perform(post("/api/v1/orders")
                        .session(client)
                        .header("X-CSRF-TOKEN", csrfToken(client))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(orderBody(productId, 1, Map.of("rewardCode", rewardCode))))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.fieldErrors.rewardCode", containsString("encomenda")));

        // Duas compras pagas atingem a condição cumulativa.
        String first = createOrder(client, productId, 1, Map.of());
        pay(owner, first, "t7-key-1");
        String second = createOrder(client, productId, 1, Map.of());
        pay(owner, second, "t7-key-2");

        // 6000 + 350 + 350 = 6700 pontos, 2 encomendas não canceladas.
        mockMvc.perform(get("/api/v1/loyalty").session(client))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.pointsBalance").value(6700))
                .andExpect(jsonPath("$.rewards.length()").value(1))
                .andExpect(jsonPath("$.rewards[0].eligible").value(true))
                .andExpect(jsonPath("$.rewards[0].redeemedCount").value(0));

        // Resgatar a recompensa: UM desconto, com proveniência REWARD.
        String third = createOrder(client, productId, 1, Map.of("rewardCode", rewardCode));
        mockMvc.perform(get("/api/v1/orders/" + third).session(client))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.discountAmount").value("1000.00"))
                .andExpect(jsonPath("$.discountLabel").value("Recompensa de meta"))
                .andExpect(jsonPath("$.pointsSpent").value(0))
                .andExpect(jsonPath("$.total").value("2500.00"));
        UUID thirdId = orderRepository.findByOrderNumber(third).orElseThrow().getId();
        org.junit.jupiter.api.Assertions.assertEquals(
                DiscountSource.REWARD, applicationRepository.findByOrderId(thirdId).orElseThrow().getSource());
        org.junit.jupiter.api.Assertions.assertEquals(1, redemptionRepository.findAll().size());

        // Utilização única (#12): o segundo resgate é rejeitado com o motivo.
        mockMvc.perform(post("/api/v1/orders")
                        .session(client)
                        .header("X-CSRF-TOKEN", csrfToken(client))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(orderBody(productId, 1, Map.of("rewardCode", rewardCode))))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.fieldErrors.rewardCode", containsString("já resgatada")));

        // Cancelar a encomenda da recompensa liberta-a outra vez (não há
        // perda por cancelamento — decisão #7 sem efeitos fantasma).
        mockMvc.perform(post("/api/v1/orders/" + third + "/cancel").session(client)
                        .header("X-CSRF-TOKEN", csrfToken(client)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.status").value("CANCELLED"));
        mockMvc.perform(get("/api/v1/loyalty").session(client))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.rewards[0].eligible").value(true))
                .andExpect(jsonPath("$.rewards[0].redeemedCount").value(0));
    }

    /* --------------------------- Devolução de pontos --------------------- */

    @Test
    void cancellingBeforeConfirmationReturnsTheSpentPoints() throws Exception {
        MockHttpSession owner = register("dona-fidel8@example.com", "Dona");
        makeOwner("dona-fidel8@example.com");
        MockHttpSession client = register("cancela8@example.com", "Cliente Cancela");
        configureRule(owner, true, true);
        adjustPoints(owner, userId("cancela8@example.com"), 3000, "Saldo inicial");

        String productId = unlimited("bolo-no-pote-premium");
        String number = createOrder(client, productId, 1, Map.of("pointsToSpend", 1500));
        mockMvc.perform(get("/api/v1/loyalty").session(client))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.pointsBalance").value(1500));

        // Cancela antes da confirmação: os pontos voltam, registados no livro.
        mockMvc.perform(post("/api/v1/orders/" + number + "/cancel").session(client)
                        .header("X-CSRF-TOKEN", csrfToken(client)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.status").value("CANCELLED"));

        mockMvc.perform(get("/api/v1/loyalty").session(client))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.pointsBalance").value(3000));
        mockMvc.perform(get("/api/v1/loyalty/transactions").session(client))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.length()").value(3))
                .andExpect(jsonPath("$[0].type").value("ADJUSTMENT"))
                .andExpect(jsonPath("$[0].points").value(1500))
                .andExpect(jsonPath("$[0].note", containsString("cancelamento")));
    }

    /* ----------------------- Configuração guardada ----------------------- */

    @Test
    void configurationRequiresAnAuthorizedAccountAndValidValues() throws Exception {
        MockHttpSession owner = register("dona-fidel9@example.com", "Dona");
        makeOwner("dona-fidel9@example.com");
        MockHttpSession client = register("comum9@example.com", "Cliente Comum");

        // Sem sessão (mas com CSRF válido — quem decide é a autorização) → 401.
        MockHttpSession anonymous = new MockHttpSession();
        mockMvc.perform(put("/api/v1/admin/loyalty/config/rule").session(anonymous)
                        .header("X-CSRF-TOKEN", csrfToken(anonymous))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(ruleBody("10", "1.00", "HALF_UP", true, true)))
                .andExpect(status().isUnauthorized());
        // Sessão comum sem CSRF → 403; sessão comum com CSRF → 403 (não é dona).
        mockMvc.perform(put("/api/v1/admin/loyalty/config/rule").session(client)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(ruleBody("10", "1.00", "HALF_UP", true, true)))
                .andExpect(status().isForbidden());
        mockMvc.perform(put("/api/v1/admin/loyalty/config/rule").session(client)
                        .header("X-CSRF-TOKEN", csrfToken(client))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(ruleBody("10", "1.00", "HALF_UP", true, true)))
                .andExpect(status().isForbidden());

        // Valores inválidos são rejeitados com erro por campo (nunca default).
        mockMvc.perform(put("/api/v1/admin/loyalty/config/rule").session(owner)
                        .header("X-CSRF-TOKEN", csrfToken(owner))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(ruleBody("10", "1.00", "PARA_CIMA", true, true)))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.fieldErrors.rounding").exists());
        mockMvc.perform(put("/api/v1/admin/loyalty/config/rule").session(owner)
                        .header("X-CSRF-TOKEN", csrfToken(owner))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(ruleBody("0", "1.00", "HALF_UP", true, true)))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.fieldErrors.earnPercent").exists());

        // Prioridades empatadas entre activas são impossíveis (#11).
        upsertDiscount(owner, discountBody("WELCOME_A", "Boas-vindas A", "WELCOME", "5", null, null, 1, true));
        mockMvc.perform(post("/api/v1/admin/loyalty/config/discounts").session(owner)
                        .header("X-CSRF-TOKEN", csrfToken(owner))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(
                                discountBody("WELCOME_B", "Boas-vindas B", "WELCOME", "10", null, null, 1, true))))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.fieldErrors.priority", containsString("prioridade 1")));

        // Recompensa sem condições não existe (#13: as duas são obrigatórias).
        mockMvc.perform(post("/api/v1/admin/loyalty/config/rewards").session(owner)
                        .header("X-CSRF-TOKEN", csrfToken(owner))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(rewardBody(
                                "SEM_LIMIAR", "Sem limiar", null, null, "1000", 1, true))))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.fieldErrors.minPoints").exists());

        // Uma recompensa válida passa e fica auditada.
        upsertReward(owner, rewardBody("GOAL_OK9", "Recompensa válida", 5000, 2, "1000", 1, true));

        // Tudo o que a proprietária configure fica auditado.
        configureRule(owner, true, true);
        org.junit.jupiter.api.Assertions.assertTrue(
                auditRepository.findAll().stream()
                        .anyMatch(entry -> "loyalty.rule_changed".equals(entry.getAction())),
                "auditoria loyalty.rule_changed");
        org.junit.jupiter.api.Assertions.assertTrue(
                auditRepository.findAll().stream()
                        .anyMatch(entry -> "loyalty.reward_rule_changed".equals(entry.getAction())),
                "auditoria loyalty.reward_rule_changed");
        org.junit.jupiter.api.Assertions.assertTrue(
                auditRepository.findAll().stream()
                        .anyMatch(entry -> "discount.rule_changed".equals(entry.getAction())),
                "auditoria discount.rule_changed");
    }

    /* --------------------------- Privacidade ----------------------------- */

    @Test
    void loyaltyIsPrivateToItsOwner() throws Exception {
        MockHttpSession owner = register("dona-fidel10@example.com", "Dona");
        makeOwner("dona-fidel10@example.com");
        MockHttpSession alice = register("alice10@example.com", "Alice");
        MockHttpSession bob = register("bob10@example.com", "Bob");
        configureRule(owner, true, true);

        String productId = unlimited("bolo-no-pote-premium");
        String number = createOrder(alice, productId, 1, Map.of());
        pay(owner, number, "t10-key");

        // Alice tem pontos; Bob continua a zero — e os movimentos são só dela.
        mockMvc.perform(get("/api/v1/loyalty").session(alice))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.pointsBalance").value(350));
        mockMvc.perform(get("/api/v1/loyalty").session(bob))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.pointsBalance").value(0));
        mockMvc.perform(get("/api/v1/loyalty/transactions").session(bob))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.length()").value(0));

        // Ajuste manual é operação de conta autorizada — 403 para comum.
        mockMvc.perform(post("/api/v1/admin/loyalty/accounts/" + userId("bob10@example.com") + "/adjustment")
                        .session(bob)
                        .header("X-CSRF-TOKEN", csrfToken(bob))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"points\":100,\"note\":\"indevido\"}"))
                .andExpect(status().isForbidden());

        // E um alvo inexistente nunca é "adivinhado" pelo servidor.
        mockMvc.perform(post("/api/v1/admin/loyalty/accounts/" + UUID.randomUUID() + "/adjustment")
                        .session(owner)
                        .header("X-CSRF-TOKEN", csrfToken(owner))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"points\":100,\"note\":\"quem?\"}"))
                .andExpect(status().isNotFound());
    }

    /* ------------------------------ Helpers ------------------------------ */

    private void expectRejectedPoints(MockHttpSession client, String productId, int points, String reason)
            throws Exception {
        mockMvc.perform(post("/api/v1/orders")
                        .session(client)
                        .header("X-CSRF-TOKEN", csrfToken(client))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(orderBody(productId, 1, Map.of("pointsToSpend", points))))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.fieldErrors.pointsToSpend", containsString(reason)));
    }

    private void configureRule(MockHttpSession owner, boolean active, boolean allowPartial) throws Exception {
        mockMvc.perform(put("/api/v1/admin/loyalty/config/rule").session(owner)
                        .header("X-CSRF-TOKEN", csrfToken(owner))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(ruleBody("10", "1.00", "HALF_UP", allowPartial, active)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.active").value(active))
                .andExpect(jsonPath("$.earnPercent").value("10.00"));
    }

    private String ruleBody(String earnPercent, String pointValue, String rounding, boolean partial, boolean active)
            throws Exception {
        return objectMapper.writeValueAsString(new LinkedHashMap<>(Map.of(
                "earnPercent", earnPercent,
                "pointValueKz", pointValue,
                "rounding", rounding,
                "allowPartialRedemption", partial,
                "active", active)));
    }

    private Map<String, Object> rewardBody(
            String code, String description, Integer minPoints, Integer minOrders,
            String discountAmount, int maxPerCustomer, boolean active) {
        Map<String, Object> body = new LinkedHashMap<>();
        body.put("code", code);
        body.put("description", description);
        body.put("minPoints", minPoints);
        body.put("minOrders", minOrders);
        body.put("discountAmount", discountAmount);
        body.put("maxPerCustomer", maxPerCustomer);
        body.put("active", active);
        return body;
    }

    /** Cria/actualiza a recompensa e devolve o seu código público (é o que o cliente envia). */
    private String upsertReward(MockHttpSession owner, Map<String, Object> body) throws Exception {
        mockMvc.perform(post("/api/v1/admin/loyalty/config/rewards").session(owner)
                        .header("X-CSRF-TOKEN", csrfToken(owner))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(body)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.code").value(body.get("code")));
        return body.get("code").toString();
    }

    private Map<String, Object> discountBody(
            String code, String description, String kind,
            String percent, String amount, String rewardCode, int priority, boolean active) {
        Map<String, Object> body = new LinkedHashMap<>();
        body.put("code", code);
        body.put("description", description);
        body.put("kind", kind);
        body.put("percent", percent);
        body.put("amount", amount);
        body.put("rewardCode", rewardCode);
        body.put("priority", priority);
        body.put("active", active);
        return body;
    }

    private void upsertDiscount(MockHttpSession owner, Map<String, Object> body) throws Exception {
        mockMvc.perform(post("/api/v1/admin/loyalty/config/discounts").session(owner)
                        .header("X-CSRF-TOKEN", csrfToken(owner))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(body)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.code").value(body.get("code")))
                .andExpect(jsonPath("$.kind").value(body.get("kind")));
    }

    private void adjustPoints(MockHttpSession owner, String userId, int points, String note) throws Exception {
        mockMvc.perform(post("/api/v1/admin/loyalty/accounts/" + userId + "/adjustment").session(owner)
                        .header("X-CSRF-TOKEN", csrfToken(owner))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(Map.of("points", points, "note", note))))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.type").value("ADJUSTMENT"))
                .andExpect(jsonPath("$.points").value(points));
    }

    private void pay(MockHttpSession owner, String orderNumber, String key) throws Exception {
        mockMvc.perform(post("/api/v1/admin/payments/" + orderNumber + "/review").session(owner)
                        .header("X-CSRF-TOKEN", csrfToken(owner))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"target\":\"PAID\",\"idempotencyKey\":\"" + key + "\"}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.status").value("PAID"));
    }

    private String userId(String email) {
        return userRepository.findByEmail(email).orElseThrow().getId().toString();
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

    /** Stock generoso para os testes de fidelização não testarem inventário. */
    private String unlimited(String slug) throws Exception {
        String id = productId(slug);
        UUID pid = UUID.fromString(id);
        InventoryItem item = inventoryRepository.findByProductId(pid).orElseGet(() -> {
            InventoryItem created = new InventoryItem();
            created.setProductId(pid);
            return created;
        });
        item.setAvailableQty(999);
        item.setUnitLabel("un");
        inventoryRepository.save(item);
        for (var reservation : reservationRepository.findAll()) {
            if (reservation.getStatus() == ReservationStatus.ACTIVE && reservation.getProductId().equals(pid)) {
                reservation.setStatus(ReservationStatus.RELEASED);
                reservationRepository.save(reservation);
            }
        }
        return id;
    }

    private String createOrder(MockHttpSession session, String productId, int quantity, Map<String, Object> extra)
            throws Exception {
        String content = mockMvc.perform(post("/api/v1/orders")
                        .session(session)
                        .header("X-CSRF-TOKEN", csrfToken(session))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(orderBody(productId, quantity, extra)))
                .andExpect(status().isCreated())
                .andReturn().getResponse().getContentAsString();
        return objectMapper.readValue(content, new TypeReference<Map<String, Object>>() {}).get("number").toString();
    }

    private String orderBody(String productId, int quantity, Map<String, Object> extra) throws Exception {
        Map<String, Object> body = new LinkedHashMap<>();
        body.put("contactName", "Cliente Fidelidade");
        body.put("contactPhone", "912345678");
        body.put("fulfillment", "PICKUP");
        body.put("paymentMethod", "ON_DELIVERY");
        body.put("productLines", List.of(Map.of("productId", productId, "quantity", quantity)));
        body.put("cakeLines", List.of());
        body.putAll(extra);
        return objectMapper.writeValueAsString(body);
    }
}
