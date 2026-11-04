package com.lisscompany.loyalty;

import java.util.List;
import java.util.UUID;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

/**
 * Expira automaticamente os pontos vencidos, uma vez por hora.
 *
 * <p>É uma rede de segurança: mesmo sem este varrimento, qualquer gasto ou
 * crédito de pontos retira primeiro os pontos vencidos da conta
 * ({@code LoyaltyService.accountFor}), pelo que um ponto expirado nunca pode
 * ser utilizado. O varrimento garante que os saldos e o histórico ficam
 * correctos também para quem não volta à loja.
 *
 * <p>Cada conta é tratada na sua própria transacção: uma falha numa conta
 * não impede as restantes.
 */
@Component
public class PointsExpiryScheduler {

    private static final Logger log = LoggerFactory.getLogger(PointsExpiryScheduler.class);

    private final LoyaltyService loyaltyService;

    public PointsExpiryScheduler(LoyaltyService loyaltyService) {
        this.loyaltyService = loyaltyService;
    }

    @Scheduled(cron = "${app.loyalty.expiry-cron:0 7 * * * *}")
    public void sweep() {
        List<UUID> accounts = loyaltyService.accountsWithDueLots();
        int expired = 0;
        for (UUID accountId : accounts) {
            try {
                expired += loyaltyService.expireAccount(accountId);
            } catch (RuntimeException ex) {
                log.warn("Falha a expirar pontos da conta {}: {}", accountId, ex.toString());
            }
        }
        if (!accounts.isEmpty()) {
            log.info("Expiração de pontos: {} conta(s) tratada(s), {} ponto(s) expirado(s)", accounts.size(), expired);
        }
    }
}
