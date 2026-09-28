# API B2C Finance — V1 (leitura)

> 28/09/2026. Autenticação e scopes: [`API_AUTHENTICATION.md`](./API_AUTHENTICATION.md). Plano geral: [`API_IMPLEMENTATION_PLAN.md`](./API_IMPLEMENTATION_PLAN.md).
>
> **Especificação formal:** OpenAPI 3.1 em `/api/openapi.json` (cópia versionada: [`api/openapi.json`](./api/openapi.json)); interface interativa em `/api/docs`. Guia com exemplos curl: [`API_CONSUMER_GUIDE.md`](./API_CONSUMER_GUIDE.md). A fonte da especificação é `src/lib/api/openapi.ts`: depois de mudar uma rota, rode `npm run openapi:lint`, que regenera o arquivo e o valida. O teste `tests/api-openapi.test.ts` falha se a rota, o scope ou o arquivo divergirem.

**Base URL:** `https://b2-c-finance.vercel.app/api/v1`.

Todas as rotas desta versão são **somente leitura** (`GET`). Nenhuma delas grava nada no banco. Em particular, a API **não** executa as rotinas que a interface roda ao abrir telas, como marcar cobranças vencidas ou gerar as mensalidades do mês.

## 1. Regras comuns

- **Autenticação:** `Authorization: Bearer b2c_live_…`, com o token de uma conta de serviço criada em **Configurações → Integrações**. Cookie de sessão não vale.
- **Scope:** cada rota exige um scope (ver tabela na seção 3).
  - Conta sem o scope recebe **403** `insufficient_scope`.
  - Dentro das funções de domínio, a conta de serviço também só alcança o que os scopes cobrem.
- **Dono (ownerId):** toda consulta roda no escopo do dono da conta de serviço.
  - Registro de outro dono **não aparece** nas listas.
  - No detalhe, id de outro dono responde **404** (nunca 403, para não confirmar que o registro existe).
- **Parâmetros:** validados com Zod.
  - Parâmetro **desconhecido** é recusado com 400. Um filtro digitado errado que fosse ignorado devolveria a lista inteira, e o agente acharia que filtrou.
  - Datas no formato `AAAA-MM-DD`. Competência no formato `AAAA-MM`.
- **requestId:**
  - Cada resposta traz `meta.requestId` e o header `x-request-id`.
  - Se a chamada enviar `x-request-id` (ou `x-correlation-id`), esse valor é reaproveitado. Use o id da execução do n8n.
- **Erros:** nunca expõem stack trace nem mensagem interna. O detalhe fica no log do servidor, ligado ao `requestId`.
- **Cache:** respostas com `Cache-Control: no-store`.
- **Rate limit:** 120 requisições por minuto por IP. Acima disso, **429** `rate_limited`.

### Formato de sucesso

```json
{
  "success": true,
  "data": { },
  "meta": { "requestId": "…", "generatedAt": "2026-09-28T13:00:00.000Z" }
}
```

Listas trazem `data` como array e `meta.pagination`:

```json
"meta": {
  "requestId": "…", "generatedAt": "…",
  "pagination": { "page": 1, "pageSize": 50, "total": 132, "totalPages": 3 }
}
```

Parâmetros de paginação: `page` (a partir de 1) e `pageSize` (padrão 50, máximo 200).

### Formato de erro

```json
{
  "success": false,
  "error": { "code": "validation_error", "message": "Parâmetros de consulta inválidos.",
             "details": [{ "field": "competence", "message": "Use o formato AAAA-MM (ex.: 2026-09)." }] },
  "meta": { "requestId": "…" }
}
```

| HTTP | `code` | Quando |
|---|---|---|
| 400 | `validation_error` | Parâmetro inválido ou desconhecido. `details` lista os campos. |
| 401 | `missing_token`, `invalid_token`, `revoked_token`, `expired_token`, `inactive_owner` | Credencial ausente ou inválida. |
| 403 | `insufficient_scope` | A conta não tem o scope. O campo `scope` diz qual falta. |
| 404 | `not_found` | O registro não existe para este dono. |
| 429 | `rate_limited` | Limite por IP atingido. |
| 500 | `internal_error` | Erro inesperado. Informe o `requestId`. |

### Convenções dos dados

- **Dinheiro:** número em reais, com 2 casas (`1500.5`).
- **Datas de calendário** (vencimento, entrada, renovação): `"AAAA-MM-DD"`.
- **Instantes** (pagamento, criação): ISO 8601 em UTC.
- **Status de cliente:** `{ "code": "ACTIVE", "label": "Ativo" }`.

## 2. Status temporal do cliente

O status do cliente tem vigência. A fonte é o histórico `ClientStatusHistory`, nunca `Client.status`.

- **Nas listas:** o status é o **da competência** pedida em `competence` (padrão: a atual).
  - Para um mês passado, vale o status do **último dia** daquele mês.
  - Para o mês corrente, vale o status de **hoje**.
- **Exemplo:** um cliente que ficou Inativo em outubro aparece como **Ativo** em `GET /clients?competence=2026-09`.
- **Referência usada:** `meta.statusReference` informa a data de referência aplicada.
- **Carteira da competência:** uma lista só inclui clientes que **tinham status** naquela competência. Quem entrou depois não aparece num mês anterior.
- **No detalhe:** `status.current` é o status de hoje. Com `?competence=` a resposta também traz `status.atCompetence`. `status.scheduledChange` informa a próxima alteração programada.

## 3. Endpoints

| Método e rota | Scope |
|---|---|
| `GET /health` | — (qualquer token válido) |
| `GET /me` | — |
| `GET /dashboard/summary` | `dashboard.read` |
| `GET /clients` · `GET /clients/:id` | `clients.read` |
| `GET /clients/:id/status-history` | `client_status.read` |
| `GET /receivables` · `GET /receivables/:id` | `receivables.read` |
| `GET /expenses` · `GET /expenses/:id` | `expenses.read` |
| `GET /cash/summary` | `cash.read` |
| `GET /upsells` | `upsells.read` |
| `GET /routine/daily` | `routine.read` |
| `GET /reports/daily` · `GET /reports/monthly` | `reports.read` (as seções dependem de outros scopes; ver 3.9) |
| `GET /search` | `clients.read` (com `type=client`) |

### 3.1 `GET /health` e `GET /me`

- `/health` retorna `{ status: "ok", apiVersion: "v1", database: "ok" }`. Chegar a esta resposta já prova que a credencial e o banco funcionam.
- `/me` retorna a conta de serviço: id, nome, prefixo do token e scopes.

### 3.2 `GET /dashboard/summary?competence=AAAA-MM`

Retorna os indicadores oficiais do mês. Eles saem do **mesmo motor de métricas** do Dashboard (`computePeriodMetrics`).

```json
{ "competence": "2026-09", "partial": true,
  "metrics": { "mrr_oficial": { "value": 45200, "name": "MRR oficial", "unit": "currency" }, "…": {} } }
```

- **Chaves:**
  - Faturamento e receita: `faturamento_total`, `mrr_oficial`, `tcv_faturado`, `tcv_vendido`, `receita_extra_reconhecida`, `faturamento_esperado`.
  - Recebimento: `recebido_competencia`, `em_aberto`, `vencido`.
  - Resultado: `resultado_mes`, `margem_gerencial`, `percentual_recorrencia`, `percentual_realizacao`.
  - Clientes: `clientes_ativos`, `novos_clientes`, `churn_quantidade`, `churn_valor`, `churn_rate`, `ticket_medio`.
  - Custos: `custo_por_cliente`, `percentual_folha`.
- **`unit`:** `currency`, `percent` ou `count`.
- **Valor nulo:** `null` significa que o indicador não é calculável (por exemplo, denominador zero).

### 3.3 `GET /clients`

| Parâmetro | Descrição |
|---|---|
| `competence` | `AAAA-MM`. Competência do status (padrão: a atual). |
| `search` | Texto contido em nome, razão social, documento, e-mail, nicho, cidade ou responsáveis. |
| `status` | `LEAD`, `PROSPECT`, `ACTIVE`, `INACTIVE`, `PAUSED`, `RENEWAL`, `DELINQUENT`, `CHURNED`. Também aceita `revenue_active` (Ativo, Renovação ou Inadimplente, isto é, quem gera receita) e `all`. **Sem `status`:** todos menos `CHURNED`, como na tela. |
| `modality` | `MRR` ou `TCV`. |
| `responsible` | Responsável comercial, pelo nome, sem diferenciar maiúsculas. |
| `delinquency` | Inadimplência **na competência**: `paid`, `owing` ou `no_billing`. O ajuste manual do mês vence o cálculo pelas cobranças, como na tela. |
| `renewalMonth` | `AAAA-MM`. Expectativa de renovação naquele mês. |
| `segment` | Nicho, por nome ou id. |
| `page`, `pageSize` | Paginação. |

- **Item:**
  - Identificação: `id`, `name`, `legalName`, `document` (**mascarado**), `status`, `modality`, `segment`, `responsible`.
  - Contrato: `paymentDay`, `monthlyValue`, `totalContractValue`, `contractTerm` (`"12 meses"` ou `"Indeterminado"`), `expectedRenewalDate`, `startedAt`.
  - Situação: `delinquency` `{ status, manual }` e `scheduledStatusChange`.
- **Ordem:** por nome.
- **Fonte das regras:** os filtros usam o mesmo código da tela Clientes (`src/lib/services/client-query.ts`).

### 3.4 `GET /clients/:id` e `GET /clients/:id/status-history`

- **Detalhe** (`?competence=` opcional):
  - Cadastro com o **documento completo**, contatos e responsáveis.
  - `status` com `current`, `atCompetence` e `scheduledChange`.
  - `financial`, com contratos ativos, valor em aberto, vencido, receita total, próximo vencimento, situação e serviços ativos.
- **Histórico de status:** `intervals[]` com os campos `status`, `effectiveFrom`, `effectiveTo` (null quando é o vigente), `reason`, `origin`, `needsReview` e `recordedAt`.
  - `currentStatus` é o status de hoje.
  - `scheduled[]` lista as alterações futuras.

### 3.5 `GET /receivables` e `GET /receivables/:id`

| Parâmetro | Descrição |
|---|---|
| `competence` | `AAAA-MM`. Cobranças da competência. É a janela padrão, com a competência atual. |
| `dateFrom`, `dateTo` | Janela por **vencimento**, com as duas datas inclusivas e máximo de 400 dias. Os dois são obrigatórios juntos e não se combinam com `competence`. |
| `status` | Um ou mais, separados por vírgula: `UPCOMING`, `PAID`, `PAID_LATE`, `PAID_OTHER_MONTH`, `OVERDUE`, `DELINQUENT`, `PARTIAL`, `REMOVED`, `RENEGOTIATED`. O atalho `open` equivale a `UPCOMING`, `OVERDUE`, `DELINQUENT` e `PARTIAL`. |
| `clientId` | Só as cobranças deste cliente. |

- **Status:** é o mesmo da tela de Recebimentos (`cycleStatusOf`), **derivado na hora** a partir do vencimento. Uma cobrança pendente com vencimento passado já sai como `OVERDUE`, mesmo que o job ainda não a tenha marcado.
- **Canceladas e renegociadas:**
  - Cobranças removidas do mês (`REMOVED`) só aparecem quando pedidas.
  - `RENEGOTIATED` é a dívida já acordada: não conta como vencida e tem `openAmount` igual a 0.
- **Item:** `id`, `client`, `description`, `competence`, `amount`, `paidAmount`, `openAmount`, `dueDate`, `paidAt`, `status`, `daysLate`, `kind`, `revenueType`, `installmentNumber` e `collectionStatus`.
- **Totais:** `meta.totals` traz `{ amount, paidAmount, openAmount }` do filtro inteiro, não só da página.
- **Detalhe:** inclui `notes` e `payments[]`.

### 3.6 `GET /expenses` e `GET /expenses/:id`

| Parâmetro | Descrição |
|---|---|
| `dateFrom`, `dateTo` | Janela pela **data do lançamento**, inclusiva. O padrão é o mês atual. |
| `status` | `pendente`, `pago`, `cancelado` ou `vencida`. `vencida` é pendente com vencimento antes de hoje, a mesma regra da tela. `pendente` exclui as vencidas. |
| `category` | Id ou nome da categoria. |

- **O que entra:** só lançamentos do tipo despesa.
- **Item:** `id`, `description`, `amount`, `date`, `dueDate`, `status` (o derivado), `rawStatus`, `category`, `type`, `recurrence`, `recurring`, `paymentMethod`, `client` e `account`.
- **Totais:** `meta.totalAmount` soma o filtro inteiro.

### 3.7 `GET /cash/summary`

Usa as mesmas fontes da tela Caixa (`getLiquidez` e `getCashSummary`).

- **Posição de hoje:** `available`, `accountsBalance`, `commitments` e `breakdown[]`.
- **Próximos 30 dias:** `next30Days`.
- **`projection`:** saldo projetado. A receber vencido **não entra** no saldo projetado e aparece em separado.
- **`month`:** entradas, saídas e projeções de 30, 60 e 90 dias.

### 3.8 `GET /upsells`

| Parâmetro | Descrição |
|---|---|
| `status` | `OPPORTUNITY`, `NEGOTIATION`, `WON`, `LOST` ou `PAUSED`. |
| `clientId` | Id do cliente. |
| `responsible` | Nome do responsável, sem diferenciar maiúsculas. O B2C Finance grava o responsável do upsell como **texto**, sem vínculo a um usuário, por isso não existe filtro `responsibleId`. |

- **Totais:** `meta.totalValue` soma o valor potencial do filtro inteiro.

### 3.9 `GET /routine/daily`

Retorna a rotina do dia, com o **mesmo montador** da tela Rotina (`montarRotinaDoDia`).

- **Conteúdo:** `actions[]`, `collections` (vencidos e próximos), `payments` (vencidos e próximos), `renewals`, `cash` e `openUpsells`.
- **Seções limitadas pelos scopes:** cada seção só é preenchida se a conta tiver o scope da área:
  - `receivables.read` → cobranças;
  - `expenses.read` → pagamentos;
  - `cash.read` → caixa;
  - `clients.read` → renovações;
  - `upsells.read` → upsell.
- **Diferença para a tela:** a API **não** marca cobranças como vencidas antes de montar a rotina, porque isso seria uma escrita. A fila de cobrança usa o vencimento, então o conteúdo é o mesmo.

### 3.10 `GET /reports/daily?date=AAAA-MM-DD` e `GET /reports/monthly?competence=AAAA-MM`

Os relatórios exigem `reports.read`. **Cada seção** depende também do scope da área dela; o relatório não é um atalho para ler o que o scope não permite. As seções omitidas aparecem em `meta.omittedSections`.

- **Diário** (padrão: hoje):

  | Seção | Conteúdo | Scope exigido |
  |---|---|---|
  | `receivables` | Cobranças que vencem no dia e pagamentos confirmados no dia | `receivables.read` |
  | `expenses` | Despesas que vencem no dia (ou lançadas no dia, quando não têm vencimento) | `expenses.read` |
  | `clients` | Mudanças de status com vigência no dia e clientes que entraram no dia | `clients.read` ou `client_status.read` |

- **Mensal** (padrão: a competência atual):

  | Seção | Conteúdo | Scope exigido |
  |---|---|---|
  | `closing` | Estado do fechamento da competência | — (sempre incluída) |
  | `indicators` | Os mesmos indicadores de `/dashboard/summary` | `dashboard.read` |
  | `portfolio` | Carteira por status **na competência** | `clients.read` ou `client_status.read` |
  | `receivables` | Contagem, totais e divisão por status | `receivables.read` |
  | `expenses` | Total e divisão por status | `expenses.read` |

### 3.11 `GET /search?q=…&type=client`

Serve para o agente descobrir de qual cliente o usuário está falando. Exemplo: `GET /search?q=face%20love&type=client`.

| Parâmetro | Descrição |
|---|---|
| `q` | De 2 a 100 caracteres. |
| `type` | `client` (padrão). É o único tipo nesta versão. |
| `limit` | De 1 a 25 (padrão 10). |

- **Casamento:**
  - Considera nome, razão social e documento.
  - **Ignora acento, maiúsculas e espaços:** `facelove estetica` acha "Face Love Estética".
  - Para o documento, bastam 4 dígitos ou mais.
- **Ordem:** por relevância (`score` de 0 a 100) e, em empate, por nome.
- **Resultado:** traz só o necessário para desambiguar:

```json
{ "type": "client", "id": "cm…", "name": "Face Love Estética", "legalName": "Face Love Clínica Ltda",
  "document": "**.***.***/0001-90", "status": { "code": "ACTIVE", "label": "Ativo" }, "modality": "MRR", "score": 90 }
```

- **Status:** o `status` é o de **hoje**.
- **Máscara do documento:** o CNPJ mostra filial e dígitos verificadores; o CPF mostra só os dígitos verificadores.
- **Total:** `meta.total` diz quantos clientes casaram. Se houver vários, o agente deve perguntar ao usuário qual deles.

## 4. Implementação

- **Onde está o código:**
  - Rotas: `src/app/api/v1/**/route.ts`. Cada rota é um `defineEndpoint({ scope, query, params }, handler)`, em `src/lib/api/http.ts`.
  - Montagem das respostas: `src/lib/api/v1/*.ts`. Esses módulos só **compõem** funções de domínio existentes: o motor de métricas, a linha do tempo de status, `cycleStatusOf`, `montarRotinaDoDia`, a liquidez e o fechamento.
  - Filtros da carteira: foram extraídos da tela Clientes para `src/lib/services/client-query.ts`, e a tela passou a usá-los. A tela e a API usam as **mesmas** regras.
- **Sem N+1:** listas montam um índice leve de ids e depois carregam status, inadimplência, alterações programadas e linhas da página **em lote**. O número de consultas é fixo, independente do tamanho da página.
- **Cache por conta de serviço:** o cache (`ownerCached`) usa o principal da chamada antes do cookie. A conta de serviço tem entrada de cache própria, e uma chamada da API com cookie de navegador junto não lê a entrada da sessão.
- **Testes:** `tests/api-v1-leitura.test.ts`, testes de integração que chamam os Route Handlers reais com token real e banco de testes. Cobrem:
  - contrato e erros;
  - scope;
  - dono;
  - paginação;
  - filtros;
  - status temporal;
  - busca;
  - recebimentos sem escrita;
  - relatórios com seções omitidas.
