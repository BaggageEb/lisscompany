# Arquitetura

## Visão geral

Monólito modular Spring Boot (uma aplicação, fronteiras de domínio explícitas). Sem microserviços: a escala actual não os justifica e a complexidade operacional seria injustificada para uma marca em crescimento.

```
frontend  ──HTTP/JSON──▶  backend (/api/v1)
                              │
                              ├─ controllers  (HTTP, DTOs, sem regra de negócio)
                              ├─ services     (regra de negócio, transacções)
                              ├─ repositories (Spring Data JPA)
                              └─ Flyway       (migrações versionadas → PostgreSQL)
```

## Módulos de domínio

Cada domínio vive no seu pacote em `com.lisscompany.<dominio>`:

| Domínio | Responsabilidade | Fase |
|---|---|---|
| `identity` | Utiladores, sessões, papéis, permissões | 4 (activo) / 7 |
| `catalog` | Produtos, categorias, ingredientes, variantes | 2 |
| `cakebuilder` | Configuração do Cake Studio e validação de composições | 3 |
| `inventory` | Stock, movimentos, reservas | **5 (activo)** |
| `orders` | Encomendas, linhas, snapshots, estados | 4 |
| `payments` | Métodos, eventos, validação manual, reembolsos | **5 (activo)** |
| `delivery` | Zonas, tarifas, levantamento | 4 |
| `loyalty` | Pontos, metas, recompensas | 6 |
| `promotions` | Descontos e regras promocionais | 6 |
| `notifications` | Comunicações ao cliente | 5+ |
| `administration` | API do painel administrativo | 5 (endpoints) / 7 (UI) |
| `audit` | Registos imutáveis de auditoria | **1 (activo)** |
| `shared` | Configuração transversal, erros, utilitários | **1 (activo)** |

Regras: os controladores não contêm lógica de negócio; a validação acontece no serviço de domínio e outra vez no endpoint; o frontend nunca é autoridade para preço, stock, descontos ou pontos.

## Ciclo de fases

O sistema cresce por fases verificáveis (ver README). Cada fase:
1. Migrações Flyway novas (nunca editar migrações já aplicadas num ambiente partilhado).
2. Endpoints novos sob `/api/v1/...`, documentados no OpenAPI.
3. Testes das regras novas; `mvn verify` e `npm test` têm de passar.

## Modelo de dados

Ver [data-model.md](data-model.md). Princípios: PostgreSQL com integridade referencial (FKs, constraints, índices); dinheiro em `NUMERIC` (decimal, nunca `double`); timestamps `TIMESTAMPTZ` em UTC; snapshot imutável da composição e preços em cada encomenda; unicidade/idempotência para eventos de pagamento e crédito de pontos; auditoria de acções administrativas.

## Segurança

- **Palavras-passe:** hash com mecanismo suportado pelo Spring Security (BCrypt via `DelegatingPasswordEncoder`), nunca texto simples.
- **Autorização:** todas as rotas privadas exigem sessão autenticada; regras declaradas explicitamente em `SecurityConfig` (catch-all `anyRequest().authenticated()`).
- **Sessão + CSRF:** a estratégia escolhida é sessão de navegador com cookies e proteção CSRF activa nas mutações (adequada a loja web); cookies `HttpOnly`/`Secure`/`SameSite` conforme ambiente.
- **CORS:** restritivo, configurado por variável de ambiente (`CORS_ALLOWED_ORIGINS`), apenas rotas `/api/**`.
- **Auditoria:** acções administrativas sensíveis gravadas em `audit_log` dentro da mesma transacção da alteração (`AuditService`, propagação `MANDATORY`).
- **Segredos:** fora do código e da base; dados bancários/Multicaixa editáveis no painel com validação e auditoria.
- **Não confiar no cliente:** preços, stock, descontos e pontos calculados no backend; o frontend apresenta.
- A enumeração completa de ameaças e mitigações será revista na fase 8 (hardening).

## Observabilidade e operação

- Health check público: `/actuator/health`; documentação em `/api/v1/docs`.
- Logs estruturados sem segredos (nunca passwords, tokens ou dados financeiros).
- Migrações versionadas com Flyway; `ddl-auto: none` (o esquema só muda por migração).
