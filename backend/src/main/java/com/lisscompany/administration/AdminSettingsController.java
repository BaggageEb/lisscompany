package com.lisscompany.administration;

import java.util.List;
import java.util.Map;
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

import com.lisscompany.delivery.DeliveryService;
import com.lisscompany.settings.SettingsService;
import com.lisscompany.shared.security.OwnerGuard;
import com.lisscompany.shared.security.Permissions;

/** Definições da loja (contactos, pagamentos, levantamento, políticas) e zonas de entrega. */
@RestController
@RequestMapping("/api/v1/admin")
public class AdminSettingsController {

    private final SettingsService settings;
    private final DeliveryService delivery;
    private final OwnerGuard guard;

    public AdminSettingsController(SettingsService settings, DeliveryService delivery, OwnerGuard guard) {
        this.settings = settings;
        this.delivery = delivery;
        this.guard = guard;
    }

    @GetMapping("/settings")
    public Map<String, String> settings() {
        guard.current(Permissions.SETTINGS_MANAGE);
        return settings.all();
    }

    @PutMapping("/settings")
    public Map<String, String> update(@RequestBody Map<String, String> changes) {
        return settings.update(changes, guard.current(Permissions.SETTINGS_MANAGE));
    }

    /** Modo de entrega (preço fixo / por zonas / gratuita) e se já está operacional. */
    @GetMapping("/delivery/config")
    public DeliveryService.ConfigView deliveryConfig() {
        guard.current(Permissions.SETTINGS_MANAGE);
        return delivery.config();
    }

    @PutMapping("/delivery/config")
    public DeliveryService.ConfigView updateDeliveryConfig(@RequestBody DeliveryService.ConfigInput input) {
        return delivery.updateConfig(input, guard.current(Permissions.SETTINGS_MANAGE));
    }

    @GetMapping("/delivery-zones")
    public List<DeliveryService.Zone> zones() {
        guard.current(Permissions.SETTINGS_MANAGE);
        return delivery.list(false);
    }

    @PostMapping("/delivery-zones")
    @ResponseStatus(HttpStatus.CREATED)
    public DeliveryService.Zone createZone(@RequestBody DeliveryService.ZoneInput input) {
        return delivery.create(input, guard.current(Permissions.SETTINGS_MANAGE));
    }

    @PutMapping("/delivery-zones/{id}")
    public DeliveryService.Zone updateZone(@PathVariable UUID id, @RequestBody DeliveryService.ZoneInput input) {
        return delivery.update(id, input, guard.current(Permissions.SETTINGS_MANAGE));
    }

    @DeleteMapping("/delivery-zones/{id}")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void deleteZone(@PathVariable UUID id) {
        delivery.delete(id, guard.current(Permissions.SETTINGS_MANAGE));
    }
}
