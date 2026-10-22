package com.lisscompany.cartquote;

import java.math.BigDecimal;
import java.math.RoundingMode;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;

import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import com.lisscompany.cakebuilder.CakeStudioService;
import com.lisscompany.catalog.Product;
import com.lisscompany.catalog.ProductRepository;
import com.lisscompany.catalog.ProductStatus;
import com.lisscompany.inventory.InventoryService;

/**
 * Revalida e recalcula um carrinho inteiro no servidor antes do checkout.
 *
 * <p>O carrinho do navegador é apenas uma conveniência de navegação: guarda um
 * <em>snapshot</em> de preços no momento da adição, mas nunca é autoridade.
 * Este serviço é quem decide o que o cliente realmente vai pagar — para cada
 * linha de produto lê o preço <em>actual</em> do catálogo, e para cada bolo
 * invoca o orçamento oficial do Cake Studio. Se o preço mudou, o stock caiu ou
 * um ingrediente ficou indisponível desde que o item entrou no carrinho, isso
 * é devolvido como aviso/erro — nunca se cobra um valor que o cliente não viu.
 *
 * <p>Regra de totalização: só entram no total as linhas <strong>válidas</strong>.
 * Uma linha que o servidor não consegue confirmar (produto inexistente ou
 * inactivo, composição de bolo inválida) é devolvida com os seus motivos e
 * excluída do total — nunca se inventa um preço para algo que não se pode
 * cobrar, e o carrinho fica bloqueado até ser corrigido.
 *
 * <p>Endpoint público e puro cálculo (sem sessão, sem efeitos secundários),
 * pelo que está isento de CSRF — tal como o {@code /cake-studio/quote}.
 */
@Service
@Transactional(readOnly = true)
public class CartQuoteService {

    private final ProductRepository productRepository;
    private final CakeStudioService cakeStudioService;
    private final InventoryService inventoryService;

    public CartQuoteService(
            ProductRepository productRepository, CakeStudioService cakeStudioService, InventoryService inventoryService) {
        this.productRepository = productRepository;
        this.cakeStudioService = cakeStudioService;
        this.inventoryService = inventoryService;
    }

    /* ------------------------------- Views ------------------------------- */

    public record ProductLineInput(String productId, int quantity) {}

    public record CakeLineInput(
            String cakeBaseId,
            String firstFillingId,
            String secondFillingId,
            List<String> extraIds,
            boolean moist,
            int quantity) {}

    public record CartInput(List<ProductLineInput> productLines, List<CakeLineInput> cakeLines) {}

    public record LineView(
            String kind,
            String name,
            String unitPrice,
            int quantity,
            String lineTotal,
            boolean valid,
            List<String> issues) {}

    public record TotalView(boolean valid, String total, String currency, List<LineView> lines, List<String> issues) {}

    /* ---------------------------- Revalidação ---------------------------- */

    public TotalView quote(CartInput input) {
        List<LineView> lines = new ArrayList<>();
        List<String> cartIssues = new ArrayList<>();

        List<ProductLineInput> productLines =
                input.productLines() == null ? List.of() : input.productLines();
        List<CakeLineInput> cakeLines = input.cakeLines() == null ? List.of() : input.cakeLines();

        if (productLines.isEmpty() && cakeLines.isEmpty()) {
            cartIssues.add("O carrinho está vazio.");
        }

        BigDecimal total = BigDecimal.ZERO;

        for (ProductLineInput line : productLines) {
            int quantity = Math.max(1, line.quantity());
            List<String> issues = new ArrayList<>();
            Product product = resolveProduct(line.productId(), issues);

            BigDecimal unit = product == null ? BigDecimal.ZERO : product.getBasePrice();
            String name = product == null ? "Produto" : product.getName();
            BigDecimal lineTotal = unit.multiply(BigDecimal.valueOf(quantity));

            // Stock (fase 5): produtos geridos por inventário só vendem o que
            // está livre — reservas activas de outras encomendas contam.
            if (product != null) {
                Integer available = inventoryService.availableFor(product.getId());
                if (available != null && available < quantity) {
                    issues.add(available <= 0
                            ? "Produto: esgotado por agora."
                            : "Produto: só há %d unidade(s) em stock.".formatted(available));
                }
            }

            boolean lineValid = issues.isEmpty();
            if (lineValid) {
                total = total.add(lineTotal);
            }

            lines.add(new LineView("PRODUCT", name, money(unit), quantity, money(lineTotal),
                    lineValid, List.copyOf(issues)));
        }

        for (CakeLineInput line : cakeLines) {
            int quantity = Math.max(1, line.quantity());
            CakeStudioService.QuoteView cake = cakeStudioService.quote(new CakeStudioService.QuoteInput(
                    line.cakeBaseId(), line.firstFillingId(), line.secondFillingId(),
                    line.extraIds(), line.moist()));

            List<String> issues = cake.valid() ? List.of() : cake.issues();
            BigDecimal unit = new BigDecimal(cake.total());
            BigDecimal lineTotal = unit.multiply(BigDecimal.valueOf(quantity));

            if (cake.valid()) {
                total = total.add(lineTotal);
            }

            lines.add(new LineView("CAKE", "Bolo no pote", money(unit), quantity, money(lineTotal),
                    cake.valid(), issues));
        }

        boolean valid = cartIssues.isEmpty() && lines.stream().allMatch(LineView::valid);
        return new TotalView(valid, money(total), "AOA", List.copyOf(lines), List.copyOf(cartIssues));
    }

    private Product resolveProduct(String rawId, List<String> issues) {
        if (rawId == null || rawId.isBlank()) {
            issues.add("Produto: identificador em falta.");
            return null;
        }
        UUID id;
        try {
            id = UUID.fromString(rawId);
        } catch (IllegalArgumentException ex) {
            issues.add("Produto: identificador inválido.");
            return null;
        }
        Product product = productRepository.findById(id).orElse(null);
        if (product == null || product.getStatus() != ProductStatus.ACTIVE) {
            issues.add("Produto: já não está disponível.");
            return null;
        }
        return product;
    }

    private static String money(BigDecimal value) {
        return value.setScale(2, RoundingMode.HALF_UP).toPlainString();
    }
}
