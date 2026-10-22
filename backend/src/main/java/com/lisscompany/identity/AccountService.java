package com.lisscompany.identity;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;

import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import com.lisscompany.audit.AuditService;
import com.lisscompany.shared.error.ConflictException;
import com.lisscompany.shared.error.InvalidRequestException;
import com.lisscompany.shared.error.NotFoundException;

/**
 * Área do cliente (fase 7): perfil, moradas guardadas e alteração de
 * palavra-passe.
 *
 * <p>Regras: tudo é por <strong>dono</strong> — o identificador vem sempre da
 * sessão, nunca do pedido. A palavra-passe nova segue as mesmas regras do
 * registo (8–72 caracteres, hash BCrypt) e exige a actual correcta; depois de
 * gravada, a sessão actual continua válida (a app autentica por hash, não por
 * comparação de sessão) e as <strong>outras</strong> sessões terminam. Cada
 * alteração sensível gera auditoria.
 */
@Service
public class AccountService {

    /** Limite honesto por conta: evita crescimento sem limite no painel. */
    private static final int MAX_ADDRESSES = 20;

    private final AppUserRepository userRepository;
    private final CustomerProfileRepository profileRepository;
    private final AddressRepository addressRepository;
    private final PasswordEncoder passwordEncoder;
    private final AuditService auditService;
    private final UserSessionRegistry sessionRegistry;

    public AccountService(
            AppUserRepository userRepository,
            CustomerProfileRepository profileRepository,
            AddressRepository addressRepository,
            PasswordEncoder passwordEncoder,
            AuditService auditService,
            UserSessionRegistry sessionRegistry) {
        this.userRepository = userRepository;
        this.profileRepository = profileRepository;
        this.addressRepository = addressRepository;
        this.passwordEncoder = passwordEncoder;
        this.auditService = auditService;
        this.sessionRegistry = sessionRegistry;
    }

    /* ------------------------------- Views ------------------------------- */

    public record ProfileView(String id, String email, String displayName, String phone) {}

    public record ProfileInput(String displayName, String phone) {}

    public record ChangePasswordInput(String currentPassword, String newPassword) {}

    public record AddressView(
            String id,
            String label,
            String recipientName,
            String line1,
            String line2,
            String city,
            String municipality,
            String province,
            String phone,
            boolean isDefault) {}

    public record AddressInput(
            String label,
            String recipientName,
            String line1,
            String line2,
            String city,
            String municipality,
            String province,
            String phone,
            Boolean isDefault) {}

    /* ------------------------------ Perfil ------------------------------- */

    @Transactional(readOnly = true)
    public ProfileView profile(CustomerPrincipal principal) {
        AppUser user = requireUser(principal.id());
        return new ProfileView(
                user.getId().toString(), user.getEmail(), user.getDisplayName(), phoneOf(user.getId()));
    }

    /** Actualiza nome a mostrar e telefone do perfil (upsert do telefone). */
    @Transactional
    public ProfileView updateProfile(CustomerPrincipal principal, ProfileInput input) {
        Map<String, String> errors = new LinkedHashMap<>();
        String displayName = input.displayName() == null ? null : input.displayName().trim();
        if (displayName == null || displayName.length() < 2 || displayName.length() > 120) {
            errors.put("displayName", "O nome deve ter entre 2 e 120 caracteres.");
        }
        String phone = blankToNull(input.phone());
        if (phone != null && phone.length() > 30) {
            errors.put("phone", "Telefone demasiado longo.");
        }
        if (!errors.isEmpty()) {
            throw new InvalidRequestException(errors);
        }

        AppUser user = requireUser(principal.id());
        user.setDisplayName(displayName);
        userRepository.save(user);

        CustomerProfile profile = profileRepository.findById(user.getId()).orElseGet(() -> {
            CustomerProfile created = new CustomerProfile();
            created.setId(user.getId());
            return created;
        });
        profile.setPhone(phone);
        profileRepository.save(profile);

        auditService.record(
                user.getId(), user.getEmail(), "customer.profile_updated", "app_user",
                user.getId().toString(),
                "Perfil actualizado (nome: %s · telefone: %s)".formatted(displayName, phone == null ? "sem" : "preenchido"));

        return new ProfileView(user.getId().toString(), user.getEmail(), user.getDisplayName(), phone);
    }

    /* --------------------------- Palavra-passe --------------------------- */

    /**
     * Altera a palavra-passe: a actual tem de estar correcta (senão 422 com o
     * campo), a nova segue as regras do registo e o hash é reescrito. Nenhuma
     * palavra-passe em texto sai ou entra em logs. As outras sessões da conta
     * terminam com a alteração — uma sessão roubada perde-se na rotação.
     */
    @Transactional
    public void changePassword(
            CustomerPrincipal principal,
            ChangePasswordInput input,
            jakarta.servlet.http.HttpServletRequest request) {
        Map<String, String> errors = new LinkedHashMap<>();
        String current = input.currentPassword() == null ? "" : input.currentPassword();
        String next = input.newPassword() == null ? "" : input.newPassword();
        if (next.length() < 8 || next.length() > 72) {
            errors.put("newPassword", "A palavra-passe deve ter entre 8 e 72 caracteres.");
        }
        if (!errors.isEmpty()) {
            throw new InvalidRequestException(errors);
        }

        AppUser user = requireUser(principal.id());
        String hash = user.getPasswordHash();
        if (hash == null || !passwordEncoder.matches(current, hash)) {
            throw new InvalidRequestException(Map.of(
                    "currentPassword", "A palavra-passe actual não corresponde."));
        }
        if (passwordEncoder.matches(next, hash)) {
            throw new InvalidRequestException(Map.of(
                    "newPassword", "A nova palavra-passe tem de ser diferente da actual."));
        }

        user.setPasswordHash(passwordEncoder.encode(next));
        userRepository.save(user);

        // As outras sessões terminam com a alteração (a actual mantém-se).
        var session = request.getSession(false);
        int revoked = session == null ? 0 : sessionRegistry.revokeAllExcept(user.getId(), session.getId());

        auditService.record(
                user.getId(), user.getEmail(), "auth.password_changed", "app_user",
                user.getId().toString(),
                "Palavra-passe alterada pela própria conta."
                        + (revoked > 0 ? " " + revoked + " sessão(ões) terminada(s)." : ""));
    }

    /* ------------------------------ Moradas ------------------------------ */

    @Transactional(readOnly = true)
    public List<AddressView> addresses(CustomerPrincipal principal) {
        return addressRepository.findByUserIdOrderByUpdatedAtDesc(principal.id()).stream()
                .map(AccountService::view)
                .toList();
    }

    @Transactional
    public AddressView createAddress(CustomerPrincipal principal, AddressInput input) {
        if (addressRepository.countByUserId(principal.id()) >= MAX_ADDRESSES) {
            throw new ConflictException(
                    "ADDRESS_LIMIT",
                    "Atingiu o máximo de " + MAX_ADDRESSES + " moradas guardadas. Remova uma antes de adicionar outra.");
        }
        Address address = apply(new Address(), input, principal.id(), true);
        address.setDefaultAddress(Boolean.TRUE.equals(input.isDefault()));
        if (address.isDefaultAddress()) {
            clearOtherDefaults(principal.id(), null);
        }
        Address saved = addressRepository.save(address);
        auditService.record(
                principal.id(), principal.email(), "customer.address_created", "address",
                saved.getId().toString(), "Morada criada: " + summary(saved));
        return view(saved);
    }

    @Transactional
    public AddressView updateAddress(CustomerPrincipal principal, UUID addressId, AddressInput input) {
        Address address = requireOwned(principal.id(), addressId);
        apply(address, input, principal.id(), false);
        address.setDefaultAddress(Boolean.TRUE.equals(input.isDefault()));
        if (address.isDefaultAddress()) {
            clearOtherDefaults(principal.id(), addressId);
        }
        Address saved = addressRepository.save(address);
        auditService.record(
                principal.id(), principal.email(), "customer.address_updated", "address",
                saved.getId().toString(), "Morada actualizada: " + summary(saved));
        return view(saved);
    }

    @Transactional
    public void deleteAddress(CustomerPrincipal principal, UUID addressId) {
        Address address = requireOwned(principal.id(), addressId);
        addressRepository.delete(address);
        auditService.record(
                principal.id(), principal.email(), "customer.address_deleted", "address",
                addressId.toString(), "Morada removida: " + summary(address));
    }

    /* ------------------------------ Internos ----------------------------- */

    private Address apply(Address address, AddressInput input, UUID userId, boolean creating) {
        Map<String, String> errors = new LinkedHashMap<>();
        String line1 = input.line1() == null ? null : input.line1().trim();
        String city = input.city() == null ? null : input.city().trim();
        if (line1 == null || line1.isEmpty()) {
            errors.put("line1", "A morada (linha 1) é obrigatória.");
        }
        if (city == null || city.isEmpty()) {
            errors.put("city", "A cidade é obrigatória.");
        }
        if (!errors.isEmpty()) {
            throw new InvalidRequestException(errors);
        }
        if (creating) {
            address.setUserId(userId);
        }
        address.setLabel(blankToNull(input.label()));
        address.setRecipientName(blankToNull(input.recipientName()));
        address.setLine1(line1);
        address.setLine2(blankToNull(input.line2()));
        address.setCity(city);
        address.setMunicipality(blankToNull(input.municipality()));
        address.setProvince(blankToNull(input.province()));
        address.setPhone(blankToNull(input.phone()));
        return address;
    }

    /** Marca uma única predefinida: as outras da conta ficam false. */
    private void clearOtherDefaults(UUID userId, UUID keepId) {
        for (Address other : addressRepository.findByUserId(userId)) {
            if (other.isDefaultAddress() && (keepId == null || !other.getId().equals(keepId))) {
                other.setDefaultAddress(false);
                addressRepository.save(other);
            }
        }
    }

    private Address requireOwned(UUID userId, UUID addressId) {
        return addressRepository.findByIdAndUserId(addressId, userId)
                .orElseThrow(() -> new NotFoundException("ADDRESS_NOT_FOUND", "Morada não encontrada."));
    }

    private AppUser requireUser(UUID userId) {
        return userRepository.findById(userId)
                .orElseThrow(() -> new NotFoundException("USER_NOT_FOUND", "Conta não encontrada."));
    }

    private String phoneOf(UUID userId) {
        return profileRepository.findById(userId).map(CustomerProfile::getPhone).orElse(null);
    }

    private static AddressView view(Address address) {
        return new AddressView(
                address.getId().toString(),
                address.getLabel(),
                address.getRecipientName(),
                address.getLine1(),
                address.getLine2(),
                address.getCity(),
                address.getMunicipality(),
                address.getProvince(),
                address.getPhone(),
                address.isDefaultAddress());
    }

    private static String summary(Address address) {
        return "%s, %s%s".formatted(address.getLine1(), address.getCity(),
                address.isDefaultAddress() ? " (predefinida)" : "");
    }

    private static String blankToNull(String value) {
        return value == null || value.isBlank() ? null : value.trim();
    }
}
