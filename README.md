# B2C Finance

ERP financeiro da agência B2C Gestão, organizado no modelo de planilha mensal
do dono: a **Gestão do Mês** (`/cobrancas`) concentra clientes do mês com
pagamento em 1 clique (🟢 Pago / 🟡 A vencer / 🔴 Devendo, com Desfazer),
recebimentos do mês, contas a pagar, folha e renovações; o **Painel Anual**
(`/projecoes`) consolida indicadores × 12 meses + meta anual. Completam o
sistema: carteira de clientes, **Renovações** (`/renovacoes`, com fluxo
"Sim, renovou" + histórico auditável), **Upsell** em Kanban (venda lança
cobrança na competência escolhida), contratos (geração de DOCX),
inadimplência, folha/comissões, Contas a Pagar (`/despesas`, com cartões e
importação de faturas XLSX/PDF), relatórios e assistente de IA.

## Stack

- **Next.js 14** (App Router, Server Components + Server Actions) + React 18 + TypeScript
- **Prisma 5** + PostgreSQL (Supabase)
- Tailwind CSS + Radix UI + Recharts
- Autenticação própria: cookie HMAC (`b2c_session`) validado no middleware Edge;
  isolamento multiusuário por `ownerId` via extensão do Prisma
  (`src/lib/auth/owner-scope.ts`)
- Deploy: Vercel

## Rodando localmente

> 🧪 **Vai desenvolver?** Não use o banco de produção. O guia
> [docs/AMBIENTE_DEV.md](docs/AMBIENTE_DEV.md) monta o sistema completo num
> banco próprio e **vazio** (branch `dev` + `npm run db:seed:dev`).

```bash
npm install
cp .env.example .env   # preencher POSTGRES_PRISMA_URL, SESSION_SECRET etc.
npm run db:seed        # requer ADMIN_PASSWORD definido
npm run dev            # http://localhost:3100
```

### Variáveis obrigatórias

| Variável | Uso |
|---|---|
| `POSTGRES_PRISMA_URL` | conexão pooled (runtime) |
| `POSTGRES_URL_NON_POOLING` | conexão direta (migrations) |
| `SESSION_SECRET` | assinatura HMAC das sessões — **obrigatória em produção** (boot falha sem ela) |
| `ADMIN_PASSWORD` | senha do admin criado pelo seed (sem fallback) |
| `SUPABASE_SERVICE_ROLE_KEY` + `B2C_STORAGE_BUCKET` | storage de arquivos (opcional em dev; fallback: disco local `.uploads/`) |

## Scripts

| Comando | Descrição |
|---|---|
| `npm run dev` / `build` / `start` | ciclo Next.js (`build` roda `prisma migrate deploy`) |
| `npm run build:ci` | build sem aplicar migrations |
| `npm run db:seed` | seed inicial (admin, categorias, regras) — create-only |
| `npm run prisma:migrate` / `prisma:studio` | ferramentas Prisma |

## Estrutura

```
src/app/           páginas por domínio (dashboard, clientes, contratos, ...)
src/lib/actions/   server actions (mutations, Zod, revalidação de cache)
src/lib/services/  queries e métricas (leitura)
src/lib/auth/      sessão, usuário atual, escopo multiusuário
src/components/    componentes compartilhados (ui/ = design system)
prisma/            schema (50 models), migrations, seed
docs/              documentação (arquitetura, métricas, design system)
docs/archive/      relatórios históricos de fases/deploys
scripts/           tooling de dev (ver scripts/README.md)
```

Documentação de domínio em [docs/](docs/). Comece pela
**[DOCUMENTACAO_COMPLETA.md](docs/DOCUMENTACAO_COMPLETA.md)** (referência única:
módulos, campos, regras, métricas, entradas de dados e capacidades); os demais
arquivos aprofundam arquitetura financeira, plano de contas, métricas e design
system.
