# Scripts de manutenção — B2C Finance

Todos os scripts exigem `POSTGRES_PRISMA_URL` no ambiente ou num arquivo `.env`
na raiz do projeto (o mesmo valor usado na Vercel/Supabase).

## Migrations (uma vez, antes do próximo deploy)

O build de produção agora roda `prisma migrate deploy` (em vez de `db push` +
`seed` a cada deploy). Como o banco já existe, é preciso **marcar a baseline
como aplicada UMA única vez**:

```bash
npm run db:baseline        # marca a migration 0_init como já aplicada
npm run db:migrate:deploy  # aplica a migration nova (campos/índices)
```

Sem esse passo, o primeiro `prisma migrate deploy` falharia com P3005
(banco não vazio). Depois disso, todos os deploys aplicam migrations
automaticamente e o seed passa a ser manual (`npm run db:seed`).

## Limpeza de dados contaminados por importações antigas

O comportamento antigo de importação criava **parcelas futuras no banco**
(com valor dividido incorretamente por N) e espalhava compras de uma fatura
em faturas de meses diferentes. Dois scripts cuidam disso:

### 1. Diagnóstico (somente leitura)

```bash
npm run db:diagnose
```

Relata: parcelas fantasma, importações fragmentadas em várias faturas,
faturas com total divergente e possíveis duplicatas. Não altera nada.

### 2. Correção (dry-run por padrão)

```bash
npm run db:fix-imported              # dry-run: mostra o que faria
npm run db:fix-imported -- --apply   # executa (com backup automático)
```

Com `--apply`, o script:
1. grava um backup JSON completo em `./backups/`;
2. preenche `installmentTotal`/`installmentGroupKey` nas transações
   importadas antigas (backfill de metadados);
3. remove as `Installment` fantasma de transações importadas
   (as de despesas manuais são preservadas);
4. recalcula o total de todas as faturas (compras − estornos).

**O que ele NÃO faz:** mover transações de faturas fragmentadas. Para
consolidar uma fatura antiga fragmentada, exclua as transações do lote
antigo e reimporte o PDF — a importação nova é ancorada no mês correto
e idempotente (reimportar o mesmo arquivo não duplica).

## Migração para multiusuário (isolamento por dono)

A partir desta versão, cada usuário só vê os próprios dados. Toda entidade
privada ganhou uma coluna `ownerId` e a extensão do Prisma
(`src/lib/prisma.ts`) injeta o dono automaticamente em toda leitura/criação.

Passo único no banco de produção (depois de aplicar a migration nova):

```bash
npm run db:migrate:deploy    # cria as colunas ownerId
npm run db:multiuser              # DRY-RUN: mostra o que faria
npm run db:multiuser -- --apply   # executa (com backup em ./backups/)
```

Com `--apply`, o script:
1. grava backup JSON completo;
2. apaga os lançamentos de teste (transações, parcelas, faturas, receitas,
   a receber, pagamentos, movimentos de caixa, importações) e logs de
   IA/WhatsApp;
3. atribui `ownerId = admin primário` a tudo que foi preservado (contas,
   cartões, pessoas, metas, regras) e zera o saldo dos caixas.

Depois disso, os demais usuários (ex.: Alvaro) começam com a conta vazia e o
admin mantém o setup preservado — sem vazamento entre contas.

## Ordem recomendada (deploy desta versão)

1. `npm run db:baseline` (só na 1ª vez, se ainda não feito)
2. `npm run db:migrate:deploy`
3. `npm run db:multiuser` (conferir) → `npm run db:multiuser -- --apply`
4. Deploy normal na Vercel.
