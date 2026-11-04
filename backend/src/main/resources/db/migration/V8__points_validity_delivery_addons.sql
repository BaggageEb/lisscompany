-- =====================================================================
-- LISSCOMPANY — V8: validade dos pontos, configuração de entregas e
-- complementos do Cake Studio.
--
-- Nenhum valor comercial é inventado: a validade dos pontos nasce SEM
-- prazo (os pontos não expiram até a proprietária definir um), e o modo
-- de entrega nasce por configurar.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Pontos com validade
--
-- Cada crédito de pontos (ganho por encomenda ou ajuste positivo) passa a
-- ser um «lote». O lote guarda quantos pontos ainda estão por gastar
-- (remaining_points) e quando caducam (expires_at; NULL = não caduca).
-- Os resgates consomem lotes por ordem de caducidade (FIFO), pelo que um
-- crédito parcialmente utilizado só expira a parte que sobrou — nunca os
-- pontos que já foram gastos nem os de outros lotes ainda válidos.
--
-- Invariante mantido pelo servidor:
--   loyalty_account.points_balance = SUM(remaining_points) dos lotes da conta.
-- ---------------------------------------------------------------------
CREATE TABLE loyalty_point_lot (
    id                    UUID PRIMARY KEY DEFAULT GEN_RANDOM_UUID(),
    account_id            UUID        NOT NULL REFERENCES loyalty_account (id),
    source_transaction_id UUID        REFERENCES loyalty_transaction (id),
    earned_points         INTEGER     NOT NULL CHECK (earned_points > 0),
    remaining_points      INTEGER     NOT NULL,
    expired_points        INTEGER     NOT NULL DEFAULT 0 CHECK (expired_points >= 0),
    earned_at             TIMESTAMPTZ NOT NULL,
    expires_at            TIMESTAMPTZ,
    expired_at            TIMESTAMPTZ,
    created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT ck_lot_remaining CHECK (remaining_points >= 0 AND remaining_points <= earned_points),
    CONSTRAINT ck_lot_expired   CHECK (expired_points + remaining_points <= earned_points)
);

-- Lotes com pontos por gastar, por conta e caducidade (consumo FIFO e varrimento).
CREATE INDEX ix_lot_account_active ON loyalty_point_lot (account_id, expires_at NULLS LAST, earned_at)
    WHERE remaining_points > 0;
CREATE INDEX ix_lot_expiry ON loyalty_point_lot (expires_at) WHERE remaining_points > 0 AND expires_at IS NOT NULL;

-- Que lotes (e quantos pontos de cada) pagou cada resgate/ajuste negativo.
-- Permite devolver os pontos aos lotes certos num cancelamento.
CREATE TABLE loyalty_lot_consumption (
    id             UUID PRIMARY KEY DEFAULT GEN_RANDOM_UUID(),
    lot_id         UUID        NOT NULL REFERENCES loyalty_point_lot (id),
    transaction_id UUID        NOT NULL REFERENCES loyalty_transaction (id),
    points         INTEGER     NOT NULL CHECK (points > 0),
    created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX ix_lot_consumption_txn ON loyalty_lot_consumption (transaction_id);
CREATE INDEX ix_lot_consumption_lot ON loyalty_lot_consumption (lot_id);

-- Novo tipo de movimento: pontos expirados.
ALTER TABLE loyalty_transaction DROP CONSTRAINT loyalty_transaction_type_check;
ALTER TABLE loyalty_transaction ADD CONSTRAINT loyalty_transaction_type_check
    CHECK (type IN ('EARN', 'REDEEM', 'ADJUSTMENT', 'EXPIRE'));

-- Migração dos saldos existentes: cada crédito passado vira um lote e o que já
-- foi gasto (créditos − saldo actual) é abatido aos lotes mais antigos primeiro.
-- Sem validade configurada (expires_at NULL), nada expira por esta migração.
WITH credits AS (
    SELECT t.id, t.account_id, t.points, t.created_at,
           SUM(t.points) OVER (PARTITION BY t.account_id ORDER BY t.created_at, t.id) AS cum
    FROM loyalty_transaction t
    WHERE t.points > 0
), totals AS (
    SELECT a.id AS account_id,
           a.points_balance,
           COALESCE((SELECT SUM(x.points) FROM loyalty_transaction x
                     WHERE x.account_id = a.id AND x.points > 0), 0) AS credited
    FROM loyalty_account a
)
INSERT INTO loyalty_point_lot (account_id, source_transaction_id, earned_points, remaining_points, earned_at)
SELECT c.account_id, c.id, c.points,
       GREATEST(0, LEAST(c.points, c.cum - GREATEST(0, tt.credited - tt.points_balance))),
       c.created_at
FROM credits c
JOIN totals tt ON tt.account_id = c.account_id;

-- ---------------------------------------------------------------------
-- 2. Configuração de entregas
--
-- A tarifa da zona passa a poder estar por definir (NULL) — uma zona
-- activa SEM preço e SEM «entrega gratuita» é inválida, e o servidor
-- recusa encomendas para ela. O modo global (preço fixo / por zonas /
-- gratuita) e o preço fixo vivem em business_setting:
--   delivery.mode, delivery.flat_fee, delivery.flat_free_over
-- ---------------------------------------------------------------------
ALTER TABLE delivery_zone ALTER COLUMN fee DROP NOT NULL;
ALTER TABLE delivery_zone ADD COLUMN free_delivery BOOLEAN NOT NULL DEFAULT FALSE;
-- Zonas antigas com tarifa 0 já significavam «entrega gratuita» (V7).
UPDATE delivery_zone SET free_delivery = TRUE WHERE fee = 0;
ALTER TABLE delivery_zone ADD CONSTRAINT ck_delivery_zone_priced
    CHECK (NOT active OR free_delivery OR fee IS NOT NULL);

-- ---------------------------------------------------------------------
-- 3. Cake Studio: complementos (velas, cartões, mensagens)
--
-- Categoria independente dos extras: não conta para o limite de três.
-- allows_message = o cliente pode escrever uma mensagem/dedicatória
-- (ex.: um cartão); a proprietária vê-a na encomenda.
-- ---------------------------------------------------------------------
ALTER TABLE ingredient DROP CONSTRAINT ck_ingredient_kind;
ALTER TABLE ingredient ADD CONSTRAINT ck_ingredient_kind
    CHECK (kind IN ('CAKE_BASE', 'FILLING', 'EXTRA', 'ADDON'));
ALTER TABLE ingredient ADD COLUMN allows_message BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE ingredient ADD CONSTRAINT ck_ingredient_message
    CHECK (kind = 'ADDON' OR NOT allows_message);

-- Velas e mensagem já existiam como «extras» e ocupavam vagas dos três extras.
UPDATE ingredient SET kind = 'ADDON' WHERE slug IN ('velas', 'mensagem') AND kind = 'EXTRA';
UPDATE ingredient SET allows_message = TRUE WHERE slug = 'mensagem' AND kind = 'ADDON';

-- Encomendas com mensagem/dedicatória: a proprietária vê-as logo na lista.
ALTER TABLE customer_order ADD COLUMN has_dedication BOOLEAN NOT NULL DEFAULT FALSE;
