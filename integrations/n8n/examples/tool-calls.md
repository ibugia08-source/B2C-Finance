# Exemplos de chamadas das ferramentas

Pedidos e respostas **fictícios**, encurtados. `YOUR_API_TOKEN` é placeholder.
O contrato completo está em `/api/docs` (OpenAPI) e em `docs/API.md`.

```bash
export B2C_FINANCE_API_URL="https://b2-c-finance.vercel.app/api/v1"
export AUTH="Authorization: Bearer YOUR_API_TOKEN"
```

## Conversa: "A Face Love está devendo este mês?"

**1. `buscar_clientes` `{ "q": "face love" }`**

```bash
curl -s -G "$B2C_FINANCE_API_URL/search" -H "$AUTH" -H "X-B2C-Source: whatsapp" \
  --data-urlencode "q=face love" --data-urlencode "type=client"
```

```json
{ "success": true,
  "data": [{ "type": "client", "id": "cmu1a2b3c0001xyz", "name": "Face Love Estética",
             "legalName": "Face Love Clínica Ltda", "document": "**.***.***/0001-90",
             "status": { "code": "ACTIVE", "label": "Ativo" }, "modality": "MRR", "score": 90 }],
  "meta": { "requestId": "n8n-4812", "total": 1 } }
```

Como veio **1** resultado, o agente segue com o `id`. Com vários resultados, ele **pergunta** qual é.

**2. `consultar_recebimentos` `{ "clientId": "cmu1a2b3c0001xyz", "status": "open" }`**

```bash
curl -s -G "$B2C_FINANCE_API_URL/receivables" -H "$AUTH" \
  --data-urlencode "clientId=cmu1a2b3c0001xyz" --data-urlencode "status=open"
```

```json
{ "success": true,
  "data": [{ "id": "cmubill0001", "description": "Mensalidade 09/2026", "amount": 1500, "openAmount": 1500,
             "dueDate": "2026-09-10", "status": { "code": "OVERDUE", "label": "Vencido" }, "daysLate": 18 }],
  "meta": { "totals": { "amount": 1500, "paidAmount": 0, "openAmount": 1500 } } }
```

**Resposta do agente:**
> Sim. A *Face Love Estética* tem R$ 1.500,00 em aberto: a mensalidade de 09/2026, vencida em 10/09/2026 (18 dias de atraso).

## "Ela estava ativa em agosto?" (status histórico)

`consultar_cliente` `{ "id": "cmu1a2b3c0001xyz", "competence": "2026-08" }` → use `data.status.atCompetence`, **não** `data.status.current`.

## "Como fechou setembro?"

`gerar_relatorio_mensal` `{ "competence": "2026-09" }`. Se `meta.omittedSections` trouxer `["expenses"]`, diga que não tem acesso às despesas. Nunca diga "zero".

## Erros que o agente deve tratar

| Resposta | O que o agente diz/faz |
|---|---|
| `403 insufficient_scope` | "Não tenho permissão para consultar isso." |
| `404 not_found` | O registro não existe neste workspace. |
| `400 validation_error` | Corrige o formato (mês AAAA-MM, data AAAA-MM-DD) e tenta **uma** vez. |
| `429 rate_limited` | Pede para tentar em 1 minuto. |
| `500 internal_error` | "Tive um problema técnico; tente mais tarde." Não mostra detalhes. |
