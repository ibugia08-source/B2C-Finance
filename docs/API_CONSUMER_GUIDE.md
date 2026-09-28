# Guia de consumo da API B2C Finance (V1)

Guia para quem vai integrar com a API, por exemplo num workflow do n8n ou no agente de WhatsApp.

| Documento | Onde está |
|---|---|
| Especificação formal (OpenAPI 3.1) | [`/api/openapi.json`](https://b2-c-finance.vercel.app/api/openapi.json), com cópia versionada em [`docs/api/openapi.json`](./api/openapi.json) |
| Documentação interativa (Swagger UI) | [`/api/docs`](https://b2-c-finance.vercel.app/api/docs) |
| Referência de cada rota | [`API.md`](./API.md) |
| Segurança e ciclo de vida do token | [`API_AUTHENTICATION.md`](./API_AUTHENTICATION.md) |

> **Nunca** coloque um token real em código, print, issue ou documento. Este guia usa sempre `YOUR_API_TOKEN`.

---

## 1. Antes de começar

1. **Crie a integração.** Um administrador cria a integração em **Configurações → Integrações (API)** e escolhe:
   - o nome;
   - a descrição;
   - **só os scopes necessários**;
   - a validade (180 dias é o recomendado).
2. **Guarde o token.** Ele é mostrado **uma única vez**. Guarde-o direto no cofre de credenciais. No n8n, isso é em **Credentials → Header Auth**, com nome `Authorization` e valor `Bearer YOUR_API_TOKEN`.
3. **Teste a conexão:**

```bash
export B2C_API="https://b2-c-finance.vercel.app/api/v1"
export B2C_TOKEN="YOUR_API_TOKEN"   # cole do cofre; não versionar

curl -s "$B2C_API/me" -H "Authorization: Bearer $B2C_TOKEN"
```

```json
{ "success": true,
  "data": { "type": "service_account", "id": "cm…", "name": "B2C Finance AI Agent",
            "tokenPrefix": "b2c_live_k3j9x2ma", "scopes": ["clients.read", "receivables.read"] },
  "meta": { "requestId": "…", "generatedAt": "2026-09-28T13:00:00.000Z" } }
```

## 2. O que você precisa saber

- **A API é versionada no caminho** (`/api/v1`).
  - Na v1 podem **surgir campos novos**, então ignore os que você não conhece.
  - Remover ou mudar o significado de um campo só acontece numa `/api/v2`.
- **O dono dos dados é o da integração.**
  - O `ownerId` é inferido da conta de serviço. **A API não aceita `ownerId`**, nem em parâmetro, nem em header, nem no corpo.
  - Não é possível pedir dados de outro workspace. Um id de outro workspace responde `404`.
- **Scopes são obrigatórios.** Cada rota exige um scope.
  - Sem o scope, a resposta é `403 insufficient_scope`, e o campo `error.scope` diz qual falta.
  - Não existe scope curinga.
  - Exclusões, usuários, permissões e reabertura de competência **não podem** ser concedidos a integrações.
- **Status do cliente tem vigência.**
  - As listas devolvem o status **da competência** que você pedir: o do último dia do mês, ou o de hoje no mês corrente.
  - Um cliente que ficou Inativo em outubro continua **Ativo em setembro**. As competências históricas são preservadas.
  - **Nunca** use o status de hoje para responder sobre um mês passado.
- **Só leitura, por enquanto.**
  - As escritas que virão exigirão o header `Idempotency-Key`, com um UUID novo por operação.
  - Reenviar a mesma chamada com a mesma chave devolverá a mesma resposta, sem duplicar o efeito.
  - **Já planeje o workflow gerando e guardando essa chave antes de chamar.**
- **Parâmetro desconhecido dá `400`.** Um filtro digitado errado não é ignorado, então você nunca recebe a lista inteira achando que filtrou.
- **Limite de 120 requisições por minuto por IP.** Acima disso a resposta é `429`, com o header `Retry-After`.

## 3. Formato das respostas

```json
{ "success": true,  "data": …, "meta": { "requestId": "…", "generatedAt": "…", "pagination": { … } } }
{ "success": false, "error": { "code": "…", "message": "…" }, "meta": { "requestId": "…" } }
```

- **Decida sempre por `success` e `error.code`,** não pela mensagem.
- **Dinheiro** vem em reais, como número com 2 casas.
- **Datas** vêm como `AAAA-MM-DD`. **Instantes** vêm em ISO 8601 UTC.
- **Mande o seu `x-request-id`** (por exemplo, o id da execução do n8n). Ele volta em `meta.requestId` e liga a sua execução ao log do B2C Finance.

```bash
curl -s "$B2C_API/health" \
  -H "Authorization: Bearer $B2C_TOKEN" \
  -H "x-request-id: n8n-exec-4812"
```

## 4. Receitas por caso de uso

### 4.1 "Como está a Face Love?"

O agente sempre começa **desambiguando** o cliente pela busca:

```bash
curl -s -G "$B2C_API/search" \
  -H "Authorization: Bearer $B2C_TOKEN" \
  --data-urlencode "q=face love" \
  --data-urlencode "type=client"
```

```json
{ "success": true,
  "data": [ { "type": "client", "id": "cmu1a2b3c0001xyz", "name": "Face Love Estética",
              "legalName": "Face Love Clínica Ltda", "document": "**.***.***/0001-90",
              "status": { "code": "ACTIVE", "label": "Ativo" }, "modality": "MRR", "score": 90 } ],
  "meta": { "requestId": "…", "generatedAt": "…", "query": "face love", "type": "client", "total": 1 } }
```

- **Um resultado** (`meta.total = 1`): siga com o `id`.
- **Vários resultados:** **pergunte ao usuário** qual deles, mostrando nome, razão social e o documento mascarado. **Nunca escolha sozinho.**
- **Nenhum resultado:** diga que não encontrou. Não invente.

Com o `id` em mãos:

```bash
CLIENT_ID="cmu1a2b3c0001xyz"
curl -s "$B2C_API/clients/$CLIENT_ID" -H "Authorization: Bearer $B2C_TOKEN"
curl -s "$B2C_API/clients/$CLIENT_ID/status-history" -H "Authorization: Bearer $B2C_TOKEN"
curl -s -G "$B2C_API/receivables" -H "Authorization: Bearer $B2C_TOKEN" \
  --data-urlencode "clientId=$CLIENT_ID" --data-urlencode "status=open"
```

### 4.2 "Quem está devendo este mês?"

```bash
curl -s -G "$B2C_API/clients" -H "Authorization: Bearer $B2C_TOKEN" \
  --data-urlencode "delinquency=owing" --data-urlencode "pageSize=100"

# As cobranças em aberto do mês, com o total em meta.totals.openAmount:
curl -s -G "$B2C_API/receivables" -H "Authorization: Bearer $B2C_TOKEN" \
  --data-urlencode "status=open"
```

### 4.3 "Como estava a carteira em setembro?" (status histórico)

```bash
# Clientes ATIVOS em setembro de 2026, com o status daquele mês (não o de hoje):
curl -s -G "$B2C_API/clients" -H "Authorization: Bearer $B2C_TOKEN" \
  --data-urlencode "competence=2026-09" --data-urlencode "status=ACTIVE"

# O status de um cliente numa competência, junto com o de hoje:
curl -s -G "$B2C_API/clients/$CLIENT_ID" -H "Authorization: Bearer $B2C_TOKEN" \
  --data-urlencode "competence=2026-09"
# → data.status.current (hoje) e data.status.atCompetence (setembro)
```

### 4.4 Resumo do dia e do mês

```bash
curl -s "$B2C_API/routine/daily" -H "Authorization: Bearer $B2C_TOKEN"
curl -s -G "$B2C_API/reports/daily"   -H "Authorization: Bearer $B2C_TOKEN" --data-urlencode "date=2026-09-28"
curl -s -G "$B2C_API/reports/monthly" -H "Authorization: Bearer $B2C_TOKEN" --data-urlencode "competence=2026-09"
curl -s -G "$B2C_API/dashboard/summary" -H "Authorization: Bearer $B2C_TOKEN" --data-urlencode "competence=2026-09"
```

Nos relatórios, as seções de áreas para as quais a integração não tem scope **não aparecem** e são listadas em `meta.omittedSections`. Trate a ausência de uma seção como "sem acesso", nunca como "zero".

### 4.5 Contas a pagar e caixa

```bash
curl -s -G "$B2C_API/expenses" -H "Authorization: Bearer $B2C_TOKEN" --data-urlencode "status=vencida"
curl -s -G "$B2C_API/expenses" -H "Authorization: Bearer $B2C_TOKEN" \
  --data-urlencode "dateFrom=2026-09-01" --data-urlencode "dateTo=2026-09-30" --data-urlencode "category=Ferramentas"
curl -s "$B2C_API/cash/summary" -H "Authorization: Bearer $B2C_TOKEN"
```

### 4.6 Upsell

```bash
curl -s -G "$B2C_API/upsells" -H "Authorization: Bearer $B2C_TOKEN" \
  --data-urlencode "status=NEGOTIATION" --data-urlencode "responsible=Bianca"
```

## 5. Paginação

As listas aceitam `page` (a partir de 1) e `pageSize` (padrão 50, máximo 200). Percorra até `meta.pagination.totalPages`:

```bash
page=1
while :; do
  resp=$(curl -s -G "$B2C_API/clients" -H "Authorization: Bearer $B2C_TOKEN" \
    --data-urlencode "page=$page" --data-urlencode "pageSize=200")
  echo "$resp" | jq -c '.data[] | {id, name, status: .status.code}'
  total=$(echo "$resp" | jq '.meta.pagination.totalPages')
  [ "$page" -ge "$total" ] && break
  page=$((page + 1))
done
```

- **Totais do filtro inteiro:** `meta.totals` (recebimentos), `meta.totalAmount` (despesas) e `meta.totalValue` (upsell) somam **todo o filtro**, não só a página. Use esses campos para responder "quanto", sem somar página a página.

## 6. Tratamento de erros

| HTTP | `error.code` | O que fazer |
|---|---|---|
| 400 | `validation_error` | Corrija o parâmetro indicado em `error.details[].field`. Não repita a chamada igual. |
| 401 | `missing_token`, `invalid_token` | Confira a credencial no n8n. |
| 401 | `revoked_token`, `expired_token` | Peça ao administrador uma rotação da chave e atualize a credencial. |
| 401 | `inactive_owner` | O workspace está inativo. Fale com o administrador. |
| 403 | `insufficient_scope` | A integração não tem o scope `error.scope`. Peça ao administrador; não tente outra rota para contornar. |
| 404 | `not_found` | O id não existe **neste** workspace. |
| 429 | `rate_limited` | Espere o tempo de `Retry-After` (segundos) e tente de novo. |
| 500 | `internal_error` | Tente de novo mais tarde. Se persistir, envie o `meta.requestId` ao suporte. |

```bash
curl -s -G "$B2C_API/clients" -H "Authorization: Bearer $B2C_TOKEN" --data-urlencode "competence=2026-13"
```

```json
{ "success": false,
  "error": { "code": "validation_error", "message": "Parâmetros de consulta inválidos.",
             "details": [{ "field": "competence", "message": "Use o formato AAAA-MM (ex.: 2026-09)." }] },
  "meta": { "requestId": "…" } }
```

## 7. Boas práticas para o agente

- **Busca antes de agir:** sempre `/search` → confirmação do usuário quando houver mais de um resultado → `id`.
- **Competência explícita:** para perguntas sobre um mês, passe `competence`. Sem ela, a API usa a competência **atual**.
- **Não expor além do necessário:** a busca e as listas trazem o documento mascarado. Só peça o detalhe (`/clients/:id`) quando precisar do dado completo, e não repita o documento inteiro em canais abertos.
- **Scopes mínimos:** um agente só de consulta não precisa de nenhum scope de escrita (`*.create`, `*.update`, `*.pay`, `register_payment`).
- **Token:**
  - Guarde-o só no cofre de credenciais.
  - Rotacione a chave ao trocar de responsável pelo workflow.
  - Revogue imediatamente se suspeitar de vazamento (em Configurações → Integrações).

## 8. Explorando pelo navegador

Abra [`/api/docs`](https://b2-c-finance.vercel.app/api/docs):

1. Clique em **Authorize** e cole `YOUR_API_TOKEN`, sem o prefixo `Bearer`.
2. Use **Try it out** em qualquer rota.

O token fica só na aba aberta e não é salvo no navegador. Para importar a API em outra ferramenta (Postman, Insomnia, n8n), use a URL `https://b2-c-finance.vercel.app/api/openapi.json`.
