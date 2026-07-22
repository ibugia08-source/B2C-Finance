import { prisma } from "@/lib/prisma";
import { parseCompetence, type ImportColumn, type ValidatedRow } from "./engine";
import { toNumber as n } from "@/lib/format";

/**
 * Definições de importação em massa — uma por módulo.
 * Cada definição declara colunas (com exemplos p/ o template), resolve
 * relacionamentos por NOME (cliente/serviço/contrato/colaborador),
 * detecta duplicidade (na planilha e contra o banco) e cria em massa.
 * ownerId é injetado pela extensão do Prisma (escopo da sessão).
 */

const norm = (s: unknown) => String(s ?? "").trim().toLowerCase();

export type ImportRefs = {
  clients: Map<string, string>; // nome normalizado → id
  services: Map<string, string>;
  contracts: Map<string, string>; // `${clientId}|${titulo}` → id
  employees: Map<string, string>;
  categories: Map<string, string>;
};

export async function loadRefs(): Promise<ImportRefs> {
  const [clients, services, contracts, employees, categories] = await Promise.all([
    prisma.client.findMany({ select: { id: true, name: true } }),
    prisma.service.findMany({ select: { id: true, name: true } }),
    prisma.contract.findMany({ select: { id: true, title: true, clientId: true } }),
    prisma.employee.findMany({ select: { id: true, name: true } }),
    prisma.category.findMany({ select: { id: true, name: true } }),
  ]);
  return {
    clients: new Map(clients.map((c) => [norm(c.name), c.id])),
    services: new Map(services.map((s) => [norm(s.name), s.id])),
    contracts: new Map(contracts.map((c) => [`${c.clientId}|${norm(c.title)}`, c.id])),
    employees: new Map(employees.map((e) => [norm(e.name), e.id])),
    categories: new Map(categories.map((c) => [norm(c.name), c.id])),
  };
}

export type ImportDef = {
  key: string;
  title: string;
  description: string;
  columns: ImportColumn[];
  instructions?: string[];
  /** transforma linha validada em dados prontos; erros de relacionamento entram aqui */
  toData: (
    row: ValidatedRow,
    refs: ImportRefs,
    err: (campo: string, erro: string) => void
  ) => Record<string, unknown> | null;
  /** chave de duplicidade (planilha + banco) */
  dupKey: (data: Record<string, unknown>) => string;
  /** chaves já existentes no banco */
  existingKeys: () => Promise<Set<string>>;
  /** cria os registros (apenas na confirmação) */
  create: (rows: Record<string, unknown>[], batchId: string) => Promise<number>;
};

// ---- opções compartilhadas ----------------------------------------

const CLIENT_STATUS = [
  { value: "ACTIVE", label: "Ativo" },
  { value: "PROSPECT", label: "Prospect" },
  { value: "INACTIVE", label: "Inativo" },
  { value: "PAUSED", label: "Pausado" },
  { value: "RENEWAL", label: "Renovação" },
  { value: "DELINQUENT", label: "Inadimplente" },
  { value: "CHURNED", label: "Perdido" },
];
const CONTRACT_TYPE = [
  { value: "MRR", label: "Recorrente" },
  { value: "TCV", label: "Fechado" },
  { value: "ONE_TIME", label: "Avulso" },
  { value: "SETUP", label: "Setup" },
];
const RECURRENCE = [
  { value: "MONTHLY", label: "Mensal" },
  { value: "QUARTERLY", label: "Trimestral" },
  { value: "SEMIANNUAL", label: "Semestral" },
  { value: "ANNUAL", label: "Anual" },
  { value: "NONE", label: "Sem recorrência" },
];
const CONTRACT_STATUS = [
  { value: "ACTIVE", label: "Ativo" },
  { value: "PENDING", label: "Pendente" },
  { value: "RENEWAL", label: "Em renovação" },
  { value: "ENDED", label: "Encerrado" },
];
const REVENUE_TYPE = [
  { value: "MRR", label: "Recorrente" },
  { value: "TCV", label: "Contrato fechado" },
  { value: "ONE_TIME", label: "Avulsa" },
  { value: "SETUP", label: "Setup" },
  { value: "RECOVERY", label: "Recuperação" },
  { value: "OTHER", label: "Outra" },
];
const INCOME_STATUS = [
  { value: "RECEIVED", label: "Recebida" },
  { value: "EXPECTED", label: "Prevista" },
  { value: "LATE", label: "Atrasada" },
];
const EXPENSE_STATUS = [
  { value: "pago", label: "Paga" },
  { value: "pendente", label: "Pendente" },
];
const EXPENSE_TYPE = [
  { value: "FIXED", label: "Fixa" },
  { value: "VARIABLE", label: "Variável" },
  { value: "TAX", label: "Imposto" },
  { value: "TOOL", label: "Ferramenta" },
  { value: "ADS", label: "Mídia/Ads" },
  { value: "OTHER", label: "Outra" },
];
const EMPLOYEE_TYPE = [
  { value: "PJ", label: "PJ" },
  { value: "CLT", label: "CLT" },
  { value: "FREELANCER", label: "Freelancer" },
];
const ITEM_KIND = [
  { value: "SALARY", label: "Salário" },
  { value: "BONUS", label: "Bônus" },
  { value: "COMMISSION", label: "Comissão" },
  { value: "BENEFIT", label: "Benefício" },
  { value: "REIMBURSEMENT", label: "Reembolso" },
  { value: "DEDUCTION", label: "Desconto" },
];
const refCliente = (
  campo: string,
  nome: unknown,
  refs: ImportRefs,
  err: (campo: string, erro: string) => void,
  required = true
): string | null => {
  if (nome == null || nome === "") {
    if (required) err(campo, "obrigatório");
    return null;
  }
  const id = refs.clients.get(norm(nome));
  if (!id) {
    err(campo, `cliente "${nome}" não encontrado — importe/cadastre o cliente antes`);
    return null;
  }
  return id;
};

// ===================================================================

export const IMPORT_DEFS: ImportDef[] = [
  // ---------------- Clientes ----------------
  {
    key: "clientes",
    title: "Clientes",
    description: "Carteira de clientes (nome, contato, cidade, status…)",
    columns: [
      { key: "name", header: "Nome", required: true, kind: "text", example: "Empresa Alfa" },
      { key: "legalName", header: "Razão social", kind: "text", example: "Alfa Comércio LTDA" },
      { key: "document", header: "CNPJ/CPF", kind: "text", example: "12.345.678/0001-00" },
      { key: "email", header: "E-mail", kind: "text", example: "contato@alfa.com" },
      { key: "phone", header: "Telefone", kind: "text", example: "(71) 99999-0000" },
      { key: "segment", header: "Segmento", kind: "text", example: "E-commerce" },
      { key: "city", header: "Cidade", kind: "text", example: "Salvador" },
      { key: "state", header: "UF", kind: "text", example: "BA" },
      { key: "origin", header: "Origem", kind: "text", example: "Indicação" },
      { key: "salesOwner", header: "Responsável comercial", kind: "text", example: "Israel" },
      { key: "paymentDay", header: "Dia de pagamento", kind: "int", example: 5, description: "1 a 31" },
      { key: "status", header: "Status", kind: "enum", options: CLIENT_STATUS, example: "Ativo" },
      { key: "monthlyValue", header: "Valor mensal (R$)", kind: "money", example: "2500,00" },
      { key: "notes", header: "Observações", kind: "text", example: "" },
    ],
    toData: (row, _refs, err) => {
      const d = row.data;
      if (d.paymentDay != null && (Number(d.paymentDay) < 1 || Number(d.paymentDay) > 31))
        err("Dia de pagamento", "use um dia entre 1 e 31");
      return { ...d, status: d.status ?? "ACTIVE" };
    },
    dupKey: (d) => norm(d.name),
    existingKeys: async () => {
      const rows = await prisma.client.findMany({ select: { name: true } });
      return new Set(rows.map((r) => norm(r.name)));
    },
    create: async (rows) => {
      const r = await prisma.client.createMany({ data: rows as any[] });
      return r.count;
    },
  },

  // ---------------- Serviços ----------------
  {
    key: "servicos",
    title: "Serviços",
    description: "Catálogo de serviços da agência",
    columns: [
      { key: "name", header: "Nome", required: true, kind: "text", example: "Gestão de tráfego" },
      { key: "category", header: "Categoria", kind: "text", example: "Tráfego" },
      { key: "defaultPrice", header: "Preço base (R$)", kind: "money", example: "1500,00" },
      { key: "estimatedCost", header: "Custo estimado (R$)", kind: "money", example: "400,00" },
      { key: "defaultOwner", header: "Responsável padrão", kind: "text", example: "Equipe tráfego" },
      { key: "description", header: "Descrição", kind: "text", example: "Meta Ads + Google Ads" },
    ],
    toData: (row) => row.data,
    dupKey: (d) => norm(d.name),
    existingKeys: async () => {
      const rows = await prisma.service.findMany({ select: { name: true } });
      return new Set(rows.map((r) => norm(r.name)));
    },
    create: async (rows) => (await prisma.service.createMany({ data: rows as any[] })).count,
  },

  // ---------------- Colaboradores ----------------
  {
    key: "colaboradores",
    title: "Colaboradores",
    description: "Equipe (para folha de pagamento)",
    columns: [
      { key: "name", header: "Nome", required: true, kind: "text", example: "Maria Souza" },
      { key: "role", header: "Cargo", kind: "text", example: "Designer" },
      { key: "type", header: "Vínculo", kind: "enum", options: EMPLOYEE_TYPE, example: "PJ" },
      { key: "baseSalary", header: "Salário fixo (R$)", kind: "money", example: "3000,00" },
      { key: "startedAt", header: "Início", kind: "date", example: "01/02/2026" },
      { key: "notes", header: "Observações", kind: "text", example: "" },
    ],
    toData: (row) => ({ ...row.data, type: row.data.type ?? "PJ", baseSalary: row.data.baseSalary ?? 0 }),
    dupKey: (d) => norm(d.name),
    existingKeys: async () => {
      const rows = await prisma.employee.findMany({ select: { name: true } });
      return new Set(rows.map((r) => norm(r.name)));
    },
    create: async (rows) => (await prisma.employee.createMany({ data: rows as any[] })).count,
  },

  // ---------------- Contratos ----------------
  {
    key: "contratos",
    title: "Acordos comerciais",
    description: "Acordos comerciais por cliente (MRR/TCV) — o cliente precisa existir",
    instructions: [
      "O cliente é localizado pelo NOME exato (sem diferenciar maiúsculas).",
      "Se informar só o valor total + data fim, o valor mensal é derivado (e vice-versa).",
      "As cobranças NÃO são geradas na importação — use \"Gerar cobranças\" em /acordos depois.",
    ],
    columns: [
      { key: "cliente", header: "Cliente", required: true, kind: "text", example: "Empresa Alfa" },
      { key: "title", header: "Título do contrato", required: true, kind: "text", example: "Gestão de tráfego mensal" },
      { key: "type", header: "Tipo", kind: "enum", options: CONTRACT_TYPE, example: "Recorrente" },
      { key: "recurrence", header: "Recorrência", kind: "enum", options: RECURRENCE, example: "Mensal" },
      { key: "monthlyValue", header: "Valor mensal (R$)", kind: "money", example: "1700,00" },
      { key: "totalValue", header: "Valor total (R$)", kind: "money", example: "5100,00" },
      { key: "startDate", header: "Início", required: true, kind: "date", example: "01/06/2026" },
      { key: "endDate", header: "Fim", kind: "date", example: "31/08/2026" },
      { key: "billingDay", header: "Dia de cobrança", kind: "int", example: 5, description: "1 a 31" },
      { key: "status", header: "Status", kind: "enum", options: CONTRACT_STATUS, example: "Ativo" },
      { key: "renewalDate", header: "Renovação", kind: "date", example: "" },
      { key: "notes", header: "Observações", kind: "text", example: "" },
    ],
    toData: (row, refs, err) => {
      const d = row.data;
      const clientId = refCliente("Cliente", d.cliente, refs, err);
      let monthly = d.monthlyValue as number | null;
      let total = d.totalValue as number | null;
      if (monthly == null && total == null) {
        err("Valor mensal (R$)", "informe valor mensal e/ou valor total");
        return null;
      }
      // derivação (mesma regra do formulário de contratos)
      const isTcv = (d.type ?? "MRR") === "TCV";
      const start = d.startDate as Date;
      const end = d.endDate as Date | null;
      const months = end && start
        ? Math.max(1, (end.getFullYear() - start.getFullYear()) * 12 + end.getMonth() - start.getMonth() + 1)
        : 12;
      // TCV nunca vira mensal recorrente — só MRR/avulso derivam total⇄mensal.
      if (isTcv) {
        monthly = 0;
      } else {
        if (monthly == null && total != null) monthly = Math.round((total / months) * 100) / 100;
        if (total == null && monthly != null) total = Math.round(monthly * months * 100) / 100;
      }
      if (end && start && end < start) err("Fim", "data fim anterior ao início");
      const day = d.billingDay == null ? 5 : Number(d.billingDay);
      if (day < 1 || day > 31) err("Dia de cobrança", "use um dia entre 1 e 31");
      if (!clientId) return null;
      return {
        clientId,
        title: d.title,
        type: d.type ?? "MRR",
        recurrence: isTcv ? "NONE" : (d.recurrence ?? "MONTHLY"),
        monthlyValue: monthly,
        totalValue: total,
        startDate: d.startDate,
        endDate: d.endDate,
        billingDay: day,
        status: d.status ?? "ACTIVE",
        renewalDate: d.renewalDate,
        notes: d.notes,
      };
    },
    dupKey: (d) => `${d.clientId}|${norm(d.title)}`,
    existingKeys: async () => {
      const rows = await prisma.contract.findMany({ select: { clientId: true, title: true } });
      return new Set(rows.map((r) => `${r.clientId}|${norm(r.title)}`));
    },
    create: async (rows) => (await prisma.contract.createMany({ data: rows as any[] })).count,
  },

  // ---------------- Cobranças ----------------
  {
    key: "cobrancas",
    title: "Cobranças",
    description: "Cobranças avulsas ou históricas por cliente",
    instructions: [
      "Competência no formato mm/aaaa (ex.: 06/2026).",
      "Cobrança com vencimento no passado entra automaticamente como VENCIDA.",
      "Contrato (opcional) é localizado pelo título dentro do mesmo cliente.",
    ],
    columns: [
      { key: "cliente", header: "Cliente", required: true, kind: "text", example: "Empresa Alfa" },
      { key: "description", header: "Descrição", required: true, kind: "text", example: "Gestão de tráfego — 06/2026" },
      { key: "competencia", header: "Competência", required: true, kind: "text", example: "06/2026", description: "mm/aaaa" },
      { key: "amount", header: "Valor (R$)", required: true, kind: "money", example: "1700,00" },
      { key: "dueDate", header: "Vencimento", required: true, kind: "date", example: "05/06/2026" },
      { key: "revenueType", header: "Tipo de receita", kind: "enum", options: REVENUE_TYPE, example: "Recorrente" },
      { key: "contrato", header: "Contrato", kind: "text", example: "", description: "título exato (opcional)" },
      { key: "notes", header: "Observações", kind: "text", example: "" },
    ],
    toData: (row, refs, err) => {
      const d = row.data;
      const clientId = refCliente("Cliente", d.cliente, refs, err);
      const comp = parseCompetence(d.competencia);
      if (!comp) err("Competência", `formato inválido: "${d.competencia}" (use mm/aaaa)`);
      if (n(d.amount) <= 0) err("Valor (R$)", "deve ser maior que zero");
      let contractId: string | null = null;
      if (d.contrato && clientId) {
        contractId = refs.contracts.get(`${clientId}|${norm(d.contrato)}`) ?? null;
        if (!contractId) err("Contrato", `contrato "${d.contrato}" não encontrado para este cliente`);
      }
      if (!clientId || !comp) return null;
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      return {
        clientId,
        contractId,
        description: d.description,
        competenceMonth: comp.month,
        competenceYear: comp.year,
        amount: d.amount,
        dueDate: d.dueDate,
        revenueType: d.revenueType ?? "MRR",
        status: (d.dueDate as Date) < today ? "OVERDUE" : "PENDING",
        notes: d.notes,
      };
    },
    dupKey: (d) => `${d.clientId}|${d.competenceYear}-${d.competenceMonth}|${norm(d.description)}|${d.amount}`,
    existingKeys: async () => {
      const rows = await prisma.billing.findMany({
        select: { clientId: true, competenceYear: true, competenceMonth: true, description: true, amount: true },
      });
      return new Set(
        rows.map((r) => `${r.clientId}|${r.competenceYear}-${r.competenceMonth}|${norm(r.description)}|${Number(r.amount)}`)
      );
    },
    create: async (rows) => (await prisma.billing.createMany({ data: rows as any[] })).count,
  },

  // ---------------- Receitas ----------------
  {
    key: "receitas",
    title: "Receitas",
    description: "Entradas de dinheiro (recebidas ou previstas)",
    columns: [
      { key: "receivedAt", header: "Data", required: true, kind: "date", example: "10/06/2026" },
      { key: "description", header: "Descrição", required: true, kind: "text", example: "Pagamento gestão de tráfego" },
      { key: "amount", header: "Valor (R$)", required: true, kind: "money", example: "1700,00" },
      { key: "status", header: "Status", kind: "enum", options: INCOME_STATUS, example: "Recebida" },
      { key: "cliente", header: "Cliente", kind: "text", example: "Empresa Alfa", description: "opcional" },
      { key: "revenueType", header: "Tipo de receita", kind: "enum", options: REVENUE_TYPE, example: "Recorrente" },
      { key: "notes", header: "Observações", kind: "text", example: "" },
    ],
    toData: (row, refs, err) => {
      const d = row.data;
      if (n(d.amount) <= 0) err("Valor (R$)", "deve ser maior que zero");
      const clientId = d.cliente ? refCliente("Cliente", d.cliente, refs, err, false) : null;
      const received = d.receivedAt as Date;
      return {
        receivedAt: received,
        description: d.description,
        amount: d.amount,
        status: d.status ?? "RECEIVED",
        clientId,
        revenueType: d.revenueType,
        competenceMonth: received.getMonth() + 1,
        competenceYear: received.getFullYear(),
        notes: d.notes,
      };
    },
    dupKey: (d) => `${(d.receivedAt as Date).toISOString().slice(0, 10)}|${norm(d.description)}|${d.amount}`,
    existingKeys: async () => {
      const rows = await prisma.income.findMany({ select: { receivedAt: true, description: true, amount: true } });
      return new Set(
        rows.map((r) => `${r.receivedAt.toISOString().slice(0, 10)}|${norm(r.description)}|${Number(r.amount)}`)
      );
    },
    create: async (rows) => (await prisma.income.createMany({ data: rows as any[] })).count,
  },

  // ---------------- Despesas ----------------
  {
    key: "despesas",
    title: "Despesas",
    description: "Despesas da agência (pagas ou a pagar)",
    columns: [
      { key: "date", header: "Data", required: true, kind: "date", example: "08/06/2026" },
      { key: "description", header: "Descrição", required: true, kind: "text", example: "Assinatura ferramenta X" },
      { key: "amount", header: "Valor (R$)", required: true, kind: "money", example: "250,00" },
      { key: "status", header: "Status", kind: "enum", options: EXPENSE_STATUS, example: "Paga" },
      { key: "expenseType", header: "Tipo", kind: "enum", options: EXPENSE_TYPE, example: "Ferramenta" },
      { key: "categoria", header: "Categoria", kind: "text", example: "", description: "nome de categoria já cadastrada" },
      { key: "cliente", header: "Cliente", kind: "text", example: "", description: "aloca a despesa a um cliente (rentabilidade)" },
      { key: "dueDate", header: "Vencimento", kind: "date", example: "" },
      { key: "notes", header: "Observações", kind: "text", example: "" },
    ],
    toData: (row, refs, err) => {
      const d = row.data;
      if (n(d.amount) <= 0) err("Valor (R$)", "deve ser maior que zero");
      let categoryId: string | null = null;
      if (d.categoria) {
        categoryId = refs.categories.get(norm(d.categoria)) ?? null;
        if (!categoryId) err("Categoria", `categoria "${d.categoria}" não encontrada`);
      }
      const clientId = d.cliente ? refCliente("Cliente", d.cliente, refs, err, false) : null;
      return {
        date: d.date,
        description: d.description,
        amount: d.amount,
        type: "despesa",
        origin: "debito",
        belongsTo: "empresa",
        status: d.status ?? "pago",
        expenseType: d.expenseType,
        categoryId,
        clientId,
        dueDate: d.dueDate,
        notes: d.notes,
      };
    },
    dupKey: (d) => `${(d.date as Date).toISOString().slice(0, 10)}|${norm(d.description)}|${d.amount}`,
    existingKeys: async () => {
      const rows = await prisma.transaction.findMany({
        where: { type: "despesa" },
        select: { date: true, description: true, amount: true },
      });
      return new Set(
        rows.map((r) => `${r.date.toISOString().slice(0, 10)}|${norm(r.description)}|${Number(r.amount)}`)
      );
    },
    create: async (rows) => (await prisma.transaction.createMany({ data: rows as any[] })).count,
  },

  // ---------------- Folha ----------------
  {
    key: "folha",
    title: "Folha de pagamento",
    description: "Itens de folha por competência — o colaborador precisa existir",
    instructions: [
      "O colaborador é localizado pelo NOME exato.",
      "Se a folha da competência não existir, ela é criada como Rascunho.",
      "Descontos entram automaticamente como negativo no total.",
    ],
    columns: [
      { key: "competencia", header: "Competência", required: true, kind: "text", example: "06/2026", description: "mm/aaaa" },
      { key: "colaborador", header: "Colaborador", required: true, kind: "text", example: "Maria Souza" },
      { key: "kind", header: "Tipo", kind: "enum", options: ITEM_KIND, example: "Salário" },
      { key: "amount", header: "Valor (R$)", required: true, kind: "money", example: "3000,00" },
      { key: "notes", header: "Observação", kind: "text", example: "" },
    ],
    toData: (row, refs, err) => {
      const d = row.data;
      const comp = parseCompetence(d.competencia);
      if (!comp) err("Competência", `formato inválido: "${d.competencia}" (use mm/aaaa)`);
      const employeeId = refs.employees.get(norm(d.colaborador));
      if (!employeeId) err("Colaborador", `colaborador "${d.colaborador}" não encontrado — importe colaboradores antes`);
      if (n(d.amount) <= 0) err("Valor (R$)", "deve ser maior que zero");
      if (!comp || !employeeId) return null;
      return {
        month: comp.month,
        year: comp.year,
        employeeId,
        kind: d.kind ?? "SALARY",
        amount: d.amount,
        notes: d.notes,
      };
    },
    dupKey: (d) => `${d.year}-${d.month}|${d.employeeId}|${d.kind}|${d.amount}`,
    existingKeys: async () => {
      const rows = await prisma.payrollItem.findMany({
        select: { employeeId: true, kind: true, amount: true, payroll: { select: { month: true, year: true } } },
      });
      return new Set(
        rows.map((r) => `${r.payroll.year}-${r.payroll.month}|${r.employeeId}|${r.kind}|${Number(r.amount)}`)
      );
    },
    create: async (rows) => {
      // agrupa por competência; cria a folha (DRAFT) se não existir
      const byComp = new Map<string, Record<string, unknown>[]>();
      for (const r of rows) {
        const k = `${r.year}-${r.month}`;
        const arr = byComp.get(k) ?? [];
        arr.push(r);
        byComp.set(k, arr);
      }
      let created = 0;
      for (const [, items] of Array.from(byComp.entries())) {
        const { month, year } = items[0] as { month: number; year: number };
        let run = await prisma.payroll.findFirst({ where: { month, year } });
        if (!run) run = await prisma.payroll.create({ data: { month, year, status: "DRAFT" } });
        if (run.status === "PAID") continue; // não mexe em folha já paga
        const r = await prisma.payrollItem.createMany({
          data: items.map((i) => ({
            payrollId: run!.id,
            employeeId: i.employeeId as string,
            kind: i.kind as any,
            amount: i.amount as number,
            notes: (i.notes as string) ?? null,
          })),
        });
        created += r.count;
      }
      return created;
    },
  },

  // Patrimônio (ativos/passivos) foi removido do MVP — os models continuam
  // no banco, mas a importação em massa não é mais oferecida na interface.
];

export function getImportDef(key: string): ImportDef | undefined {
  return IMPORT_DEFS.find((d) => d.key === key);
}
