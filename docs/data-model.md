# Modelo de dados

Estado: **Fase 7** — esquema de identidade, auditoria, definições de negócio, catálogo (V2/V3), encomendas (V4), inventário/pagamentos (V5) e fidelização/promoções (V6). A fase 7 não acrescentou tabelas: o perfil/moradas do cliente usam `customer_profile`/`address` da V1 e o painel lê as tabelas existentes. Novas tabelas entram por migração (`backend/src/main/resources/db/migration/`); migrações já aplicadas nunca são editadas.

## Convenções

- **Dinheiro:** `NUMERIC` com precisão decimal (nunca `double precision`). Valores trafegam na API como string decimal.
- **Tempo:** `TIMESTAMPTZ` em UTC; a aplicação escreve `Instant`.
- **Identificadores:** `UUID` com `gen_random_uuid()` (excepto `audit_log`, que usa `BIGSERIAL`).
- **Integridade:** chaves estrangeiras com `ON DELETE` explícito, `CHECK` para enums, `UNIQUE` para e-mails/códigos.
- **Auditoria:** toda a acção sensível gera linha imutável em `audit_log`.

## Tabelas criadas na Fase 1 (V1)

### `audit_log`
Registos imutáveis de auditoria: `action`, `entity_type`, `entity_id`, `actor_user_id`, `actor_label`, `details`, `created_at`. Índices por entidade, data e actor.

### `app_user`
Utilizador (cliente ou conta administrativa): `email` (único), `password_hash`, `display_name`, `status` (`ACTIVE|DISABLED|PENDING`), `email_verified`, `is_owner`, protecção contra força bruta (`failed_login_attempts`, `locked_until`), `last_login_at`.

### `role`, `permission`, `user_role`, `role_permission`
RBAC granular. Papéis de sistema previstos (a implementar na fase 7): `OWNER`, `ORDER_MANAGER`, `CATALOG_MANAGER`, `PAYMENTS_REVIEWER`, `ASSISTANT`. Uma conta secundária nunca concede privilégios superiores aos seus.

### `customer_profile`
Perfil do cliente ligado a `app_user`: telefone, canal de contacto preferido, notas.

### `address`
Moradas do cliente (o cliente só acede às suas): linha 1/2, cidade, município, província, telefone, morada por omissão. Entidade JPA usada pela fase 7 (perfil e moradas na área do cliente).

### `business_setting`
Chave/valor tipado (`STRING|NUMBER|BOOLEAN|JSON`) para tudo o que a proprietária configura sem código: dados de pagamento, entrega, fidelização, contactos. Inclui `updated_by` + `updated_at` para rastreio.

### `inventory_item`, `stock_movement`, `stock_reservation` (V5)

Stock por produto (só produtos com linha de inventário; os restantes são ilimitados — decisão #2), movimentos imutáveis com motivo (`INITIAL_SETUP`, `MANUAL_ADJUSTMENT`, `SOLD`, `RETURNED`) e reservas por encomenda (`ACTIVE → CONSUMED | RELEASED`, com `expires_at` NULL até a decisão #6 fixar prazo).

### `payment`, `payment_event` (V5)

Pagamento único por encomenda, nasce `PENDING` e só muda por revisão manual de conta autorizada (decisões #4/#5), com estados `PENDING|UNDER_REVIEW|PAID|FAILED|PARTIALLY_REFUNDED|REFUNDED`. Eventos imutáveis com chave de idempotência única por pagamento (`payment_id, idempotency_key`) — repetir o mesmo pedido nunca duplica efeitos.

### `loyalty_rule`, `loyalty_account`, `loyalty_transaction` (V6)

Regra única de fidelização (taxa de acumulação, taxa pontos↔Kz, arredondamento, resgate parcial/total, activo/pausado — decisão #8 sem defaults presumidos), conta por cliente com saldo, e livro-razão imutável de movimentos (`EARN|REDEEM|ADJUSTMENT`) que guarda a taxa em vigor por movimento (`rate_kind`, `rate_used` — decisão #9: pontos invariantes), com a encomenda como chave de idempotência do crédito.

### `reward_rule`, `reward_redemption` (V6)

Recompensas identificadas por **código público** (`min_points`, `min_orders`, `discount_amount`, `max_per_customer`, `active` — decisões #12/#13; a validade continua por definir) e resgates: um por encomenda (`order_id` único), limitados ao máximo configurado por cliente.

### `discount_rule`, `discount_application` (V6)

Catálogo de regras de desconto (`WELCOME` com percentagem, `REWARD` ligada a `RewardRule`) com `priority` única entre activas, e a aplicação registada por encomenda com proveniência (`WELCOME|REWARD|POINTS`) — exactamente um desconto por encomenda (decisão #11). `customer_order` ganhou `discount_amount`, `discount_label` e `points_spent`: a encomenda guarda o **desconto real** aplicado pelo servidor (`total = subtotal + entrega − desconto`).

## Entidades planeadas (fases futuras)

`Product`, `ProductCategory`, `Ingredient` (criadas na V2), `CakeConfiguration` (+ layers/extras), `Cart`, `CartItem`, `Order` (criada na V4: `customer_order`, `order_item`), `Refund`, `DeliveryZone`, `DeliveryRule`, `PickupConfiguration`, `LoyaltyAccount`, `LoyaltyTransaction`, `LoyaltyRule`, `RewardRule`, `RewardRedemption`, `DiscountRule`, `DiscountApplication` (criadas na V6), `Notification`.

Requisitos-chave dessas tabelas:
- Encomenda guarda **snapshot imutável** de artigos, ingredientes, preços, descontos e totais.
- **Idempotência** por constraint única para eventos de pagamento e crédito de pontos (uma encomenda nunca credita pontos duas vezes).
- **Stock nunca negativo** sem regra explícita; movimentos com motivo, quantidade, referência e data; reservas com expiração.
- **Estados:** encomenda (`RECEIVED→CONFIRMED→PREPARING→READY→COMPLETED`, `CANCELLED`) e pagamento (`PENDING|UNDER_REVIEW|PAID|FAILED|PARTIALLY_REFUNDED|REFUNDED`) mantidos separados, com transições validadas no backend.
