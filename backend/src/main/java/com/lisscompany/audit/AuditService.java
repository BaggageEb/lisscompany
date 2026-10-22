package com.lisscompany.audit;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;

import java.util.UUID;

/**
 * Serviço de auditoria.
 *
 * <p>Grava uma linha por ação sensível. Usa {@link Propagation#MANDATORY} para
 * operações que já correm numa transacção de negócio — o registo de auditoria
 * faz parte da mesma unidade atómica que a alteração que descreve. Não pode
 * falhar em silêncio nem criar transacções surpresa.
 */
@Service
public class AuditService {

    private static final Logger log = LoggerFactory.getLogger(AuditService.class);

    private final AuditRepository repository;

    public AuditService(AuditRepository repository) {
        this.repository = repository;
    }

    @Transactional(propagation = Propagation.MANDATORY)
    public AuditLog record(
            UUID actorUserId, String actorLabel, String action,
            String entityType, String entityId, String details) {
        AuditLog entry = new AuditLog();
        entry.setAction(truncate(action, 100));
        entry.setEntityType(truncate(entityType, 100));
        entry.setEntityId(truncate(entityId, 100));
        entry.setActorUserId(actorUserId);
        entry.setActorLabel(truncate(actorLabel, 255));
        entry.setDetails(truncate(details, 2000));
        AuditLog saved = repository.save(entry);
        log.info("AUDIT action={} actor={} entity={}{}",
                action, actorUserId, entityType, entityId == null ? "" : "/" + entityId);
        return saved;
    }

    private static String truncate(String value, int max) {
        if (value == null || value.length() <= max) {
            return value;
        }
        return value.substring(0, max - 1) + "…";
    }
}
