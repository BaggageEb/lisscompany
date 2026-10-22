package com.lisscompany.orders;

import java.math.BigDecimal;
import java.math.RoundingMode;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;

import org.springframework.data.domain.PageRequest;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import com.lisscompany.audit.AuditService;
import com.lisscompany.cartquote.CartQuoteService;
import com.lisscompany.catalog.Ingredient;
import com.lisscompany.catalog.IngredientRepository;
import com.lisscompany.catalog.Product;
import com.lisscompany.catalog.ProductRepository;
import com.lisscompany.catalog.ProductStatus;
import com.lisscompany.identity.CustomerPrincipal;
import com.lisscompany.inventory.InventoryService;
import com.lisscompany.loyalty.LoyaltyService;
import com.lisscompany.payments.PaymentService;
import com.lisscompany.payments.PaymentStatus;
import com.lisscompany.shared.error.CartValidationException;
import com.lisscompany.shared.error.ConflictException;
import com.lisscompany.shared.error.InvalidRequestException;
import com.lisscompany.shared.error.NotFoundException;

import tools.jackson.databind.ObjectMapper;

/**
 * Criação de encomendas (fase 4).
 *
 * <p>O fluxo é sempre o mesmo: o cliente manda <strong>identificadores e
 * quantidades</strong>, o serviço revalida o carrinho inteiro pelo
 * {@link CartQuoteService} — a mesma autoridade do orçamento — e só cria a
 * encomenda com os preços que o servidor confirmou. Se alguma linha for
 * rejeitada, nada é persistido e o cliente recebe os motivos (422).
 *
 * <p>A encomenda guarda um snapshot imutável: nomes, preços de venda,
 * quantidade e a composição completa de cada bolo com os ingredientes do
 * momento. Depois de criada, o histórico não depende do catálogo vivo.
 */
@Service
public class OrderService {

    private final AuditService auditService;
    private final CartQuoteService cartQuoteService;
    private final CustomerOrderRepository orderRepository;
    private final ProductRepository productRepository;
    private final IngredientRepository ingredientRepository;
    private final InventoryService inventoryService;
    private final PaymentService paymentService;
    private final LoyaltyService loyaltyService;
    private final ObjectMapper objectMapper;

    public OrderService(
            AuditService auditService,
            CartQuoteService cartQuoteService,
            CustomerOrderRepository orderRepository,
            ProductRepository productRepository,
            IngredientRepository ingredientRepository,
            InventoryService inventoryService,
            PaymentService paymentService,
            LoyaltyService loyaltyService,
            ObjectMapper objectMapper) {
        this.auditService = auditService;
        this.cartQuoteService = cartQuoteService;
        this.orderRepository = orderRepository;
        this.productRepository = productRepository;
        this.ingredientRepository = ingredientRepository;
        this.inventoryService = inventoryService;
        this.paymentService = paymentService;
        this.loyaltyService = loyaltyService;
        this.objectMapper = objectMapper;
    }

    /* ------------------------------- Views ------------------------------- */

    public record ProductLine(String productId, int quantity) {}

    public record CakeLine(
            String cakeBaseId,
            String firstFillingId,
            String secondFillingId,
            List<String> extraIds,
            boolean moist,
            int quantity) {}

    public record CreateInput(
            String contactName,
            String contactPhone,
            OrderFulfillment fulfillment,
            String addressLine1,
            String addressLine2,
            String addressCity,
            String addressMunicipality,
            PaymentMethod paymentMethod,
            String notes,
            List<ProductLine> productLines,
            List<CakeLine> cakeLines,
            /** Pontos que o cliente quer resgatar (0/ausente = nenhum, fase 6). */
            Integer pointsToSpend,
            /** Código público da recompensa escolhida (ausente = nenhuma, fase 6). */
            String rewardCode) {}

    public record ItemView(
            String kind, String name, String unitPrice, int quantity, String lineTotal, List<String> summary) {}

    public record OrderView(
            String number,
            String status,
            String paymentStatus,
            String createdAt,
            String fulfillment,
            String paymentMethod,
            String contactName,
            String contactPhone,
            String notes,
            String addressLine1,
            String addressLine2,
            String addressCity,
            String addressMunicipality,
            String subtotal,
            String deliveryFee,
            String discountAmount,
            String discountLabel,
            int pointsSpent,
            String total,
            String currency,
            List<ItemView> items) {}

    public record OrderSummaryView(
            String number, String status, String paymentStatus, String createdAt, String total, String currency, int itemCount) {}

    /* ------------------------------ Criação ------------------------------ */

    @Transactional
    public OrderView create(CustomerPrincipal principal, CreateInput input) {
        validateFulfillment(input);

        // 1. Revalidação: o servidor decide preço e validade de cada linha.
        List<CartQuoteService.ProductLineInput> quoteProducts = toProductLines(input.productLines());
        List<CartQuoteService.CakeLineInput> quoteCakes = toCakeLines(input.cakeLines());
        CartQuoteService.TotalView quote =
                cartQuoteService.quote(new CartQuoteService.CartInput(quoteProducts, quoteCakes));
        if (!quote.valid()) {
            throw new CartValidationException(
                    "CART_INVALID",
                    "O carrinho deixou de ser válido. Corrija os artigos indicados e tente novamente.",
                    issuesOf(quote));
        }

        // 2. Encomenda com os valores confirmados (nunca os do navegador).
        CustomerOrder order = new CustomerOrder();
        order.setOrderNumber(formatNumber(orderRepository.nextOrderSequence()));
        order.setUserId(principal.id());
        order.setFulfillment(input.fulfillment());
        order.setContactName(input.contactName().trim());
        order.setContactPhone(input.contactPhone().trim());
        order.setNotes(blankToNull(input.notes()));
        order.setPaymentMethod(input.paymentMethod());
        // Fase 4: sem tarifas (decisão #3 pendente) — entrega sempre a zero.
        order.setDeliveryFee(BigDecimal.ZERO);
        if (input.fulfillment() == OrderFulfillment.DELIVERY) {
            order.setAddressLine1(blankToNull(input.addressLine1()));
            order.setAddressLine2(blankToNull(input.addressLine2()));
            order.setAddressCity(blankToNull(input.addressCity()));
            order.setAddressMunicipality(blankToNull(input.addressMunicipality()));
        }
        // Levantamento não leva morada (a CHECK da V4 exige nulls) — o campo é ignorado.

        // 3. Linhas: o quote devolve produtos primeiro e bolos depois, pela
        //    mesma ordem dos inputs, pelo que o emparelhamento é determinístico.
        List<ProductLine> productLines = input.productLines() == null ? List.of() : input.productLines();
        List<CakeLine> cakeLines = input.cakeLines() == null ? List.of() : input.cakeLines();
        int cursor = 0;
        for (ProductLine line : productLines) {
            order.addItem(productItem(line, quote.lines().get(cursor++)));
        }
        for (CakeLine line : cakeLines) {
            order.addItem(cakeItem(line, quote.lines().get(cursor++)));
        }

        BigDecimal total = new BigDecimal(quote.total());
        order.setSubtotal(total);

        // 3b. Fidelização (fase 6): o cliente pode pedir pontos ou uma
        //     recompensa; o SERVIDOR avalia elegibilidade, limites e valor.
        //     Exactamente UM desconto pega (decisão #11) e o total passa a
        //     subtotal + entrega − desconto — o cliente nunca calcula preço.
        int pointsToSpend = input.pointsToSpend() == null ? 0 : input.pointsToSpend();
        LoyaltyService.AppliedDiscount applied = loyaltyService.evaluate(
                principal.id(), total, pointsToSpend, input.rewardCode());
        if (applied != null) {
            order.setDiscountAmount(applied.amount());
            order.setDiscountLabel(applied.label());
            order.setPointsSpent(applied.pointsSpent());
        }
        order.setTotal(total.add(order.getDeliveryFee()).subtract(order.getDiscountAmount()));

        CustomerOrder saved = orderRepository.save(order);

        // Fidelização registada na MESMA transacção: livro-razão de pontos,
        // aplicação do desconto e resgate da recompensa — ou tudo, ou nada.
        loyaltyService.recordRedemption(saved, applied, principal);

        // Fase 5 (decisão #6): reserva de stock e abertura do pagamento
        // correm na MESMA transacção — ou a encomenda existe com os três,
        // ou não existe nada. Stock insuficiente aqui também é 422.
        inventoryService.reserveFor(saved);
        paymentService.openFor(saved);

        // Auditoria na MESMA transacção (propagação MANDATORY do AuditService):
        // a encomenda e o seu registo são atómicos — ou existem ambos, ou nenhum.
        auditService.record(
                principal.id(),
                principal.email(),
                "order.created",
                "customer_order",
                saved.getId().toString(),
                "Encomenda %s · %s artigo(s) · total %s %s · %s%s"
                        .formatted(
                                saved.getOrderNumber(),
                                productLines.size() + cakeLines.size(),
                                saved.getTotal(),
                                saved.getCurrency(),
                                saved.getFulfillment(),
                                applied == null
                                        ? ""
                                        : " · desconto: "
                                                + saved.getDiscountLabel()
                                                + " (−"
                                                + money(saved.getDiscountAmount())
                                                + (saved.getPointsSpent() > 0
                                                        ? ", " + saved.getPointsSpent() + " pontos"
                                                        : "")
                                                + ")"));

        return view(saved);
    }

    /* -------------------------------- Leitura ---------------------------- */

    @Transactional(readOnly = true)
    public List<OrderSummaryView> listFor(CustomerPrincipal principal) {
        List<CustomerOrder> orders = orderRepository.findByUserIdOrderByCreatedAtDesc(principal.id());
        // Estados de pagamento em lote — a lista do cliente não faz N+1.
        Map<UUID, com.lisscompany.payments.PaymentStatus> paymentStates = paymentService.statusesFor(
                orders.stream().map(CustomerOrder::getId).toList());
        return orders.stream()
                .map(order -> summary(order, paymentStates.get(order.getId())))
                .toList();
    }

    /** Só o dono vê a encomenda — para quem não é dono, o resultado é 404. */
    @Transactional(readOnly = true)
    public OrderView get(CustomerPrincipal principal, String orderNumber) {
        return view(requireOwnedOrder(principal, orderNumber));
    }

    /* ----------------- Painel administrativo (fase 7) ------------------- */

    /** Resumo para o painel: identifica quem encomendou e o que está por resolver. */
    public record AdminOrderSummaryView(
            String number,
            String status,
            String paymentStatus,
            String createdAt,
            String total,
            String currency,
            int itemCount,
            String contactName,
            String fulfillment,
            String paymentMethod) {}

    /** Detalhe do painel: a mesma visão do cliente + transições que a máquina aceita. */
    public record AdminOrderDetailView(OrderView order, List<String> allowedTargets) {}

    /** Tamanho da página do painel — sem carregar a base inteira para a memória. */
    private static final int PANEL_PAGE_SIZE = 200;

    /**
     * Lista de encomendas para o painel (conta autorizada — o guard está no
     * controlador). Filtros opcionais por estado da encomenda e do pagamento;
     * a paginação é por aqui (mais recentes primeiro).
     */
    @Transactional(readOnly = true)
    public List<AdminOrderSummaryView> listForPanel(OrderStatus status, PaymentStatus paymentStatus) {
        List<CustomerOrder> orders = orderRepository.findForPanel(PageRequest.of(0, PANEL_PAGE_SIZE));
        Map<UUID, PaymentStatus> states = paymentService.statusesFor(
                orders.stream().map(CustomerOrder::getId).toList());
        return orders.stream()
                .filter(order -> status == null || order.getStatus() == status)
                .filter(order -> paymentStatus == null || states.get(order.getId()) == paymentStatus)
                .map(order -> new AdminOrderSummaryView(
                        order.getOrderNumber(),
                        order.getStatus().name(),
                        states.get(order.getId()) == null ? null : states.get(order.getId()).name(),
                        order.getCreatedAt().toString(),
                        money(order.getTotal()),
                        order.getCurrency(),
                        order.getItems().size(),
                        order.getContactName(),
                        order.getFulfillment().name(),
                        order.getPaymentMethod().name()))
                .toList();
    }

    /** Detalhe para o painel — qualquer encomenda, validada no servidor. */
    @Transactional(readOnly = true)
    public AdminOrderDetailView getForPanel(String orderNumber) {
        CustomerOrder order = orderRepository.findByOrderNumber(orderNumber)
                .orElseThrow(() -> new NotFoundException("ORDER_NOT_FOUND", "Encomenda não encontrada."));
        List<String> targets = OrderStatusTransitions.targetsFrom(order.getStatus()).stream()
                .map(Enum::name)
                .sorted()
                .toList();
        return new AdminOrderDetailView(view(order), targets);
    }

    /* --------------------- Cancelamento (decisão #7) --------------------- */

    /**
     * O cliente cancela a SUA encomenda enquanto estiver {@code RECEIVED}
     * (cancelamento automático antes de confirmada — decisão #7). Depois de
     * confirmada exige conta autorizada (endpoint administrativo). O stock
     * reservado é devolvido e o pagamento pendente é fechado como FAILED.
     */
    @Transactional
    public OrderView cancel(CustomerPrincipal principal, String orderNumber) {
        CustomerOrder order = requireOwnedOrder(principal, orderNumber);
        OrderStatusTransitions.assertAllowed(order.getStatus(), OrderStatus.CANCELLED);
        if (order.getStatus() != OrderStatus.RECEIVED) {
            throw new ConflictException(
                    "ORDER_NOT_CANCELLABLE",
                    "Só é possível cancelar antes de a loja confirmar a encomenda. Contacte a loja.");
        }
        return close(order, principal.id(), principal.email(), "pelo cliente");
    }

    /* ------------------ Transições administrativas (fase 5/7) ------------------ */

    /**
     * Transição de estado pedida por conta autorizada (painel). A validação é
     * sempre do servidor: qualquer salto inválido é 409. Cancelar devolve o
     * stock e fecha o pagamento (sem reembolso automático — decisão #7).
     */
    @Transactional
    public OrderView transition(CustomerPrincipal actor, String orderNumber, OrderStatus target, String note) {
        CustomerOrder order = orderRepository.findByOrderNumber(orderNumber)
                .orElseThrow(() -> new NotFoundException("ORDER_NOT_FOUND", "Encomenda não encontrada."));
        OrderStatusTransitions.assertAllowed(order.getStatus(), target);

        if (target == OrderStatus.CANCELLED) {
            return close(order, actor.id(), actor.email(), "por conta autorizada");
        }

        OrderStatus from = order.getStatus();
        order.setStatus(target);
        orderRepository.save(order);
        auditService.record(
                actor.id(),
                actor.email(),
                "order.status_changed",
                "customer_order",
                order.getId().toString(),
                "Encomenda %s · %s → %s%s"
                        .formatted(order.getOrderNumber(), from, target,
                                note == null || note.isBlank() ? "" : " · " + note.trim()));
        return view(order);
    }

    /** Efeitos comuns de cancelar: stock devolvido, pagamento fechado, auditoria. */
    private OrderView close(CustomerOrder order, UUID actorId, String actorLabel, String byWho) {
        OrderStatus from = order.getStatus();
        order.setStatus(OrderStatus.CANCELLED);
        orderRepository.save(order);

        inventoryService.releaseFor(order);
        paymentService.failOnCancel(order, actorId, actorLabel);
        // Fase 6: cancelar antes da confirmação devolve o que o cliente gastou
        // em fidelização nesta encomenda — pontos e recompensa nunca se
        // perdem por um cancelamento que não chegou a ser venda.
        loyaltyService.refundOnCancel(order, actorId, actorLabel);

        auditService.record(
                actorId,
                actorLabel,
                "order.status_changed",
                "customer_order",
                order.getId().toString(),
                "Encomenda %s · %s → CANCELLED (%s) · stock devolvido"
                        .formatted(order.getOrderNumber(), from, byWho));
        return view(order);
    }

    /** Carrega a encomenda garantindo que pertence ao dono (404 para terceiros). */
    private CustomerOrder requireOwnedOrder(CustomerPrincipal principal, String orderNumber) {
        CustomerOrder order = orderRepository.findByOrderNumber(orderNumber)
                .orElseThrow(() -> new NotFoundException("ORDER_NOT_FOUND", "Encomenda não encontrada."));
        if (!order.getUserId().equals(principal.id())) {
            throw new NotFoundException("ORDER_NOT_FOUND", "Encomenda não encontrada.");
        }
        return order;
    }

    /* ------------------------------ Internos ----------------------------- */

    /** Motivos de rejeição: os do carrinho + os de cada linha (o quote reparte-os). */
    private static List<String> issuesOf(CartQuoteService.TotalView quote) {
        List<String> issues = new ArrayList<>(quote.issues());
        int cakeNumber = 0;
        for (CartQuoteService.LineView line : quote.lines()) {
            boolean isCake = "CAKE".equals(line.kind());
            if (isCake) {
                cakeNumber++;
            }
            if (line.valid()) {
                continue;
            }
            // Linhas de produto já se descrevem ("Produto: …"); bolos levam número
            // porque o nome visível é o mesmo em todas as criações.
            String prefix = isCake ? "Bolo personalizado " + cakeNumber + ": " : "";
            for (String issue : line.issues()) {
                issues.add(prefix + issue);
            }
        }
        return issues;
    }

    private OrderItem productItem(ProductLine line, CartQuoteService.LineView confirmed) {
        OrderItem item = new OrderItem();
        item.setKind(OrderItemKind.PRODUCT);
        item.setName(confirmed.name());
        item.setUnitPrice(new BigDecimal(confirmed.unitPrice()));
        item.setQuantity(line.quantity());
        item.setLineTotal(new BigDecimal(confirmed.lineTotal()));
        item.setProductId(UUID.fromString(line.productId()));
        return item;
    }

    private OrderItem cakeItem(CakeLine line, CartQuoteService.LineView confirmed) {
        Product baseProduct = productRepository
                .findFirstByCakeStudioBaseTrueAndStatus(ProductStatus.ACTIVE)
                .orElseThrow(() -> new IllegalStateException("produto-base do Cake Studio validado não encontrado"));

        Ingredient cakeBase = requireIngredient(line.cakeBaseId());
        Ingredient firstFilling = requireIngredient(line.firstFillingId());
        Ingredient secondFilling = requireIngredient(line.secondFillingId());
        List<Ingredient> extras = line.extraIds() == null
                ? List.of()
                : line.extraIds().stream().map(this::requireIngredient).toList();

        CakeCompositionSnapshot snapshot = new CakeCompositionSnapshot(
                new SnapshotIngredient(cakeBase.getId().toString(), cakeBase.getName()),
                List.of(
                        new SnapshotIngredient(firstFilling.getId().toString(), firstFilling.getName()),
                        new SnapshotIngredient(secondFilling.getId().toString(), secondFilling.getName())),
                extras.stream()
                        .map(extra -> new SnapshotIngredient(extra.getId().toString(), extra.getName()))
                        .toList(),
                labels(cakeBase, firstFilling, secondFilling, extras, line.moist()),
                line.moist());

        OrderItem item = new OrderItem();
        item.setKind(OrderItemKind.CAKE);
        item.setName(baseProduct.getName());
        item.setUnitPrice(new BigDecimal(confirmed.unitPrice()));
        item.setQuantity(line.quantity());
        item.setLineTotal(new BigDecimal(confirmed.lineTotal()));
        item.setComposition(objectMapper.writeValueAsString(snapshot));
        return item;
    }

    /** Rótulos legíveis gerados no SERVIDOR (o cliente não escreve texto da encomenda). */
    private static List<String> labels(
            Ingredient cakeBase, Ingredient first, Ingredient second, List<Ingredient> extras, boolean moist) {
        List<String> labels = new ArrayList<>();
        labels.add("Massa " + cakeBase.getName());
        labels.add("1º recheio: " + first.getName());
        labels.add("2º recheio: " + second.getName());
        for (Ingredient extra : extras) {
            labels.add("Extra: " + extra.getName());
        }
        labels.add(moist ? "Bolo molhado" : "Bolo não molhado");
        return labels;
    }

    /** Ingrediente já validado pelo quote — só falha se o invariant partisse. */
    private Ingredient requireIngredient(String rawId) {
        UUID id = UUID.fromString(rawId);
        return ingredientRepository.findByIdAndActiveTrue(id)
                .orElseThrow(() -> new IllegalStateException("ingrediente validado não encontrado: " + rawId));
    }

    private List<CartQuoteService.ProductLineInput> toProductLines(List<ProductLine> lines) {
        return lines == null
                ? List.of()
                : lines.stream()
                        .map(line -> new CartQuoteService.ProductLineInput(line.productId(), line.quantity()))
                        .toList();
    }

    private List<CartQuoteService.CakeLineInput> toCakeLines(List<CakeLine> lines) {
        return lines == null
                ? List.of()
                : lines.stream()
                        .map(line -> new CartQuoteService.CakeLineInput(
                                line.cakeBaseId(),
                                line.firstFillingId(),
                                line.secondFillingId(),
                                line.extraIds(),
                                line.moist(),
                                line.quantity()))
                        .toList();
    }

    private void validateFulfillment(CreateInput input) {
        if (input.fulfillment() != OrderFulfillment.DELIVERY) {
            return;
        }
        Map<String, String> errors = new LinkedHashMap<>();
        if (blankToNull(input.addressLine1()) == null) {
            errors.put("addressLine1", "A morada é obrigatória para entrega.");
        }
        if (blankToNull(input.addressCity()) == null) {
            errors.put("addressCity", "A cidade é obrigatória para entrega.");
        }
        if (!errors.isEmpty()) {
            throw new InvalidRequestException(errors);
        }
    }

    private String formatNumber(long sequence) {
        return String.format("LC-%06d", sequence);
    }

    /** Vazio (ou só espaços) vira {@code null} e é aparado — campos opcionais. */
    private static String blankToNull(String value) {
        return value == null || value.isBlank() ? null : value.trim();
    }

    /** Dinheiro sai sempre com 2 decimais como string decimal (convenção da API). */
    private static String money(BigDecimal value) {
        return value.setScale(2, RoundingMode.HALF_UP).toPlainString();
    }

    private OrderView view(CustomerOrder order) {
        com.lisscompany.payments.PaymentStatus payment = paymentService.statusOf(order.getId());
        return new OrderView(
                order.getOrderNumber(),
                order.getStatus().name(),
                payment == null ? null : payment.name(),
                order.getCreatedAt().toString(),
                order.getFulfillment().name(),
                order.getPaymentMethod().name(),
                order.getContactName(),
                order.getContactPhone(),
                order.getNotes(),
                order.getAddressLine1(),
                order.getAddressLine2(),
                order.getAddressCity(),
                order.getAddressMunicipality(),
                money(order.getSubtotal()),
                money(order.getDeliveryFee()),
                money(order.getDiscountAmount()),
                order.getDiscountLabel(),
                order.getPointsSpent(),
                money(order.getTotal()),
                order.getCurrency(),
                order.getItems().stream().map(this::itemView).toList());
    }

    private OrderSummaryView summary(CustomerOrder order, com.lisscompany.payments.PaymentStatus payment) {
        return new OrderSummaryView(
                order.getOrderNumber(),
                order.getStatus().name(),
                payment == null ? null : payment.name(),
                order.getCreatedAt().toString(),
                money(order.getTotal()),
                order.getCurrency(),
                order.getItems().size());
    }

    private ItemView itemView(OrderItem item) {
        return new ItemView(
                item.getKind().name(),
                item.getName(),
                money(item.getUnitPrice()),
                item.getQuantity(),
                money(item.getLineTotal()),
                item.getComposition() == null
                        ? List.of()
                        : objectMapper.readValue(item.getComposition(), CakeCompositionSnapshot.class).labels());
    }

    /* --------------------------- Snapshot (JSON) -------------------------- */

    public record SnapshotIngredient(String id, String name) {}

    public record CakeCompositionSnapshot(
            SnapshotIngredient cakeBase,
            List<SnapshotIngredient> fillings,
            List<SnapshotIngredient> extras,
            List<String> labels,
            boolean moist) {}
}
