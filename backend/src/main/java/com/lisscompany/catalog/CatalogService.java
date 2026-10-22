package com.lisscompany.catalog;

import java.util.List;

import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import com.lisscompany.shared.error.NotFoundException;

/**
 * Leitura pública do catálogo. Sem regra de negócio além do filtro de
 * visibilidade: só produtos {@link ProductStatus#ACTIVE} saem daqui —
 * DRAFT e HIDDEN nunca chegam ao cliente.
 */
@Service
@Transactional(readOnly = true)
public class CatalogService {

    private final ProductCategoryRepository categoryRepository;
    private final ProductRepository productRepository;

    public CatalogService(ProductCategoryRepository categoryRepository, ProductRepository productRepository) {
        this.categoryRepository = categoryRepository;
        this.productRepository = productRepository;
    }

    public List<ProductCategory> listCategories() {
        return categoryRepository.findAllByOrderByDisplayOrderAscNameAsc();
    }

    public List<Product> listActiveProducts() {
        return productRepository.findByStatusOrderByCategoryDisplayOrderAscNameAsc(ProductStatus.ACTIVE);
    }

    /** @throws NotFoundException se o slug não existe ou não está activo. */
    public Product getProduct(String slug) {
        return productRepository.findBySlugAndStatus(slug, ProductStatus.ACTIVE)
                .orElseThrow(() -> new NotFoundException("PRODUCT_NOT_FOUND", "Produto não encontrado."));
    }
}
