# API — trilha de atividades e Idempotency-Key

> Implementado em 28/09/2026, antes das rotas de escrita. Contrato público em [`API.md`](./API.md); segurança do token em [`API_AUTHENTICATION.md`](./API_AUTHENTICATION.md).

## 1. Duas trilhas, dois propósitos

| | `AuditLog` (já existia) | `ApiActivity` (nova) |
|---|---|---|
| O que registra | A **diferença** campo a campo de cada entidade alterada (antes → depois). | **Uma linha por chamada** de integração: quem, de onde, o quê, sobre quem, como terminou. |
| Quem grava | As funções de domínio e os motores, dentro da transação do fato. | O `defineEndpoint`, ao fim de cada chamada da API. |
| Retenção | Nenhuma: é append-only, com trigger que recusa UPDATE e DELETE. | Consultas por 30 dias, ações por 400 dias. |
| Ligação | `correlationId` = requestId da chamada. | `requestId` e `correlationId` (este vem do header `x-correlation-id`, por exemplo a execução do n8n). |

Reaproveitar o `AuditLog` para as chamadas foi descartado. A trava append-only dele impediria a retenção. Além disso, uma linha por consulta afogaria a diferença campo a campo, que é o que a auditoria contábil precisa ler.

## 2. `ApiActivity`

| Campo | Conteúdo |
|---|---|
| `ownerId` | Dono dos dados (vem da conta de serviço; nunca do chamador). |
| `serviceAccountId` | Integração que chamou. |
| `actorUserId` | Pessoa em nome de quem agiu. Fica vazio até existir a delegação (`X-B2C-On-Behalf-Of`). |
| `source` | `WEB`, `API`, `N8N`, `WHATSAPP` ou `SYSTEM`. Pela API, só `API` (padrão), `N8N` ou `WHATSAPP`, declarados em `X-B2C-Source`. `WEB` e `SYSTEM` são reservados para gravações internas e não podem ser declarados de fora. |
| `kind` | `READ` ou `WRITE`. |
| `action` | Ação estável, como `clients.list`, `payments.register` ou `client_status.change`. O catálogo está em `src/lib/api/activity-meta.ts`. |
| `entityType`, `entityId` | Entidade tocada, quando houver. |
| `requestId`, `correlationId` | Ligação com a resposta (`meta.requestId`) e com o `AuditLog`. |
| `result` | `SUCCESS`, `ERROR`, `DENIED` (401 com token que confere, ou 403) ou `REPLAYED` (repetição idempotente). |
| `httpStatus`, `errorCode`, `durationMs` | Resultado técnico da chamada. |
| `metadata` | Rótulo e valor para a tela (cliente, R$), método, caminho e a Idempotency-Key. Passa por `higienizar`. |
| `createdAt` | Instante da chamada. |

- **Nunca registrado:**
  - token, header `Authorization` e cookie;
  - corpo cru da requisição;
  - mensagem ou stack de erro interno (só o código);
  - chaves com nome de segredo (`token`, `secret`, `senha`, `password`, `authorization`, `cookie`, `apiKey`, `hash`);
  - qualquer texto com formato de token `b2c_live_…`, que é substituído.
- **Token que não confere:** não gera linha, porque não há dono a quem atribuir a tentativa. Essas tentativas aparecem só no log do servidor e no limite de requisições por IP.
- **`/health`:** não é registrado (`audit: false`), porque monitores chamam essa rota a cada minuto.
- **Falha ao gravar a trilha:** vai para o log e **não derruba** a chamada.
- **Índices** (a tabela é consultada por eles):

  | Índice | Uso |
  |---|---|
  | `(ownerId, createdAt desc)` | Listagem da tela |
  | `(ownerId, kind, createdAt desc)` | Tela filtrada por tipo |
  | `(serviceAccountId, createdAt desc)` | Filtro por integração |
  | `(requestId)` | Suporte ("o que houve na chamada X?") |
  | `(kind, createdAt)` | Retenção |

## 3. Idempotency-Key

- **Regra:** a mesma conta de serviço mais a mesma chave executa a operação **uma vez**.
- **Formato da chave:** de 1 a 255 caracteres, em `A-Z a-z 0-9 . _ : -`.
- **Sugestão para o WhatsApp:** usar o id da mensagem, como `wa_message_3EB0C4…`.

| Situação | Resposta |
|---|---|
| Escrita sem o header | 400 `idempotency_key_required` (nada executa). |
| Primeira chamada | Reserva a chave (`IN_PROGRESS`, com índice único `(serviceAccountId, key)`), executa e guarda o status e o corpo (`COMPLETED`). A resposta traz `meta.idempotency = { key, replayed: false }` e o header `Idempotent-Replayed: false`. |
| Repetição com os mesmos dados | **Não executa.** Devolve o mesmo status e o mesmo `data`. `meta.requestId` é o da chamada nova. `meta.idempotency = { key, replayed: true, originalRequestId, firstProcessedAt }`. Header `Idempotent-Replayed: true`. Na trilha, o resultado é `REPLAYED`. |
| Repetição enquanto a primeira ainda roda | 409 `idempotency_in_progress`. Tente de novo em instantes. |
| Mesma chave com outros dados ou outra operação | 422 `idempotency_key_reused`. É quase sempre um bug no chamador. Gere uma chave nova para um pedido novo. |
| Mesma chave em **outra** integração | Executa. A chave pertence à conta de serviço. |

**O que é guardado para repetir:**

- **Guardado:** sucesso (2xx) e recusa por regra de negócio (422). Esses resultados são seguros para devolver de novo.
- **Não guardado (a chave é liberada, e a próxima tentativa executa de verdade):** erro de servidor (5xx), 404, 403 e afins.
- **O resultado que conta:** o do momento da primeira execução. A repetição não recalcula.

**Os dados que definem "o mesmo pedido":**

- É o SHA-256 do JSON canônico (chaves ordenadas) de `{ params, query, body }`. A ordem dos campos no JSON não importa.
- O pedido é validado **antes** de reservar a chave. Um pedido inválido (400) não queima a chave.

**Falha depois de executar:**

- Se a operação aconteceu mas o resultado não pôde ser guardado, a chave **fica em andamento**. Liberá-la faria a repetição executar de novo.
- Depois de 2 minutos nesse estado, a mensagem do 409 orienta a conferir no B2C Finance se a operação aconteceu antes de tentar com uma chave nova.

**Validade:** as chaves duram **30 dias**. Uma chave vencida vale como nova.

**Operações previstas** (`API_WRITE_OPERATIONS`):

| Operação | Scope | Na tela |
|---|---|---|
| `payments.register` | `receivables.register_payment` | Pagamento registrado |
| `clients.create` | `clients.create` | Cliente cadastrado |
| `expenses.create` | `expenses.create` | Despesa lançada |
| `expenses.pay` | `expenses.pay` | Despesa marcada como paga |
| `upsells.create` | `upsells.create` | Upsell cadastrado |
| `client_status.change` | `client_status.write` | Status do cliente alterado |

Uma rota de escrita é declarada assim:

```ts
export const POST = defineEndpoint(
  { action: "payments.register", scope: "receivables.register_payment",
    write: { operation: "payments.register" }, body: Schema },
  async ({ ctx, body }) => { /* função de domínio */ return { status: 201, data, audit: { entityType, entityId, label, amount } }; }
);
```

## 4. Retenção

A retenção roda no **job diário** já existente (`/api/cron/status-programado`, às 00:10 no horário da Bahia). Não foi criado um cron novo por causa do limite de jobs do plano da Vercel. A função é `aplicarRetencaoDaApi` e apaga:

- `ApiActivity` do tipo `READ` com mais de 30 dias;
- `ApiActivity` do tipo `WRITE` com mais de 400 dias (cobre o ano fiscal e a revisão do fechamento);
- `ApiIdempotencyKey` vencidas.

Cada `DELETE` usa índice. Uma falha na retenção não afeta o resultado do status programado.

## 5. Tela

A tela fica em **Configurações → Integrações → Atividades da IA/API** (`/configuracoes/integracoes/atividades`) e exige `integracoes.visualizar`.

- **Colunas:** data e hora, integração, origem, ação, entidade (nome e R$) e resultado. O código de erro e o requestId aparecem ao passar o mouse.
- **Filtros:** integração, origem, resultado e tipo (ações ou consultas). Os filtros ficam na URL, então funcionam sem JavaScript e o link pode ser compartilhado.
- **Paginação:** 50 linhas por página.

## 6. Testes

`tests/api-idempotencia-auditoria.test.ts` monta rotas de escrita com o mesmo `defineEndpoint` das futuras rotas, chamando as funções de domínio **reais**.

- **Idempotência nas operações reais:**
  - registrar pagamento (uma repetição não cria um segundo pagamento);
  - cadastrar cliente (um só cadastro);
  - alterar status (um só intervalo).
- **Casos da chave:**
  - chave ausente ou inválida;
  - chave reutilizada com outros dados;
  - chave pertencente à conta, e não global;
  - concorrência (duas chamadas simultâneas executam uma vez);
  - erro 5xx libera a chave e 422 é guardado;
  - chave vencida;
  - hash independente da ordem dos campos.
- **Trilha:**
  - campos completos, sem segredo;
  - repetição registrada como `REPLAYED`;
  - leitura, scope negado e token revogado entram na trilha;
  - erro interno registra só o código;
  - `higienizar`.
- **Tela:** isolamento por dono e exigência de permissão.
- **Retenção:** apaga só o que venceu.
