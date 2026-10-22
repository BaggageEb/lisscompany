package com.lisscompany.administration;

import java.util.List;
import java.util.UUID;

import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

import com.lisscompany.identity.AppUser;
import com.lisscompany.inventory.InventoryService;
import com.lisscompany.shared.security.OwnerGuard;

import jakarta.validation.Valid;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;

/**
 * Inventário para o painel da loja (fase 5: leitura — fase 7: ajustes).
 * A configuração de quantidades iniciais (decisão #2) faz-se por ajuste
 * manual: a primeira entrada positiva cria a linha de inventário do produto.
 * Tudo exige conta autorizada ({@link OwnerGuard}).
 */
@RestController
@RequestMapping("/api/v1/admin/inventory")
public class AdminInventoryController {

    public record AdjustmentRequest(
            @NotNull(message = "Indique quantas unidades somar (ou subtrair).") Integer delta,
            @Size(max = 500, message = "Nota demasiado longa.") String note) {}

    private final InventoryService inventoryService;
    private final OwnerGuard ownerGuard;

    public AdminInventoryController(InventoryService inventoryService, OwnerGuard ownerGuard) {
        this.inventoryService = inventoryService;
        this.ownerGuard = ownerGuard;
    }

    @GetMapping
    public List<InventoryService.StockView> list() {
        ownerGuard.requireOwner(signedInUser().id());
        return inventoryService.listStock();
    }

    /**
     * Ajuste manual de stock (fase 7): cria a linha na primeira entrada e
     * valida que não se baixa abaixo das reservas activas. Delta assinado;
     * zero é erro de validação, não um movimento vazio.
     */
    @PostMapping("/{productId}/adjustment")
    @ResponseStatus(HttpStatus.OK)
    public InventoryService.StockView adjust(
            @PathVariable UUID productId, @Valid @RequestBody AdjustmentRequest request) {
        AppUser actor = ownerGuard.requireOwner(signedInUser().id());
        return inventoryService.adjustStock(productId, request.delta(), request.note(), actor);
    }

    private com.lisscompany.identity.CustomerPrincipal signedInUser() {
        org.springframework.security.core.Authentication authentication =
                org.springframework.security.core.context.SecurityContextHolder.getContext().getAuthentication();
        if (authentication == null
                || !(authentication.getPrincipal() instanceof com.lisscompany.identity.CustomerPrincipal principal)) {
            throw new com.lisscompany.shared.error.UnauthorizedException(
                    "NOT_AUTHENTICATED", "Sessão inválida. Volte a entrar.");
        }
        return principal;
    }
}
