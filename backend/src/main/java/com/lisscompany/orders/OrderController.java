package com.lisscompany.orders;

import java.util.List;

import org.springframework.http.HttpStatus;
import org.springframework.security.core.Authentication;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

import com.lisscompany.identity.CustomerPrincipal;
import com.lisscompany.shared.error.UnauthorizedException;

import jakarta.validation.Valid;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;

/**
 * API de encomendas (fase 4) — autenticada por sessão e protegida por CSRF.
 *
 * <p>Regra de ouro: o cliente manda identificadores e quantidades; preço,
 * validade e total são decididos pelo servidor no momento da criação. As
 * encomendas só são visíveis ao próprio cliente (para terceiros, 404).
 */
@RestController
@RequestMapping("/api/v1/orders")
public class OrderController {

    public record ProductLineRequest(
            @NotBlank(message = "Produto em falta.") String productId,
            @Min(value = 1, message = "Quantidade mínima: 1.") int quantity) {}

    public record CakeLineRequest(
            @NotBlank(message = "Escolha a massa do bolo.") String cakeBaseId,
            @NotBlank(message = "Escolha o primeiro recheio.") String firstFillingId,
            @NotBlank(message = "Escolha o segundo recheio.") String secondFillingId,
            List<String> extraIds,
            boolean moist,
            @Min(value = 1, message = "Quantidade mínima: 1.") int quantity) {}

    public record CreateOrderRequest(
            @NotBlank(message = "Indique o nome de quem recebe.") @Size(min = 2, max = 120)
                    String contactName,
            @NotBlank(message = "Indique o telefone de contacto.") @Size(min = 6, max = 30)
                    String contactPhone,
            @NotNull(message = "Escolha entrega ou levantamento.") OrderFulfillment fulfillment,
            @Size(max = 255) String addressLine1,
            @Size(max = 255) String addressLine2,
            @Size(max = 120) String addressCity,
            @Size(max = 120) String addressMunicipality,
            @NotNull(message = "Escolha o método de pagamento.") PaymentMethod paymentMethod,
            @Size(max = 500) String notes,
            @Valid List<ProductLineRequest> productLines,
            @Valid List<CakeLineRequest> cakeLines,
            /** Pontos de fidelização a resgatar (fase 6; 0/ausente = nenhum). */
            @Min(value = 0, message = "Os pontos não podem ser negativos.") Integer pointsToSpend,
            /** Código público da recompensa escolhida (fase 6; ausente = nenhuma). */
            @Size(max = 40, message = "Recompensa demasiado longa.") String rewardCode) {}

    private final OrderService service;

    public OrderController(OrderService service) {
        this.service = service;
    }

    @PostMapping
    @ResponseStatus(HttpStatus.CREATED)
    public OrderService.OrderView create(@Valid @RequestBody CreateOrderRequest request) {
        return service.create(principal(), new OrderService.CreateInput(
                request.contactName(),
                request.contactPhone(),
                request.fulfillment(),
                request.addressLine1(),
                request.addressLine2(),
                request.addressCity(),
                request.addressMunicipality(),
                request.paymentMethod(),
                request.notes(),
                toProductLines(request.productLines()),
                toCakeLines(request.cakeLines()),
                request.pointsToSpend(),
                request.rewardCode()));
    }

    @GetMapping
    public List<OrderService.OrderSummaryView> list() {
        return service.listFor(principal());
    }

    @GetMapping("/{orderNumber}")
    public OrderService.OrderView get(@PathVariable String orderNumber) {
        return service.get(principal(), orderNumber);
    }

    /** Cancelamento do cliente enquanto a encomenda ainda não foi confirmada (decisão #7). */
    @PostMapping("/{orderNumber}/cancel")
    public OrderService.OrderView cancel(@PathVariable String orderNumber) {
        return service.cancel(principal(), orderNumber);
    }

    private List<OrderService.ProductLine> toProductLines(List<ProductLineRequest> lines) {
        return lines == null
                ? List.of()
                : lines.stream().map(line -> new OrderService.ProductLine(line.productId(), line.quantity())).toList();
    }

    private List<OrderService.CakeLine> toCakeLines(List<CakeLineRequest> lines) {
        return lines == null
                ? List.of()
                : lines.stream()
                        .map(line -> new OrderService.CakeLine(
                                line.cakeBaseId(),
                                line.firstFillingId(),
                                line.secondFillingId(),
                                line.extraIds(),
                                line.moist(),
                                line.quantity()))
                        .toList();
    }

    private CustomerPrincipal principal() {
        Authentication authentication = SecurityContextHolder.getContext().getAuthentication();
        if (authentication == null || !(authentication.getPrincipal() instanceof CustomerPrincipal principal)) {
            throw new UnauthorizedException("NOT_AUTHENTICATED", "Sessão inválida. Volte a entrar.");
        }
        return principal;
    }
}
