# LISSCOMPANY — plataforma de e-commerce

Bolos no pote e produtos personalizados, com o **LissCompany Cake Studio** como experiência central.

> **Estado: Fases 1–7 concluídas; fase 8 (qualidade) analisada.** O repositório contém o monorepo, o design system, o backend Spring Boot com migrações Flyway verificadas contra PostgreSQL real, a loja pública com Cake Studio, a identidade com sessão + CSRF, carrinho/checkout/encomendas, o inventário com reservas + pagamentos com revisão manual, a fidelização (pontos, recompensas, resgate no checkout) e o painel administrativo (encomendas, pagamentos, inventário, fidelização, perfil do cliente) — com o servidor sempre autoritativo. A revisão final da fase 8 confirmou 77 testes backend e 111 frontend a passar, `tsc` e build de produção limpos, sem código de depuração nem segredos no repositório. O **deploy continua por publicar** (decisão de alojamento pendente). As páginas marcadas como “em construção” ou “por configurar” são honestas: ainda não executam acções.

Slogan: _a little bit of everything_ · Moeda: Kwanza (AOA, `Kz`) · Idioma: Português · Mercado: Angola/Luanda

## Estrutura do repositório

```
├── backend/     API Spring Boot (Java 25, Maven) — monólito modular
│   └── src/main/resources/db/migration/   Migrações Flyway (PostgreSQL)
├── frontend/    SPA React + TypeScript (Vite) — design system e rotas públicas
├── docs/        Arquitetura, modelo de dados, decisões pendentes
├── .env.example Exemplo de configuração de ambiente (sem segredos)
└── .toolchain/  JDK e Maven locais (não versionados; só nesta máquina)
```

## Requisitos

- **Backend:** JDK 25 (LTS), Maven 3.9+, PostgreSQL 14+
- **Frontend:** Node.js 20+ e npm
- Nesta máquina de desenvolvimento a toolchain está em `.toolchain/` (JDK Temurin 25 + Maven 3.9.16); os testes de integração usam PostgreSQL real embutido (Zonky) e **não** precisam de Docker nem de root.

## Configuração de ambiente

Copie `.env.example` para `.env` e preencha. Nunca coloque segredos em código: `DB_PASSWORD`, dados bancários (IBAN) e o número Multicaixa Express são configuração privada — os primeiros por variáveis de ambiente, os últimos editáveis no painel administrativo (fase 7).

## Executar o backend

```bash
cd backend
# Com um PostgreSQL local a correr em localhost:5432 (base "lisscompany"):
./mvnw spring-boot:run   # ou: mvn spring-boot:run
```

- A API escuta em `http://localhost:8080`
- Health check: `GET /actuator/health` (público)
- Documentação OpenAPI: `GET /api/v1/docs` e Swagger UI em `GET /api/v1/docs/ui`
- As migrações do Flyway correm automaticamente no arranque (`backend/src/main/resources/db/migration/`)

## Executar o frontend

```bash
cd frontend
npm install
npm run dev        # http://localhost:3000 (proxy /api e /actuator para :8080)
```

## Testes

```bash
# Backend — inclui testes de integração com PostgreSQL real (Zonky, sem Docker):
cd backend && mvn verify

# Frontend — Vitest + Testing Library:
cd frontend && npm test

# Build de produção do frontend (tsc + vite build):
cd frontend && npm run build
```

## Arquitetura e módulos

Ver [docs/architecture.md](docs/architecture.md). Monólito modular Spring Boot; cada domínio (`identity`, `catalog`, `cakebuilder`, `inventory`, `orders`, `payments`, `delivery`, `loyalty`, `promotions`, `notifications`, `administration`, `audit`) vive no seu pacote. O backend é sempre autoritativo: preços, stock, descontos e pontos são calculados e validados no servidor.

## Modelo de dados

Ver [docs/data-model.md](docs/data-model.md). PostgreSQL com chaves estrangeiras, constraints, índices e migrações versionadas. Dinheiro em `NUMERIC` (nunca float), timestamps em `TIMESTAMPTZ` (UTC).

## Regras de negócio

Implementadas por fases; o estado por fase está em [docs/decisions.md](docs/decisions.md), que também lista as **decisões comerciais ainda por confirmar** (catálogo inicial, tarifas de entrega, taxa de conversão de pontos, prioridade entre descontos, etc.) — nenhuma é inventada.

## Estratégia de pagamentos

Transferência IBAN, Multicaixa Express e pagamento na entrega/levantamento, com validação manual por conta autorizada (fase 5). Os dados bancários são configuração (`business_setting`), nunca hardcoded — a edição pelo painel entra com as definições da loja, ainda por configurar. A integração automática com um fornecedor de pagamento está **por confirmar**.

## Deploy e segurança

Ainda sem deploy publicado. Estratégia de segurança (hash de palavras-passe, sessão + CSRF, autorização server-side, auditoria, CORS restritivo) está descrita em [docs/architecture.md](docs/architecture.md#segurança).

## Fases

| Fase |Âmbito|Estado|
|---|---|---|
| 1 | Inspeção, fundações, design system, migrações, ambiente | **Concluída** |
| 2 | Identidade visual e páginas públicas (loja, produto) | **Concluída** |
| 3 | Cake Studio (configurador imersivo) | **Concluída** |
| 4 | Autenticação, carrinho, checkout, encomendas (incl. área do cliente) | **Concluída** |
| 5 | Inventário e pagamentos (reservas, revisão manual, transições) | **Concluída** |
| 6 | Fidelização (saldo, recompensas, resgate no checkout, livro-razão de movimentos) | **Concluída** |
| 7 | Painel administrativo (encomendas, pagamentos, inventário, fidelização) + perfil/moradas/segurança do cliente | **Concluída** |
| 8 | Qualidade, testes, performance, acessibilidade, deploy | **Análise concluída** (testes/qualidade OK); deploy por publicar |
