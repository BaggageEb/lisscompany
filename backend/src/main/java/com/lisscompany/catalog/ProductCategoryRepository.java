package com.lisscompany.catalog;

import java.util.List;

import org.springframework.data.jpa.repository.JpaRepository;

public interface ProductCategoryRepository extends JpaRepository<ProductCategory, java.util.UUID> {
    List<ProductCategory> findAllByOrderByDisplayOrderAscNameAsc();
}
