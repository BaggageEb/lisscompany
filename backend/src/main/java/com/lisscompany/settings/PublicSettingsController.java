package com.lisscompany.settings;

import java.util.List;

import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import com.lisscompany.delivery.DeliveryService;

/** Informação pública da loja: contactos, levantamento, políticas, métodos e zonas de entrega. */
@RestController
@RequestMapping("/api/v1/public")
public class PublicSettingsController {

    public record StoreInfo(
            SettingsService.PublicSettings settings,
            /** Zonas activas com preço (as únicas que o cliente pode escolher). */
            List<DeliveryService.Zone> deliveryZones,
            DeliveryService.PublicDelivery delivery) {}

    private final SettingsService settings;
    private final DeliveryService delivery;

    public PublicSettingsController(SettingsService settings, DeliveryService delivery) {
        this.settings = settings;
        this.delivery = delivery;
    }

    @GetMapping("/store")
    public StoreInfo store() {
        return new StoreInfo(
                settings.publicView(),
                delivery.list(true).stream().filter(DeliveryService.Zone::priced).toList(),
                delivery.publicDelivery());
    }
}
