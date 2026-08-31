# Ambientes do B2C Finance

Referência normativa: `docs/spec/03-engenharia-seguranca-roadmap.md` §4.6.
Tarefa de origem: **F0.1** do `EXECUTAR.md`.

## Os três ambientes

| Ambiente | Banco | Para quê | `APP_ENV` |
| --- | --- | --- | --- |
| **local** | `b2c_finance_dev` (Postgres embarcado, porta 55432) | desenvolvimento do dia a dia | `local` |
| **staging** | `b2c_finance_staging` (mesma instância, banco separado) | validar os GATES de fase (cenários S1–S27) com dados migrados | `staging` |
| **produção** | Supabase (Vercel) | uso real da agência | `production` |

Produção e staging **nunca** compartilham banco. O `.env` do repositório
aponta para **local** por padrão; os valores de produção vivem só na Vercel.

## Subir o ambiente local

```bash
cd ~/Desktop/B2C-FINANCE && node .devdb/start-db.mjs   # deixa rodando
cd bugia-Finance && cp .env.example .env               # já vem local
npx prisma migrate deploy && npm run db:seed:dev
npm run dev                                            # http://localhost:3100
```

## Trabalhar em staging

```bash
cp .env.staging.example .env
npx prisma migrate deploy      # o banco b2c_finance_staging já existe
npm run dev
```

Para voltar ao local, `cp .env.example .env`. O arquivo `.env` é o único
seletor de ambiente — não há flag escondida.

## A guarda dos scripts (`scripts/guard.ts`)

Todo script que **altera dados** chama `assertDestructiveAllowed()` e só roda
com as três travas satisfeitas:

1. `APP_ENV` declarado explicitamente (`local` | `staging` | `production`);
2. `ALLOW_DESTRUCTIVE=true`;
3. o `APP_ENV` declarado **bate** com o ambiente deduzido da URL do banco.

A trava 3 é a que importa: ela impede um `APP_ENV=local` apontando para o
banco de produção. Exemplo de uso:

```bash
APP_ENV=local ALLOW_DESTRUCTIVE=true npx tsx scripts/wipe-data.ts --confirmar
```

Produção exige, além disso, `allowProduction: true` **no código** do script.
Nenhum script do repositório passa essa opção: rodar contra produção é uma
mudança revisada, não uma variável de ambiente.

Scripts sensíveis que não apagam nada (ex.: `mint-token.ts`, que emite sessão
de administrador) usam `assertNotProduction()` — dispensam `ALLOW_DESTRUCTIVE`,
mas recusam produção.

## Staging hospedado (quando existir)

Ao criar um projeto Supabase de staging, a URL precisa conter `staging` no
host ou no nome do banco — é assim que a guarda o distingue de produção.
Sem isso, ela trata o banco como produção e recusa a execução (falha fechada,
por decisão).
