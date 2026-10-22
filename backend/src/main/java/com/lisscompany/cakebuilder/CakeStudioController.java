package com.lisscompany.cakebuilder;

import java.util.List;

import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;

/**
 * API pública do Cake Studio (sob {@code /api/v1/public/**}, sem sessão).
 *
 * <p>{@code GET /options} serve produto base, regras e ingredientes;
 * {@code POST /quote} recalcula preço e validade da composição no servidor.
 * O POST não altera estado nenhum (é um cálculo), pelo que está isento de CSRF
 * — as mutações reais da fase 4 (carrinho/encomendas) manterão CSRF activo.
 */
@RestController
@RequestMapping("/api/v1/public/cake-studio")
public class CakeStudioController {

    public record QuoteRequest(
            @NotBlank(message = "Escolha a massa do bolo.") String cakeBaseId,
            @NotBlank(message = "Escolha o primeiro recheio.") String firstFillingId,
            @NotBlank(message = "Escolha o segundo recheio.") String secondFillingId,
            List<String> extraIds,
            boolean moist) {}

    private final CakeStudioService service;

    public CakeStudioController(CakeStudioService service) {
        this.service = service;
    }

    @GetMapping("/options")
    public CakeStudioService.OptionsView options() {
        return service.getOptions();
    }

    @PostMapping("/quote")
    public CakeStudioService.QuoteView quote(@Valid @RequestBody QuoteRequest request) {
        return service.quote(new CakeStudioService.QuoteInput(
                request.cakeBaseId(),
                request.firstFillingId(),
                request.secondFillingId(),
                request.extraIds(),
                request.moist()));
    }
}
