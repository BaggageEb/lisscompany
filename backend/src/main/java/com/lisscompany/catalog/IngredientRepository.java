package com.lisscompany.catalog;

import java.util.List;
import java.util.Optional;
import java.util.UUID;

import org.springframework.data.jpa.repository.JpaRepository;

public interface IngredientRepository extends JpaRepository<Ingredient, UUID> {

    List<Ingredient> findByKindAndActiveTrueOrderByDisplayOrderAscNameAsc(IngredientKind kind);

    Optional<Ingredient> findByIdAndActiveTrue(UUID id);
}
