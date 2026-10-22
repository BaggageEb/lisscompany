package com.lisscompany;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

import java.math.BigDecimal;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

import com.lisscompany.cakebuilder.CakeStudioService;
import com.lisscompany.catalog.Ingredient;
import com.lisscompany.catalog.IngredientKind;
import com.lisscompany.catalog.IngredientRepository;
import com.lisscompany.catalog.Product;
import com.lisscompany.catalog.ProductRepository;
import com.lisscompany.catalog.ProductStatus;
import com.lisscompany.shared.error.ResourceNotConfiguredException;

/**
 * Testes unitários da autoridade de preços e regras do Cake Studio — sem
 * base de dados nem Spring context: valida a lógica pura do servidor.
 */
class CakeStudioServiceTest {

    private ProductRepository productRepository;
    private IngredientRepository ingredientRepository;
    private CakeStudioService service;

    private Product baseProduct;
    private Ingredient chocolate;
    private Ingredient ganache;
    private Ingredient morango;
    private Ingredient goldLeaf;

    @BeforeEach
    void setUp() {
        productRepository = mock(ProductRepository.class);
        ingredientRepository = mock(IngredientRepository.class);
        service = new CakeStudioService(productRepository, ingredientRepository);

        baseProduct = mock(Product.class);
        when(baseProduct.getId()).thenReturn(UUID.randomUUID());
        when(baseProduct.getSlug()).thenReturn("bolo-no-pote-classico");
        when(baseProduct.getName()).thenReturn("Bolo no Pote Clássico");
        when(baseProduct.getBasePrice()).thenReturn(new BigDecimal("2500.00"));
        when(baseProduct.getCurrency()).thenReturn("AOA");
        when(baseProduct.getDescription()).thenReturn("Descrição");
        when(productRepository.findFirstByCakeStudioBaseTrueAndStatus(ProductStatus.ACTIVE))
                .thenReturn(Optional.of(baseProduct));

        chocolate = ingredient(IngredientKind.CAKE_BASE, "Chocolate", "0.00");
        ganache = ingredient(IngredientKind.FILLING, "Ganache de chocolate", "0.00");
        morango = ingredient(IngredientKind.FILLING, "Morango", "500.00");
        goldLeaf = ingredient(IngredientKind.EXTRA, "Folha de ouro", "1500.00");

        when(ingredientRepository.findByIdAndActiveTrue(any())).thenReturn(Optional.empty());
        when(ingredientRepository.findByIdAndActiveTrue(chocolate.getId())).thenReturn(Optional.of(chocolate));
        when(ingredientRepository.findByIdAndActiveTrue(ganache.getId())).thenReturn(Optional.of(ganache));
        when(ingredientRepository.findByIdAndActiveTrue(morango.getId())).thenReturn(Optional.of(morango));
        when(ingredientRepository.findByIdAndActiveTrue(goldLeaf.getId())).thenReturn(Optional.of(goldLeaf));
    }

    private Ingredient ingredient(IngredientKind kind, String name, String delta) {
        Ingredient ingredient = mock(Ingredient.class);
        when(ingredient.getId()).thenReturn(UUID.randomUUID());
        when(ingredient.getKind()).thenReturn(kind);
        when(ingredient.getName()).thenReturn(name);
        when(ingredient.getPriceDelta()).thenReturn(new BigDecimal(delta));
        when(ingredient.isActive()).thenReturn(true);
        return ingredient;
    }

    private CakeStudioService.QuoteInput input(
            Ingredient base, Ingredient first, Ingredient second, List<Ingredient> extras, boolean moist) {
        return new CakeStudioService.QuoteInput(
                base == null ? null : base.getId().toString(),
                first == null ? null : first.getId().toString(),
                second == null ? null : second.getId().toString(),
                extras.stream().map(e -> e.getId().toString()).toList(),
                moist);
    }

    @Test
    void quoteComputesAuthoritativeTotalFromBasePlusDeltas() {
        var quote = service.quote(input(chocolate, ganache, morango, List.of(goldLeaf), false));

        assertThat(quote.valid()).isTrue();
        // 2500 base + 0 massa + 0 + 500 morango + 1500 folha = 4500.00
        assertThat(quote.total()).isEqualTo("4500.00");
        assertThat(quote.currency()).isEqualTo("AOA");
        assertThat(quote.lines()).extracting(CakeStudioService.QuoteLine::label)
                .containsExactly("Bolo no Pote Clássico", "Morango", "Folha de ouro");
        assertThat(quote.issues()).isEmpty();
    }

    @Test
    void moistNeverChangesThePrice() {
        var dry = service.quote(input(chocolate, ganache, morango, List.of(), false));
        var wet = service.quote(input(chocolate, ganache, morango, List.of(), true));
        assertThat(wet.total()).isEqualTo(dry.total());
        assertThat(wet.valid()).isTrue();
    }

    @Test
    void quoteRejectsUnknownIngredientIds() {
        var quote = service.quote(new CakeStudioService.QuoteInput(
                UUID.randomUUID().toString(),
                UUID.randomUUID().toString(),
                ganache.getId().toString(),
                List.of(),
                false));

        assertThat(quote.valid()).isFalse();
        assertThat(quote.issues()).hasSize(2); // massa + segundo recheio
    }

    @Test
    void quoteRejectsMalformedIdsAsIssuesNotExceptions() {
        var quote = service.quote(new CakeStudioService.QuoteInput(
                "not-a-uuid", ganache.getId().toString(), ganache.getId().toString(), List.of(), false));

        assertThat(quote.valid()).isFalse();
        assertThat(quote.issues()).anySatisfy(issue -> assertThat(issue).contains("Massa"));
    }

    @Test
    void quoteRejectsWrongIngredientKind() {
        // Um recheio usado como massa.
        var quote = service.quote(new CakeStudioService.QuoteInput(
                ganache.getId().toString(),
                ganache.getId().toString(),
                morango.getId().toString(),
                List.of(),
                false));

        assertThat(quote.valid()).isFalse();
        assertThat(quote.issues()).anySatisfy(issue -> assertThat(issue).contains("Massa"));
    }

    @Test
    void quoteEnforcesExtraLimit() {
        List<Ingredient> extras = List.of(goldLeaf, goldLeaf, goldLeaf, goldLeaf);
        var quote = service.quote(input(chocolate, ganache, ganache, extras, false));

        assertThat(quote.valid()).isFalse();
        assertThat(quote.issues()).anySatisfy(issue -> assertThat(issue).contains("máximo 3 extras"));
    }

    @Test
    void quoteRequiresBothFillings() {
        var quote = service.quote(new CakeStudioService.QuoteInput(
                chocolate.getId().toString(), ganache.getId().toString(), null, List.of(), false));

        assertThat(quote.valid()).isFalse();
        assertThat(quote.issues()).anySatisfy(issue -> assertThat(issue).contains("Segundo recheio"));
    }

    @Test
    void optionsExposeRulesAndActiveGroups() {
        when(ingredientRepository.findByKindAndActiveTrueOrderByDisplayOrderAscNameAsc(IngredientKind.CAKE_BASE))
                .thenReturn(List.of(chocolate));
        when(ingredientRepository.findByKindAndActiveTrueOrderByDisplayOrderAscNameAsc(IngredientKind.FILLING))
                .thenReturn(List.of(ganache, morango));
        when(ingredientRepository.findByKindAndActiveTrueOrderByDisplayOrderAscNameAsc(IngredientKind.EXTRA))
                .thenReturn(List.of(goldLeaf));

        var options = service.getOptions();

        assertThat(options.baseProduct().slug()).isEqualTo("bolo-no-pote-classico");
        assertThat(options.baseProduct().basePrice()).isEqualTo("2500.00");
        assertThat(options.rules().cakeLayers()).isEqualTo(2);
        assertThat(options.rules().fillingLayers()).isEqualTo(2);
        assertThat(options.rules().maxDistinctFillings()).isEqualTo(2);
        assertThat(options.rules().maxExtras()).isEqualTo(3);
        assertThat(options.rules().moistChangesPrice()).isFalse();
        assertThat(options.cakeBases()).hasSize(1);
        assertThat(options.fillings()).hasSize(2);
        assertThat(options.extras()).hasSize(1);
    }

    @Test
    void optionsFailLoudlyWhenStudioBaseIsNotConfigured() {
        when(productRepository.findFirstByCakeStudioBaseTrueAndStatus(ProductStatus.ACTIVE))
                .thenReturn(Optional.empty());

        assertThatThrownBy(() -> service.getOptions())
                .isInstanceOf(ResourceNotConfiguredException.class)
                .hasMessageContaining("produto base");
    }
}
