import { API_SCOPE_GROUPS, API_SCOPES, FORBIDDEN_SCOPES } from "./scopes";
import { OPERACOES_DE_ESCRITA } from "./agent/catalog";
import { PAGE_SIZE_MAX, PAGE_SIZE_PADRAO } from "./http";
import { CLIENT_STATUSES } from "./v1/common";
import { RECEIVABLE_STATUSES } from "./v1/receivables";
import { EXPENSE_STATUSES } from "./v1/expenses";
import { UPSELL_STATUSES } from "./v1/upsells";

/**
 * ESPECIFICAÇÃO OPENAPI 3.1 DA API V1 (28/09/2026) — fonte única.
 *
 * Servida em /api/openapi.json, desenhada em /api/docs e copiada para
 * docs/api/openapi.json (`npm run openapi:export`). Os enums (scopes,
 * status, filtros) vêm das MESMAS constantes que as rotas validam, e um
 * teste confere que cada rota de src/app/api/v1 está aqui com o scope que o
 * código exige — a documentação não consegue divergir em silêncio.
 */

export const API_VERSION = "1.0.0";

type Obj = Record<string, unknown>;
const ref = (nome: string) => ({ $ref: `#/components/schemas/${nome}` });
const refParam = (nome: string) => ({ $ref: `#/components/parameters/${nome}` });
const refResp = (nome: string) => ({ $ref: `#/components/responses/${nome}` });

const str = (description?: string, extra: Obj = {}) => ({ type: "string", ...(description ? { description } : {}), ...extra });
const num = (description?: string, extra: Obj = {}) => ({ type: "number", ...(description ? { description } : {}), ...extra });
const int = (description?: string, extra: Obj = {}) => ({ type: "integer", ...(description ? { description } : {}), ...extra });
const bool = (description?: string) => ({ type: "boolean", ...(description ? { description } : {}) });
const nulo = (s: Obj) => ({ ...s, type: [s.type as string, "null"] });
const nuloRef = (nome: string) => ({ oneOf: [ref(nome), { type: "null" }] });
const obj = (properties: Obj, required: string[] = Object.keys(properties), extra: Obj = {}) => ({
  type: "object",
  properties,
  required,
  ...extra,
});
const arr = (items: Obj) => ({ type: "array", items });
const data = (description = "Data de calendário (AAAA-MM-DD).") => str(description, { format: "date" });
const dinheiro = (description?: string) => num(description ?? "Valor em reais, 2 casas.");

// ---------------------------------------------------------------------------
// Parâmetros
// ---------------------------------------------------------------------------

const q = (name: string, schema: Obj, description: string, example?: unknown): Obj => ({
  name,
  in: "query",
  required: false,
  description,
  schema,
  ...(example !== undefined ? { example } : {}),
});

const PARAMETERS = {
  Page: q("page", int(undefined, { minimum: 1, default: 1 }), "Página (a partir de 1)."),
  PageSize: q(
    "pageSize",
    int(undefined, { minimum: 1, maximum: PAGE_SIZE_MAX, default: PAGE_SIZE_PADRAO }),
    `Itens por página (máx. ${PAGE_SIZE_MAX}).`
  ),
  Competence: q(
    "competence",
    str(undefined, { pattern: "^\\d{4}-(0[1-9]|1[0-2])$" }),
    "Competência AAAA-MM. Padrão: a competência atual (fuso America/Bahia).",
    "2026-09"
  ),
  Id: { name: "id", in: "path", required: true, description: "Id do registro.", schema: str(undefined, { pattern: "^[A-Za-z0-9_-]{1,64}$" }) },
  IdempotencyKey: {
    name: "Idempotency-Key",
    in: "header",
    required: true,
    description:
      "Obrigatória em toda escrita. A mesma integração + a mesma chave executa UMA vez; a repetição devolve a resposta original (header `Idempotent-Replayed: true`). Use um id estável do evento de origem (ex.: id da mensagem do WhatsApp).",
    schema: str(undefined, { pattern: "^[A-Za-z0-9._:-]{1,255}$" }),
    example: "wa_message_3EB0C4A1F2",
  },
  Identity: {
    name: "X-B2C-Identity",
    in: "header",
    required: false,
    description:
      "Delegação: id do vínculo devolvido por `POST /integrations/resolve-identity`. A API recorta os scopes pelo RBAC do usuário vinculado (conta ∩ usuário) e o registra como ator. Exige `identities.resolve` na integração. Inválido/desativado/de outro workspace → 403 `invalid_identity`; usuário sem a permissão → 403 `user_forbidden`.",
    schema: str(undefined, { pattern: "^[A-Za-z0-9_-]{1,64}$" }),
  },
  Source: {
    name: "x-b2c-source",
    in: "header",
    required: false,
    description: "Origem da chamada para a trilha de atividades: `n8n` ou `whatsapp`. Sem o header (ou outro valor) = API.",
    schema: str(undefined, { enum: ["n8n", "whatsapp", "api"] }),
  },
  RequestId: {
    name: "x-request-id",
    in: "header",
    required: false,
    description: "Id da chamada (ex.: execução do n8n). Reaproveitado em `meta.requestId`; senão é gerado.",
    schema: str(undefined, { pattern: "^[A-Za-z0-9._:-]{1,100}$" }),
  },
};

// ---------------------------------------------------------------------------
// Schemas
// ---------------------------------------------------------------------------

const SCHEMAS: Record<string, Obj> = {
  Meta: obj(
    {
      requestId: str("Id da chamada; também no header `x-request-id`."),
      generatedAt: str("Instante da resposta (ISO 8601, UTC).", { format: "date-time" }),
    },
    ["requestId", "generatedAt"],
    { additionalProperties: true }
  ),
  Pagination: obj({ page: int(), pageSize: int(), total: int("Total de itens no filtro inteiro."), totalPages: int() }),
  ListMeta: {
    allOf: [ref("Meta"), obj({ pagination: ref("Pagination") })],
  },
  Error: obj(
    {
      success: { const: false },
      error: obj(
        {
          code: str("Código estável — trate por ele, não pela mensagem.", {
            enum: [
              "missing_token", "invalid_token", "revoked_token", "expired_token", "inactive_owner",
              "insufficient_scope", "validation_error", "not_found", "rate_limited", "internal_error",
              "idempotency_key_required", "idempotency_key_reused", "idempotency_in_progress", "unprocessable",
              "duplicate", "possible_duplicate", "invalid_state", "competence_closed", "retroactive_requires_confirmation",
              "identity_not_found", "invalid_identity", "user_forbidden", "agency_scope_not_supported",
            ],
          }),
          message: str("Mensagem em português para humanos."),
          scope: str("Só em `insufficient_scope`: o scope que falta."),
          details: arr(obj({ field: nulo(str()), message: str() })),
        },
        ["code", "message"]
      ),
      meta: obj({ requestId: str() }),
    },
    ["success", "error", "meta"]
  ),
  ClientStatus: obj({
    code: str("Status (vigência pelo histórico — nunca o cadastro).", { enum: [...CLIENT_STATUSES] }),
    label: str(undefined, { example: "Ativo" }),
  }),
  Ref: obj({ id: str(), name: str() }),
  ScheduledStatusChange: nulo(obj({ status: ref("ClientStatus"), effectiveFrom: data("Início da vigência.") })),
  ClientListItem: obj({
    id: str(),
    name: str(),
    legalName: nulo(str()),
    document: nulo(str("Documento MASCARADO (CNPJ: filial e dígitos; CPF: só dígitos).", { example: "**.***.***/0001-90" })),
    status: { ...nuloRef("ClientStatus"), description: "Status NA COMPETÊNCIA pedida." },
    modality: nulo(str(undefined, { enum: ["MRR", "TCV", null] })),
    segment: nulo(str("Nicho.")),
    responsible: nulo(str("Responsável comercial (nome).")),
    paymentDay: nulo(int()),
    monthlyValue: nulo(dinheiro("Mensalidade (MRR).")),
    totalContractValue: nulo(dinheiro("Valor total do contrato (TCV).")),
    contractTerm: str('"12 meses", "Indeterminado" ou "—".'),
    expectedRenewalDate: nulo(data()),
    startedAt: nulo(data()),
    delinquency: nulo(obj({ status: str(undefined, { enum: ["paid", "owing", "no_billing"] }), manual: bool("Ajuste manual da competência.") })),
    scheduledStatusChange: ref("ScheduledStatusChange"),
  }),
  ClientDetail: obj({
    id: str(), name: str(), legalName: nulo(str()),
    document: nulo(str("Documento COMPLETO.")),
    email: nulo(str()), phone: nulo(str()), segment: nulo(str()), city: nulo(str()), state: nulo(str()),
    tags: arr(str()),
    modality: nulo(str(undefined, { enum: ["MRR", "TCV", null] })),
    responsible: nulo(str()), operationsOwner: nulo(str()), paymentDay: nulo(int()),
    monthlyValue: nulo(dinheiro()), totalContractValue: nulo(dinheiro()),
    contractTerm: str(), contractMonths: nulo(int()), contractIndefinite: bool(),
    expectedRenewalDate: nulo(data()), startedAt: nulo(data()), churnedAt: nulo(data()),
    createdAt: str(undefined, { format: "date-time" }),
    status: obj(
      {
        current: { ...nuloRef("ClientStatus"), description: "Status de hoje." },
        atCompetence: obj({ competence: str(), status: nuloRef("ClientStatus") }),
        scheduledChange: ref("ScheduledStatusChange"),
      },
      ["current", "scheduledChange"]
    ),
    financial: nulo(
      obj({
        activeContracts: int(), openAmount: dinheiro(), overdueAmount: dinheiro(), totalRevenue: dinheiro(),
        nextDueDate: nulo(data()), situation: str(undefined, { enum: ["EM_DIA", "INADIMPLENTE", "SEM_COBRANCA"] }),
        activeServices: arr(str()),
      })
    ),
    contacts: arr(obj({ id: str(), name: str(), role: nulo(str()), email: nulo(str()), phone: nulo(str()), isPrimary: bool() })),
  }, undefined),
  StatusInterval: obj({
    id: str(),
    status: ref("ClientStatus"),
    effectiveFrom: data("Primeiro dia da vigência (inclusivo)."),
    effectiveTo: nulo(data("Último dia da vigência (inclusivo); null = vigente sem fim.")),
    reason: nulo(str()),
    origin: str("De onde veio a mudança (UI, IMPORT, JOB, API, BACKFILL…)."),
    needsReview: bool("Intervalo reconstruído sem evidência — precisa de conferência humana."),
    recordedAt: str(undefined, { format: "date-time" }),
  }),
  StatusHistory: obj({
    clientId: str(),
    today: data(),
    currentStatus: nuloRef("ClientStatus"),
    intervals: arr(ref("StatusInterval")),
    scheduled: { ...arr(ref("StatusInterval")), description: "Alterações com vigência futura." },
  }),
  Receivable: obj({
    id: str(),
    client: ref("Ref"),
    description: str(),
    competence: str(undefined, { example: "2026-09" }),
    amount: dinheiro(), paidAmount: dinheiro(), openAmount: dinheiro("0 para removidas e renegociadas."),
    dueDate: data("Vencimento."),
    paidAt: nulo(str(undefined, { format: "date-time" })),
    status: obj({ code: str("Derivado na hora (mesma regra da tela).", { enum: [...RECEIVABLE_STATUSES] }), label: str() }),
    daysLate: int(),
    kind: str("MRR, TCV, SETUP, ONE_TIME, UPSELL, RENEGOTIATION…"),
    revenueType: str(),
    installmentNumber: nulo(int()),
    collectionStatus: str(),
  }),
  ReceivableDetail: {
    allOf: [
      ref("Receivable"),
      obj({
        notes: nulo(str()),
        payments: arr(obj({ id: str(), amount: dinheiro(), paidAt: str(undefined, { format: "date-time" }), method: str(), status: str() })),
      }),
    ],
  },
  Expense: obj({
    id: str(), description: str(), amount: dinheiro(),
    date: data("Data do lançamento (define o mês)."), dueDate: nulo(data("Vencimento.")),
    status: str("Status com `vencida` derivada.", { enum: ["pendente", "pago", "cancelado", "devendo", "reembolsado", "vencida"] }),
    rawStatus: str("Status gravado."),
    category: nuloRef("Ref"), type: nulo(str("FIXED, VARIABLE, PAYROLL, TAX, TOOL, ADS, LOAN, CARD, OTHER.")),
    recurrence: nulo(str()), recurring: bool(), paymentMethod: str(),
    client: nuloRef("Ref"), account: nuloRef("Ref"),
    createdAt: str(undefined, { format: "date-time" }),
  }),
  Upsell: obj({
    id: str(), title: nulo(str()), client: ref("Ref"), value: dinheiro("Valor potencial."),
    status: str(undefined, { enum: [...UPSELL_STATUSES] }), responsible: nulo(str("Nome (texto livre).")),
    expectedCloseDate: nulo(data()), closedAt: nulo(str(undefined, { format: "date-time" })),
    createdAt: str(undefined, { format: "date-time" }), offer: nuloRef("Ref"),
    services: arr(obj({ id: str(), name: str(), unitPrice: nulo(dinheiro()) })),
    billingId: nulo(str("Cobrança lançada ao vender.")),
    notes: nulo(str()),
  }),
  Metric: obj({
    value: nulo(num("null = não calculável (ex.: denominador zero).")),
    name: str(),
    unit: str(undefined, { enum: ["currency", "percent", "count"] }),
  }),
  DashboardSummary: obj({
    competence: str(), partial: bool("Mês em curso (números parciais)."),
    metrics: {
      type: "object",
      additionalProperties: ref("Metric"),
      description:
        "faturamento_total, mrr_oficial, tcv_faturado, tcv_vendido, receita_extra_reconhecida, faturamento_esperado, recebido_competencia, em_aberto, vencido, resultado_mes, margem_gerencial, percentual_recorrencia, percentual_realizacao, clientes_ativos, novos_clientes, churn_quantidade, churn_valor, churn_rate, ticket_medio, custo_por_cliente, percentual_folha.",
    },
  }),
  CashSummary: obj({
    date: data(), accountsBalance: dinheiro(), commitments: dinheiro(), commitmentWindowDays: int(), available: dinheiro(),
    breakdown: arr(obj({ label: str(), value: dinheiro(), type: str(undefined, { enum: ["account", "commitment"] }) })),
    next30Days: obj({ inflows: dinheiro(), outflows: dinheiro(), projectedBalance: dinheiro() }),
    projection: obj({
      horizonDays: int(), startingBalance: dinheiro(), receivable: dinheiro(),
      overdueReceivableNotIncluded: dinheiro("A receber vencido — informado, fora da projeção."),
      payable: dinheiro(), financedLiabilities: dinheiro(), projectedBalance: dinheiro(),
    }),
    month: obj({
      competence: str(), inflows: dinheiro(), outflows: dinheiro(), realizedBalance: dinheiro(), expectedBalance: dinheiro(),
      projection30: dinheiro(), projection60: dinheiro(), projection90: dinheiro(),
    }),
  }),
  DailyRoutine: obj({
    date: data(),
    actions: arr(obj({ key: str(), priority: str(undefined, { enum: ["alta", "media", "baixa"] }), text: str(), done: bool() })),
    pendingActions: int(),
    collections: obj({ overdue: arr({ type: "object" }), overdueTotal: dinheiro(), dueSoon: arr({ type: "object" }), dueSoonTotal: dinheiro() }),
    payments: obj({ overdue: arr({ type: "object" }), overdueTotal: dinheiro(), dueSoon: arr({ type: "object" }), dueSoonTotal: dinheiro() }),
    renewals: nulo(obj({ month: str(), pendingCount: int(), pendingExpectedValue: dinheiro() })),
    cash: nulo(obj({ available: dinheiro(), projection30: dinheiro() })),
    openUpsells: arr(obj({ id: str(), client: str(), value: nulo(dinheiro()), responsible: nulo(str()) })),
  }),
  DailyReport: obj(
    {
      date: data(),
      receivables: obj({
        dueToday: obj({ count: int(), amount: dinheiro(), openAmount: dinheiro(), items: arr(ref("Receivable")) }),
        received: obj({ count: int(), amount: dinheiro(), items: arr({ type: "object" }) }),
      }),
      expenses: obj({
        dueToday: obj({ count: int(), amount: dinheiro(), paidAmount: dinheiro(), items: arr(ref("Expense")) }),
        paid: {
          ...obj({ count: int(), amount: dinheiro(), items: arr(ref("Expense")) }),
          description: "Despesas MARCADAS COMO PAGAS no dia (pela trilha de auditoria: status → pago).",
        },
      }),
      clients: obj({
        statusChanges: { ...arr(obj({ client: ref("Ref"), status: ref("ClientStatus"), reason: nulo(str()) })), description: "Status com vigência começando no dia." },
        statusChangesRecorded: {
          ...arr(obj({ client: ref("Ref"), status: ref("ClientStatus"), effectiveFrom: data(), reason: nulo(str()) })),
          description: "Alterações de status REGISTRADAS no dia (qualquer vigência).",
        },
        newClients: { ...arr(obj({ id: str(), name: str(), modality: nulo(str()) })), description: "Entrada (startedAt) no dia." },
        createdClients: { ...arr(obj({ id: str(), name: str(), modality: nulo(str()) })), description: "Cadastrados no sistema no dia." },
      }),
      upsells: obj({
        created: obj({ count: int(), value: dinheiro(), items: arr({ type: "object" }) }),
        won: obj({ count: int(), value: dinheiro(), items: arr({ type: "object" }) }),
      }),
    },
    ["date"]
  ),
  MonthlyReport: obj(
    {
      competence: str(),
      closing: obj({
        state: str("Estado do fechamento da competência."), label: str(),
        closedAt: nulo(str(undefined, { format: "date-time" })), closedBy: nulo(str()),
        reopenedAt: nulo(str(undefined, { format: "date-time" })),
      }),
      indicators: { type: "object", additionalProperties: ref("Metric") },
      portfolio: obj({ byStatus: arr(obj({ status: ref("ClientStatus"), count: int() })) }),
      receivables: obj({ count: int(), totals: obj({ amount: dinheiro(), paidAmount: dinheiro(), openAmount: dinheiro() }), byStatus: { type: "object" } }),
      expenses: obj({ total: dinheiro(), byStatus: { type: "object" } }),
    },
    ["competence", "closing"]
  ),
  SearchResult: obj({
    type: { const: "client" },
    id: str(), name: str(), legalName: nulo(str()),
    document: nulo(str("Mascarado.")),
    status: { ...nuloRef("ClientStatus"), description: "Status de hoje." },
    modality: nulo(str()),
    score: int("Relevância 0–100.", { minimum: 0, maximum: 100 }),
  }),
  ClientCreate: obj(
    {
      name: str(undefined, { minLength: 1, maxLength: 200 }),
      legalName: nulo(str()), document: nulo(str("CNPJ/CPF.")), email: nulo(str(undefined, { format: "email" })),
      phone: nulo(str()), nicheId: nulo(str("Nicho do catálogo.")), city: nulo(str()),
      state: nulo(str("UF (2 letras).", { minLength: 2, maxLength: 2 })), address: nulo(str()),
      legalRepresentative: nulo(str()), origin: nulo(str()),
      responsibleId: nulo(str("Colaborador responsável (Employee).")), operationsOwner: nulo(str()),
      paymentDay: nulo(int("Dia do pagamento MRR (1–31).", { minimum: 1, maximum: 31 })),
      tags: arr(str()),
      modality: nulo(str("MRR exige monthlyValue e paymentDay; TCV exige totalContractValue, contractMonths e startedAt.", { enum: ["MRR", "TCV", null] })),
      monthlyValue: nulo(dinheiro()), totalContractValue: nulo(dinheiro()),
      contractMonths: nulo(int(undefined, { minimum: 1, maximum: 120 })),
      contractIndefinite: bool("Prazo Indeterminado (só MRR)."),
      startedAt: nulo(data("Entrada do cliente.")), notes: nulo(str()),
      initialStatus: str("Status a partir de hoje (padrão ACTIVE).", { enum: ["ACTIVE", "LEAD", "PROSPECT"], default: "ACTIVE" }),
      allowDuplicate: bool("Cadastrar mesmo com nome/documento igual a outro cliente."),
    },
    ["name"],
    { additionalProperties: false }
  ),
  ClientPatch: {
    type: "object",
    additionalProperties: false,
    minProperties: 1,
    description: "Os mesmos campos do cadastro, todos opcionais. **Sem `status`**: status muda só por `POST /clients/{id}/status-changes`.",
    properties: {
      name: str(undefined, { minLength: 1, maxLength: 200 }), legalName: nulo(str()), document: nulo(str()),
      email: nulo(str()), phone: nulo(str()), nicheId: nulo(str()), city: nulo(str()), state: nulo(str()),
      address: nulo(str()), legalRepresentative: nulo(str()), origin: nulo(str()), responsibleId: nulo(str()),
      operationsOwner: nulo(str()), paymentDay: nulo(int()), tags: arr(str()),
      modality: nulo(str(undefined, { enum: ["MRR", "TCV", null] })), monthlyValue: nulo(dinheiro()),
      totalContractValue: nulo(dinheiro()), contractMonths: nulo(int()), contractIndefinite: bool(),
      startedAt: nulo(data()), notes: nulo(str()),
    },
  },
  StatusChange: obj(
    {
      status: str(undefined, { enum: [...CLIENT_STATUSES] }),
      effectiveFrom: data("Primeiro dia em que o novo status vale. Futura = programada; mês passado = retroativa."),
      reason: str(undefined, { maxLength: 500 }),
      renewalCompetence: str("Perda: competência da renovação frustrada (AAAA-MM)."),
      allowRetroactive: bool("Obrigatório (true) para vigência em mês que já passou — reescreve a carteira daquele mês."),
    },
    ["status", "effectiveFrom"],
    { additionalProperties: false }
  ),
  StatusChangeResult: obj({
    change: obj(
      {
        status: str(), effectiveFrom: data(),
        scheduled: bool("Vigência futura: registrada sem mudar o status de hoje."),
        currentStatusChanged: bool(), warning: str(),
      },
      ["status", "effectiveFrom", "scheduled", "currentStatusChanged"]
    ),
    statusHistory: ref("StatusHistory"),
  }),
  PaymentCreate: obj(
    {
      amount: dinheiro("Valor pago (> 0, até 2 casas). Acima do saldo só com allowOverpayment."),
      paidAt: data("Dia do pagamento (padrão: hoje). Não pode ser futuro; o mês do caixa não pode estar fechado."),
      method: str(undefined, { enum: ["PIX", "TRANSFER", "BOLETO", "CARD", "CASH", "OTHER"], default: "PIX" }),
      accountId: nulo(str("Conta bancária do dono.")),
      notes: nulo(str()),
      allowOverpayment: bool("Aceitar valor acima do saldo (o excedente vira crédito do cliente)."),
      allowDuplicate: bool("Aceitar mesmo havendo pagamento igual (valor e data) nesta cobrança."),
    },
    ["amount"],
    { additionalProperties: false }
  ),
  PaymentResult: obj({
    payment: obj({
      id: str(), amount: dinheiro(), paidAt: str(undefined, { format: "date-time" }), method: str(),
      fullyPaid: bool(), paidLate: bool(), paidInDifferentMonth: bool(),
      creditGenerated: dinheiro(), creditApplied: dinheiro(), creditRemaining: dinheiro(),
    }),
    receivable: ref("ReceivableDetail"),
  }),
  ExpenseCreate: obj(
    {
      description: str(undefined, { minLength: 1, maxLength: 200 }),
      amount: dinheiro(), dueDate: data("Vencimento (define o mês da despesa)."),
      categoryId: nulo(str()), category: str("Nome da categoria (alternativa a categoryId)."),
      type: str(undefined, { enum: ["FIXED", "VARIABLE", "TAX", "PAYROLL", "TOOL", "ADS", "LOAN", "OTHER"], default: "OTHER" }),
      recurrence: str("Recorrência: cria as ocorrências dos próximos 12 meses.", {
        enum: ["NONE", "MONTHLY", "QUARTERLY", "SEMIANNUAL", "ANNUAL", "CUSTOM"], default: "NONE",
      }),
      recurrenceInterval: nulo(int("Meses entre ocorrências (CUSTOM).", { minimum: 1, maximum: 24 })),
      notes: nulo(str()),
    },
    ["description", "amount", "dueDate"],
    { additionalProperties: false }
  ),
  ExpensePatch: {
    type: "object",
    additionalProperties: false,
    minProperties: 1,
    description: "Só despesa pendente; só esta ocorrência. **Sem `status`**: para pagar, `POST /expenses/{id}/pay`.",
    properties: {
      description: str(), amount: dinheiro(), dueDate: data(), categoryId: nulo(str()), category: str(),
      type: str(undefined, { enum: ["FIXED", "VARIABLE", "TAX", "PAYROLL", "TOOL", "ADS", "LOAN", "OTHER"] }),
      notes: nulo(str()),
    },
  },
  ExpenseDetail: { allOf: [ref("Expense"), obj({ notes: nulo(str()), installment: nulo(obj({ number: int(), total: nulo(int()) })) })] },
  UpsellCreate: {
    ...obj(
      {
        clientId: str(),
        serviceId: nulo(str("Serviço do catálogo (ou use description).")),
        description: nulo(str("Descrição curta (ou use serviceId).")),
        amount: dinheiro("Valor potencial."),
        responsibleId: nulo(str("Colaborador responsável (Employee). Sem ele, herda o do cliente.")),
        expectedCloseDate: nulo(data()),
        notes: nulo(str()),
        status: str("Só o funil aberto — vender/recusar é decisão da tela.", { enum: ["OPPORTUNITY", "NEGOTIATION", "PAUSED"], default: "OPPORTUNITY" }),
      },
      ["clientId", "amount"],
      { additionalProperties: false }
    ),
    anyOf: [{ required: ["serviceId"] }, { required: ["description"] }],
  },
  UpsellPatch: {
    type: "object",
    additionalProperties: false,
    minProperties: 1,
    description: "Só oportunidade em aberto (não WON/LOST).",
    properties: {
      serviceId: nulo(str()), description: nulo(str()), amount: dinheiro(), responsibleId: nulo(str()),
      expectedCloseDate: nulo(data()), notes: nulo(str()),
      status: str(undefined, { enum: ["OPPORTUNITY", "NEGOTIATION", "PAUSED"] }),
    },
  },
  RoutineActionResult: obj({
    key: str(), text: str(), priority: str(undefined, { enum: ["alta", "media", "baixa"] }),
    done: { const: true }, alreadyDone: bool("Já estava concluída (nada mudou)."),
  }),
  IdentityResolveRequest: obj(
    {
      channel: { const: "WHATSAPP" },
      externalIdentifier: str("Telefone como veio do WhatsApp. Com \"+\" o código do país é lido do número; sem ele, 10–11 dígitos = Brasil. A variante do nono dígito é aceita.", {
        minLength: 8, maxLength: 40, example: "+5571999990000",
      }),
    },
    ["channel", "externalIdentifier"],
    { additionalProperties: false, description: "Só o número. `userId` (ou qualquer outro campo) é recusado: quem decide o usuário é o vínculo cadastrado pelo administrador." }
  ),
  IdentityResolution: obj({
    identityId: str("Id do vínculo — mande em `X-B2C-Identity` nas chamadas seguintes."),
    channel: { const: "WHATSAPP" },
    user: obj({ id: str(), name: str(), role: str(), roleLabel: str() }),
    permissions: { ...arr(str()), description: "Permissões do RBAC do usuário que importam para a integração." },
    allowedScopes: { ...arr(str(undefined, { enum: API_SCOPES })), description: "Scopes da integração ∩ RBAC do usuário: o que ela pode fazer POR ele." },
    delegation: obj({ header: { const: "X-B2C-Identity" }, value: str() }),
  }),
  KnowledgeBundle: obj({
    catalog: str(),
    version: str("Versão do pacote (muda quando a documentação muda) — reindexe quando mudar."),
    principle: str(),
    collection: str("Nome sugerido da coleção no vector store."),
    embedding: obj({ provider: str(), model: str(), dimensions: { type: "integer" }, distance: str() }),
    documentos: arr(obj({ id: str(), path: str(), titulo: str(), categoria: str(), atualizado_em: str(), sha256: str(), trechos: { type: "integer" } })),
    trechos: arr(obj({
      id: str(),
      text: str("Trecho pronto para gerar o embedding (já traz documento e seção no início)."),
      metadata: obj({ docId: str(), titulo: str(), categoria: str(), secao: str(), fonte: str(), atualizado_em: str(), tipo: { const: "conhecimento" } }),
    })),
  }),
  PendingActionProposal: obj(
    {
      operation: str("Operação da API ou nome da ferramenta do agente. Bloqueadas (excluir, reabrir competência, permissões, usuários, plano de contas) → 403 `operation_blocked`.", {
        enum: [...Object.keys(OPERACOES_DE_ESCRITA), ...Object.values(OPERACOES_DE_ESCRITA).map((o) => o.tool)],
      }),
      targetId: str("Id da entidade alvo (cobrança, cliente, despesa, oportunidade ou chave da ação da rotina). Omitir em operações de criação."),
      input: { type: "object", description: "O MESMO corpo da rota de escrita da operação (ex.: `POST /receivables/{id}/payments`)." },
    },
    ["operation"],
    { additionalProperties: false }
  ),
  PendingActionConfirm: obj(
    {
      messageId: str("Id da mensagem do WhatsApp em que o usuário confirmou."),
      confirmationCode: str("Código de 4 dígitos que o usuário digitou.", { pattern: "^\\d{4}$" }),
    },
    ["messageId", "confirmationCode"],
    { additionalProperties: false, description: "Não há corpo da ação: executa-se o payload guardado no preview." }
  ),
  PendingAction: obj({
    actionId: str(),
    operation: str(),
    tool: str(),
    risk: { const: "WRITE_CONFIRMATION" },
    status: str(undefined, { enum: ["PENDING", "EXECUTING", "EXECUTED", "FAILED", "CANCELLED", "EXPIRED", "SUPERSEDED"] }),
    channel: { const: "WHATSAPP" },
    targetId: { type: ["string", "null"] },
    summary: obj({ label: { type: ["string", "null"] }, amount: { type: ["number", "null"] } }),
    preview: str("Prévia montada pela API a partir do estado atual."),
    confirmationCode: str("Só enquanto PENDING."),
    message: str("Texto pronto para o WhatsApp (prévia + como confirmar; ou o resultado)."),
    expiresAt: str(undefined, { format: "date-time" }),
    createdAt: str(undefined, { format: "date-time" }),
    result: { type: ["object", "null"] },
    errorCode: { type: ["string", "null"] },
  }, ["actionId", "operation", "risk", "status", "preview", "expiresAt"]),
  ServiceAccountMe: obj({
    type: { const: "service_account" }, id: str(), name: str(),
    tokenPrefix: str("Parte pública do token.", { example: "b2c_live_k3j9x2ma" }),
    scopes: arr(str(undefined, { enum: API_SCOPES })),
  }),
};

// ---------------------------------------------------------------------------
// Respostas e operações
// ---------------------------------------------------------------------------

const exemploErro = (code: string, message: string, extra: Obj = {}) => ({
  success: false,
  error: { code, message, ...extra },
  meta: { requestId: "3f1c2a9e-5b7d-4c1e-9a0f-2d6e8b4c7a10" },
});

const RESPONSES = {
  Unauthorized: {
    description: "Credencial ausente ou inválida (missing_token, invalid_token, revoked_token, expired_token, inactive_owner).",
    content: { "application/json": { schema: ref("Error"), example: exemploErro("invalid_token", "Token inválido.") } },
  },
  Forbidden: {
    description: "A conta de serviço não tem o scope da rota.",
    content: {
      "application/json": {
        schema: ref("Error"),
        example: exemploErro("insufficient_scope", "Esta integração não tem o scope “clients.read”.", { scope: "clients.read" }),
      },
    },
  },
  BadRequest: {
    description: "Parâmetro inválido ou DESCONHECIDO (filtro digitado errado não é ignorado).",
    content: {
      "application/json": {
        schema: ref("Error"),
        example: exemploErro("validation_error", "Parâmetros de consulta inválidos.", {
          details: [{ field: "competence", message: "Use o formato AAAA-MM (ex.: 2026-09)." }],
        }),
      },
    },
  },
  NotFound: {
    description: "Não existe PARA ESTE DONO (id de outro workspace também responde 404).",
    content: { "application/json": { schema: ref("Error"), example: exemploErro("not_found", "Cliente não encontrado.") } },
  },
  RateLimited: {
    description: "120 requisições por minuto por IP.",
    headers: { "Retry-After": { schema: int(), description: "Segundos." } },
    content: { "application/json": { schema: ref("Error"), example: exemploErro("rate_limited", "Muitas requisições. Aguarde um minuto.") } },
  },
  Conflict: {
    description:
      "Conflito: `idempotency_in_progress` (a 1ª chamada com a chave ainda roda), `duplicate` (cliente com mesmo nome/documento — reenvie com `allowDuplicate`) ou `possible_duplicate` (pagamento igual já registrado — reenvie com `allowDuplicate`).",
    content: {
      "application/json": {
        schema: ref("Error"),
        example: exemploErro("possible_duplicate", "Já existe um pagamento de 1500.00 em 2026-09-28 nesta cobrança. Se for mesmo outro pagamento, envie \"allowDuplicate\": true."),
      },
    },
  },
  Unprocessable: {
    description:
      "Recusado pela regra de negócio: `unprocessable`, `invalid_state` (ex.: cobrança quitada/removida, despesa paga), `competence_closed`, `retroactive_requires_confirmation` ou `idempotency_key_reused` (mesma chave, outros dados). Recusas de regra ficam guardadas na chave: repetir devolve a mesma recusa.",
    content: {
      "application/json": {
        schema: ref("Error"),
        example: exemploErro("competence_closed", "O caixa de 08/2026 está fechado."),
      },
    },
  },
  InternalError: {
    description: "Erro inesperado. Nunca traz stack nem mensagem interna — informe o requestId.",
    content: { "application/json": { schema: ref("Error"), example: exemploErro("internal_error", "Erro interno. Informe o requestId ao suporte.") } },
  },
};

const META_EXEMPLO = { requestId: "n8n-exec-4812", generatedAt: "2026-09-28T13:00:00.000Z" };

function sucesso(
  schemaData: Obj,
  opts: { lista?: boolean; exemplo?: unknown; metaExtra?: Obj; metaExemplo?: Obj } = {}
) {
  const meta = opts.lista ? ref("ListMeta") : ref("Meta");
  return {
    description: "Sucesso.",
    headers: { "x-request-id": { schema: str(), description: "Mesmo valor de meta.requestId." } },
    content: {
      "application/json": {
        schema: obj({ success: { const: true }, data: schemaData, meta: opts.metaExtra ? { allOf: [meta, opts.metaExtra] } : meta }),
        ...(opts.exemplo !== undefined
          ? {
              example: {
                success: true,
                data: opts.exemplo,
                meta: {
                  ...META_EXEMPLO,
                  ...(opts.lista ? { pagination: { page: 1, pageSize: 50, total: 1, totalPages: 1 } } : {}),
                  ...(opts.metaExemplo ?? {}),
                },
              },
            }
          : {}),
      },
    },
  };
}

function op(o: {
  id: string;
  tag: string;
  summary: string;
  description?: string;
  scope: string | null;
  params?: Obj[];
  ok: Obj;
  notFound?: boolean;
}) {
  const scopeTxt = o.scope ? `\n\n**Scope obrigatório:** \`${o.scope}\`.` : "\n\n**Scope:** nenhum (qualquer token válido).";
  return {
    get: {
      operationId: o.id,
      tags: [o.tag],
      summary: o.summary,
      description: (o.description ?? "") + scopeTxt,
      security: [{ bearerAuth: o.scope ? [o.scope] : [] }],
      "x-required-scope": o.scope,
      parameters: [refParam("RequestId"), refParam("Source"), refParam("Identity"), ...(o.params ?? [])],
      responses: {
        "200": o.ok,
        "400": refResp("BadRequest"),
        "401": refResp("Unauthorized"),
        ...(o.scope ? { "403": refResp("Forbidden") } : {}),
        ...(o.notFound ? { "404": refResp("NotFound") } : {}),
        "429": refResp("RateLimited"),
        "500": refResp("InternalError"),
      },
    },
  };
}

function writeOp(o: {
  method: "post" | "patch";
  id: string;
  tag: string;
  summary: string;
  description?: string;
  scope: string;
  params?: Obj[];
  body: { schema: Obj; example: unknown };
  ok: Obj;
  okStatus?: "200" | "201";
}) {
  return {
    [o.method]: {
      operationId: o.id,
      tags: [o.tag],
      summary: o.summary,
      description:
        (o.description ?? "") +
        `\n\n**Scope obrigatório:** \`${o.scope}\`. **Idempotency-Key obrigatória.** Registrada em Atividades da IA/API e no AuditLog.`,
      security: [{ bearerAuth: [o.scope] }],
      "x-required-scope": o.scope,
      parameters: [refParam("IdempotencyKey"), refParam("RequestId"), refParam("Source"), refParam("Identity"), ...(o.params ?? [])],
      requestBody: {
        required: true,
        content: { "application/json": { schema: o.body.schema, example: o.body.example } },
      },
      responses: {
        [o.okStatus ?? "201"]: {
          ...o.ok,
          headers: {
            ...(o.ok.headers as Obj),
            "Idempotent-Replayed": { schema: str(undefined, { enum: ["true", "false"] }), description: "true = repetição devolvida da 1ª execução." },
          },
        },
        "400": refResp("BadRequest"),
        "401": refResp("Unauthorized"),
        "403": refResp("Forbidden"),
        "404": refResp("NotFound"),
        "409": refResp("Conflict"),
        "422": refResp("Unprocessable"),
        "429": refResp("RateLimited"),
        "500": refResp("InternalError"),
      },
    },
  };
}

const PAG = [refParam("Page"), refParam("PageSize")];

const EX_CLIENTE = {
  id: "cmu1a2b3c0001xyz",
  name: "Face Love Estética",
  legalName: "Face Love Clínica Ltda",
  document: "**.***.***/0001-90",
  status: { code: "ACTIVE", label: "Ativo" },
  modality: "MRR",
  segment: "Estética",
  responsible: "Raiane",
  paymentDay: 10,
  monthlyValue: 1500,
  totalContractValue: null,
  contractTerm: "12 meses",
  expectedRenewalDate: "2027-01-10",
  startedAt: "2026-01-10",
  delinquency: { status: "owing", manual: false },
  scheduledStatusChange: null,
};

const PATHS: Record<string, Obj> = {
  "/health": op({
    id: "getHealth", tag: "Sistema", summary: "Saúde da API e da credencial", scope: null,
    ok: sucesso(obj({ status: { const: "ok" }, apiVersion: { const: "v1" }, database: str() }), {
      exemplo: { status: "ok", apiVersion: "v1", database: "ok" },
    }),
  }),
  "/me": op({
    id: "getMe", tag: "Sistema", summary: "Quem é esta credencial", scope: null,
    description: "Teste de conexão do n8n. Não devolve dado de negócio.",
    ok: sucesso(ref("ServiceAccountMe"), {
      exemplo: { type: "service_account", id: "cmu9sa0001", name: "B2C Finance AI Agent", tokenPrefix: "b2c_live_k3j9x2ma", scopes: ["clients.read", "receivables.read"] },
    }),
  }),
  "/dashboard/summary": op({
    id: "getDashboardSummary", tag: "Painéis", summary: "Indicadores oficiais do mês", scope: "dashboard.read",
    description: "Mesmo motor de métricas do Dashboard. Competência passada = números daquela competência.",
    params: [refParam("Competence")],
    ok: sucesso(ref("DashboardSummary"), {
      exemplo: { competence: "2026-09", partial: true, metrics: { mrr_oficial: { value: 45200, name: "MRR oficial", unit: "currency" }, clientes_ativos: { value: 38, name: "Clientes ativos", unit: "count" } } },
    }),
  }),
  "/clients": op({
    id: "listClients", tag: "Clientes", summary: "Carteira da competência", scope: "clients.read",
    description:
      "Status de cada cliente **na competência** (vigência pelo histórico). Só entra quem tinha status naquela competência. Sem `status`: todos menos `CHURNED`. Documento mascarado. Ordem: nome.",
    params: [
      refParam("Competence"),
      q("search", str(undefined, { minLength: 1, maxLength: 100 }), "Texto em nome, razão social, documento, e-mail, nicho, cidade ou responsáveis.", "face love"),
      q("status", str(undefined, { enum: [...CLIENT_STATUSES, "revenue_active", "all"] }), "`revenue_active` = Ativo, Renovação ou Inadimplente; `all` = qualquer status."),
      q("modality", str(undefined, { enum: ["MRR", "TCV"] }), "Modalidade."),
      q("responsible", str(undefined, { maxLength: 100 }), "Responsável comercial (nome, sem diferenciar maiúsculas)."),
      q("delinquency", str(undefined, { enum: ["paid", "owing", "no_billing"] }), "Inadimplência NA COMPETÊNCIA (ajuste manual vence o cálculo)."),
      q("renewalMonth", str(undefined, { pattern: "^\\d{4}-(0[1-9]|1[0-2])$" }), "Expectativa de renovação no mês AAAA-MM.", "2026-12"),
      q("segment", str(undefined, { maxLength: 100 }), "Nicho (nome ou id)."),
      ...PAG,
    ],
    ok: sucesso(arr(ref("ClientListItem")), {
      lista: true,
      exemplo: [EX_CLIENTE],
      metaExemplo: { statusReference: { competence: "2026-09", date: "2026-09-28" } },
      metaExtra: obj({ statusReference: obj({ competence: str(), date: data("Dia cujo status foi usado (fim do mês, ou hoje no mês corrente).") }) }),
    }),
  }),
  "/clients/{id}": op({
    id: "getClient", tag: "Clientes", summary: "Detalhe do cliente", scope: "clients.read", notFound: true,
    description: "Documento completo. `status.current` = hoje; com `competence`, também `status.atCompetence`.",
    params: [refParam("Id"), refParam("Competence")],
    ok: sucesso(ref("ClientDetail")),
  }),
  "/clients/{id}/status-history": op({
    id: "getClientStatusHistory", tag: "Clientes", summary: "Histórico de status com vigência", scope: "client_status.read", notFound: true,
    description: "Intervalos `effectiveFrom`–`effectiveTo` (inclusivos). Mudar o status em outubro não reescreve setembro.",
    params: [refParam("Id")],
    ok: sucesso(ref("StatusHistory"), {
      exemplo: {
        clientId: "cmu1a2b3c0001xyz", today: "2026-10-05", currentStatus: { code: "INACTIVE", label: "Inativo" },
        intervals: [
          { id: "h1", status: { code: "ACTIVE", label: "Ativo" }, effectiveFrom: "2026-01-10", effectiveTo: "2026-09-30", reason: null, origin: "UI", needsReview: false, recordedAt: "2026-01-10T12:00:00.000Z" },
          { id: "h2", status: { code: "INACTIVE", label: "Inativo" }, effectiveFrom: "2026-10-01", effectiveTo: null, reason: "Encerrou contrato", origin: "UI", needsReview: false, recordedAt: "2026-10-01T14:00:00.000Z" },
        ],
        scheduled: [],
      },
    }),
  }),
  "/receivables": op({
    id: "listReceivables", tag: "Recebimentos", summary: "Cobranças", scope: "receivables.read",
    description:
      "Janela: `dateFrom`+`dateTo` (vencimento, inclusivo, máx. 400 dias) OU `competence` (padrão: atual). Status derivado na hora — a leitura não grava nada. Removidas só quando pedidas. `meta.totals` soma o filtro inteiro.",
    params: [
      refParam("Competence"),
      q("dateFrom", data(), "Vencimento a partir de (junto com dateTo).", "2026-09-01"),
      q("dateTo", data(), "Vencimento até (inclusivo).", "2026-09-30"),
      q("status", str(`Um ou mais, separados por vírgula: ${RECEIVABLE_STATUSES.join(", ")}; atalho \`open\` = UPCOMING, OVERDUE, DELINQUENT, PARTIAL.`), "Status derivado.", "open"),
      q("clientId", str(), "Só deste cliente."),
      ...PAG,
    ],
    ok: sucesso(arr(ref("Receivable")), {
      lista: true,
      metaExtra: obj({ window: { type: "object" }, totals: obj({ amount: dinheiro(), paidAmount: dinheiro(), openAmount: dinheiro() }) }, ["window", "totals"]),
      metaExemplo: { window: { competence: "2026-09" }, totals: { amount: 1500, paidAmount: 0, openAmount: 1500 } },
      exemplo: [{
        id: "cmubill0001", client: { id: "cmu1a2b3c0001xyz", name: "Face Love Estética" }, description: "Mensalidade 09/2026",
        competence: "2026-09", amount: 1500, paidAmount: 0, openAmount: 1500, dueDate: "2026-09-10", paidAt: null,
        status: { code: "OVERDUE", label: "Vencido" }, daysLate: 18, kind: "MRR", revenueType: "MRR", installmentNumber: null, collectionStatus: "NOT_CONTACTED",
      }],
    }),
  }),
  "/receivables/{id}": op({
    id: "getReceivable", tag: "Recebimentos", summary: "Cobrança e pagamentos", scope: "receivables.read", notFound: true,
    params: [refParam("Id")],
    ok: sucesso(ref("ReceivableDetail")),
  }),
  "/expenses": op({
    id: "listExpenses", tag: "Despesas", summary: "Despesas", scope: "expenses.read",
    description: "Período pela data do lançamento (padrão: mês atual). `vencida` = pendente com vencimento antes de hoje.",
    params: [
      q("status", str(undefined, { enum: [...EXPENSE_STATUSES] }), "Status."),
      q("dateFrom", data(), "Lançamento a partir de (junto com dateTo)."),
      q("dateTo", data(), "Lançamento até (inclusivo)."),
      q("category", str(undefined, { maxLength: 100 }), "Categoria (id ou nome)."),
      ...PAG,
    ],
    ok: sucesso(arr(ref("Expense")), { lista: true, metaExtra: obj({ window: { type: "object" }, totalAmount: dinheiro() }, ["totalAmount"]) }),
  }),
  "/expenses/{id}": op({
    id: "getExpense", tag: "Despesas", summary: "Despesa", scope: "expenses.read", notFound: true,
    params: [refParam("Id")],
    ok: sucesso({ allOf: [ref("Expense"), obj({ notes: nulo(str()), installment: nulo(obj({ number: int(), total: nulo(int()) })) })] }),
  }),
  "/cash/summary": op({
    id: "getCashSummary", tag: "Caixa", summary: "Disponível, compromissos e projeção", scope: "cash.read",
    ok: sucesso(ref("CashSummary")),
  }),
  "/upsells": op({
    id: "listUpsells", tag: "Upsell", summary: "Oportunidades de upsell", scope: "upsells.read",
    description: "O responsável é gravado como NOME (texto) — por isso o filtro é `responsible`, não um id.",
    params: [
      q("status", str(undefined, { enum: [...UPSELL_STATUSES] }), "Status."),
      q("clientId", str(), "Cliente."),
      q("responsible", str(undefined, { maxLength: 100 }), "Nome do responsável."),
      ...PAG,
    ],
    ok: sucesso(arr(ref("Upsell")), { lista: true, metaExtra: obj({ totalValue: dinheiro() }) }),
  }),
  "/routine/daily": op({
    id: "getDailyRoutine", tag: "Painéis", summary: "Rotina do dia", scope: "routine.read",
    description:
      "Mesmo montador da tela Rotina. Seções de áreas sem scope (receivables.read, expenses.read, cash.read, clients.read, upsells.read) vêm vazias.",
    ok: sucesso(ref("DailyRoutine")),
  }),
  "/reports/daily": op({
    id: "getDailyReport", tag: "Relatórios", summary: "Relatório do dia", scope: "reports.read",
    description:
      "O que venceu, entrou e mudou no dia (fuso America/Bahia): cobranças do dia e pagamentos recebidos; despesas do dia e despesas pagas no dia; status com vigência no dia e registrados no dia; clientes com entrada e cadastrados no dia; upsells criados e vendidos no dia. Seções sem o scope da área saem de `data` e entram em `meta.omittedSections`.",
    params: [q("date", data(), "Dia (padrão: hoje, fuso America/Bahia).", "2026-09-28")],
    ok: sucesso(ref("DailyReport"), { metaExtra: obj({ omittedSections: arr(str()) }) }),
  }),
  "/reports/monthly": op({
    id: "getMonthlyReport", tag: "Relatórios", summary: "Relatório da competência", scope: "reports.read",
    description: "Fechamento, indicadores, carteira por status NA competência, recebimentos e despesas. Competências passadas mostram o que valia nelas.",
    params: [refParam("Competence")],
    ok: sucesso(ref("MonthlyReport"), { metaExtra: obj({ omittedSections: arr(str()) }) }),
  }),
  "/search": op({
    id: "search", tag: "Busca", summary: "Desambiguar clientes pelo nome", scope: "clients.read",
    description: "Ignora acento, caixa e espaço (`facelove estetica` acha “Face Love Estética”). Resultado mínimo para escolher; documento mascarado.",
    params: [
      { ...q("q", str(undefined, { minLength: 2, maxLength: 100 }), "Texto buscado.", "face love"), required: true },
      q("type", str(undefined, { enum: ["client"], default: "client" }), "Tipo de resultado."),
      q("limit", int(undefined, { minimum: 1, maximum: 25, default: 10 }), "Máximo de resultados."),
    ],
    ok: sucesso(arr(ref("SearchResult")), {
      metaExtra: obj({ query: str(), type: str(), total: int("Quantos casaram (antes do limit).") }),
      metaExemplo: { query: "face love", type: "client", total: 1 },
      exemplo: [{ type: "client", id: "cmu1a2b3c0001xyz", name: "Face Love Estética", legalName: "Face Love Clínica Ltda", document: "**.***.***/0001-90", status: { code: "ACTIVE", label: "Ativo" }, modality: "MRR", score: 90 }],
    }),
  }),
};

// ---------------------------------------------------------------------------
// Escritas (28/09/2026)
// ---------------------------------------------------------------------------

const ID = [refParam("Id")];
Object.assign(
  PATHS["/clients"],
  writeOp({
    method: "post", id: "createClient", tag: "Clientes", summary: "Cadastrar cliente", scope: "clients.create",
    description: "Mesma regra do formulário: duplicidade, modalidade MRR/TCV, contrato e cobranças, expectativa de renovação.",
    body: {
      schema: ref("ClientCreate"),
      example: { name: "Face Love Estética", legalName: "Face Love Clínica Ltda", modality: "MRR", monthlyValue: 1500, paymentDay: 10, contractMonths: 12, startedAt: "2026-10-01" },
    },
    ok: sucesso(ref("ClientDetail")),
  })
);
Object.assign(
  PATHS["/clients/{id}"],
  writeOp({
    method: "patch", id: "updateClient", tag: "Clientes", summary: "Atualizar cadastro do cliente", scope: "clients.update",
    params: ID, okStatus: "200",
    body: { schema: ref("ClientPatch"), example: { phone: "+55 71 99999-0000", city: "Salvador", state: "BA" } },
    ok: sucesso(ref("ClientDetail")),
  })
);
PATHS["/clients/{id}/status-changes"] = writeOp({
  method: "post", id: "changeClientStatus", tag: "Clientes", summary: "Alterar status com vigência", scope: "client_status.write",
  description:
    "Novo status A PARTIR DE `effectiveFrom`, na linha do tempo — nunca uma troca global. Hoje: vale já. Futura: fica programada (o status de hoje não muda). Mês passado: exige `allowRetroactive: true`. Competência fechada: 422.",
  params: ID,
  body: { schema: ref("StatusChange"), example: { status: "INACTIVE", effectiveFrom: "2026-10-01", reason: "Encerrou o contrato" } },
  ok: sucesso(ref("StatusChangeResult")),
});
PATHS["/receivables/{id}/payments"] = writeOp({
  method: "post", id: "registerPayment", tag: "Recebimentos", summary: "Registrar pagamento", scope: "receivables.register_payment",
  description:
    "Motor de Recebimentos. Valida: cobrança do dono (404), estado (quitada/removida/renegociada → 422), valor (acima do saldo só com `allowOverpayment`), data (não futura), competência do caixa (fechada → 422) e duplicidade (pagamento igual → 409, salvo `allowDuplicate`).",
  params: ID,
  body: { schema: ref("PaymentCreate"), example: { amount: 1500, paidAt: "2026-09-28", method: "PIX" } },
  ok: sucesso(ref("PaymentResult")),
});
Object.assign(
  PATHS["/expenses"],
  writeOp({
    method: "post", id: "createExpense", tag: "Despesas", summary: "Lançar despesa", scope: "expenses.create",
    description: "Nasce pendente (pagar é `POST /expenses/{id}/pay`). Cartão de crédito fica fora da V1.",
    body: { schema: ref("ExpenseCreate"), example: { description: "Licença do CRM", amount: 300, dueDate: "2026-10-10", category: "Ferramentas", type: "TOOL" } },
    ok: sucesso(ref("ExpenseDetail")),
  })
);
Object.assign(
  PATHS["/expenses/{id}"],
  writeOp({
    method: "patch", id: "updateExpense", tag: "Despesas", summary: "Atualizar despesa pendente", scope: "expenses.update",
    params: ID, okStatus: "200",
    body: { schema: ref("ExpensePatch"), example: { amount: 350, dueDate: "2026-10-15" } },
    ok: sucesso(ref("ExpenseDetail")),
  })
);
PATHS["/expenses/{id}/pay"] = writeOp({
  method: "post", id: "payExpense", tag: "Despesas", summary: "Marcar despesa como paga", scope: "expenses.pay",
  description: "Motor de despesas (guarda de período, auditoria). Já paga → 200 com `alreadyPaid: true`. Corpo vazio (`{}`).",
  params: ID, okStatus: "200",
  body: { schema: { type: "object", additionalProperties: false }, example: {} },
  ok: sucesso(obj({ alreadyPaid: bool(), expense: ref("ExpenseDetail") })),
});
Object.assign(
  PATHS["/upsells"],
  writeOp({
    method: "post", id: "createUpsell", tag: "Upsell", summary: "Cadastrar oportunidade", scope: "upsells.create",
    body: {
      schema: ref("UpsellCreate"),
      example: { clientId: "cmu1a2b3c0001xyz", description: "Gestão de tráfego pago", amount: 900, responsibleId: "cmuemp0001", expectedCloseDate: "2026-10-31" },
    },
    ok: sucesso(ref("Upsell")),
  })
);
PATHS["/upsells/{id}"] = {
  ...op({
    id: "getUpsell", tag: "Upsell", summary: "Oportunidade", scope: "upsells.read", notFound: true, params: ID,
    ok: sucesso(ref("Upsell")),
  }),
  ...writeOp({
    method: "patch", id: "updateUpsell", tag: "Upsell", summary: "Atualizar oportunidade em aberto", scope: "upsells.update",
    params: ID, okStatus: "200",
    body: { schema: ref("UpsellPatch"), example: { amount: 1200, status: "NEGOTIATION" } },
    ok: sucesso(ref("Upsell")),
  }),
};
PATHS["/routine/actions/{id}/complete"] = writeOp({
  method: "post", id: "completeRoutineAction", tag: "Painéis", summary: "Concluir ação da rotina de hoje", scope: "routine.write",
  description: "`id` = a chave da ação em `GET /routine/daily` (codificada na URL, ex.: `cobrar%3Acm…`). Só muda o estado do dia.",
  params: [{ name: "id", in: "path", required: true, description: "Chave da ação.", schema: str(undefined, { pattern: "^[A-Za-z0-9:_.%-]{1,200}$" }) }],
  okStatus: "200",
  body: { schema: { type: "object", additionalProperties: false }, example: {} },
  ok: sucesso(ref("RoutineActionResult")),
});

PATHS["/integrations/resolve-identity"] = {
  post: {
    operationId: "resolveIdentity",
    tags: ["Integração"],
    summary: "Identificar quem está falando (WhatsApp → usuário)",
    description:
      "Resolve o número pelo VÍNCULO cadastrado em Configurações → Integrações → WhatsApp e devolve o usuário, as permissões relevantes e os scopes que a integração pode usar em nome dele. Número não vinculado, vínculo desativado ou usuário inativo → 404. Usuário restrito a uma agência → 403 (ainda não suportado). É uma consulta (sem Idempotency-Key); POST para o telefone não ir para a URL.\n\n**Scope obrigatório:** `identities.resolve`.",
    security: [{ bearerAuth: ["identities.resolve"] }],
    "x-required-scope": "identities.resolve",
    parameters: [refParam("RequestId"), refParam("Source")],
    requestBody: {
      required: true,
      content: { "application/json": { schema: ref("IdentityResolveRequest"), example: { channel: "WHATSAPP", externalIdentifier: "+5571999990000" } } },
    },
    responses: {
      "200": sucesso(ref("IdentityResolution"), {
        exemplo: {
          identityId: "cmuwa0001", channel: "WHATSAPP",
          user: { id: "cmuuser01", name: "Raiane", role: "FINANCEIRO", roleLabel: "Financeiro" },
          permissions: ["clientes.visualizar", "recebimentos.visualizar"],
          allowedScopes: ["clients.read", "client_status.read", "receivables.read"],
          delegation: { header: "X-B2C-Identity", value: "cmuwa0001" },
        },
      }),
      "400": refResp("BadRequest"),
      "401": refResp("Unauthorized"),
      "403": refResp("Forbidden"),
      "404": refResp("NotFound"),
      "429": refResp("RateLimited"),
      "500": refResp("InternalError"),
    },
  },
};

PATHS["/knowledge/documents"] = op({
  id: "getKnowledgeDocuments", tag: "Integração", summary: "Base de conhecimento do agente (para indexar)",
  description:
    "Documentação curada (métricas, regras MRR/TCV, status com vigência, plano de contas, políticas, API, o agente) em trechos com metadados, pronta para um vector store. RAG = conhecimento; dados atuais vêm só das rotas de dados. Guia: docs/AI_AGENT_KNOWLEDGE.md.",
  scope: "knowledge.read",
  ok: sucesso(ref("KnowledgeBundle")),
});

const P_ACAO = [{ name: "id", in: "path", required: true, description: "Id da ação pendente.", schema: str(undefined, { pattern: "^[A-Za-z0-9_-]{1,64}$" }) }];
const EX_ACAO = {
  actionId: "cmupa0001", operation: "payments.register", tool: "registrar_pagamento", risk: "WRITE_CONFIRMATION",
  status: "PENDING", channel: "WHATSAPP", targetId: "cmubil0001", summary: { label: "Face Love Distribuidora", amount: 1500 },
  preview: "Encontrei:\n\n*Face Love Distribuidora*\nRecebimento em aberto: R$ 1.500,00\nCompetência: Setembro/2026\nData de pagamento: hoje (28/09/2026)\n\nDeseja registrar?",
  confirmationCode: "4821",
  expiresAt: "2026-09-28T13:10:00.000Z", createdAt: "2026-09-28T13:00:00.000Z", result: null, errorCode: null,
};
const acaoOp = (o: { method: "get" | "post"; id: string; summary: string; description: string; params?: Obj[]; body?: { schema: Obj; example: unknown }; ok: Obj; okStatus?: string; idem?: boolean }) => ({
  [o.method]: {
    operationId: o.id,
    tags: ["Agente"],
    summary: o.summary,
    description: o.description + "\n\n**Scope obrigatório:** `agent_actions.manage` + **X-B2C-Identity** (a ação é sempre de um usuário).",
    security: [{ bearerAuth: ["agent_actions.manage"] }],
    "x-required-scope": "agent_actions.manage",
    parameters: [
      ...(o.idem ? [{ ...PARAMETERS.IdempotencyKey, description: "`wa:<messageId>:<actionId>` — a mensagem do WhatsApp que confirmou + o id da ação (caracteres fora de `A-Za-z0-9._-` no messageId viram `_`).", example: "wa:wamid.HBgM_3EB0:cmupa0001" }] : []),
      refParam("RequestId"), refParam("Source"), { ...PARAMETERS.Identity, required: true }, ...(o.params ?? []),
    ],
    ...(o.body ? { requestBody: { required: true, content: { "application/json": { schema: o.body.schema, example: o.body.example } } } } : {}),
    responses: {
      [o.okStatus ?? "200"]: o.ok,
      "400": refResp("BadRequest"),
      "401": refResp("Unauthorized"),
      "403": refResp("Forbidden"),
      "404": refResp("NotFound"),
      "409": refResp("Conflict"),
      "422": refResp("Unprocessable"),
      "429": refResp("RateLimited"),
      "500": refResp("InternalError"),
    },
  },
});
PATHS["/agent/pending-actions"] = {
  ...acaoOp({
    method: "post", id: "proposeAgentAction", okStatus: "201", summary: "Propor ação de escrita (gera prévia, não executa)",
    description: "O agente propõe; a API valida `input` com o schema da rota de escrita, lê o estado atual, monta a prévia e guarda a ação (válida por 10 min; `B2C_PENDING_ACTION_TTL_MINUTES`). Uma pendente por usuário: a nova substitui a anterior. Nada é gravado no negócio. Header opcional `X-B2C-Message-Id` = mensagem de origem.",
    body: { schema: ref("PendingActionProposal"), example: { operation: "payments.register", targetId: "cmubil0001", input: { amount: 1500 } } },
    ok: sucesso(ref("PendingAction"), { exemplo: EX_ACAO }),
  }),
  ...acaoOp({
    method: "get", id: "listAgentActions", summary: "Ações do usuário do vínculo",
    description: "Filtros: `status`, `sourceMessageId` (a ação proposta a partir de uma mensagem), `limit` (1–20).",
    params: [
      { name: "status", in: "query", required: false, schema: str(undefined, { enum: ["PENDING", "EXECUTING", "EXECUTED", "FAILED", "CANCELLED", "EXPIRED", "SUPERSEDED"] }) },
      { name: "sourceMessageId", in: "query", required: false, schema: str() },
      { name: "limit", in: "query", required: false, schema: { type: "integer", minimum: 1, maximum: 20, default: 5 } },
    ],
    ok: sucesso(arr(ref("PendingAction"))),
  }),
};
PATHS["/agent/pending-actions/{id}/confirm"] = acaoOp({
  method: "post", id: "confirmAgentAction", idem: true, summary: "Confirmar e executar a ação",
  description: "Confere usuário, vínculo, código (5 tentativas), validade e se o estado ainda é o da prévia (senão 409 `state_changed`). Executa o payload GUARDADO pela rota de escrita oficial, com a mesma Idempotency-Key. 200 = despachada (`data.status` EXECUTED ou FAILED, `data.message` pronta para o WhatsApp); repetir a mesma confirmação devolve o mesmo resultado. Erros: 410 `action_expired`, 409 `action_not_pending`, 422 `confirmation_mismatch`.",
  params: P_ACAO,
  body: { schema: ref("PendingActionConfirm"), example: { messageId: "wamid.HBgM_3EB0", confirmationCode: "4821" } },
  ok: sucesso(ref("PendingAction")),
});
PATHS["/agent/pending-actions/{id}/cancel"] = acaoOp({
  method: "post", id: "cancelAgentAction", summary: "Cancelar a ação (nada é executado)",
  description: "O usuário respondeu NÃO.",
  params: P_ACAO,
  body: { schema: obj({ messageId: str() }, [], { additionalProperties: false }), example: { messageId: "wamid.HBgM_3EB1" } },
  ok: sucesso(ref("PendingAction")),
});

const DESCRICAO = `API oficial do B2C Finance para integrações (n8n, agente de WhatsApp).

## Versionamento
A versão está no caminho: \`/api/v1\`. Mudanças incompatíveis (remover campo, mudar significado) só em \`/api/v2\`; campos novos podem surgir na v1 — ignore os que não conhece.

## Autenticação e dono dos dados
- \`Authorization: Bearer YOUR_API_TOKEN\` — token de uma **conta de serviço** criada em Configurações → Integrações. Cookie de sessão não vale.
- O **dono dos dados (ownerId) é inferido da conta de serviço**. A API **não aceita ownerId** em parâmetro, header ou corpo — não há como pedir dados de outro workspace. Registro de outro dono responde 404.

## Scopes
Toda rota exige um scope (\`x-required-scope\`). Sem ele: 403 \`insufficient_scope\`. Não existe curinga; exclusões, usuários, permissões e reabertura de competência não são concedíveis. Scopes: ${API_SCOPES.join(", ")}.

## Status temporal e competências
O status do cliente tem **vigência** (histórico com início e fim). Listas mostram o status **da competência pedida** — do último dia do mês, ou de hoje no mês corrente. Mudar um cliente para Inativo em outubro **não** altera o que setembro mostra: competências históricas são preservadas. Nunca use o status atual para responder sobre um mês passado.

## Escritas e Idempotency-Key
A V1 tem escritas CONTROLADAS (cadastro/edição de cliente, status com vigência, pagamento, despesa, upsell, rotina) e nenhuma operação destrutiva: não há DELETE, reabertura de competência nem gestão de usuários/permissões. Status do cliente nunca muda por PATCH — só por \`POST /clients/{id}/status-changes\`, com data de vigência. Toda escrita exige o header **\`Idempotency-Key\`** (1–255 caracteres \`A-Z a-z 0-9 . _ : -\`; ex.: o id da mensagem do WhatsApp, \`wa_message_3EB0C4…\`):
- a mesma integração + a mesma chave executa a operação **uma vez**; a repetição devolve a resposta original com o header \`Idempotent-Replayed: true\` e \`meta.idempotency.replayed = true\`;
- repetir enquanto a primeira ainda roda → 409 \`idempotency_in_progress\`; mesma chave com outros dados → 422 \`idempotency_key_reused\`; escrita sem a chave → 400 \`idempotency_key_required\`;
- guardam-se sucessos e recusas de regra (422) por 30 dias; erro de servidor libera a chave para nova tentativa.

## Quem está falando (delegação)
Para agir em nome de uma pessoa (ex.: quem mandou a mensagem no WhatsApp), a integração resolve o número em \`POST /integrations/resolve-identity\` e manda o \`identityId\` em \`X-B2C-Identity\`. A API recorta os scopes pelo RBAC dessa pessoa e a registra como ator. O usuário vem do VÍNCULO cadastrado pelo administrador — nunca de um campo enviado pelo chamador ou pela IA.

## Ações do agente com confirmação
O agente de WhatsApp não escreve direto: propõe em \`POST /agent/pending-actions\` (a API monta a prévia a partir do estado atual e guarda a ação), o usuário responde "SIM <código>" e a integração confirma em \`POST /agent/pending-actions/{id}/confirm\` com \`Idempotency-Key: wa:<messageId>:<actionId>\`. A execução usa a rota de escrita oficial, com o RBAC do usuário. Excluir, reabrir competência, permissões, usuários e plano de contas são BLOQUEADOS para o agente.

## Trilha de atividades
Toda chamada (exceto \`/health\`) fica registrada para o dono do workspace em Configurações → Integrações → Atividades: integração, origem (\`X-B2C-Source\`), ação, entidade, resultado e requestId — nunca token nem segredo. Consultas ficam 30 dias; ações, 400.

## Contrato
Sucesso: \`{ success: true, data, meta: { requestId, generatedAt } }\`. Erro: \`{ success: false, error: { code, message }, meta: { requestId } }\`. Dinheiro em reais (número, 2 casas); datas de calendário \`AAAA-MM-DD\`; instantes ISO 8601 UTC. Parâmetro desconhecido = 400. 120 req/min por IP.`;

export function buildOpenApiSpec(serverUrl = "https://b2-c-finance.vercel.app/api/v1") {
  return {
    openapi: "3.1.0",
    info: {
      title: "B2C Finance API",
      version: API_VERSION,
      summary: "API V1 do B2C Finance: leitura e escritas controladas (contas de serviço com scopes).",
      description: DESCRICAO,
    },
    servers: [{ url: serverUrl, description: "API v1" }],
    tags: [
      { name: "Sistema", description: "Saúde da API e identidade da credencial." },
      { name: "Busca", description: "Desambiguação de clientes pelo nome — o primeiro passo do agente." },
      { name: "Clientes", description: "Carteira com status temporal (vigência) e histórico de status." },
      { name: "Recebimentos", description: "Cobranças e pagamentos, com status derivado sem escrita." },
      { name: "Despesas", description: "Contas a pagar da agência." },
      { name: "Caixa", description: "Disponível, compromissos e projeção." },
      { name: "Upsell", description: "Oportunidades de venda adicional." },
      { name: "Painéis", description: "Indicadores oficiais e rotina do dia." },
      { name: "Relatórios", description: "Resumo do dia e da competência; seções seguem os scopes." },
      { name: "Integração", description: "Quem está falando: número de WhatsApp → usuário e delegação por identidade." },
      { name: "Agente", description: "Escritas do agente com prévia e confirmação do usuário (PendingAction)." },
    ],
    security: [{ bearerAuth: [] }],
    paths: PATHS,
    components: {
      securitySchemes: {
        bearerAuth: {
          type: "http",
          scheme: "bearer",
          bearerFormat: "b2c_live_<prefixo>_<segredo>",
          description:
            "Token de conta de serviço (Configurações → Integrações). Mostrado uma única vez. Os scopes da conta limitam cada rota.",
        },
      },
      parameters: PARAMETERS,
      schemas: SCHEMAS,
      responses: RESPONSES,
    },
    "x-scopes": API_SCOPE_GROUPS.map((g) => ({
      group: g.label,
      scopes: g.scopes.map((s) => ({ scope: s.id, description: s.label, write: !!s.write })),
    })),
    "x-forbidden-scopes": [...FORBIDDEN_SCOPES],
  };
}
