# SPEC — Diretrizes de Desenvolvimento do B2C Finance

> **Como usar:** antes de codar qualquer coisa neste projeto, leia este arquivo
> inteiro. Se estiver usando IA (Claude, Copilot, etc.), comece o chat com:
> *"Leia e siga a SPEC.md na raiz do projeto"*. Toda regra aqui existe porque
> a violação dela já causou bug, lentidão ou falha de segurança neste sistema.
> Na dúvida entre esta SPEC e um exemplo antigo no código, **a SPEC vence**.

---

## 1. O sistema em uma linha

ERP financeiro de agência: Next.js 14 (App Router) + TypeScript + Prisma 5 +
PostgreSQL (Supabase) + Tailwind/Radix, deploy na Vercel (região `gru1`).
Padrão: **Server Components para leitura, Server Actions para mutação**.
Não existem API routes de dados (só 3 de download de arquivo).

## 2. Comandos — e uma armadilha importante

| Comando | Uso |
|---|---|
| `npm run dev` | desenvolvimento (lento — nunca julgue performance nele) |
| `npm run build:ci` | **use este para validar build** (não toca no banco) |
| `npm run build` | ⚠️ roda `prisma migrate deploy` NO BANCO REAL — só a Vercel usa |
| `npm start` | servir o build de produção localmente |
| `PRISMA_LOG=1 npm start` | mostra cada query SQL com duração (profiling) |

⚠️ O `.env` local aponta para o **banco de produção**. Rodar o app localmente
lê/escreve dados reais. Nunca rode `wipe-data.ts`, seeds destrutivos ou
`prisma migrate reset` sem confirmar 3× o que está fazendo.

## 3. Fluxo de trabalho (obrigatório)

1. **Nunca commite direto na `main`.** Crie branch: `git checkout -b feat/nome`.
2. Commits pequenos e isolados, um assunto por commit.
3. Antes de cada commit: `npm run build:ci` verde (typecheck + build).
4. Nada de reescrita gigante de uma vez — mudanças incrementais.
5. Merge na `main` → a Vercel faz o deploy automaticamente.

## 4. Segurança — regras invioláveis

- **NUNCA** coloque secret, senha, token ou API key no código — nem como
  "fallback de dev". O padrão do projeto é **falhar o boot em produção** se a
  env var faltar (veja `src/lib/auth/session.ts`). Siga esse padrão.
- **NUNCA** use prefixo `NEXT_PUBLIC_` em variável sensível — tudo com esse
  prefixo vai para o navegador de qualquer pessoa.
- **NUNCA** versione `.env*` (só `.env.example` com placeholders).
- Toda server action (exceto login/logout) começa com
  `await getViewer();` — sessão obrigatória. Não remova, não "simplifique".
- Não mexa em `src/middleware.ts`, `src/lib/auth/` ou `src/lib/prisma.ts`
  sem revisão de alguém sênior — é a fundação de auth + isolamento multiusuário.

## 5. Multiusuário (ownerId) — como funciona e como não quebrar

Uma extensão do Prisma (`src/lib/prisma.ts`) injeta `ownerId` automaticamente
em toda query de entidade privada, resolvendo o dono pelo cookie de sessão.
Consequências práticas:

- Em páginas e actions: **não** passe `ownerId` manualmente — já é automático.
- Em **scripts** (`scripts/*.ts`): não há cookie — use `runWithOwner(id, fn)`
  ou `runWithoutScope(fn)` de `src/lib/auth/owner-scope.ts`, com as queries
  `await`adas DENTRO do callback.
- Dentro de `unstable_cache` o cookie **não existe** (lança erro) → o escopo
  cai no fail-closed e retorna vazio. Por isso existe a regra da seção 6.

## 6. Cache de leitura — use `ownerCached`, nunca `unstable_cache` cru

Toda função de leitura pesada (métricas, sumários, listas agregadas) deve ser
cacheada com o helper **`ownerCached`** de `src/lib/owner-cache.ts`:

```ts
import { ownerCached } from "@/lib/owner-cache";
import { CACHE_TAGS } from "@/lib/cache-tags";

async function getMinhaMetricaImpl(period: Period): Promise<Resultado> { ... }

export const getMinhaMetrica = ownerCached("minha-metrica", getMinhaMetricaImpl, {
  revalidate: 300, // 5 min
  tags: [CACHE_TAGS.DASHBOARD_METRICS],
});
```

Por quê: o helper resolve o `ownerId` na request, inclui na chave (cada
usuário tem sua entrada — sem vazar dado entre contas) e fixa o escopo dentro
do callback. `unstable_cache` cru aqui **já causou dashboard zerado em
produção**.

Atenção: o resultado cacheado é serializado em JSON — campos `Date` voltam
como *string*. Prefira retornar números/strings; se retornar datas, os
consumidores devem usar `formatDateBR()` (aceita os dois).

## 7. Invalidação de cache — só pelos helpers de domínio

**NUNCA** chame `revalidatePath()`/`revalidateTag()` direto numa action.
Use os helpers de `src/lib/revalidate.ts`:

| Helper | Quando usar |
|---|---|
| `revalidateFinance({cardId?, personId?})` | transações, cartões, faturas, caixinhas, pessoas, importações, regras |
| `revalidateAgency({clientId?, contractId?})` | clientes, contratos, cobranças, pagamentos, inadimplência, acordos |
| `revalidateCatalog()` | serviços, ofertas, upsells |
| `revalidatePayroll()` | folha e comissões |
| `revalidateAdmin()` | usuários, configurações |
| `revalidateAssistant()` | assistente de IA |

Se criar uma rota nova, **adicione-a ao helper do domínio** — não faça
`revalidatePath` avulso. Antes desses helpers existirem, caminhos esquecidos
geravam telas com dados defasados (vários commits "fix cache sync" no
histórico provam).

## 8. Performance — regras aprendidas na prática (com números)

O dashboard já custou **4,4s e 405 queries por clique**. Hoje custa 0,9s/12.
Para continuar assim:

- **Nada de escrita em caminho de leitura.** Página que o usuário abre não
  grava no banco. Se precisar de manutenção periódica (ex.: marcar vencidos),
  siga o padrão de throttle de `markOverdueBillings` em
  `src/lib/services/billing-metrics.ts`.
- **Nada de query em loop (N+1).** `for` com `await prisma.*` dentro é bug de
  performance. Use `createMany`, `updateMany` com `id: { in: [...] }`, ou
  busque tudo com `findMany` e agrupe em JS (padrão "bucketize" — veja
  `getYearlySeries` em `src/lib/services/dashboard-main.ts`).
- **`findMany` sempre com `take`** em listas que podem crescer.
- **Biblioteca pesada de gráfico/planilha nunca entra no bundle inicial**:
  recharts só via `src/components/dashboard/charts-lazy.tsx` (next/dynamic);
  `xlsx`, `pdf-parse`, `docxtemplater` só em código server (lib/actions/routes).
- Cada roundtrip ao banco custa ~60-120ms. Pense em "quantas queries essa
  página dispara?" antes de pensar em qualquer micro-otimização.

## 9. Não duplique helpers — importe do lugar certo

| Precisa de | Importe de |
|---|---|
| `toNumber` (Decimal→number), `clean` (FormData→string\|null), `formatBRL`, `formatBRLShort`, `parseBRL`, `formatDecimalInput`, `formatDateBR`, `parseDateBR`, `parseMonthParam`, `MONTHS_PT` | `@/lib/format` |
| `BILLING_OPEN_STATUSES`, `BILLING_AWAITING_STATUSES`, `MONEY_EPSILON` | `@/lib/billing-status` |
| `cn()` (classes Tailwind) | `@/lib/utils` |

Já existiram **16 cópias** de `toNumber` e **9** de `clean` neste código.
Se sentir vontade de escrever `const n = (v) => ...` local: importe.
Números mágicos de negócio (limiares, taxas) ganham **constante nomeada**.

## 10. Padrões de código do projeto

- **Formulários**: inputs não-controlados + `FormData` + validação Zod com
  `safeParse` no submit + server action. **Não** adicione react-hook-form
  (foi removido de propósito). Exemplo canônico:
  `src/app/clientes/client-dialog.tsx`.
- **Server actions**: `"use server";` na PRIMEIRA linha do arquivo; Zod para
  validar; retorno `{ ok: true } | { ok: false, error }`; helper de
  revalidação do domínio no final.
- **Relatórios**: um arquivo por relatório em `src/lib/reports/definitions/`,
  registrado em `registry.ts`. Não engorde o registry.
- **Duas métricas com nome parecido que NÃO são a mesma coisa**:
  MRR/TCV *contratual* (`contract-metrics.ts`, carteira de contratos) ≠
  MRR/TCV *de faturamento* (`revenue-metrics.ts`, clientes/cobranças).
  Não "unifique" nem troque uma pela outra.

## 11. Organização de arquivos

- **Raiz limpa**: nada de `.md` de status/fase/deploy na raiz. Documentação
  de verdade vai em `docs/`; histórico morto em `docs/archive/`.
- Scripts one-off/experimentos: `scripts/archive/`, nunca em `scripts/` ativo.
- Não crie npm script apontando para arquivo que não existe.
- `vercel.json`: não re-adicione chaves legadas (`name`, `version`, `public`,
  `env`) — a Vercel **rejeita o deploy inteiro** por causa delas (já
  aconteceu). Não remova `"regions": ["gru1"]` — o banco fica em São Paulo.

## 12. Antes de abrir PR / mergear — checklist

- [ ] `npm run build:ci` verde
- [ ] Nenhum secret/valor hardcoded novo
- [ ] Mutações usam helper de revalidação do domínio (seção 7)
- [ ] Leituras pesadas novas usam `ownerCached` (seção 6)
- [ ] Nenhuma query dentro de loop
- [ ] Helpers importados, não copiados (seção 9)
- [ ] Testou o fluxo afetado rodando `npm run build:ci && npm start`
- [ ] Commits pequenos, descritivos, em branch própria

---

*Última revisão: julho/2026, após a auditoria completa (branch
`refactor/auditoria` — 22 commits com o histórico detalhado de cada decisão).*
