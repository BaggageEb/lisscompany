package com.lisscompany.orders;

/**
 * Método de pagamento escolhido no checkout (README: transferência IBAN,
 * Multicaixa Express e pagamento na entrega/levantamento).
 *
 * <p>A fase 4 apenas <em>regista</em> a escolha: a validação manual do
 * comprovativo e o estado {@code PAID} são da fase 5, e os dados bancários
 * editáveis do painel, da fase 7. Nenhum valor bancário é guardado aqui.
 */
public enum PaymentMethod {
    /** Transferência para o IBAN da loja (validação manual depois). */
    IBAN_TRANSFER,
    /** Multicaixa Express (validação manual depois). */
    MULTICAIXA_EXPRESS,
    /** Pagamento no momento da entrega ou do levantamento. */
    ON_DELIVERY
}
