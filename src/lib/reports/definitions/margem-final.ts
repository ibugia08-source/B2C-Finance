import { competenceOf, type Competence } from "@/lib/competence";
import { margemTotalmenteAlocada } from "@/lib/services/full-margin";
import { type ReportQuery } from "../query";
import { type ReportDef, type ReportRow } from "../shared";

/**
 * MARGEM TOTALMENTE ALOCADA (F5.5 · ref. 01 §7.6).
 *
 * A pergunta que a margem de contribuição deixa aberta de propósito: com
 * folha, impostos e despesas gerais DENTRO, quem dá lucro? O overhead é
 * distribuído proporcional à receita — a base está escrita na descrição do
 * relatório porque um rateio de base escondida vira "número que a tela
 * inventou".
 */

function competenciasNoPeriodo(q: ReportQuery): Competence[] {
  const fim = new Date(q.period.end.getTime() - 1);
  const out: Competence[] = [];
  const cursor = new Date(q.period.start.getFullYear(), q.period.start.getMonth(), 1);
  while (cursor <= fim) {
    out.push(competenceOf(cursor) as Competence);
    cursor.setMonth(cursor.getMonth() + 1);
  }
  return out.length > 0 ? out : [competenceOf(q.period.start) as Competence];
}

async function linhas(q: ReportQuery): Promise<ReportRow[]> {
  const dados = await margemTotalmenteAlocada(competenciasNoPeriodo(q));
  return dados.linhas
    .filter((l) => !q.clientId || l.clientId === q.clientId)
    .map((l) => ({
      cliente: l.cliente,
      receita: l.receita,
      contribuicao: l.margemDeContribuicao,
      overhead: l.overheadAlocado,
      margemFinal: l.margemFinal,
      margem: l.margemFinalPercentual,
    }));
}

export const margemFinalReport: ReportDef = {
  key: "margem-totalmente-alocada",
  title: "Margem totalmente alocada",
  description:
    "Margem de contribuição menos o overhead do período (despesas gerais, folha e impostos), distribuído proporcional à receita reconhecida de cada cliente. Por competência.",
  columns: [
    { key: "cliente", label: "Cliente", kind: "text" },
    { key: "receita", label: "Receita", kind: "money", total: true },
    { key: "contribuicao", label: "Margem de contribuição", kind: "money", total: true },
    { key: "overhead", label: "Overhead alocado", kind: "money", total: true },
    { key: "margemFinal", label: "Margem final", kind: "money", total: true },
    { key: "margem", label: "% Margem final", kind: "percent" },
  ],
  filterFields: ["periodo", "cliente"],
  groupOptions: [],
  defaultSort: { key: "margemFinal", dir: "asc" },
  build: linhas,
};
