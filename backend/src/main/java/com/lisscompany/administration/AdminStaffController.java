package com.lisscompany.administration;

import java.util.List;
import java.util.Map;
import java.util.UUID;

import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

import com.lisscompany.identity.StaffService;
import com.lisscompany.shared.security.OwnerGuard;
import com.lisscompany.shared.security.Permissions;

/** Contas secundárias, papéis e permissões (permissão STAFF_MANAGE). */
@RestController
@RequestMapping("/api/v1/admin")
public class AdminStaffController {

    private final StaffService service;
    private final OwnerGuard guard;

    public AdminStaffController(StaffService service, OwnerGuard guard) {
        this.service = service;
        this.guard = guard;
    }

    @GetMapping("/staff")
    public List<StaffService.StaffView> staff() {
        guard.current(Permissions.STAFF_MANAGE);
        return service.staff();
    }

    @PostMapping("/staff")
    @ResponseStatus(HttpStatus.CREATED)
    public StaffService.CreatedStaff create(@RequestBody StaffService.CreateInput input) {
        return service.create(input, guard.current(Permissions.STAFF_MANAGE));
    }

    @PutMapping("/staff/{id}")
    public StaffService.StaffView update(@PathVariable UUID id, @RequestBody StaffService.UpdateInput input) {
        return service.update(id, input, guard.current(Permissions.STAFF_MANAGE));
    }

    @PostMapping("/staff/{id}/reset-password")
    public StaffService.CreatedStaff reset(@PathVariable UUID id) {
        return service.resetPassword(id, guard.current(Permissions.STAFF_MANAGE));
    }

    @GetMapping("/roles")
    public List<StaffService.RoleView> roles() {
        guard.current(Permissions.STAFF_MANAGE);
        return service.roles();
    }

    @PostMapping("/roles")
    @ResponseStatus(HttpStatus.CREATED)
    public StaffService.RoleView createRole(@RequestBody StaffService.RoleInput input) {
        return service.saveRole(null, input, guard.current(Permissions.STAFF_MANAGE));
    }

    @PutMapping("/roles/{id}")
    public StaffService.RoleView updateRole(@PathVariable UUID id, @RequestBody StaffService.RoleInput input) {
        return service.saveRole(id, input, guard.current(Permissions.STAFF_MANAGE));
    }

    @GetMapping("/permissions")
    public List<Map<String, Object>> permissions() {
        guard.current(Permissions.STAFF_MANAGE);
        return service.permissions();
    }
}
