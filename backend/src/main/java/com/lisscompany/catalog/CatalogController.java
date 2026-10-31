package com.lisscompany.catalog;

import java.util.List;

import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/**
 * API pública de catálogo (loja). Rotas sob {@code /api/v1/public/**}
 * (permitidas sem sessão no {@code SecurityConfig}) — apenas leitura.
 *
 * <p>Os preços saem sempre como string decimal: nunca float na fronteira.
 */
@RestController
@RequestMapping("/api/v1/public/catalog")
public class CatalogController {

    public record CategoryView(String id, String slug, String name, String description, int displayOrder) {}

    public record ProductView(
            String id,
            String slug,
            String name,
            String description,
            String basePrice,
            String currency,
            String imageUrl,
            String categorySlug,
            String categoryName,
            boolean available,
            List<String> gallery,
            Integer stockQty) {}

    private final CatalogService service;
    private final CatalogAdminService adminService;
    private final com.lisscompany.inventory.InventoryService inventoryService;

    public CatalogController(
            CatalogService service,
            CatalogAdminService adminService,
            com.lisscompany.inventory.InventoryService inventoryService) {
        this.service = service;
        this.adminService = adminService;
        this.inventoryService = inventoryService;
    }

    @GetMapping("/categories")
    public List<CategoryView> categories() {
        return service.listCategories().stream()
                .map(category -> new CategoryView(
                        category.getId().toString(),
                        category.getSlug(),
                        category.getName(),
                        category.getDescription(),
                        category.getDisplayOrder()))
                .toList();
    }

    @GetMapping("/products")
    public List<ProductView> products() {
        return service.listActiveProducts().stream().map(this::toView).toList();
    }

    @GetMapping("/products/{slug}")
    public ProductView product(@PathVariable String slug) {
        return toView(service.getProduct(slug));
    }

    private ProductView toView(Product product) {
        Integer free = inventoryService.availableFor(product.getId());
        return new ProductView(
                product.getId().toString(),
                product.getSlug(),
                product.getName(),
                product.getDescription(),
                product.getBasePrice().toPlainString(),
                product.getCurrency(),
                product.getImageUrl(),
                product.getCategory().getSlug(),
                product.getCategory().getName(),
                product.getStatus() == ProductStatus.ACTIVE && (free == null || free > 0),
                adminService.galleryOf(product.getId()),
                free == null ? null : Math.max(free, 0));
    }
}
