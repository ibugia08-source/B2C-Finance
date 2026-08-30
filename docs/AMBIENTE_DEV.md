# Ambiente de Desenvolvimento — B2C Finance

Como ter **o sistema completo, na versão atual, sem nenhum dado** — separado da
produção. Trabalho novo acontece na branch **`dev`**, apontando para um **banco
próprio e vazio**.

---

## Por que um banco separado é obrigatório

Uma branch do Git carrega **apenas código**. Os dados vivem no banco (Supabase).
Hoje o `.env` local aponta para o **banco de produção** — então, sem esta
configuração, desenvolver na `dev` continuaria lendo e gravando **dados reais de
clientes**.

```
                    ┌─────────────────────────┐
  branch main  ───► │  Vercel (produção)      │ ──┐
                    └─────────────────────────┘   │
                                                  ├──► Supabase PRODUÇÃO
  .env local (hoje) ──────────────────────────────┘     (dados reais)  ⚠️

  ── depois desta configuração ──

                    ┌─────────────────────────┐
  branch main  ───► │  Vercel (produção)      │ ─────► Supabase PRODUÇÃO
                    └─────────────────────────┘
                    ┌─────────────────────────┐
  branch dev   ───► │  Vercel (preview)       │ ──┐
                    └─────────────────────────┘   ├──► Supabase DEV
  .env local  ────────────────────────────────────┘     (vazio)  ✅
```

---

## Opção rápida — Postgres local, sem instalar nada (EM USO)

Este é o ambiente montado em 29/08/2026 e o que está rodando hoje. Usa um
Postgres real baixado por npm (`embedded-postgres`), fora do repositório, em
`../.devdb`. Não exige Docker, Homebrew nem conta na nuvem.

```bash
# 1. Banco local (deixe este terminal aberto — é o servidor do banco)
cd ~/Desktop/B2C-FINANCE/.devdb && node start-db.mjs

# 2. Aplicação, em outro terminal
cd ~/Desktop/B2C-FINANCE/bugia-Finance && npm run dev
```

- Banco: `postgres://b2cdev:b2cdev@127.0.0.1:55432/b2c_finance_dev`
- Dados persistem em `../.devdb/data` entre reinícios.
- O `.env` do repositório já aponta para ele; o de produção ficou guardado
  em `.env.producao.backup`.

> **Detalhe que quebra a instalação em Postgres puro:** a migration
> `20260724000000_security_rls_login_throttle` faz
> `REVOKE ... FROM anon, authenticated` — roles que existem no Supabase mas não
> num Postgres comum. O `start-db.mjs init` cria as duas antes de migrar. Sem
> isso, `db:migrate:deploy` falha com *role "anon" does not exist*.

Para recriar do zero: apague `../.devdb/data`, rode `node start-db.mjs init` e
depois `npm run db:migrate:deploy && npm run db:seed:dev`.

Limitação: é local. Para ter **preview online** na Vercel, siga a opção Supabase
abaixo.

---

## Opção com nuvem — Supabase (necessária para preview online)

### Passo 1 — Criar o projeto Supabase de desenvolvimento

1. Acesse [supabase.com/dashboard](https://supabase.com/dashboard) → **New project**.
2. Preencha:
   - **Name**: `b2c-finance-dev`
   - **Database Password**: gere uma forte e **guarde** (ela entra na connection string)
   - **Region**: `South America (São Paulo)` — mesma região da produção
   - **Plan**: Free
3. Aguarde ~2 minutos até o projeto ficar pronto.

## Passo 2 — Copiar as duas connection strings

No projeto **dev**: botão **Connect** (topo) → aba **ORMs** → **Prisma**.
Copie os dois valores e troque `[YOUR-PASSWORD]` pela senha do passo 1:

| Variável | Porta | Uso |
|---|---|---|
| `POSTGRES_PRISMA_URL` | **6543** (pooler) | app em runtime |
| `POSTGRES_URL_NON_POOLING` | **5432** (direta) | migrations |

## Passo 3 — Apontar o ambiente local para o banco dev

```bash
cd ~/Desktop/B2C-FINANCE/bugia-Finance

# 1. GUARDE o .env atual (ele aponta para PRODUÇÃO) — fica fora do Git
cp .env .env.producao.backup

# 2. Crie o .env de desenvolvimento a partir do modelo
cp .env.development.example .env

# 3. Edite o .env e preencha:
#    - POSTGRES_PRISMA_URL e POSTGRES_URL_NON_POOLING (passo 2)
#    - SESSION_SECRET  → gere um NOVO, diferente do de produção:
#        node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"
#    - ADMIN_PASSWORD  → a senha com que você vai logar no sistema dev
```

> O Prisma CLI e os scripts leem **`.env`** (não `.env.development`). Por isso o
> arquivo de trabalho local é o `.env` — e por isso o backup do de produção é o
> primeiro passo. Nenhum `.env` real vai para o Git.

## Passo 4 — Criar a estrutura e deixar o sistema pronto (sem dados)

```bash
npm install                  # se ainda não instalou
npm run prisma:generate      # gera o client do Prisma
npm run db:migrate:deploy    # aplica as 24 migrations no banco vazio
npm run db:seed:dev          # SÓ admin + categorias + regras
```

O `db:seed:dev` cria **apenas**:

- o **usuário administrador** (para você conseguir logar);
- as **16 categorias** globais;
- as **8 regras** de categorização.

E **não cria** nenhum cliente, contrato, cobrança, pagamento, receita, despesa,
pessoa, cartão, colaborador, folha ou caixa. Ao final ele imprime a contagem de
cada tabela de negócio, provando que estão zeradas.

> 🔒 **Trava de segurança**: se o banco alvo já tiver dados de negócio, o script
> **aborta** e avisa que o `.env` provavelmente aponta para produção. Rodar assim
> mesmo exige `--forcar` — nunca use isso contra produção.

## Passo 5 — Subir o sistema

```bash
npm run dev     # http://localhost:3100
```

> **Por que 3100 e não 3000?** A porta 3000 já é usada por outro projeto nesta
> máquina (`actus-hub-onboarding`). O `npm run dev` do B2C Finance está fixado em
> **3100** no `package.json` para os dois rodarem ao mesmo tempo, sem conflito.
> Para servir o build de produção localmente use `npm run start:local` (também
> na 3100) — o `npm start` continua sem porta fixa, como a Vercel espera.

Login: o `ADMIN_EMAIL` e o `ADMIN_PASSWORD` que você definiu no `.env`.
O sistema abre **completo e vazio** — todos os 19 módulos, zero dados.

---

## Passo 6 — Preview online na Vercel (opcional, mas recomendado)

Por padrão, um **preview** da Vercel herda as variáveis de **produção** — ou
seja, o preview da branch `dev` leria o **banco de produção**. Para separar:

1. Vercel → projeto B2C → **Settings** → **Environment Variables**.
2. Para `POSTGRES_PRISMA_URL`, `POSTGRES_URL_NON_POOLING` e `SESSION_SECRET`:
   adicione uma nova entrada com o **valor de desenvolvimento**, marcando
   **apenas** o ambiente **Preview** (deixe Production com o valor atual).
   - Se aparecer a opção *Branch*, restrinja a `dev`.
3. Faça um push na `dev` — o preview passa a usar o banco vazio.

> Enquanto isso não estiver configurado, **não abra o preview da `dev`**: ele
> escreveria no banco de produção.

---

## Fluxo de trabalho a partir daqui

```bash
# sempre partindo da dev atualizada
git checkout dev && git pull

# uma branch por assunto
git checkout -b feat/nome-da-melhoria

# ... implementar ...
npm run build:ci            # obrigatório: verde antes de commitar
git add -A && git commit -m "feat: ..."
git push -u origin feat/nome-da-melhoria

# PR: feat/nome-da-melhoria → dev
```

| Branch | Papel | Deploy |
|---|---|---|
| `main` | produção — **não commitar direto** | Vercel publica em produção a cada push |
| `dev` | integração das melhorias | preview da Vercel (com banco dev, após o passo 6) |
| `feat/*`, `fix/*` | um assunto por branch | preview por PR |

Quando um conjunto de melhorias estiver validado na `dev`, abre-se um PR
**`dev` → `main`** para publicar em produção.

---

## Voltar a apontar para produção (quando precisar)

```bash
cp .env .env.dev.backup          # guarda o dev
cp .env.producao.backup .env     # volta para produção
```

⚠️ Depois disso, qualquer comando local (inclusive `npm run dev` e os scripts de
`scripts/`) volta a mexer em **dados reais**. Faça o caminho inverso assim que
terminar.

---

## Resumo dos comandos

| Comando | O que faz |
|---|---|
| `npm run db:migrate:deploy` | aplica as migrations (cria as 55 tabelas) |
| `npm run db:seed:dev` | admin + categorias + regras · **zero dados de negócio** |
| `npm run db:seed` | seed completo, **com** pessoas e cartões de exemplo (não use em dev limpo) |
| `npm run dev` | sobe o sistema em http://localhost:3100 |
| `npm run build:ci` | valida typecheck + build (obrigatório antes de commitar) |
| `npm run prisma:studio` | inspeciona o banco numa interface visual |
