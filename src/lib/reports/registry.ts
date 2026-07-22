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
import { financeiroMensalReport } from "./definitions/financeiro-mensal";
import { clientesReport } from "./definitions/clientes";
import { inadimplenciaReport } from "./definitions/inadimplencia";
import { contratosReport } from "./definitions/contratos";
import { despesasReport } from "./definitions/despesas";
import { folhaReport } from "./definitions/folha";
import { caixaReport } from "./definitions/caixa";
import { rentabilidadeClienteReport } from "./definitions/rentabilidade-cliente";
import { recebimentosReport } from "./definitions/recebimentos";
import { receitaExtraReport } from "./definitions/receita-extra";
import { mrrReport } from "./definitions/mrr";
import { tcvReport } from "./definitions/tcv";
import { renovacoesReport } from "./definitions/renovacoes";
import { perdasReport } from "./definitions/perdas";
import { clientesPorResponsavelReport } from "./definitions/clientes-por-responsavel";
import { upsellReport } from "./definitions/upsell";
import { cartoesLimitesReport } from "./definitions/cartoes-limites";
import { executivoReport } from "./definitions/executivo";

export type {
  ColumnKind,
  ReportColumn,
  FilterField,
  ReportRow,
  ReportDef,
} from "./shared";

export const REPORTS: ReportDef[] = [
  financeiroMensalReport,
  clientesReport,
  inadimplenciaReport,
  contratosReport,
  despesasReport,
  folhaReport,
  caixaReport,
  rentabilidadeClienteReport,
  recebimentosReport,
  receitaExtraReport,
  mrrReport,
  tcvReport,
  renovacoesReport,
  perdasReport,
  clientesPorResponsavelReport,
  upsellReport,
  cartoesLimitesReport,
  executivoReport,
];

export function getReport(key: string): ReportDef | undefined {
  return REPORTS.find((r) => r.key === key);
}
