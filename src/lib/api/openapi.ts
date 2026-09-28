import { API_SCOPE_GROUPS, API_SCOPES } from "./scopes";
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
      expenses: obj({ dueToday: obj({ count: int(), amount: dinheiro(), paidAmount: dinheiro(), items: arr(ref("Expense")) }) }),
      clients: obj({
        statusChanges: arr(obj({ client: ref("Ref"), status: ref("ClientStatus"), reason: nulo(str()) })),
        newClients: arr(obj({ id: str(), name: str(), modality: nulo(str()) })),
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
      parameters: [refParam("RequestId"), ...(o.params ?? [])],
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
    description: "Seções sem o scope da área saem de `data` e entram em `meta.omittedSections`.",
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

## Escritas (futuras)
Esta versão é somente leitura. As operações de escrita que virão exigirão o header **\`Idempotency-Key\`** (UUID por operação): repetir a mesma chamada com a mesma chave devolve a mesma resposta sem duplicar o efeito (pagamento duas vezes, por exemplo).

## Contrato
Sucesso: \`{ success: true, data, meta: { requestId, generatedAt } }\`. Erro: \`{ success: false, error: { code, message }, meta: { requestId } }\`. Dinheiro em reais (número, 2 casas); datas de calendário \`AAAA-MM-DD\`; instantes ISO 8601 UTC. Parâmetro desconhecido = 400. 120 req/min por IP.`;

export function buildOpenApiSpec(serverUrl = "https://b2-c-finance.vercel.app/api/v1") {
  return {
    openapi: "3.1.0",
    info: {
      title: "B2C Finance API",
      version: API_VERSION,
      summary: "API V1 de leitura do B2C Finance (contas de serviço com scopes).",
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
    "x-forbidden-scopes": ["users.manage", "permissions.manage", "clients.delete", "receivables.delete", "competences.reopen"],
  };
}
