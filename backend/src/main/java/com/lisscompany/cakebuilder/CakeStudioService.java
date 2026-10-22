package com.lisscompany.cakebuilder;

import java.math.BigDecimal;
import java.math.RoundingMode;
import java.util.ArrayList;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Objects;
import java.util.Set;
import java.util.UUID;

import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import com.lisscompany.catalog.Ingredient;
import com.lisscompany.catalog.IngredientKind;
import com.lisscompany.catalog.IngredientRepository;
import com.lisscompany.catalog.Product;
import com.lisscompany.catalog.ProductRepository;
import com.lisscompany.catalog.ProductStatus;
import com.lisscompany.shared.error.ResourceNotConfiguredException;

/**
 * Lógica do Cake Studio no servidor: serve as opções (produto base, regras e
 * ingredientes activos) e valida/orça uma composição.
 *
 * <p>Esta classe é a <strong>autoridade</strong>: preço, disponibilidade e
 * validade da composição são calculados aqui, nunca confiados no cliente.
 * O frontend calcula uma estimativa apenas para feedback imediato.
 */
@Service
@Transactional(readOnly = true)
public class CakeStudioService {

    private static final BigDecimal MONEY_SCALE = new BigDecimal("0.01");

    private final ProductRepository productRepository;
    private final IngredientRepository ingredientRepository;

    public CakeStudioService(ProductRepository productRepository, IngredientRepository ingredientRepository) {
        this.productRepository = productRepository;
        this.ingredientRepository = ingredientRepository;
    }

    /* ------------------------------- Views ------------------------------- */

    public record BaseProductView(String id, String slug, String name, String basePrice, String currency, String description) {}

    public record IngredientView(
            String id,
            String slug,
            String name,
            String description,
            String priceDelta,
            String imageUrl,
            boolean available,
            int displayOrder) {}

    public record OptionsView(
            BaseProductView baseProduct,
            CakeStudioRules rules,
            List<IngredientView> cakeBases,
            List<IngredientView> fillings,
            List<IngredientView> extras) {}

    public record QuoteLine(String label, String amount) {}

    public record QuoteView(boolean valid, String total, String currency, List<QuoteLine> lines, List<String> issues) {}

    /** Pedido de orçamento (entrada já validada pelo bean validation). */
    public record QuoteInput(
            String cakeBaseId,
            String firstFillingId,
            String secondFillingId,
            List<String> extraIds,
            boolean moist) {}

    /* ------------------------------ Opções ------------------------------- */

    public OptionsView getOptions() {
        Product base = productRepository.findFirstByCakeStudioBaseTrueAndStatus(ProductStatus.ACTIVE)
                .orElseThrow(() -> new ResourceNotConfiguredException(
                        "CAKE_STUDIO_NOT_CONFIGURED",
                        "O Cake Studio ainda não tem produto base configurado."));

        return new OptionsView(
                new BaseProductView(
                        base.getId().toString(),
                        base.getSlug(),
                        base.getName(),
                        base.getBasePrice().toPlainString(),
                        base.getCurrency(),
                        base.getDescription()),
                CakeStudioRules.DEFAULT,
                views(IngredientKind.CAKE_BASE),
                views(IngredientKind.FILLING),
                views(IngredientKind.EXTRA));
    }

    private List<IngredientView> views(IngredientKind kind) {
        return ingredientRepository.findByKindAndActiveTrueOrderByDisplayOrderAscNameAsc(kind).stream()
                .map(ingredient -> new IngredientView(
                        ingredient.getId().toString(),
                        ingredient.getSlug(),
                        ingredient.getName(),
                        ingredient.getDescription(),
                        ingredient.getPriceDelta().toPlainString(),
                        ingredient.getImageUrl(),
                        ingredient.isActive(),
                        ingredient.getDisplayOrder()))
                .toList();
    }

    /* ---------------------------- Orçamento ------------------------------ */

    public QuoteView quote(QuoteInput input) {
        CakeStudioRules rules = CakeStudioRules.DEFAULT;
        List<String> issues = new ArrayList<>();
        List<QuoteLine> lines = new ArrayList<>();

        Product baseProduct = productRepository.findFirstByCakeStudioBaseTrueAndStatus(ProductStatus.ACTIVE)
                .orElseThrow(() -> new ResourceNotConfiguredException(
                        "CAKE_STUDIO_NOT_CONFIGURED",
                        "O Cake Studio ainda não tem produto base configurado."));

        BigDecimal total = baseProduct.getBasePrice();
        lines.add(new QuoteLine(baseProduct.getName(), money(total)));

        Ingredient cakeBase = resolve(input.cakeBaseId(), IngredientKind.CAKE_BASE, "Massa", issues);
        Ingredient firstFilling = resolve(input.firstFillingId(), IngredientKind.FILLING, "Primeiro recheio", issues);
        Ingredient secondFilling = resolve(input.secondFillingId(), IngredientKind.FILLING, "Segundo recheio", issues);

        List<Ingredient> extras = new ArrayList<>();
        List<String> extraIds = input.extraIds() == null ? List.of() : input.extraIds().stream().filter(Objects::nonNull).toList();
        if (extraIds.size() > rules.maxExtras()) {
            issues.add("São permitidos no máximo " + rules.maxExtras() + " extras.");
        }
        for (String extraId : extraIds) {
            Ingredient extra = resolve(extraId, IngredientKind.EXTRA, "Extra", issues);
            if (extra != null) {
                extras.add(extra);
            }
        }

        // Regra de recheios distintos (duas camadas, no máximo N distintos).
        Set<String> distinctFillings = new LinkedHashSet<>();
        for (Ingredient filling : new Ingredient[] { firstFilling, secondFilling }) {
            if (filling != null) {
                distinctFillings.add(filling.getId().toString());
            }
        }
        if (firstFilling != null && secondFilling != null && distinctFillings.size() > rules.maxDistinctFillings()) {
            issues.add("São permitidos no máximo " + rules.maxDistinctFillings() + " recheios distintos.");
        }

        // Preço: base + deltas de massa + recheios + extras. Molhado: zero efeito.
        if (cakeBase != null) {
            total = total.add(cakeBase.getPriceDelta());
            addIfNonZero(lines, cakeBase);
        }
        for (Ingredient filling : new Ingredient[] { firstFilling, secondFilling }) {
            if (filling != null) {
                total = total.add(filling.getPriceDelta());
                addIfNonZero(lines, filling);
            }
        }
        for (Ingredient extra : extras) {
            total = total.add(extra.getPriceDelta());
            addIfNonZero(lines, extra);
        }

        return new QuoteView(issues.isEmpty(), money(total), "AOA", List.copyOf(lines), List.copyOf(issues));
    }

    private Ingredient resolve(String rawId, IngredientKind expectedKind, String label, List<String> issues) {
        if (rawId == null || rawId.isBlank()) {
            issues.add(label + ": escolha obrigatória.");
            return null;
        }
        UUID id;
        try {
            id = UUID.fromString(rawId);
        } catch (IllegalArgumentException ex) {
            issues.add(label + ": ingrediente inválido.");
            return null;
        }
        Ingredient ingredient = ingredientRepository.findByIdAndActiveTrue(id).orElse(null);
        if (ingredient == null) {
            issues.add(label + ": ingrediente indisponível.");
            return null;
        }
        if (ingredient.getKind() != expectedKind) {
            issues.add(label + ": tipo de ingrediente incorrecto.");
            return null;
        }
        return ingredient;
    }

    private void addIfNonZero(List<QuoteLine> lines, Ingredient ingredient) {
        if (ingredient.getPriceDelta().compareTo(BigDecimal.ZERO) != 0) {
            lines.add(new QuoteLine(ingredient.getName(), money(ingredient.getPriceDelta())));
        }
    }

    private static String money(BigDecimal value) {
        return value.setScale(2, RoundingMode.HALF_UP).toPlainString();
    }
}
