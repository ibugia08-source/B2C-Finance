import { resolvePeriod, type Period } from "@/lib/period";
import { parseBRL } from "@/lib/format";

/**
 * Filtros padrão da camada de relatórios/análise. Todos opcionais e lidos
 * de searchParams — a URL é a fonte de verdade (permite visões salvas).
 */

export type SearchParams = Record<string, string | undefined>;

export type ReportQuery = {
  period: Period;
  clientId?: string;
  serviceId?: string;
  contractId?: string;
  costCenterId?: string;
  categoryId?: string;
  responsavel?: string; // texto livre (salesOwner/collector/responsável)
  status?: string; // status do domínio do relatório
  tipo?: string; // RevenueType | ExpenseType | ContractType conforme o relatório
  valorMin?: number;
  valorMax?: number;
  vencDe?: Date;
  vencAte?: Date;
  competencia?: { month: number; year: number };
  pago?: boolean; // true=pago | false=não pago | undefined=todos
  situacao?: "inadimplente" | "a_vencer" | "vencido";
};

export type ReportPresentation = {
  colunas?: string[]; // subset de colunas (ordem preservada da definição)
  agrupar?: string; // key de coluna
  ordenar?: string; // key de coluna
  dir: "asc" | "desc";
  totais: boolean;
  grafico: boolean;
};

function parseISODate(v?: string): Date | undefined {
  if (!v || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return undefined;
  const [y, m, d] = v.split("-").map(Number);
  return new Date(y, m - 1, d);
}

function parseMoney(v?: string): number | undefined {
  if (!v) return undefined;
  const n = parseBRL(v);
  return Number.isFinite(n) && n !== 0 ? n : undefined;
}

export function parseReportQuery(sp: SearchParams): ReportQuery {
  let competencia: ReportQuery["competencia"];
  if (sp.competencia && /^\d{4}-\d{2}$/.test(sp.competencia)) {
    const [y, m] = sp.competencia.split("-").map(Number);
    competencia = { month: m, year: y };
  }
  return {
    period: resolvePeriod(sp),
    clientId: sp.cliente || undefined,
    serviceId: sp.servico || undefined,
    contractId: sp.contrato || undefined,
    costCenterId: sp.cc || undefined,
    categoryId: sp.categoria || undefined,
    responsavel: sp.responsavel || undefined,
    status: sp.status || undefined,
    tipo: sp.tipo || undefined,
    valorMin: parseMoney(sp.valorMin),
    valorMax: parseMoney(sp.valorMax),
    vencDe: parseISODate(sp.vencDe),
    vencAte: parseISODate(sp.vencAte),
    competencia,
    pago: sp.pago === "sim" ? true : sp.pago === "nao" ? false : undefined,
    situacao:
      sp.situacao === "inadimplente" || sp.situacao === "a_vencer" || sp.situacao === "vencido"
        ? sp.situacao
        : undefined,
  };
}

export function parsePresentation(sp: SearchParams): ReportPresentation {
  return {
    colunas: sp.colunas ? sp.colunas.split(",").filter(Boolean) : undefined,
    agrupar: sp.agrupar || undefined,
    ordenar: sp.ordenar || undefined,
    dir: sp.dir === "asc" ? "asc" : "desc",
    totais: sp.totais !== "0",
    grafico: sp.grafico !== "0",
  };
}

/** Faixa de valor aplicada a um campo numérico do where Prisma. */
export function amountRange(q: ReportQuery): Record<string, number> | undefined {
  if (q.valorMin == null && q.valorMax == null) return undefined;
  const r: Record<string, number> = {};
  if (q.valorMin != null) r.gte = q.valorMin;
  if (q.valorMax != null) r.lte = q.valorMax;
  return r;
}

/** Faixa de vencimento (dueDate) — vencAte é inclusivo (fim do dia). */
export function dueDateRange(q: ReportQuery): Record<string, Date> | undefined {
  if (!q.vencDe && !q.vencAte) return undefined;
  const r: Record<string, Date> = {};
  if (q.vencDe) r.gte = q.vencDe;
  if (q.vencAte) {
    const end = new Date(q.vencAte);
    end.setDate(end.getDate() + 1);
    r.lt = end;
  }
  return r;
}
