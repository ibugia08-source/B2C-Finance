## Ambientes

| Ambiente | Onde | Banco |
|---|---|---|
| Desenvolvimento | `npm run dev`, porta 3100 | PostgreSQL local |
| Produção | Vercel, região `gru1` | PostgreSQL gerenciado |

> **Cuidado:** o `.env` local pode apontar para o banco de produção. Rodar o
> app localmente então **lê e escreve dados reais**. Confira antes de rodar
> qualquer script destrutivo.

## Publicação

Quem publica é a **Vercel**, automaticamente, no push para `main`. O workflow
do GitHub Actions apenas valida — ele não faz deploy. Não existe passo manual
de publicação, e por isso o que entra na `main` vai para produção.

## Instalação limpa

Um banco vazio subia quebrado até existir o bootstrap, que roda no build e
exige `ADMIN_PASSWORD` na primeira publicação. É ele que cria o workspace, o
usuário administrador e o plano de contas inicial.

## Armadilha do build local

`npm run build:ci` sobrescreve o diretório `.next` que o servidor de
desenvolvimento está usando. Se havia um `npm run dev` no ar, **reinicie-o**
depois de buildar — senão ele serve um estado corrompido e o sintoma não
parece ter relação com o build.

## Comandos de banco

| Comando | Uso |
|---|---|
| `npm run db:migrate:deploy` | aplica migrações pendentes |
| `npm run db:seed` | popula dados de desenvolvimento |
| `npm run db:bootstrap` | cria workspace, admin e plano de contas |
| `npm run prisma:studio` | inspeção visual do banco |

`npm run build` roda `prisma migrate deploy` **no banco real** — só a Vercel
deve usá-lo. Para validar o build localmente, use `build:ci`.

## Verificações periódicas

| Comando | O que confere |
|---|---|
| `npm run verify:ledger` | o razão está balanceado (débitos = créditos) |
| `npm run verify:snapshots` | as fotografias batem com os totais recalculados |
| `npm run outbox:worker` | processa a fila de integrações externas |
| `npm run relatorios:agendados` | dispara os relatórios por e-mail |
