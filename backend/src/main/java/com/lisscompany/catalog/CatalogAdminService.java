package com.lisscompany.catalog;

import java.math.BigDecimal;
import java.math.RoundingMode;
import java.text.Normalizer;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.UUID;

import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import com.lisscompany.audit.AuditService;
import com.lisscompany.identity.AppUser;
import com.lisscompany.shared.error.ConflictException;
import com.lisscompany.shared.error.InvalidRequestException;
import com.lisscompany.shared.error.NotFoundException;

/**
 * Gestão do catálogo pelo painel: produtos (com fotografias e galeria),
 * categorias e ingredientes/extras do Cake Studio. A proprietária gere tudo
 * sem alterar código; cada alteração fica no registo de auditoria.
 */
@Service
public class CatalogAdminService {

    public record ProductAdminView(
            String id, String slug, String name, String description, String basePrice, String status,
            boolean cakeStudioBase, String categoryId, String categoryName, String imageUrl,
            List<String> gallery, Integer stockQty, String updatedAt) {}

    public record ProductInput(
            String name, String description, String basePrice, String categoryId, String status,
            Boolean cakeStudioBase, String imageUrl, List<String> gallery) {}

    public record CategoryView(String id, String slug, String name, String description, int displayOrder, long products) {}

    public record CategoryInput(String name, String description, Integer displayOrder) {}

    public record IngredientAdminView(
            String id, String kind, String slug, String name, String description, String priceDelta,
            int displayOrder, boolean active, String imageUrl, Integer stockQty, boolean available) {}

    public record IngredientInput(
            String kind, String name, String description, String priceDelta, Integer displayOrder,
            Boolean active, String imageUrl, Integer stockQty, Boolean trackStock) {}

    private final ProductRepository products;
    private final ProductCategoryRepository categories;
    private final IngredientRepository ingredients;
    private final JdbcTemplate jdbc;
    private final AuditService audit;

    public CatalogAdminService(
            ProductRepository products, ProductCategoryRepository categories, IngredientRepository ingredients,
            JdbcTemplate jdbc, AuditService audit) {
        this.products = products;
        this.categories = categories;
        this.ingredients = ingredients;
        this.jdbc = jdbc;
        this.audit = audit;
    }

    /* ------------------------------ Produtos ----------------------------- */

    @Transactional(readOnly = true)
    public List<ProductAdminView> listProducts() {
        return products.findAllByOrderByCategoryDisplayOrderAscNameAsc().stream().map(this::view).toList();
    }

    @Transactional
    public ProductAdminView createProduct(ProductInput input, AppUser actor) {
        Product product = new Product();
        apply(product, input, true);
        Product saved = products.saveAndFlush(product);
        saveGallery(saved.getId(), input.gallery());
        audit.record(actor.getId(), actor.getEmail(), "catalog.product_created", "product", saved.getId().toString(),
                "Produto «%s» · %s Kz · %s".formatted(saved.getName(), saved.getBasePrice(), saved.getStatus()));
        return view(saved);
    }

    @Transactional
    public ProductAdminView updateProduct(UUID id, ProductInput input, AppUser actor) {
        Product product = products.findById(id)
                .orElseThrow(() -> new NotFoundException("PRODUCT_NOT_FOUND", "Produto não encontrado."));
        apply(product, input, false);
        Product saved = products.saveAndFlush(product);
        saveGallery(saved.getId(), input.gallery());
        audit.record(actor.getId(), actor.getEmail(), "catalog.product_updated", "product", saved.getId().toString(),
                "Produto «%s» · %s Kz · %s".formatted(saved.getName(), saved.getBasePrice(), saved.getStatus()));
        return view(saved);
    }

    private void apply(Product product, ProductInput input, boolean creating) {
        Map<String, String> errors = new LinkedHashMap<>();
        String name = clean(input.name());
        if (name == null || name.length() < 2 || name.length() > 200) {
            errors.put("name", "Indique o nome do produto (2 a 200 caracteres).");
        }
        BigDecimal price = money(input.basePrice(), "basePrice", errors, "Indique o preço em Kz.");
        ProductCategory category = null;
        try {
            category = input.categoryId() == null ? null : categories.findById(UUID.fromString(input.categoryId())).orElse(null);
        } catch (IllegalArgumentException ex) {
            category = null;
        }
        if (category == null) {
            errors.put("categoryId", "Escolha uma categoria.");
        }
        ProductStatus status = ProductStatus.ACTIVE;
        try {
            if (input.status() != null && !input.status().isBlank()) {
                status = ProductStatus.valueOf(input.status().trim().toUpperCase());
            }
        } catch (IllegalArgumentException ex) {
            errors.put("status", "Estado inválido.");
        }
        String description = input.description() == null ? "" : input.description().trim();
        if (description.length() > 4000) {
            errors.put("description", "Descrição demasiado longa (máximo 4000 caracteres).");
        }
        if (!errors.isEmpty()) {
            throw new InvalidRequestException(errors);
        }
        product.setName(name);
        product.setDescription(description);
        product.setBasePrice(price);
        product.setCategory(category);
        product.setStatus(status);
        product.setImageUrl(clean(input.imageUrl()));
        if (creating || product.getSlug() == null) {
            product.setSlug(uniqueSlug(name, null));
        }
        boolean base = Boolean.TRUE.equals(input.cakeStudioBase());
        if (base && status == ProductStatus.ACTIVE) {
            // Só um produto activo pode ser a base do Cake Studio (índice único parcial).
            for (Product other : products.findByCakeStudioBaseTrue()) {
                if (product.getId() == null || !other.getId().equals(product.getId())) {
                    other.setCakeStudioBase(false);
                    products.saveAndFlush(other);
                }
            }
        }
        product.setCakeStudioBase(base);
    }

    private void saveGallery(UUID productId, List<String> gallery) {
        jdbc.update("DELETE FROM product_image WHERE product_id = ?", productId);
        if (gallery == null) {
            return;
        }
        int position = 0;
        for (String url : gallery) {
            String clean = clean(url);
            if (clean != null) {
                jdbc.update("INSERT INTO product_image (product_id, url, position) VALUES (?, ?, ?)",
                        productId, clean, position++);
            }
        }
    }

    private ProductAdminView view(Product p) {
        List<String> gallery = jdbc.queryForList(
                "SELECT url FROM product_image WHERE product_id = ? ORDER BY position", String.class, p.getId());
        List<Integer> stock = jdbc.queryForList(
                "SELECT available_qty FROM inventory_item WHERE product_id = ?", Integer.class, p.getId());
        return new ProductAdminView(
                p.getId().toString(), p.getSlug(), p.getName(), p.getDescription(),
                p.getBasePrice().setScale(2, RoundingMode.HALF_UP).toPlainString(), p.getStatus().name(),
                p.isCakeStudioBase(), p.getCategory().getId().toString(), p.getCategory().getName(),
                p.getImageUrl(), gallery, stock.isEmpty() ? null : stock.get(0), p.getUpdatedAt().toString());
    }

    /** Galeria pública de um produto (para a página de detalhe). */
    @Transactional(readOnly = true)
    public List<String> galleryOf(UUID productId) {
        return jdbc.queryForList(
                "SELECT url FROM product_image WHERE product_id = ? ORDER BY position", String.class, productId);
    }

    /* ----------------------------- Categorias ---------------------------- */

    @Transactional(readOnly = true)
    public List<CategoryView> listCategories() {
        return categories.findAllByOrderByDisplayOrderAscNameAsc().stream()
                .map(c -> new CategoryView(c.getId().toString(), c.getSlug(), c.getName(), c.getDescription(),
                        c.getDisplayOrder(),
                        jdbc.queryForObject("SELECT COUNT(*) FROM product WHERE category_id = ?", Long.class, c.getId())))
                .toList();
    }

    @Transactional
    public CategoryView saveCategory(UUID id, CategoryInput input, AppUser actor) {
        String name = clean(input.name());
        if (name == null || name.length() < 2 || name.length() > 160) {
            throw new InvalidRequestException(Map.of("name", "Indique o nome da categoria (2 a 160 caracteres)."));
        }
        ProductCategory category = id == null
                ? new ProductCategory()
                : categories.findById(id).orElseThrow(() -> new NotFoundException("CATEGORY_NOT_FOUND", "Categoria não encontrada."));
        category.setName(name);
        category.setDescription(clean(input.description()));
        category.setDisplayOrder(input.displayOrder() == null ? 0 : input.displayOrder());
        if (id == null) {
            category.setSlug(uniqueCategorySlug(name));
        }
        ProductCategory saved = categories.saveAndFlush(category);
        audit.record(actor.getId(), actor.getEmail(), id == null ? "catalog.category_created" : "catalog.category_updated",
                "product_category", saved.getId().toString(), "Categoria «" + saved.getName() + "»");
        return new CategoryView(saved.getId().toString(), saved.getSlug(), saved.getName(), saved.getDescription(),
                saved.getDisplayOrder(), products.existsByCategoryId(saved.getId()) ? 1 : 0);
    }

    @Transactional
    public void deleteCategory(UUID id, AppUser actor) {
        ProductCategory category = categories.findById(id)
                .orElseThrow(() -> new NotFoundException("CATEGORY_NOT_FOUND", "Categoria não encontrada."));
        if (products.existsByCategoryId(id)) {
            throw new ConflictException("CATEGORY_NOT_EMPTY", "A categoria tem produtos. Mova-os ou oculte-os primeiro.");
        }
        categories.delete(category);
        audit.record(actor.getId(), actor.getEmail(), "catalog.category_deleted", "product_category", id.toString(),
                "Categoria «" + category.getName() + "» removida");
    }

    /* ---------------------------- Ingredientes --------------------------- */

    @Transactional(readOnly = true)
    public List<IngredientAdminView> listIngredients() {
        return ingredients.findAllByOrderByKindAscDisplayOrderAscNameAsc().stream().map(this::view).toList();
    }

    @Transactional
    public IngredientAdminView saveIngredient(UUID id, IngredientInput input, AppUser actor) {
        Map<String, String> errors = new LinkedHashMap<>();
        IngredientKind kind = null;
        try {
            kind = IngredientKind.valueOf(String.valueOf(input.kind()).trim().toUpperCase());
        } catch (IllegalArgumentException ex) {
            errors.put("kind", "Escolha o tipo: massa, recheio ou extra.");
        }
        String name = clean(input.name());
        if (name == null || name.length() < 2 || name.length() > 160) {
            errors.put("name", "Indique o nome (2 a 160 caracteres).");
        }
        BigDecimal delta = input.priceDelta() == null || input.priceDelta().isBlank()
                ? BigDecimal.ZERO.setScale(2)
                : money(input.priceDelta(), "priceDelta", errors, "Preço adicional inválido.");
        String description = input.description() == null ? "" : input.description().trim();
        if (description.length() > 1000) {
            errors.put("description", "Descrição demasiado longa (máximo 1000 caracteres).");
        }
        boolean track = Boolean.TRUE.equals(input.trackStock());
        if (track && (input.stockQty() == null || input.stockQty() < 0)) {
            errors.put("stockQty", "Indique uma quantidade em stock (0 = esgotado).");
        }
        if (!errors.isEmpty()) {
            throw new InvalidRequestException(errors);
        }
        Ingredient ingredient = id == null
                ? new Ingredient()
                : ingredients.findById(id).orElseThrow(() -> new NotFoundException("INGREDIENT_NOT_FOUND", "Ingrediente não encontrado."));
        ingredient.setKind(kind);
        ingredient.setName(name);
        ingredient.setDescription(description);
        ingredient.setPriceDelta(delta);
        ingredient.setDisplayOrder(input.displayOrder() == null ? 0 : input.displayOrder());
        ingredient.setActive(input.active() == null || input.active());
        ingredient.setImageUrl(clean(input.imageUrl()));
        ingredient.setStockQty(track ? input.stockQty() : null);
        if (id == null) {
            ingredient.setSlug(uniqueIngredientSlug(name));
        }
        Ingredient saved = ingredients.saveAndFlush(ingredient);
        audit.record(actor.getId(), actor.getEmail(), id == null ? "catalog.ingredient_created" : "catalog.ingredient_updated",
                "ingredient", saved.getId().toString(),
                "%s «%s» · +%s Kz · %s".formatted(saved.getKind(), saved.getName(), delta, saved.isActive() ? "activo" : "inactivo"));
        return view(saved);
    }

    private IngredientAdminView view(Ingredient i) {
        return new IngredientAdminView(
                i.getId().toString(), i.getKind().name(), i.getSlug(), i.getName(), i.getDescription(),
                i.getPriceDelta().setScale(2, RoundingMode.HALF_UP).toPlainString(), i.getDisplayOrder(), i.isActive(),
                i.getImageUrl(), i.getStockQty(), i.isAvailable());
    }

    /* ------------------------------ Utilitários -------------------------- */

    private static String clean(String value) {
        return value == null || value.isBlank() ? null : value.trim();
    }

    private static BigDecimal money(String raw, String field, Map<String, String> errors, String message) {
        if (raw == null || raw.isBlank()) {
            errors.put(field, message);
            return null;
        }
        try {
            BigDecimal value = new BigDecimal(raw.trim().replace(",", ".")).setScale(2, RoundingMode.HALF_UP);
            if (value.signum() < 0 || value.compareTo(new BigDecimal("999999999.99")) > 0) {
                errors.put(field, "Valor fora do intervalo permitido.");
            }
            return value;
        } catch (NumberFormatException ex) {
            errors.put(field, message);
            return null;
        }
    }

    static String slugify(String text) {
        String base = Normalizer.normalize(text, Normalizer.Form.NFD)
                .replaceAll("\\p{M}+", "")
                .toLowerCase(Locale.ROOT)
                .replaceAll("[^a-z0-9]+", "-")
                .replaceAll("^-+|-+$", "");
        return base.isEmpty() ? "item" : base;
    }

    private String uniqueSlug(String name, UUID ignore) {
        String base = slugify(name);
        String slug = base;
        for (int n = 2; products.existsBySlug(slug); n++) {
            slug = base + "-" + n;
        }
        return slug;
    }

    private String uniqueCategorySlug(String name) {
        String base = slugify(name);
        String slug = base;
        for (int n = 2; categories.existsBySlug(slug); n++) {
            slug = base + "-" + n;
        }
        return slug;
    }

    private String uniqueIngredientSlug(String name) {
        String base = slugify(name);
        String slug = base;
        for (int n = 2; ingredients.existsBySlug(slug); n++) {
            slug = base + "-" + n;
        }
        return slug;
    }

    /** Imagens usadas numa lista para evitar warnings de import não usado. */
    @SuppressWarnings("unused")
    private static List<String> none() {
        return new ArrayList<>();
    }
}
