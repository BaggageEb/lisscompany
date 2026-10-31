-- =====================================================================
-- LISSCOMPANY — V7: sistema de gestão (painel), RBAC, entrega, reembolsos,
-- notificações e correcções de conformidade com o prompt mestre.
-- Nenhum valor comercial é inventado: zonas, tarifas, contactos, dados
-- bancários e políticas nascem vazios e são configurados no painel.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. RBAC: permissões e papéis de sistema (a proprietária tem tudo via is_owner)
-- ---------------------------------------------------------------------
INSERT INTO permission (code, description) VALUES
    ('DASHBOARD_VIEW',  'Ver o painel de resumo'),
    ('ORDERS_VIEW',     'Consultar encomendas'),
    ('ORDERS_MANAGE',   'Alterar estados de encomendas, cancelar e registar notas'),
    ('PAYMENTS_REVIEW', 'Validar ou rejeitar pagamentos'),
    ('PAYMENTS_REFUND', 'Registar reembolsos'),
    ('CATALOG_MANAGE',  'Gerir produtos, categorias, ingredientes, extras e imagens'),
    ('INVENTORY_MANAGE','Gerir stock'),
    ('LOYALTY_MANAGE',  'Gerir fidelização, recompensas e descontos'),
    ('CUSTOMERS_VIEW',  'Consultar clientes'),
    ('SETTINGS_MANAGE', 'Gerir definições da loja, pagamentos, entrega e conteúdos'),
    ('STAFF_MANAGE',    'Gerir contas secundárias, papéis e permissões'),
    ('AUDIT_VIEW',      'Consultar o registo de auditoria');

INSERT INTO role (code, name, is_system) VALUES
    ('ORDER_MANAGER',     'Gestor de encomendas',          TRUE),
    ('CATALOG_MANAGER',   'Gestor de stock e catálogo',    TRUE),
    ('PAYMENTS_REVIEWER', 'Responsável de pagamentos',     TRUE),
    ('ASSISTANT',         'Assistente (leitura limitada)', TRUE);

INSERT INTO role_permission (role_id, permission_id)
SELECT r.id, p.id FROM role r JOIN permission p ON (
       (r.code = 'ORDER_MANAGER'     AND p.code IN ('DASHBOARD_VIEW','ORDERS_VIEW','ORDERS_MANAGE','CUSTOMERS_VIEW'))
    OR (r.code = 'CATALOG_MANAGER'   AND p.code IN ('DASHBOARD_VIEW','CATALOG_MANAGE','INVENTORY_MANAGE'))
    OR (r.code = 'PAYMENTS_REVIEWER' AND p.code IN ('DASHBOARD_VIEW','ORDERS_VIEW','PAYMENTS_REVIEW'))
    OR (r.code = 'ASSISTANT'         AND p.code IN ('DASHBOARD_VIEW','ORDERS_VIEW')));

-- ---------------------------------------------------------------------
-- 2. Catálogo: galeria de imagens e stock de ingredientes
-- ---------------------------------------------------------------------
CREATE TABLE product_image (
    id         UUID PRIMARY KEY DEFAULT GEN_RANDOM_UUID(),
    product_id UUID         NOT NULL REFERENCES product (id) ON DELETE CASCADE,
    url        VARCHAR(500) NOT NULL,
    position   INTEGER      NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_product_image_product ON product_image (product_id, position);

-- NULL = stock não controlado (sempre disponível); 0 = esgotado.
ALTER TABLE ingredient ADD COLUMN stock_qty INTEGER;
ALTER TABLE ingredient ADD CONSTRAINT ck_ingredient_stock CHECK (stock_qty IS NULL OR stock_qty >= 0);

-- ---------------------------------------------------------------------
-- 3. Entrega e levantamento (tudo configurado pela proprietária)
-- ---------------------------------------------------------------------
CREATE TABLE delivery_zone (
    id            UUID PRIMARY KEY DEFAULT GEN_RANDOM_UUID(),
    name          VARCHAR(160)  NOT NULL,
    fee           NUMERIC(12,2) NOT NULL CHECK (fee >= 0),
    free_over     NUMERIC(12,2) CHECK (free_over IS NULL OR free_over > 0),
    lead_time     VARCHAR(160),
    schedule      VARCHAR(300),
    active        BOOLEAN       NOT NULL DEFAULT TRUE,
    display_order INTEGER       NOT NULL DEFAULT 0,
    created_at    TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
    updated_at    TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

ALTER TABLE customer_order
    ADD COLUMN delivery_zone_id   UUID REFERENCES delivery_zone (id) ON DELETE SET NULL,
    ADD COLUMN delivery_zone_name VARCHAR(160),
    ADD COLUMN pickup_slot        VARCHAR(120),
    ADD COLUMN terms_accepted_at  TIMESTAMPTZ;

-- ---------------------------------------------------------------------
-- 4. Pagamentos: comprovativo (referência) e reembolsos auditados
-- ---------------------------------------------------------------------
ALTER TABLE payment
    ADD COLUMN proof_reference    VARCHAR(200),
    ADD COLUMN proof_submitted_at TIMESTAMPTZ;

CREATE TABLE refund (
    id          UUID PRIMARY KEY DEFAULT GEN_RANDOM_UUID(),
    payment_id  UUID          NOT NULL REFERENCES payment (id) ON DELETE RESTRICT,
    order_id    UUID          NOT NULL REFERENCES customer_order (id) ON DELETE RESTRICT,
    amount      NUMERIC(12,2) NOT NULL CHECK (amount > 0),
    reason      VARCHAR(500)  NOT NULL,
    reference   VARCHAR(120),
    created_by  UUID          REFERENCES app_user (id),
    created_at  TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_refund_payment ON refund (payment_id);

-- ---------------------------------------------------------------------
-- 5. Notas operacionais de encomenda
-- ---------------------------------------------------------------------
CREATE TABLE order_note (
    id         UUID PRIMARY KEY DEFAULT GEN_RANDOM_UUID(),
    order_id   UUID         NOT NULL REFERENCES customer_order (id) ON DELETE CASCADE,
    author_id  UUID         REFERENCES app_user (id),
    author     VARCHAR(255),
    body       VARCHAR(1000) NOT NULL,
    created_at TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_order_note_order ON order_note (order_id, created_at DESC);

-- ---------------------------------------------------------------------
-- 6. Notificações (saída) e recuperação de palavra-passe
-- ---------------------------------------------------------------------
CREATE TABLE notification (
    id         UUID PRIMARY KEY DEFAULT GEN_RANDOM_UUID(),
    user_id    UUID         REFERENCES app_user (id) ON DELETE SET NULL,
    kind       VARCHAR(40)  NOT NULL,
    recipient  VARCHAR(320) NOT NULL,
    subject    VARCHAR(200) NOT NULL,
    -- O corpo nunca guarda tokens: só texto descritivo.
    status     VARCHAR(30)  NOT NULL DEFAULT 'PENDING_CHANNEL',
    created_at TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE TABLE password_reset_token (
    id         UUID PRIMARY KEY DEFAULT GEN_RANDOM_UUID(),
    user_id    UUID         NOT NULL REFERENCES app_user (id) ON DELETE CASCADE,
    token_hash VARCHAR(128) NOT NULL UNIQUE,
    expires_at TIMESTAMPTZ  NOT NULL,
    used_at    TIMESTAMPTZ,
    created_at TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_password_reset_user ON password_reset_token (user_id);

-- ---------------------------------------------------------------------
-- 7. Fidelização: a recompensa exige pontos (ou meta em Kz) E encomendas
--    (lógica AND). NOT VALID: linhas antigas não são revalidadas, mas
--    qualquer criação/alteração passa a ser verificada.
-- ---------------------------------------------------------------------
ALTER TABLE reward_rule ADD COLUMN goal_kz NUMERIC(12,2) CHECK (goal_kz IS NULL OR goal_kz > 0);
ALTER TABLE reward_rule DROP CONSTRAINT ck_reward_rule_condition;
ALTER TABLE reward_rule ADD CONSTRAINT ck_reward_rule_both_conditions
    CHECK ((min_points IS NOT NULL OR goal_kz IS NOT NULL) AND min_orders IS NOT NULL) NOT VALID;

-- Desconto de boas-vindas: 5% definido pela proprietária da marca. Vem
-- pré-carregado mas DESACTIVADO — activa-se no painel com um clique.
INSERT INTO discount_rule (id, code, description, kind, percent, priority, active)
VALUES (GEN_RANDOM_UUID(), 'WELCOME_5', 'Desconto de boas-vindas (5%)', 'WELCOME', 5.00, 1, FALSE);
