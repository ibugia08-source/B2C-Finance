/**
 * Registry de relatórios: cada relatório declara colunas, filtros aplicáveis,
 * opções de agrupamento e um builder que devolve linhas cruas (número/Date/
 * string). Formatação acontece na renderização e na exportação — os dados
 * originais nunca são alterados.
 *
 * As definições vivem em ./definitions/* (um arquivo por relatório) e os
 * tipos/helpers compartilhados em ./shared. Este arquivo apenas agrega tudo
 * e mantém a mesma API pública de sempre.
 */

import { type ReportDef } from "./shared";
import { hasPermission, type PermissionUser } from "@/lib/permissions";
import { financeiroMensalReport } from "./definitions/financeiro-mensal";
import { clientesReport } from "./definitions/clientes";
import { inadimplenciaReport } from "./definitions/inadimplencia";
import { contratosReport } from "./definitions/contratos";
import { despesasReport } from "./definitions/despesas";
import { folhaReport } from "./definitions/folha";
import { caixaReport } from "./definitions/caixa";
import { margemFinalReport } from "./definitions/margem-final";
import { rentabilidadeClienteReport } from "./definitions/rentabilidade-cliente";
import { recebimentosReport } from "./definitions/recebimentos";
import { receitaExtraReport } from "./definitions/receita-extra";
import { mrrReport } from "./definitions/mrr";
import { tcvReport } from "./definitions/tcv";
import { renovacoesReport } from "./definitions/renovacoes";
import { perdasReport } from "./definitions/perdas";
import { clientesPorResponsavelReport } from "./definitions/clientes-por-responsavel";
import { upsellReport } from "./definitions/upsell";
import { executivoReport } from "./definitions/executivo";

export type {
  ColumnKind,
  ReportColumn,
  FilterField,
  ReportRow,
  ReportDef,
} from "./shared";

const DEFINICOES: ReportDef[] = [
  financeiroMensalReport,
  clientesReport,
  inadimplenciaReport,
  contratosReport,
  despesasReport,
  folhaReport,
  caixaReport,
  rentabilidadeClienteReport,
  // F5.5 — a segunda metade da rentabilidade: overhead dentro.
  margemFinalReport,
  recebimentosReport,
  receitaExtraReport,
  mrrReport,
  tcvReport,
  renovacoesReport,
  perdasReport,
  clientesPorResponsavelReport,
  upsellReport,
  executivoReport,
];

/**
 * PERMISSÃO POR RELATÓRIO (25/09/2026). relatorios.visualizar só abre o
 * módulo; cada relatório exige também a permissão da TELA dona dos dados —
 * antes, qualquer um com relatorios.visualizar lia salários em /relatorios/folha.
 * Lista = todas exigidas (o Financeiro mensal tem a coluna Folha).
 * Relatório novo SEM entrada aqui fica restrito ao ADMIN (falha fechada).
 */
export const REPORT_PERMISSIONS: Record<string, string | string[]> = {
  "financeiro-mensal": ["dashboard.ver_financeiro", "folha.visualizar"],
  clientes: "clientes.visualizar",
  inadimplencia: "recebimentos.ver_inadimplencia",
  contratos: "contratos.visualizar",
  despesas: "despesas.visualizar",
  folha: "folha.visualizar",
  caixa: "caixa.visualizar",
  "rentabilidade-cliente": "dashboard.ver_financeiro",
  // O overhead alocado embute folha, mas somado a estrutura e impostos.
  "margem-totalmente-alocada": "dashboard.ver_financeiro",
  recebimentos: "recebimentos.visualizar",
  "receita-extra": "receitas.visualizar",
  mrr: "clientes.visualizar",
  tcv: "recebimentos.visualizar",
  renovacoes: "clientes.visualizar",
  perdas: "clientes.visualizar",
  "clientes-por-responsavel": "clientes.visualizar",
  upsell: "upsell.visualizar",
  executivo: "dashboard.ver_financeiro",
};

/** Permissão que nenhum papel recebe: relatório sem mapeamento = só ADMIN. */
const SO_ADMIN = "__relatorio_sem_permissao_mapeada__";

export const REPORTS: ReportDef[] = DEFINICOES.map((d) => ({
  ...d,
  permission: REPORT_PERMISSIONS[d.key] ?? SO_ADMIN,
}));

export function getReport(key: string): ReportDef | undefined {
  return REPORTS.find((r) => r.key === key);
}

/** O usuário pode abrir ESTE relatório (tela, PDF e exportação)? */
/**
 * Relatórios que o CONTADOR (contabil.visualizar) não abre mesmo tendo
 * relatorios.visualizar: salário POR COLABORADOR. O papel existe para "leitura
 * do contábil e dos relatórios, para exportação" — ele precisa dos números
 * da agência (inclusive o total de folha do Financeiro mensal), não da folha
 * nominal de cada pessoa.
 */
const FORA_DO_CONTADOR = new Set(["folha"]);

export function canViewReport(
  user: PermissionUser | null | undefined,
  def: Pick<ReportDef, "permission"> & { key?: string }
): boolean {
  if (!hasPermission(user, "relatorios.visualizar")) return false;
  if (
    def.key &&
    !FORA_DO_CONTADOR.has(def.key) &&
    hasPermission(user, "contabil.visualizar")
  ) {
    return true;
  }
  const perms = def.permission == null ? [] : Array.isArray(def.permission) ? def.permission : [def.permission];
  return perms.every((p) => hasPermission(user, p));
}
