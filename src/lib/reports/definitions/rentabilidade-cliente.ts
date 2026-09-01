import { competenceOf } from "@/lib/competence";
import { margemDeContribuicaoDe } from "@/lib/services/contribution-margin";
import { type ReportQuery } from "../query";
import { type ReportDef, type ReportRow } from "../shared";

/**
 * MARGEM DE CONTRIBUIÇÃO POR CLIENTE (F3.4 · ref. 01 §7.4).
 *
 * Este relatório MUDOU DE BASE na F3.4, e a mudança é o ponto: ele somava
 * receita RECEBIDA (caixa) contra despesa da competência. A margem de um
 * cliente subia e descia conforme a data em que ele pagava, não conforme a
 * operação — e num mês de atraso o melhor cliente da carteira aparecia como
 * o pior. Agora os dois lados são competência, como 01 §7.4 define.
 *
 * A segunda mudança é a coluna "Custos rateados": até aqui só entrava
 * despesa com o cliente escrito nela. A mídia da fatura do cartão, que é o
 * maior custo direto de uma agência de tráfego, ficava inteira de fora.
 */

function competenciasNoPeriodo(q: ReportQuery): string[] {
  const fim = new Date(q.period.end.getTime() - 1);
  const out: string[] = [];
  const cursor = new Date(q.period.start.getFullYear(), q.period.start.getMonth(), 1);
  while (cursor <= fim) {
    out.push(competenceOf(cursor));
    cursor.setMonth(cursor.getMonth() + 1);
  }
  return out.length > 0 ? out : [competenceOf(q.period.start)];
}

async function margem(q: ReportQuery): Promise<ReportRow[]> {
  const dados = await margemDeContribuicaoDe(competenciasNoPeriodo(q));
  return dados.linhas
    .filter((l) => !q.clientId || l.clientId === q.clientId)
    .map((l) => ({
      cliente: l.cliente,
      receita: l.receita,
      despesasDiretas: l.custosDiretos,
      custosRateados: l.custosRateados,
      resultado: l.margem,
      margem: l.margemPercentual,
    }));
}

export const rentabilidadeClienteReport: ReportDef = {
  // A chave NÃO muda: visões salvas apontam para ela.
  key: "rentabilidade-cliente",
  title: "Margem de contribuição por cliente",
  description:
    "Receita reconhecida menos custos diretos e rateados, por competência. Não desconta folha, estrutura nem impostos — não é lucro do cliente.",
  columns: [
    { key: "cliente", label: "Cliente", kind: "text" },
    { key: "receita", label: "Receita", kind: "money", total: true },
    { key: "despesasDiretas", label: "Custos diretos", kind: "money", total: true },
    { key: "custosRateados", label: "Custos rateados", kind: "money", total: true },
    { key: "resultado", label: "Margem", kind: "money", total: true },
    { key: "margem", label: "% Margem", kind: "percent" },
  ],
  filterFields: ["periodo", "cliente"],
  groupOptions: [],
  defaultSort: { key: "resultado", dir: "asc" },
  build: margem,
};
