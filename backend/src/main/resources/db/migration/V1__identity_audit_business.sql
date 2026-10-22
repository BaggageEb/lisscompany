-- =====================================================================
-- LISSCOMPANY — Fase 1: identidade, auditoria e definições de negócio
-- PostgreSQL 14+. Todos os timestamps em UTC (timestamptz).
-- Dinheiro: NUMERIC com precisão decimal explícita, nunca double.
-- =====================================================================

-- ---------------------------------------------------------------------
-- Auditoria: registos imutáveis de ações administrativas/operacionais
-- ---------------------------------------------------------------------
CREATE TABLE audit_log (
    id             BIGSERIAL PRIMARY KEY,
    action         VARCHAR(100)  NOT NULL,
    entity_type    VARCHAR(100),
    entity_id      VARCHAR(100),
    actor_user_id  UUID,
    actor_label    VARCHAR(255),
    details        VARCHAR(2000),
    created_at     TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_audit_log_entity   ON audit_log (entity_type, entity_id);
CREATE INDEX idx_audit_log_created  ON audit_log (created_at DESC);
CREATE INDEX idx_audit_log_actor    ON audit_log (actor_user_id);

-- ---------------------------------------------------------------------
-- Identidade: utilizadores, papéis, permissões
-- ---------------------------------------------------------------------
CREATE TABLE app_user (
    id              UUID PRIMARY KEY DEFAULT GEN_RANDOM_UUID(),
    email           VARCHAR(320) NOT NULL,
    password_hash   VARCHAR(255),
    display_name    VARCHAR(120) NOT NULL,
    status          VARCHAR(20)  NOT NULL DEFAULT 'ACTIVE',
    email_verified  BOOLEAN      NOT NULL DEFAULT FALSE,
    is_owner        BOOLEAN      NOT NULL DEFAULT FALSE,
    failed_login_attempts SMALLINT NOT NULL DEFAULT 0,
    locked_until    TIMESTAMPTZ,
    last_login_at   TIMESTAMPTZ,
    created_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_app_user_email   UNIQUE (email),
    CONSTRAINT ck_app_user_status  CHECK (status IN ('ACTIVE', 'DISABLED', 'PENDING'))
);

CREATE INDEX idx_app_user_status ON app_user (status);

CREATE TABLE role (
    id          UUID PRIMARY KEY DEFAULT GEN_RANDOM_UUID(),
    code        VARCHAR(50)  NOT NULL,
    name        VARCHAR(120) NOT NULL,
    is_system   BOOLEAN      NOT NULL DEFAULT FALSE,
    created_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    updated_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_role_code UNIQUE (code)
);

CREATE TABLE permission (
    id          UUID PRIMARY KEY DEFAULT GEN_RANDOM_UUID(),
    code        VARCHAR(80)  NOT NULL,
    description VARCHAR(255) NOT NULL,
    CONSTRAINT uq_permission_code UNIQUE (code)
);

CREATE TABLE user_role (
    user_id     UUID        NOT NULL REFERENCES app_user (id) ON DELETE CASCADE,
    role_id     UUID        NOT NULL REFERENCES role (id)     ON DELETE CASCADE,
    granted_by  UUID        REFERENCES app_user (id),
    granted_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (user_id, role_id)
);

CREATE INDEX idx_user_role_role ON user_role (role_id);

CREATE TABLE role_permission (
    role_id       UUID NOT NULL REFERENCES role (id)       ON DELETE CASCADE,
    permission_id UUID NOT NULL REFERENCES permission (id) ON DELETE CASCADE,
    PRIMARY KEY (role_id, permission_id)
);

-- ---------------------------------------------------------------------
-- Perfil do cliente e moradas (o cliente só acede às suas)
-- ---------------------------------------------------------------------
CREATE TABLE customer_profile (
    user_id           UUID PRIMARY KEY REFERENCES app_user (id) ON DELETE CASCADE,
    phone             VARCHAR(30),
    preferred_contact VARCHAR(20) NOT NULL DEFAULT 'PHONE',
    notes             VARCHAR(500),
    created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT ck_customer_profile_contact CHECK (preferred_contact IN ('PHONE', 'EMAIL', 'WHATSAPP'))
);

CREATE TABLE address (
    id             UUID PRIMARY KEY DEFAULT GEN_RANDOM_UUID(),
    user_id        UUID        NOT NULL REFERENCES app_user (id) ON DELETE CASCADE,
    label          VARCHAR(50),
    recipient_name VARCHAR(120),
    line1          VARCHAR(255) NOT NULL,
    line2          VARCHAR(255),
    city           VARCHAR(120) NOT NULL,
    municipality   VARCHAR(120),
    province       VARCHAR(120),
    phone          VARCHAR(30),
    is_default     BOOLEAN     NOT NULL DEFAULT FALSE,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_address_user ON address (user_id);

-- ---------------------------------------------------------------------
-- Definições de negócio: chave/valor tipado, editável pela proprietária
-- (pagamentos, entrega, fidelização, contactos — sem segredos em código)
-- ---------------------------------------------------------------------
CREATE TABLE business_setting (
    key         VARCHAR(100) PRIMARY KEY,
    value       TEXT        NOT NULL,
    value_type  VARCHAR(20) NOT NULL DEFAULT 'STRING',
    description VARCHAR(255),
    updated_by  UUID        REFERENCES app_user (id),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT ck_business_setting_type CHECK (value_type IN ('STRING', 'NUMBER', 'BOOLEAN', 'JSON'))
);
