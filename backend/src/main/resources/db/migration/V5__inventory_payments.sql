-- =====================================================================
-- LISSCOMPANY — Fase 5: inventário e pagamentos
-- PostgreSQL 14+. Dinheiro em NUMERIC(12,2) (nunca double).
--
-- Regras comerciais (docs/decisions.md):
--   #2 stocks iniciais configuráveis, SEM consumo automático por receita
--      → as tabelas existem mas o seed é feito pelo painel (fase 7);
--      produtos sem linha de inventário são ilimitados (sem bloqueio).
--   #6 reserva ao criar encomenda, baixa ao confirmar pagamento;
--      StockReservation com expiração configurável (business_setting).
--   #4/#5 sem fornecedor automático: pagamento nasce PENDING e só muda
--      por revisão manual de conta autorizada; eventos idempotentes.
-- =====================================================================

-- ---------------------------------------------------------------------
-- Inventário: stock disponível por produto
-- ---------------------------------------------------------------------
CREATE TABLE inventory_item (
    id                UUID PRIMARY KEY DEFAULT GEN_RANDOM_UUID(),
    product_id        UUID        NOT NULL REFERENCES product (id) ON DELETE CASCADE,
    -- Quantidade disponível para venda. Sempre >= 0 (CHECK).
    available_qty     INTEGER     NOT NULL DEFAULT 0,
    -- Unidade legível para a loja («potes», «caixas»). Não afecta cálculos.
    unit_label        VARCHAR(30) NOT NULL DEFAULT 'un',
    updated_by        UUID        REFERENCES app_user (id),
    created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_inventory_item_product UNIQUE (product_id),
    CONSTRAINT ck_inventory_item_qty     CHECK (available_qty >= 0)
);

-- Movimentos imutáveis: todo o stock muda por movimento com motivo.
CREATE TABLE stock_movement (
    id             UUID PRIMARY KEY DEFAULT GEN_RANDOM_UUID(),
    product_id     UUID        NOT NULL REFERENCES product (id) ON DELETE RESTRICT,
    -- Δ assinado: positivo repõe, negativo baixa. Nunca zero.
    delta          INTEGER     NOT NULL,
    reason         VARCHAR(30) NOT NULL,
    -- Referência ao documento que originou o movimento (encomenda, ajuste…)
    order_id       UUID        REFERENCES customer_order (id) ON DELETE SET NULL,
    actor_user_id  UUID        REFERENCES app_user (id),
    note           VARCHAR(500),
    created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT ck_stock_movement_delta CHECK (delta <> 0),
    CONSTRAINT ck_stock_movement_reason CHECK (reason IN
        ('INITIAL_SETUP', 'MANUAL_ADJUSTMENT', 'RESERVED', 'RELEASED', 'SOLD', 'RETURNED'))
);

CREATE INDEX idx_stock_movement_product ON stock_movement (product_id, created_at DESC);

-- Reservas: quantidade segura para uma encomenda enquanto não é paga.
CREATE TABLE stock_reservation (
    id          UUID PRIMARY KEY DEFAULT GEN_RANDOM_UUID(),
    order_id    UUID        NOT NULL REFERENCES customer_order (id) ON DELETE CASCADE,
    product_id  UUID        NOT NULL REFERENCES product (id) ON DELETE CASCADE,
    quantity    INTEGER     NOT NULL,
    -- ACTIVE → CONSUMED (pagamento confirmado) | RELEASED (cancelada/expirada)
    status      VARCHAR(15) NOT NULL DEFAULT 'ACTIVE',
    -- Decisão #6: prazo configurável; NULL = sem expiração até decisão.
    expires_at  TIMESTAMPTZ,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT ck_stock_reservation_qty     CHECK (quantity > 0),
    CONSTRAINT ck_stock_reservation_status  CHECK (status IN ('ACTIVE', 'CONSUMED', 'RELEASED')),
    -- Uma encomenda tem no máximo uma reserva activa por produto.
    CONSTRAINT uq_stock_reservation_active UNIQUE (order_id, product_id, status)
);

CREATE INDEX idx_stock_reservation_active ON stock_reservation (product_id) WHERE status = 'ACTIVE';
CREATE INDEX idx_stock_reservation_expiry ON stock_reservation (expires_at) WHERE status = 'ACTIVE';

-- ---------------------------------------------------------------------
-- Pagamentos: um registo por encomenda, estado próprio (nunca o do cliente)
-- ---------------------------------------------------------------------
CREATE TABLE payment (
    id             UUID PRIMARY KEY DEFAULT GEN_RANDOM_UUID(),
    -- Uma encomenda tem no máximo um pagamento activo; reembolsos futuros
    -- nascem como novas linhas de payment_event, não como segunda tabela.
    order_id       UUID           NOT NULL REFERENCES customer_order (id) ON DELETE CASCADE,
    method         VARCHAR(30)    NOT NULL,
    amount         NUMERIC(12,2)  NOT NULL,
    currency       VARCHAR(3)     NOT NULL DEFAULT 'AOA',
    status         VARCHAR(20)    NOT NULL DEFAULT 'PENDING',
    -- Quem rever/confirmou (conta autorizada); NULL enquanto pendente.
    reviewed_by    UUID           REFERENCES app_user (id),
    reviewed_at    TIMESTAMPTZ,
    review_note    VARCHAR(500),
    created_at     TIMESTAMPTZ    NOT NULL DEFAULT NOW(),
    updated_at     TIMESTAMPTZ    NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_payment_order        UNIQUE (order_id),
    CONSTRAINT ck_payment_method       CHECK (method IN
        ('IBAN_TRANSFER', 'MULTICAIXA_EXPRESS', 'ON_DELIVERY')),
    CONSTRAINT ck_payment_currency     CHECK (currency = 'AOA'),
    CONSTRAINT ck_payment_status       CHECK (status IN
        ('PENDING', 'UNDER_REVIEW', 'PAID', 'FAILED', 'PARTIALLY_REFUNDED', 'REFUNDED')),
    CONSTRAINT ck_payment_amount       CHECK (amount >= 0)
);

CREATE INDEX idx_payment_status ON payment (status) WHERE status <> 'PAID';

-- Eventos de pagamento imutáveis e IDEMPOTENTES: a chave única impede que
-- o mesmo evento (ex.: comprovativo reenviado) duplique na base.
CREATE TABLE payment_event (
    id              UUID PRIMARY KEY DEFAULT GEN_RANDOM_UUID(),
    payment_id      UUID        NOT NULL REFERENCES payment (id) ON DELETE CASCADE,
    -- Chave de idempotência fornecida pelo cliente (ex.: «upload:…»); quando
    -- ausente, o servidor gera uma estável a partir do estado+timestamp.
    idempotency_key VARCHAR(120) NOT NULL,
    from_status     VARCHAR(20),
    to_status       VARCHAR(20) NOT NULL,
    actor_user_id   UUID        REFERENCES app_user (id),
    actor_label     VARCHAR(255),
    note            VARCHAR(500),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_payment_event_idem UNIQUE (payment_id, idempotency_key),
    CONSTRAINT ck_payment_event_from CHECK (from_status IS NULL OR from_status IN
        ('PENDING', 'UNDER_REVIEW', 'PAID', 'FAILED', 'PARTIALLY_REFUNDED', 'REFUNDED')),
    CONSTRAINT ck_payment_event_to   CHECK (to_status IN
        ('PENDING', 'UNDER_REVIEW', 'PAID', 'FAILED', 'PARTIALLY_REFUNDED', 'REFUNDED'))
);

CREATE INDEX idx_payment_event_payment ON payment_event (payment_id, created_at DESC);
