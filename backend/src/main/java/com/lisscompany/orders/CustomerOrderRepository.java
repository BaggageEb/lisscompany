package com.lisscompany.orders;

import java.util.List;
import java.util.Optional;
import java.util.UUID;

import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;

public interface CustomerOrderRepository extends JpaRepository<CustomerOrder, UUID> {

    /**
     * Próximo número de encomenda ({@code LC-000001}) da sequência da V4.
     * {@code nextval} não participa na transacção: um rollback deixa um salto,
     * nunca um número repetido (a unicidade está garantida pela constraint).
     */
    @Query(value = "SELECT nextval('order_number_seq')", nativeQuery = true)
    long nextOrderSequence();

    List<CustomerOrder> findByUserIdOrderByCreatedAtDesc(UUID userId);

    /** Encomendas do painel administrativo, mais recentes primeiro (fase 7). */
    @Query("SELECT o FROM CustomerOrder o ORDER BY o.createdAt DESC")
    List<CustomerOrder> findForPanel(Pageable pageable);

    /**
     * Encomendas não canceladas de um cliente — a contagem por trás da
     * condição cumulativa de recompensas (#13) e do desconto de boas-vindas.
     */
    long countByUserIdAndStatusNot(UUID userId, OrderStatus status);

    Optional<CustomerOrder> findByOrderNumber(String orderNumber);

    /** Com linhas carregadas — para fora da transacção (ex.: testes a verificar snapshots). */
    @Query("SELECT o FROM CustomerOrder o LEFT JOIN FETCH o.items WHERE o.orderNumber = :orderNumber")
    Optional<CustomerOrder> findByOrderNumberWithItems(@org.springframework.data.repository.query.Param("orderNumber") String orderNumber);
}
