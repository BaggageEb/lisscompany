-- =====================================================================
-- LISSCOMPANY — Fase 2: catálogo e ingredientes do Cake Studio
-- PostgreSQL 14+. Dinheiro em NUMERIC(12,2) (nunca double).
-- O schema muda apenas por migração (ddl-auto: none).
-- =====================================================================

CREATE TABLE product_category (
    id            UUID PRIMARY KEY DEFAULT GEN_RANDOM_UUID(),
    slug          VARCHAR(120) NOT NULL,
    name          VARCHAR(160) NOT NULL,
    description   VARCHAR(1000),
    display_order INTEGER      NOT NULL DEFAULT 0,
    created_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    updated_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_product_category_slug UNIQUE (slug)
);

CREATE TABLE product (
    id                  UUID PRIMARY KEY DEFAULT GEN_RANDOM_UUID(),
    category_id         UUID           NOT NULL REFERENCES product_category (id) ON DELETE RESTRICT,
    slug                VARCHAR(160)   NOT NULL,
    name                VARCHAR(200)   NOT NULL,
    description         VARCHAR(4000)  NOT NULL DEFAULT '',
    base_price          NUMERIC(12,2)  NOT NULL,
    currency            VARCHAR(3)     NOT NULL DEFAULT 'AOA',
    status              VARCHAR(20)    NOT NULL DEFAULT 'ACTIVE',
    is_cake_studio_base BOOLEAN        NOT NULL DEFAULT FALSE,
    image_url           VARCHAR(500),
    created_at          TIMESTAMPTZ    NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ    NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_product_slug        UNIQUE (slug),
    CONSTRAINT ck_product_slug_lower  CHECK (slug = LOWER(slug)),
    CONSTRAINT ck_product_price       CHECK (base_price >= 0),
    CONSTRAINT ck_product_currency    CHECK (currency = 'AOA'),
    CONSTRAINT ck_product_status      CHECK (status IN ('DRAFT', 'ACTIVE', 'HIDDEN'))
);

-- Só existe um produto-base ACTIVO do Cake Studio de cada vez.
CREATE UNIQUE INDEX uq_product_cake_studio_base ON product (is_cake_studio_base)
    WHERE is_cake_studio_base AND status = 'ACTIVE';

CREATE INDEX idx_product_status ON product (status) WHERE status = 'ACTIVE';

CREATE TABLE ingredient (
    id            UUID PRIMARY KEY DEFAULT GEN_RANDOM_UUID(),
    kind          VARCHAR(20)   NOT NULL,
    slug          VARCHAR(120)  NOT NULL,
    name          VARCHAR(160)  NOT NULL,
    description   VARCHAR(1000) NOT NULL DEFAULT '',
    price_delta   NUMERIC(12,2) NOT NULL DEFAULT 0,
    display_order INTEGER       NOT NULL DEFAULT 0,
    active        BOOLEAN       NOT NULL DEFAULT TRUE,
    image_url     VARCHAR(500),
    created_at    TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
    updated_at    TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_ingredient_slug     UNIQUE (slug),
    CONSTRAINT ck_ingredient_kind     CHECK (kind IN ('CAKE_BASE', 'FILLING', 'EXTRA')),
    CONSTRAINT ck_ingredient_delta    CHECK (price_delta >= 0)
);

CREATE INDEX idx_ingredient_kind ON ingredient (kind) WHERE active;
