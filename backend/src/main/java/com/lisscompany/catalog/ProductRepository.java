package com.lisscompany.catalog;

import java.util.List;
import java.util.Optional;
import java.util.UUID;

import org.springframework.data.jpa.repository.JpaRepository;

public interface ProductRepository extends JpaRepository<Product, UUID> {

    List<Product> findByStatusOrderByCategoryDisplayOrderAscNameAsc(ProductStatus status);

    Optional<Product> findBySlugAndStatus(String slug, ProductStatus status);

    Optional<Product> findFirstByCakeStudioBaseTrueAndStatus(ProductStatus status);
}
