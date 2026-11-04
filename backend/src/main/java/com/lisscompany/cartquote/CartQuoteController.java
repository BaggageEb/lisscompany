package com.lisscompany.cartquote;

import java.util.List;

import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import jakarta.validation.Valid;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;

/**
 * API pública de revalidação de carrinho (sob {@code /api/v1/public/**}, sem
 * sessão) — o último ponto de verificação antes do checkout.
 *
 * <p>{@code POST /quote} devolve o total <strong>confirmado pelo servidor</strong>
 * para o carrinho inteiro: cada linha é repreçada com o preço actual do
 * catálogo e cada criação de bolo passa pelo orçamento oficial do Cake Studio.
 * Nada vindo do navegador é aceite como preço.
 *
 * <p>É um POST sem qualquer efeito secundário (não cria encomenda, não altera
 * stock nem sessão), pelo que está isento de CSRF — tal como os POSTs públicos
 * do catálogo/Cake Studio. As mutações reais da fase de encomendas manterão
 * CSRF activo.
 */
@RestController
@RequestMapping("/api/v1/public/cart")
public class CartQuoteController {

    public record ProductLineRequest(
            @NotBlank(message = "Produto em falta.") String productId,
            @Min(value = 1, message = "Quantidade mínima: 1.") int quantity) {}

    public record CakeLineRequest(
            @NotBlank(message = "Escolha a massa do bolo.") String cakeBaseId,
            @NotBlank(message = "Escolha o primeiro recheio.") String firstFillingId,
            @NotBlank(message = "Escolha o segundo recheio.") String secondFillingId,
            List<String> extraIds,
            boolean moist,
            @Min(value = 1, message = "Quantidade mínima: 1.") int quantity,
            @Valid @Size(max = 20, message = "Demasiados complementos.") List<AddonRequest> addons) {}

    public record AddonRequest(
            @NotBlank(message = "Complemento em falta.") String id,
            @Size(max = 200, message = "Mensagem demasiado longa (máximo 200 caracteres).") String message) {}

    public record QuoteRequest(
            @Valid @Size(max = 100, message = "Carrinho demasiado longo.") List<ProductLineRequest> productLines,
            @Valid @Size(max = 100, message = "Carrinho demasiado longo.") List<CakeLineRequest> cakeLines,
            /** Modalidade escolhida (DELIVERY pede também o preço da entrega). */
            String fulfillment,
            @Size(max = 60) String deliveryZoneId) {}

    private final CartQuoteService service;

    public CartQuoteController(CartQuoteService service) {
        this.service = service;
    }

    @PostMapping("/quote")
    public CartQuoteService.TotalView quote(@Valid @RequestBody QuoteRequest request) {
        List<CartQuoteService.ProductLineInput> productLines =
                request.productLines() == null
                        ? List.of()
                        : request.productLines().stream()
                                .map(line -> new CartQuoteService.ProductLineInput(line.productId(), line.quantity()))
                                .toList();

        List<CartQuoteService.CakeLineInput> cakeLines =
                request.cakeLines() == null
                        ? List.of()
                        : request.cakeLines().stream()
                                .map(line -> new CartQuoteService.CakeLineInput(
                                        line.cakeBaseId(),
                                        line.firstFillingId(),
                                        line.secondFillingId(),
                                        line.extraIds(),
                                        line.moist(),
                                        line.quantity(),
                                        line.addons() == null ? List.of() : line.addons().stream()
                                                .map(a -> new com.lisscompany.cakebuilder.AddonChoice(a.id(), a.message()))
                                                .toList()))
                                .toList();

        return service.quote(new CartQuoteService.CartInput(
                productLines, cakeLines, "DELIVERY".equalsIgnoreCase(request.fulfillment()), request.deliveryZoneId()));
    }
}
