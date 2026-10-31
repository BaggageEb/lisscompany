package com.lisscompany.payments;

import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import com.lisscompany.orders.CustomerOrder;
import com.lisscompany.orders.CustomerOrderRepository;
import com.lisscompany.settings.SettingsService;
import com.lisscompany.shared.error.NotFoundException;
import com.lisscompany.shared.security.OwnerGuard;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;

/**
 * Pagamento visto pelo CLIENTE dono da encomenda: instruções (dados privados
 * da loja, só para quem tem a encomenda) e indicação da referência do
 * comprovativo. Indicar a referência nunca marca «pago».
 */
@RestController
@RequestMapping("/api/v1/orders/{orderNumber}/payment")
public class CustomerPaymentController {

    public record ProofRequest(
            @NotBlank(message = "Indique a referência do pagamento.")
            @Size(max = 200, message = "Referência demasiado longa.") String reference) {}

    public record InstructionsView(
            String status, String amount, SettingsService.PaymentInstructions instructions, String proofReference) {}

    private final PaymentService paymentService;
    private final CustomerOrderRepository orderRepository;
    private final SettingsService settings;
    private final OwnerGuard guard;

    public CustomerPaymentController(
            PaymentService paymentService, CustomerOrderRepository orderRepository, SettingsService settings,
            OwnerGuard guard) {
        this.paymentService = paymentService;
        this.orderRepository = orderRepository;
        this.settings = settings;
        this.guard = guard;
    }

    @GetMapping
    public InstructionsView instructions(@PathVariable String orderNumber) {
        var principal = guard.principal();
        CustomerOrder order = orderRepository.findByOrderNumber(orderNumber)
                .filter(o -> o.getUserId().equals(principal.id()))
                .orElseThrow(() -> new NotFoundException("ORDER_NOT_FOUND", "Encomenda não encontrada."));
        PaymentService.PaymentView view = paymentService.viewForOrder(orderNumber);
        return new InstructionsView(
                view.status(), view.amount(), settings.instructionsFor(order.getPaymentMethod()), view.proofReference());
    }

    @PostMapping("/proof")
    public PaymentService.PaymentView proof(
            @PathVariable String orderNumber, @jakarta.validation.Valid @RequestBody ProofRequest request) {
        var principal = guard.principal();
        return paymentService.submitProof(principal.id(), principal.email(), orderNumber, request.reference());
    }
}
