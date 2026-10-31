package com.lisscompany.administration;

import java.util.List;
import java.util.UUID;

import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

import com.lisscompany.catalog.CatalogAdminService;
import com.lisscompany.shared.security.OwnerGuard;
import com.lisscompany.shared.security.Permissions;

/** Gestão de produtos, categorias e ingredientes (permissão CATALOG_MANAGE). */
@RestController
@RequestMapping("/api/v1/admin/catalog")
public class AdminCatalogController {

    private final CatalogAdminService service;
    private final OwnerGuard guard;

    public AdminCatalogController(CatalogAdminService service, OwnerGuard guard) {
        this.service = service;
        this.guard = guard;
    }

    @GetMapping("/products")
    public List<CatalogAdminService.ProductAdminView> products() {
        guard.current(Permissions.CATALOG_MANAGE);
        return service.listProducts();
    }

    @PostMapping("/products")
    @ResponseStatus(HttpStatus.CREATED)
    public CatalogAdminService.ProductAdminView createProduct(@RequestBody CatalogAdminService.ProductInput input) {
        return service.createProduct(input, guard.current(Permissions.CATALOG_MANAGE));
    }

    @PutMapping("/products/{id}")
    public CatalogAdminService.ProductAdminView updateProduct(
            @PathVariable UUID id, @RequestBody CatalogAdminService.ProductInput input) {
        return service.updateProduct(id, input, guard.current(Permissions.CATALOG_MANAGE));
    }

    @GetMapping("/categories")
    public List<CatalogAdminService.CategoryView> categories() {
        guard.current(Permissions.CATALOG_MANAGE);
        return service.listCategories();
    }

    @PostMapping("/categories")
    @ResponseStatus(HttpStatus.CREATED)
    public CatalogAdminService.CategoryView createCategory(@RequestBody CatalogAdminService.CategoryInput input) {
        return service.saveCategory(null, input, guard.current(Permissions.CATALOG_MANAGE));
    }

    @PutMapping("/categories/{id}")
    public CatalogAdminService.CategoryView updateCategory(
            @PathVariable UUID id, @RequestBody CatalogAdminService.CategoryInput input) {
        return service.saveCategory(id, input, guard.current(Permissions.CATALOG_MANAGE));
    }

    @DeleteMapping("/categories/{id}")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void deleteCategory(@PathVariable UUID id) {
        service.deleteCategory(id, guard.current(Permissions.CATALOG_MANAGE));
    }

    @GetMapping("/ingredients")
    public List<CatalogAdminService.IngredientAdminView> ingredients() {
        guard.current(Permissions.CATALOG_MANAGE);
        return service.listIngredients();
    }

    @PostMapping("/ingredients")
    @ResponseStatus(HttpStatus.CREATED)
    public CatalogAdminService.IngredientAdminView createIngredient(
            @RequestBody CatalogAdminService.IngredientInput input) {
        return service.saveIngredient(null, input, guard.current(Permissions.CATALOG_MANAGE));
    }

    @PutMapping("/ingredients/{id}")
    public CatalogAdminService.IngredientAdminView updateIngredient(
            @PathVariable UUID id, @RequestBody CatalogAdminService.IngredientInput input) {
        return service.saveIngredient(id, input, guard.current(Permissions.CATALOG_MANAGE));
    }
}
