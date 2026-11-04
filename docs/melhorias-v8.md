# V8 — validade dos pontos, entregas e complementos do Cake Studio

Migração: `backend/src/main/resources/db/migration/V8__points_validity_delivery_addons.sql`.

## 1. Validade dos pontos
- **Configuração global** em *Painel → Fidelização → Validade dos pontos*: 30/60/90/180/365 dias, outro valor (1–3650) ou «sem validade». Guardada em `business_setting` (`loyalty.points_validity_days`).
- **Lotes**: cada crédito de pontos (compra paga ou ajuste positivo) é um lote em `loyalty_point_lot` com `earned_at`, `expires_at` e `remaining_points`. Os gastos consomem primeiro os lotes que caducam mais cedo (FIFO) e ficam registados em `loyalty_lot_consumption`.
- **Nova validade → pontos existentes**: ao guardar o prazo, `expires_at = earned_at + prazo` para todos os lotes com pontos por gastar. Se algum lote já estiver vencido com o novo prazo, expira na mesma operação (o painel mostra uma pré-visualização antes). Pontos **já expirados não são repostos**.
- **Expiração automática**: (a) *lazy* — qualquer operação que gasta/credita pontos retira primeiro os vencidos; (b) agendador horário (`PointsExpiryScheduler`, `app.loyalty.expiry-cron`). Cada expiração gera um movimento `EXPIRE` no histórico.
- **Crédito parcialmente usado**: só expira o que sobrou do lote. Lotes ainda válidos nunca são tocados.
- **Pontos expirados nunca se gastam**: o saldo utilizável exclui lotes vencidos.
- **Cancelamento**: os pontos regressam aos lotes de origem (ou a um lote novo se esse já expirou).
- Por omissão **não há prazo** (nada é presumido): os pontos só passam a expirar quando a proprietária definir um.

## 2. Imagens responsivas
`pages/shop.css` — abaixo de 34rem o cartão do produto passa a miniatura quadrada à esquerda + dados à direita (`object-fit: cover`, sem distorção); o detalhe limita a imagem. Computador inalterado.

## 3. Bolos personalizados
O produto-base do Cake Studio (`is_cake_studio_base`) é exposto como `customizable`. Na loja e no detalhe leva a **Personalizar no Cake Studio**; o servidor recusa esse produto como linha normal do carrinho/encomenda.

## 4. Complementos (velas, cartões, mensagens)
- Novo tipo de ingrediente `ADDON`, **fora do limite de 3 extras**; o preço soma-se ao bolo.
- `allows_message`: o complemento admite mensagem/dedicatória (≤ 200 caracteres, limpa de caracteres de controlo no servidor).
- A mensagem fica no snapshot do bolo e a proprietária vê-a no detalhe da encomenda e o selo «Tem dedicatória» na lista.
- Gestão em *Painel → Ingredientes* (tipo «Complemento»). Migração: «Velas» e «Mensagem» do seed passam de extra a complemento.

## 5 e 6. Entregas
- *Painel → Configuração de entregas* (`/admin/entregas`): modo **preço fixo** (com limiar de entrega gratuita opcional), **por zona** (preço ou «entrega gratuita» por zona, activar/desactivar) ou **gratuita**.
- Uma zona activa sem preço (e sem «gratuita») é inválida (restrição na BD + validação).
- O preço é calculado **só no servidor** (`DeliveryService.quote`), usado pelo orçamento do carrinho (`POST /public/cart/quote` com `fulfillment: DELIVERY`) e pela criação da encomenda. Sem configuração, a entrega ao domicílio **não pode ser confirmada** (nunca «0 Kz»).
- Checkout: identifica a zona (pelo município/cidade ou se só houver uma), mostra o custo antes de confirmar e o total inclui a entrega. Levantamento não cobra entrega.
