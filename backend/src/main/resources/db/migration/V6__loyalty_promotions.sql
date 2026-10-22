-- V6: Fidelização (pontos, metas, recompensas) e promoções (descontos).
--
-- Princípio desta migração: NENHUM valor de negócio é presumido. As taxas de
-- acumulação, a conversão pontos↔Kz, o arredondamento, os valores de desconto
-- e os limiares das recompensas vivem nestas tabelas vazias até a proprietária
-- os configurar através do painel/administrativo. Programa não configurado =
-- inactivo por omissão (nenhum cliente ganha nem gasta pontos).

-- ---------------------------------------------------------------------------
-- 1. Regra de fidelização: linha única de configuração (audit_log guarda o
--    histórico de alterações; só existe uma linha activa).
-- ---------------------------------------------------------------------------
CREATE TABLE loyalty_rule (
    id                      UUID PRIMARY KEY,
    earn_percent            NUMERIC(5, 2) NOT NULL CHECK (earn_percent > 0 AND earn_percent <= 100),
    point_value_kz          NUMERIC(12, 4) NOT NULL CHECK (point_value_kz > 0),
    rounding                VARCHAR(10) NOT NULL CHECK (rounding IN ('DOWN', 'HALF_UP')),
    allow_partial_redemption BOOLEAN NOT NULL,
    active                  BOOLEAN NOT NULL,
    created_by              UUID,
    updated_by              UUID,
    created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at              TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Exactamente uma linha de configuração (o histórico fica no audit_log).
CREATE UNIQUE INDEX uq_loyalty_rule_single ON loyalty_rule ((1));

-- ---------------------------------------------------------------------------
-- 2. Conta de fidelização por cliente (criada sob procura).
-- ---------------------------------------------------------------------------
CREATE TABLE loyalty_account (
    id                 UUID PRIMARY KEY,
    user_id            UUID NOT NULL REFERENCES app_user (id),
    points_balance     INTEGER NOT NULL DEFAULT 0 CHECK (points_balance >= 0),
    lifetime_points    INTEGER NOT NULL DEFAULT 0 CHECK (lifetime_points >= 0),
    created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX uq_loyalty_account_user ON loyalty_account (user_id);

-- ---------------------------------------------------------------------------
-- 3. Livro-razão imutável de pontos. Cada movimento arquiva a taxa em vigor
--    naquele momento (decisão #9: pontos invariantes — mudar a conversão nunca
--    reescreve movimentos antigos).
-- ---------------------------------------------------------------------------
CREATE TABLE loyalty_transaction (
    id           UUID PRIMARY KEY,
    account_id   UUID NOT NULL REFERENCES loyalty_account (id),
    order_id     UUID REFERENCES customer_order (id),
    type         VARCHAR(20) NOT NULL CHECK (type IN ('EARN', 'REDEEM', 'ADJUSTMENT')),
    points       INTEGER NOT NULL CHECK (points <> 0),
    rate_kind    VARCHAR(20) NOT NULL CHECK (rate_kind IN ('EARN_PERCENT', 'POINT_VALUE')),
    rate_used    NUMERIC(12, 4) NOT NULL CHECK (rate_used > 0),
    amount_kz    NUMERIC(12, 2) NOT NULL DEFAULT 0 CHECK (amount_kz >= 0),
    note         VARCHAR(200),
    created_by   UUID,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Idempotência: uma encomenda nunca credita (nem gasta) pontos duas vezes.
CREATE UNIQUE INDEX uq_loyalty_txn_order_type
    ON loyalty_transaction (order_id, type) WHERE order_id IS NOT NULL;
CREATE INDEX ix_loyalty_txn_account ON loyalty_transaction (account_id, created_at DESC);

-- ---------------------------------------------------------------------------
-- 4. Recompensas: metas (pontos) e condição cumulativa (pontos E encomendas),
--    ambas obrigatórias para a recompensa da meta. Valores 100% configurados.
-- ---------------------------------------------------------------------------
CREATE TABLE reward_rule (
    id                 UUID PRIMARY KEY,
    code               VARCHAR(40) NOT NULL UNIQUE,
    description        VARCHAR(200) NOT NULL,
    min_points         INTEGER CHECK (min_points IS NULL OR min_points > 0),
    min_orders         INTEGER CHECK (min_orders IS NULL OR min_orders > 0),
    discount_amount    NUMERIC(12, 2) NOT NULL CHECK (discount_amount > 0),
    max_per_customer   INTEGER NOT NULL CHECK (max_per_customer >= 1),
    active             BOOLEAN NOT NULL DEFAULT FALSE,
    created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT ck_reward_rule_condition CHECK (min_points IS NOT NULL OR min_orders IS NOT NULL)
);

-- Resgate de uma recompensa: uma por encomenda.
CREATE TABLE reward_redemption (
    id              UUID PRIMARY KEY,
    order_id        UUID NOT NULL UNIQUE REFERENCES customer_order (id),
    account_id      UUID NOT NULL REFERENCES loyalty_account (id),
    reward_rule_id  UUID NOT NULL REFERENCES reward_rule (id),
    discount_amount NUMERIC(12, 2) NOT NULL CHECK (discount_amount >= 0),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX ix_reward_redemption_account ON reward_redemption (account_id);

-- ---------------------------------------------------------------------------
-- 5. Descontos: catálogo de regras (boas-vindas, recompensa) com prioridade.
--    Decisão #11: exactamente UM desconto por encomenda; a hierarquia entre
--    regras activas é configurada pela proprietária (prioridades distintas).
-- ---------------------------------------------------------------------------
CREATE TABLE discount_rule (
    id             UUID PRIMARY KEY,
    code           VARCHAR(40) NOT NULL UNIQUE,
    description    VARCHAR(200) NOT NULL,
    kind           VARCHAR(20) NOT NULL CHECK (kind IN ('WELCOME', 'REWARD')),
    percent        NUMERIC(5, 2) CHECK (percent IS NULL OR (percent > 0 AND percent <= 100)),
    amount         NUMERIC(12, 2) CHECK (amount IS NULL OR amount > 0),
    reward_rule_id UUID REFERENCES reward_rule (id),
    priority       INTEGER NOT NULL CHECK (priority >= 1),
    active         BOOLEAN NOT NULL DEFAULT FALSE,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT ck_discount_rule_welcome CHECK (
        (kind = 'WELCOME' AND percent IS NOT NULL AND amount IS NULL AND reward_rule_id IS NULL)
        OR (kind = 'REWARD' AND reward_rule_id IS NOT NULL AND (percent IS NOT NULL) <> (amount IS NOT NULL))
    )
);

-- Um desconto por encomenda, com proveniência explícita (decisão #11).
CREATE TABLE discount_application (
    id               UUID PRIMARY KEY,
    order_id         UUID NOT NULL UNIQUE REFERENCES customer_order (id),
    discount_rule_id UUID REFERENCES discount_rule (id),
    source           VARCHAR(20) NOT NULL CHECK (source IN ('WELCOME', 'REWARD', 'POINTS')),
    label            VARCHAR(120) NOT NULL,
    amount           NUMERIC(12, 2) NOT NULL CHECK (amount >= 0),
    points_spent     INTEGER NOT NULL DEFAULT 0 CHECK (points_spent >= 0),
    created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- 6. Snapshot do desconto na encomenda: o total passa a ser
--    total = subtotal + entrega − desconto (o total já incluído é sempre o
--    valor confirmado pelo servidor; o cliente nunca calcula preço).
-- ---------------------------------------------------------------------------
ALTER TABLE customer_order
    ADD COLUMN discount_amount NUMERIC(12, 2) NOT NULL DEFAULT 0,
    ADD COLUMN discount_label VARCHAR(120),
    ADD COLUMN points_spent INTEGER NOT NULL DEFAULT 0,
    DROP CONSTRAINT ck_customer_order_amounts,
    ADD CONSTRAINT ck_customer_order_amounts
        CHECK (total = subtotal + delivery_fee - discount_amount),
    ADD CONSTRAINT ck_customer_order_discount
        CHECK (discount_amount >= 0 AND discount_amount <= subtotal AND points_spent >= 0);
