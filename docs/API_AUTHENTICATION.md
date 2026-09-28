# Autenticação da API oficial (`/api/v1`)

> Implementado em 28/09/2026. Plano geral: [`API_IMPLEMENTATION_PLAN.md`](./API_IMPLEMENTATION_PLAN.md) (fase F1).

Sistemas externos, como o n8n, acessam a API com uma **conta de serviço** (Service Account) própria. Uma conta de serviço não é um usuário:

- não faz login;
- não usa cookie;
- não tem papel.

Ela pode exatamente o que a lista de **scopes** dela permite. O cookie de sessão do navegador **não** abre a API: as rotas `/api/v1` só leem o header `Authorization`.

---

## 1. Como chamar

```http
GET /api/v1/me HTTP/1.1
Host: b2-c-finance.vercel.app
Authorization: Bearer b2c_live_k3j9x2ma_Qm9...43 caracteres...
x-correlation-id: exec-123        (opcional; ecoado na resposta)
```

`GET /api/v1/me` é o teste de conexão. Qualquer token válido acessa, e a rota não devolve dado de negócio:

```json
{ "data": { "type": "service_account", "id": "cm…", "name": "B2C Finance AI Agent",
            "tokenPrefix": "b2c_live_k3j9x2ma", "scopes": ["clients.read", "dashboard.read"] } }
```

**No n8n:**
1. Crie uma credencial do tipo **Header Auth**, com nome `Authorization` e valor `Bearer <token>`.
2. Use essa credencial nos nós HTTP Request.

## 2. Formato do token

```
b2c_live_<prefixo 8 [a-z0-9]>_<segredo 43 base64url>
```

| Parte | Função |
|---|---|
| `b2c_live_` | Deixa o token reconhecível por varredores de segredo (GitHub secret scanning, gitleaks) e por quem o encontra num log. |
| prefixo | É **público**: identifica a chave no banco (índice único) e na tela. Não dá acesso a nada sozinho. |
| segredo | 32 bytes de `crypto.randomBytes` (256 bits). |

## 3. Armazenamento

- **O token nunca é gravado.** O banco guarda:
  - `tokenHash = sha256(token)` em hex;
  - `tokenPrefix`.
- A constraint `ServiceAccount_tokenHash_sha256` recusa qualquer valor que não seja um SHA-256 hex. Assim, gravar o token puro por engano falha no banco.
- **Por que SHA-256, e não bcrypt ou pepper:**
  - O segredo tem 256 bits de entropia, então força bruta offline é inviável mesmo com o banco vazado. bcrypt e argon2 existem para senhas humanas, que têm baixa entropia.
  - Não há pepper para perder ou rotacionar, e nenhuma variável de ambiente nova é exigida.
- O token completo aparece **uma única vez**, na resposta da criação ou da rotação. Ele não fica:
  - no banco;
  - na auditoria, que registra só o prefixo;
  - no HTML das páginas;
  - nos logs.

## 4. Validação de cada requisição

A validação fica em `src/lib/api/auth.ts`, em `authenticateApiToken` e `withApiAuth`. Os passos, em ordem:

| # | Verificação | Falha |
|---|---|---|
| 1 | O header `Authorization: Bearer …` está presente. | 401 `missing_token` |
| 2 | O formato do token é válido. Um formato inválido não consulta o banco. | 401 `invalid_token` |
| 3 | A conta existe: busca **por prefixo**, a única leitura sem escopo de dono. | 401 `invalid_token` |
| 4 | O hash confere, comparado em **tempo constante** (`timingSafeEqual`). Quando o prefixo não existe, a comparação roda contra um hash fantasma: "prefixo inexistente" e "segredo errado" custam o mesmo tempo e têm a mesma resposta. | 401 `invalid_token` |
| 5 | Status `ACTIVE` e sem `revokedAt`. | 401 `revoked_token` |
| 6 | `expiresAt` ainda no futuro. | 401 `expired_token` |
| 7 | O dono (`ownerId`) existe e está ativo. | 401 `inactive_owner` |
| 8 | O scope da rota (`requireApiScope`). | 403 `insufficient_scope` |

- **Respostas de erro:**
  - Formato: `{ "error": { "code", "message", "scope"? } }`.
  - Header `WWW-Authenticate` conforme a RFC 6750.
  - `Cache-Control: no-store`.
- **Erro inesperado:** vira 500 `internal_error`, sem detalhe na resposta. O detalhe fica no log do servidor, junto com o `correlationId`.
- **Revogação:** vale imediatamente, porque a conta é relida a cada requisição, sem cache.

### Dono (ownerId)

- O handler roda dentro de `runWithPrincipal(conta.ownerId, principal)`, e esse dono é fixado antes de qualquer query. A extensão do Prisma escopa tudo por ele, e `resolveOwnerId` nunca chega ao cookie.
- A conta pertence ao **workspace**, por meio do `ownerId` do dono dos dados, e não a quem a criou. O `createdById` só registra quem a criou.

### Principal e defesa em profundidade

- **Principal da chamada:** `{ kind: "system", name: "api:<nome>", origin: "API", serviceAccount: { id, name, scopes } }`. A auditoria dos motores sai com `origin=API` e ator `sistema:api:<nome>`.
- **Diferença para jobs e webhooks:**
  - Job ou webhook (sistema sem conta de serviço): continua podendo tudo.
  - Conta de serviço: `domainCan`, a guarda de permissão dos motores (`guardPermission`) e o acesso a relatórios só permitem o que os scopes cobrem.
- **Como a checagem funciona:**
  - Cada permissão do RBAC que o domínio pergunta é traduzida pelo mapa `PERMISSION_TO_SCOPE`, em `src/lib/api/scopes.ts`.
  - Uma permissão sem entrada no mapa é **negada** à conta. Por isso exclusões, usuários, fechamento e folha são inalcançáveis, mesmo que um endpoint chame uma função que faça mais do que declarou.

### lastUsedAt

- É gravado no máximo **uma vez por minuto** por conta (`LAST_USED_JANELA_MS`), não a cada requisição.
- A escrita é um `updateMany` que repete a condição de tempo no `WHERE`. Com isso, chamadas simultâneas geram no máximo uma escrita efetiva.
- Falha nessa escrita nunca derruba a requisição.

### Rate limit

- O middleware limita `/api/v1/*` a **120 requisições por minuto por IP**, em memória por instância, no mesmo modelo do login e dos webhooks.
- O limite por chave, compartilhado entre instâncias, fica para a fase F7 do plano.

## 5. Scopes

O catálogo fica em `src/lib/api/scopes.ts`. O formato é `recurso.acao`, em inglês, porque faz parte do contrato público da API.

| Scope | Permite | Permissão do RBAC coberta |
|---|---|---|
| `clients.read` | Ler clientes | `clientes.visualizar`, `clientes.ver_dados_financeiros` |
| `clients.create` | Cadastrar clientes | `clientes.criar` |
| `clients.update` | Editar clientes | `clientes.editar` |
| `client_status.read` | Ler status e histórico com vigência | — |
| `client_status.write` | Alterar, programar e cancelar status | `clientes.alterar_status`, `programar_status`, `alterar_status_retroativo` |
| `receivables.read` | Ler cobranças e recebimentos | `recebimentos.visualizar`, `ver_inadimplencia` |
| `receivables.register_payment` | Registrar pagamento | `recebimentos.registrar_pagamento`, `rotina.registrar_pagamento` |
| `expenses.read` / `.create` / `.update` / `.pay` | Despesas | `despesas.visualizar` / `criar` / `editar` / `marcar_como_paga` |
| `cash.read` | Caixa e saldos | `caixa.visualizar` |
| `upsells.read` / `.create` / `.update` | Upsell | `upsell.visualizar` / `criar` / `editar`, `marcar_vendido` |
| `dashboard.read` | Indicadores | `dashboard.visualizar`, `ver_financeiro` |
| `routine.read` | Rotina do dia | `rotina.visualizar` |
| `reports.read` | Relatórios. Cada relatório também exige os scopes das permissões dele. | `relatorios.visualizar` |
| `identities.resolve` | Resolver número de WhatsApp → usuário (`POST /integrations/resolve-identity`) e agir em nome dele (`X-B2C-Identity`, com os scopes recortados pelo RBAC do usuário) | — (da integração, não delegável) |
| `agent_actions.manage` | Propor ações do agente e executá-las após o `SIM <código>` do usuário (`/agent/pending-actions`). Sozinho não escreve nada: a execução exige o scope da operação. | — (delegado só a quem tem algum scope de escrita) |

**Regras:**

- **Não existe curinga**, nem quando quem cria a conta é ADMIN.
- **Nunca concedíveis** (`FORBIDDEN_SCOPES`, fora do catálogo): `users.manage`, `permissions.manage`, `clients.delete`, `receivables.delete`, `competences.reopen`, `payments.delete`, `expenses.delete`, `chart_of_accounts.manage`.
- **Pedido com qualquer scope desconhecido ou proibido é recusado por inteiro.** Um pedido "meio aceito" deixaria a integração com menos poder do que quem a criou acha que deu.

Por enquanto, a única rota é `/me`. Os endpoints de negócio chegam na fase F2 do plano, e cada um declara o seu scope em `withApiAuth("<scope>", handler)`.

## 6. Gestão (Configurações → Integrações)

A tela fica em `/configuracoes/integracoes` e aparece no menu Sistema como **Integrações (API)**.

| Permissão (RBAC) | Quem tem | O que libera |
|---|---|---|
| `integracoes.visualizar` | ADMIN; concedível na matriz | Ver a lista, os scopes, o último uso e a validade |
| `integracoes.gerenciar` | **Só o ADMIN**, travada na matriz (`ADMIN_ONLY_PERMISSIONS`) | Criar, revogar e rotacionar |

- **Trava da matriz também no servidor:** a action de usuários descarta overrides de permissões `ADMIN_ONLY`. A trava da tela não vale contra um POST montado à mão.
- **Quem não gerencia:** um principal de sistema, inclusive uma conta de serviço chamando a API, **nunca** gerencia integrações. Uma chave não cria outra chave.

**Operações**, em `src/lib/services/service-accounts.ts`, todas auditadas com `entity = "ServiceAccount"`:

- **Criar:**
  - Campos: nome, descrição, scopes e validade (30, 90, 180 ou 365 dias, ou sem expiração; o padrão é 180).
  - O token é mostrado uma vez, com botão Copiar.
- **Revogar:**
  - Muda o status para `REVOKED` e grava `revokedAt` e `revokedById`.
  - O efeito é imediato e irreversível. Uma integração revogada não é rotacionada; crie uma nova.
- **Rotacionar:**
  - Gera um token novo, troca o hash e o prefixo e grava `rotatedAt`.
  - O token anterior para de funcionar na hora, sem período de convivência. Atualize a credencial no n8n logo em seguida.
  - A validade renova pelo mesmo prazo que a chave tinha.

## 7. Modelo de dados

A migration é `20260928120000_service_accounts_api` e é **aditiva**: cria dois enums e uma tabela, não altera nenhuma tabela existente e liga o RLS na tabela nova (regra F1.12).

```prisma
model ServiceAccount {
  id, ownerId, type (INTEGRATION), status (ACTIVE | REVOKED),
  name, description?, tokenHash, tokenPrefix @unique, scopes String[],
  createdAt, updatedAt, lastUsedAt?, expiresAt?, revokedAt?, revokedById?, rotatedAt?, createdById
}
```

- **Escopo por dono:** `ServiceAccount` está em `OWNED_MODELS`, então toda leitura e escrita da tela é escopada por dono. A única leitura sem escopo é a busca do token por prefixo.
- **Checks no banco:**
  - `tokenHash` precisa ser um SHA-256 hex;
  - `status = REVOKED` equivale a `revokedAt IS NOT NULL`.
- **Aplicação da migration:** ela **não** é executada à mão contra produção. A Vercel aplica a migration no build de produção, pelo pipeline padrão (`migrate deploy`), como as anteriores.

## 8. Resposta a incidente (token vazado)

1. Em **Configurações → Integrações**, clique em **Rotacionar**, para manter a integração com outro token, ou em **Revogar**. O efeito é imediato.
2. Atualize a credencial no n8n.
3. Na auditoria (`AuditLog`, entidade `ServiceAccount`), confira quem criou, rotacionou ou revogou a chave. O registro por requisição (`ApiRequestLog`) chega nas próximas fases do plano.

## 9. Testes

`tests/api-autenticacao.test.ts` cobre:

- **Tokens:**
  - token válido e `GET` protegido com 200;
  - token inválido: ausente, malformado, segredo errado e prefixo inexistente;
  - cookie não autentica;
  - revogado; expirado; dono inativo;
  - rotação (o antigo cai e o novo entra).
- **Armazenamento:**
  - o banco guarda só o hash, e a auditoria não guarda o segredo;
  - o check recusa o token puro;
  - amostragem de `lastUsedAt`.
- **Scopes:**
  - scope ausente dá 403 sem executar o handler;
  - a conta esbarra no scope dentro do domínio e na guarda dos motores;
  - o catálogo não tem curinga nem scopes proibidos.
- **Isolamento por dono:**
  - a API lê os clientes de A e nunca os de B;
  - B não vê, não revoga e não rotaciona a conta de A.
- **Permissão para gerenciar:**
  - usuário sem permissão administrativa não cria, não revoga e não rotaciona;
  - conta de serviço e job não criam chaves;
  - `integracoes.gerenciar` é só do ADMIN.
