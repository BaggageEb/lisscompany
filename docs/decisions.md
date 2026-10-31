# Decisões pendentes

Cada decisão comercial que **não foi tomada** pela proprietária é registada aqui com a sua consequência técnica. Nenhuma é substituída por um valor fictício apresentado como real.

| # | Decisão pendente | Consequência técnica | Como será resolvida |
|---|---|---|---|
| 1 | Catálogo inicial: produtos, imagens, descrições, preços | Tabela `product` existe com seed de DEMONSTRAÇÃO (V3) — será substituído pelos dados reais | Proprietária fornece dados → seed controlado |
| 2 | Quantidades/unitades iniciais de stock e consumos por receita | **Painel activo na fase 7**: ajuste manual por produto (a primeira entrada positiva cria a linha de inventário; movimentos `INITIAL_SETUP`/`MANUAL_ADJUSTMENT` auditados); produtos sem linha continuam ilimitados e **não há consumo automático por receita** (bolos não baixam ingredientes) | Consumo por receita continua por decidir |
| 3 | Zonas, tarifas, horários e prazos de entrega; local de levantamento | **Implementado (V7)**: zonas/tarifas/entrega grátis a partir de X e dados de levantamento configurados pela proprietária em *Definições*. Sem zonas, a entrega fica «a combinar» (tarifa 0); com zonas, a zona é obrigatória e a tarifa é SEMPRE a do servidor. | A proprietária cria as zonas no painel — nenhum valor é inventado. |
| 4 | Fornecedor de pagamentos automáticos | Fluxo actual: método escolhido + validação manual por conta autorizada (**activo na fase 5**: `POST /api/v1/admin/payments/{ordem}/review`, idempotente) | Integração só com API/credenciais confirmadas |
| 5 | Processo de validação de transferências e Multicaixa | Estados `PENDING` → `PAID` por revisão manual (**activo na fase 5**, com auditoria); envio de comprovativo por activar | Definição de política + UI de comprovativo |
| 6 | Momento da reserva e baixa definitiva de stock | **Implementado na fase 5**: reserva ao criar encomenda, baixa ao confirmar pagamento (`StockReservation`); `expires_at` fica NULL — sem prazo inventado | Confirmar prazo de expiração com a proprietária |
| 7 | Prazos de cancelamento e regras de reembolso | Cancelamento antes de `CONFIRMED` automático (**activo na fase 5**: cliente cancela via API; depois exige conta autorizada); sem reembolso automático implícito | Política a definir |
| 8 | Taxa de conversão pontos↔Kz, precisão e arredondamento | **Implementado na fase 6**: `LoyaltyRule` guarda taxa, arredondamento e resgate parcial/total, configurável pela API administrativa — sem defaults presumidos | Editável no painel (secção Fidelização, activo na fase 7) |
| 9 | Efeito de alterar a conversão sobre pontos existentes | **Implementado na fase 6 com pontos invariantes**: cada movimento guarda a taxa em vigor (`rate_kind`/`rate_used` em `loyalty_transaction`); revalorizar pontos antigos exigiria decisão explícita | Decisão explícita da proprietária só se quiser revalorizar |
| 10 | Consumo de pontos ao resgatar (total vs parcial) | **Implementado na fase 6**: `allowPartialRedemption` em `LoyaltyRule` escolhe resgate total ou parcial; o resgate nunca excede o saldo nem o valor da encomenda | Editável no painel (secção Fidelização, activo na fase 7) |
| 11 | Prioridade entre desconto de boas-vindas e recompensa | **Resolvida na fase 6**: exactamente UM desconto por encomenda; a escolha explícita do cliente (pontos OU recompensa) vence o automático de boas-vindas, e dois pedidos explícitos são rejeitados (422) — política em `LoyaltyService.evaluate` | `DiscountRule.priority` editável no painel (activo na fase 7) |
| 12 | Valores de descontos/brindes e validade das recompensas | **Revisto (V7)**: a meta de 10.000 Kz existe como `reward_rule.goal_kz` (utilização única, pontos exigidos = meta ÷ conversão em vigor). O valor do desconto e a validade continuam a ser definidos pela proprietária no painel. | Configuração no painel. |
| 13 | Nº mínimo de encomendas para a recompensa cumulativa | **Corrigido (V7)**: a recompensa exige pontos (ou meta em Kz) **E** encomendas — lógica AND obrigatória no servidor e na base de dados (`ck_reward_rule_both_conditions`). Só contam encomendas **concluídas e com pagamento confirmado**. | Número definido pela proprietária no painel. |
| 14 | Se a recompensa da meta é a mesma da cumulativa | Modelaremos `RewardRule` distintos mas relacionáveis; a ligação é configuração | Confirmação da proprietária |
| 15 | Requisitos legais, fiscais e políticas finais | Páginas de políticas mostram marcador “em construção”; nada de texto legal inventado | Texto aprovado + validação legal |
| 16 | Logótipo e recursos gráficos finais | Usa-se wordmark tipográfico + paleta; placeholders facilmente substituíveis | Ficheiros finais fornecidos |
| 17 | Morada, horários, contactos e fuso horário oficiais | Contactos não publicados; nada de dados fictícios — o painel da fase 7 cobre encomendas, pagamentos, inventário e fidelização; os contactos continuam por configurar | Definições da loja (próximo bloco do painel) |


## Decisões tomadas na V7 (sistema de gestão)

| Tema | Decisão |
|---|---|
| Pontos | Creditados só com a encomenda **concluída E paga** (em qualquer ordem: ao pagar já concluída, ou ao concluir já paga); idempotente por encomenda. Reembolso estorna os pontos proporcionalmente (ajuste auditável, saldo nunca negativo). |
| Concorrência | A conta de pontos é bloqueada (`PESSIMISTIC_WRITE`) durante a criação da encomenda: pontos, recompensas e boas-vindas não se gastam duas vezes com pedidos simultâneos. |
| Boas-vindas 5% | Regra `WELCOME_5` pré-carregada mas **desactivada**; activa-se com um clique no painel (a conversão pontos↔Kz continua pendente, por isso o programa de pontos não é pré-configurado). |
| Permissões | RBAC granular (12 permissões, papéis de sistema + papéis próprios). Ninguém se auto-edita, a proprietária principal é intocável, só se atribuem permissões que a própria conta tem e só a proprietária concede a gestão de contas. Desactivar uma conta termina o acesso de imediato. |
| Dados bancários | Configuração privada (`business_setting`): nunca públicos, nunca na auditoria; só o dono da encomenda os vê, depois de encomendar. |
| Imagens | Carregadas no painel; tipo decidido pelos bytes (PNG/JPEG/WebP ≤ 5 MB), nome UUID gerado no servidor. Guardadas em `app.media.dir` (volume persistente). |
| Ingredientes | Stock opcional (`stock_qty`): `NULL` = não controlado, `0` = esgotado e bloqueado no servidor. O consumo automático por receita continua pendente (#2). |
| Termos | A aceitação só é exigida se a proprietária publicar «Termos e condições». |
| Recuperação de palavra-passe | Token aleatório, guardado só como hash SHA-256, uso único, expira, resposta neutra. O **canal de envio (e-mail/SMS) continua pendente**: a notificação fica em fila (`PENDING_CHANNEL`). |
| Demonstração | O catálogo ilustrativo saiu das migrações de produção (`db/demo`); só entra com o perfil `demo`. |
