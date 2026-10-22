package com.lisscompany.identity;

import java.util.List;
import java.util.Optional;
import java.util.UUID;

import org.springframework.data.jpa.repository.JpaRepository;

/** Moradas por utilizador — toda a consulta é por {@code userId} (dono). */
public interface AddressRepository extends JpaRepository<Address, UUID> {

    List<Address> findByUserIdOrderByUpdatedAtDesc(UUID userId);

    Optional<Address> findByIdAndUserId(UUID id, UUID userId);

    long countByUserId(UUID userId);

    /** Moradas por utilizador ordenadas para marcar/remover a predefinida. */
    List<Address> findByUserId(UUID userId);

    void deleteByIdAndUserId(UUID id, UUID userId);
}
