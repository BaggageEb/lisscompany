-- =====================================================================
-- LISSCOMPANY — Fase 4: encomendas (checkout)
-- PostgreSQL 14+. Dinheiro em NUMERIC(12,2) (nunca double).
--
-- A encomenda guarda um SNAPSHOT imutável do que foi confirmado no momento
-- da criação: nomes, preços, quantidade, composição do bolo e totais. Se o
-- catálogo mudar depois, o histórico continua a descrever o que se vendeu.
-- =====================================================================

-- Numeração sequencial legível do cliente (LC-000001). nextval não faz
-- rollback com a transacção: podem existir saltos, nunca repetições.
CREATE SEQUENCE order_number_seq START WITH 1;

CREATE TABLE customer_order (
    id                   UUID PRIMARY KEY DEFAULT GEN_RANDOM_UUID(),
    order_number         VARCHAR(20)   NOT NULL,
    user_id              UUID          NOT NULL REFERENCES app_user (id) ON DELETE RESTRICT,
    status               VARCHAR(20)   NOT NULL DEFAULT 'RECEIVED',
    -- Modalidade: levantamento na loja ou entrega (tarifas: decisão #3 pendente)
    fulfillment          VARCHAR(20)   NOT NULL,
    contact_name         VARCHAR(120)  NOT NULL,
    contact_phone        VARCHAR(30)   NOT NULL,
    notes                VARCHAR(500),
    -- Morada fornecida pelo cliente (fase 4 não inventa moradas nem tarifas)
    address_line1        VARCHAR(255),
    address_line2        VARCHAR(255),
    address_city         VARCHAR(120),
    address_municipality VARCHAR(120),
    payment_method       VARCHAR(30)   NOT NULL,
    subtotal             NUMERIC(12,2) NOT NULL,
    delivery_fee         NUMERIC(12,2) NOT NULL DEFAULT 0,
    total                NUMERIC(12,2) NOT NULL,
    currency             VARCHAR(3)    NOT NULL DEFAULT 'AOA',
    created_at           TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
    updated_at           TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_customer_order_number      UNIQUE (order_number),
    CONSTRAINT ck_customer_order_status      CHECK (status IN
        ('RECEIVED', 'CONFIRMED', 'PREPARING', 'READY', 'COMPLETED', 'CANCELLED')),
    CONSTRAINT ck_customer_order_fulfillment CHECK (fulfillment IN ('PICKUP', 'DELIVERY')),
    CONSTRAINT ck_customer_order_payment     CHECK (payment_method IN
        ('IBAN_TRANSFER', 'MULTICAIXA_EXPRESS', 'ON_DELIVERY')),
    CONSTRAINT ck_customer_order_currency    CHECK (currency = 'AOA'),
    CONSTRAINT ck_customer_order_amounts     CHECK (total = subtotal + delivery_fee),
    CONSTRAINT ck_customer_order_nonnegative CHECK (subtotal >= 0 AND delivery_fee >= 0 AND total >= 0),
    -- Entrega exige morada; levantamento não leva morada nenhuma.
    CONSTRAINT ck_customer_order_address     CHECK (
        (fulfillment = 'DELIVERY' AND address_line1 IS NOT NULL AND address_city IS NOT NULL)
        OR (fulfillment = 'PICKUP' AND address_line1 IS NULL AND address_line2 IS NULL
            AND address_city IS NULL AND address_municipality IS NULL)
    )
);

CREATE INDEX idx_customer_order_user   ON customer_order (user_id, created_at DESC);
CREATE INDEX idx_customer_order_status ON customer_order (status) WHERE status <> 'COMPLETED';

CREATE TABLE order_item (
    id         UUID PRIMARY KEY DEFAULT GEN_RANDOM_UUID(),
    order_id   UUID         NOT NULL REFERENCES customer_order (id) ON DELETE CASCADE,
    kind       VARCHAR(10)  NOT NULL,
    -- Snapshot: o nome/preço de VENDA, não a referência viva do catálogo
    name       VARCHAR(200) NOT NULL,
    unit_price NUMERIC(12,2) NOT NULL,
    quantity   INTEGER      NOT NULL,
    line_total NUMERIC(12,2) NOT NULL,
    -- Referência ao catálogo quando ainda existir (ON DELETE SET NULL preserva o histórico)
    product_id UUID         REFERENCES product (id) ON DELETE SET NULL,
    -- Snapshot da composição do Cake Studio (ingredientes + rótulos do momento)
    composition JSONB,
    created_at TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    CONSTRAINT ck_order_item_kind       CHECK (kind IN ('PRODUCT', 'CAKE')),
    CONSTRAINT ck_order_item_quantity   CHECK (quantity > 0),
    CONSTRAINT ck_order_item_price      CHECK (unit_price >= 0 AND line_total >= 0),
    CONSTRAINT ck_order_item_line_total CHECK (line_total = unit_price * quantity),
    -- Cada bol tem ou uma referência de produto ou uma composição, nunca as duas.
    CONSTRAINT ck_order_item_snapshot   CHECK (
        (kind = 'PRODUCT' AND composition IS NULL)
        OR (kind = 'CAKE' AND composition IS NOT NULL)
    )
);

CREATE INDEX idx_order_item_order ON order_item (order_id);
CREATE INDEX idx_order_item_product ON order_item (product_id) WHERE product_id IS NOT NULL;
