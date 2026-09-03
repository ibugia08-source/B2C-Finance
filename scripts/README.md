# Scripts — B2C Finance

Todos leem o `.env` da raiz (loader próprio em `env.ts`; `tsx` não carrega
`.env` sozinho). Scripts que ESCREVEM passam pela guarda de `guard.ts`
(03 §4.6): `APP_ENV` declarado + `ALLOW_DESTRUCTIVE=true` + o ambiente
declarado tem de bater com o inferido de TODAS as URLs de banco presentes.
Produção só com `allowProduction: true` no código — nenhum script do repo tem.

## Operação (rodam em produção via cron/manual)

| Script | O que faz |
|---|---|
| `outbox-worker.ts` | entrega eventos do Outbox (AvanceCRM/whatsapp, gateway); canal sem provedor configurado fica pendente, nunca vira erro |
| `relatorios-agendados.ts` | dispara relatórios por e-mail agendados (janela recuperável) |

```bash
npm run outbox:worker
npm run relatorios:agendados
```

## Desenvolvimento local

| Script | O que faz |
|---|---|
| `mint-token.ts` | emite cookie de sessão de admin para smoke autenticado (recusa produção) |
| `setup-test-db.mjs` | (re)cria e migra o banco de TESTE `b2c_finance_test` (porta 55433) |
| `inicio-limpo.ts` | zera DADOS DE OPERAÇÃO mantendo estrutura e configuração do dono; faz backup antes; exige a guarda + `--confirmar` |
| `ledger-toggle.ts` | liga/desliga o razão contábil (FeatureFlag em banco); exige a guarda |

```bash
APP_ENV=local npx tsx scripts/mint-token.ts
npm run db:test:setup
```

Seed (admin + categorias + regras, nada de dado de negócio): `npm run db:seed:dev`.
Aborta se o banco já tiver dados; `--forcar` exige a guarda completa.

## Verificação (somente leitura)

| Script | O que confere |
|---|---|
| `verify-ledger.ts` | partidas dobradas balanceadas (`npm run verify:ledger`) |
| `verify-snapshots.ts` | fotografias mensais vs recálculo (`npm run verify:snapshots`) |
| `verify-metric-parity.ts` | paridade dicionário de métricas × serviços |

## Gates do CI (rodam no `npm run verify`)

| Script | Gate |
|---|---|
| `check-design-tokens.mjs` | `lint:tokens` — cor/tipografia só via token |
| `auditoria-aa.mjs` | `audit:aa` — acessibilidade AA mecânica; par de contraste não resolvido REPROVA (gate nunca fica cego em silêncio) |

## `archive/`

História, não ferramenta: migrações e backfills já executados
(`import-reestruturacao`, `backfill-sales-owner`, `cutover-dry-run`,
`verify-decimal-backfill`, `verify-timestamps`), o `wipe-data` superado pelo
`inicio-limpo`, e os testes manuais da era v1 (`test-*.ts`). Não rode nada
daqui sem ler o cabeçalho do arquivo — e sem a guarda, nada roda mesmo.
