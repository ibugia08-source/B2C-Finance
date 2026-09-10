import { prisma } from "@/lib/prisma";
import { toNumber as n } from "@/lib/format";
import type { Competence } from "@/lib/competence";
import { escopoAtual, clientesNoEscopo } from "@/lib/services/data-scope";

/**
 * MARGEM DE CONTRIBUIÇÃO POR CLIENTE (F3.4 · ref. 01 §7.4).
 *
 * "Margem de contribuição do cliente = receita reconhecida − custos diretos/
 * alocados (NÃO chamar de lucro líquido enquanto overhead não estiver
 * rateado)."
 *
 * O aviso da spec é a parte mais importante do arquivo, e por isso ele viaja
 * junto com o número, no campo `overheadForaDaConta`: esta margem NÃO desconta
 * folha, aluguel, ferramentas nem imposto. Um cliente com margem de 70% aqui
 * pode estar dando prejuízo depois do overhead. Quem trata este número como
 * lucro do cliente demite o cliente errado.
 *
 * BASE TEMPORAL: COMPETÊNCIA dos dois lados. Receita reconhecida (não
 * recebida) contra custo do mês (não pago). Misturar receita de caixa com
 * custo de competência — que é o que um relatório "de rentabilidade" costuma
 * fazer sem dizer — produz margens que oscilam com a data do pagamento do
 * cliente, e não com a operação.
 *
 * VERSÃO 2 (10/09/2026): com o rateio de mídia removido, o custo do cliente
 * é só o DIRETO — a despesa com o cliente escrito nela (`Transaction.clientId`).
 * Some com isso a armadilha da contagem dupla (despesa rateada E com cliente),
 * e some também a parcela de tráfego distribuída: mídia sem dono agora é
 * overhead, e overhead só aparece na margem TOTALMENTE alocada (F5.5), que
 * declara que está distribuindo.
 *
 * Quem quiser o custo de mídia dentro da margem de um cliente escreve o
 * cliente na despesa — o vínculo manual, que continua existindo. É uma
 * decisão por lançamento em vez de uma tela de distribuição mensal.
 */

export type MargemDoCliente = {
  clientId: string;
  cliente: string;
  receita: number;
  custosDiretos: number;
  custoTotal: number;
  margem: number;
  /** Percentual sobre a receita; null quando não houve receita. */
  margemPercentual: number | null;
};

export type MargemDeContribuicao = {
  competence: Competence;
  linhas: MargemDoCliente[];
  receita: number;
  custoTotal: number;
  margem: number;
  /**
   * O que esta conta NÃO desconta, para a tela dizer em vez de deixar
   * subentendido (01 §7.4).
   */
  overheadForaDaConta: string;
};

export const AVISO_OVERHEAD =
  "Não desconta folha, estrutura, ferramentas nem impostos — é margem de contribuição, não lucro do cliente.";

/** Uma competência. É a chamada de tela. */
export async function margemDeContribuicao(
  competence: Competence
): Promise<MargemDeContribuicao> {
  return margemDeContribuicaoDe([competence]);
}

/**
 * Várias competências somadas — o relatório aceita "últimos 12 meses".
 *
 * Somar meses fechados é legítimo; o que não pode é somar meses com bases
 * diferentes, e não é o caso: dos dois lados é competência.
 */
export async function margemDeContribuicaoDe(
  competences: Competence[]
): Promise<MargemDeContribuicao> {
  if (competences.length === 0) throw new RangeError("Informe ao menos uma competência.");
  const ordenadas = [...competences].sort();
  const competence = ordenadas[ordenadas.length - 1];
  const [y0, m0] = ordenadas[0].split("-").map(Number);
  const [y1, m1] = competence.split("-").map(Number);
  const start = new Date(y0, m0 - 1, 1);
  const end = new Date(y1, m1, 1);

  const scope = await escopoAtual();
  const idsDoEscopo = await clientesNoEscopo(scope);
  const filtroCliente = idsDoEscopo === null ? {} : { clientId: { in: idsDoEscopo } };

  const [cobrancas, despesas] = await Promise.all([
    // Receita RECONHECIDA: só REVENUE. Parcela de reparcelamento é
    // SETTLEMENT_ONLY e fica fora — ela liquida dívida velha, não fatura
    // de novo (01 §3.13).
    prisma.billing.findMany({
      where: {
        competence: { in: ordenadas },
        status: { not: "CANCELED" },
        recognitionMode: "REVENUE",
        ...filtroCliente,
      },
      select: { clientId: true, amount: true },
    }),
    prisma.transaction.findMany({
      where: {
        type: "despesa",
        status: { not: "cancelado" },
        date: { gte: start, lt: end },
        clientId: idsDoEscopo === null ? { not: null } : { in: idsDoEscopo },
      },
      select: { id: true, clientId: true, amount: true },
    }),
  ]);

  const receita = new Map<string, number>();
  const diretos = new Map<string, number>();
  const soma = (mapa: Map<string, number>, id: string | null, v: number) => {
    if (!id) return;
    mapa.set(id, (mapa.get(id) ?? 0) + v);
  };

  for (const b of cobrancas) soma(receita, b.clientId, n(b.amount));
  for (const d of despesas) soma(diretos, d.clientId, n(d.amount));

  const ids = [...new Set([...receita.keys(), ...diretos.keys()])];
  const nomes = ids.length
    ? new Map(
        (
          await prisma.client.findMany({
            where: { id: { in: ids } },
            select: { id: true, name: true },
          })
        ).map((c) => [c.id, c.name])
      )
    : new Map<string, string>();

  const linhas: MargemDoCliente[] = ids
    .map((id) => {
      const r = Math.round((receita.get(id) ?? 0) * 100) / 100;
      const custoTotal = Math.round((diretos.get(id) ?? 0) * 100) / 100;
      const margem = Math.round((r - custoTotal) * 100) / 100;
      return {
        clientId: id,
        cliente: nomes.get(id) ?? "(cliente removido)",
        receita: r,
        custosDiretos: custoTotal,
        custoTotal,
        margem,
        margemPercentual: r > 0 ? Math.round((margem / r) * 1000) / 10 : null,
      };
    })
    .sort((a, b) => a.margem - b.margem); // pior primeiro: é onde se age

  const totalReceita = Math.round(linhas.reduce((s, l) => s + l.receita, 0) * 100) / 100;
  const totalCusto = Math.round(linhas.reduce((s, l) => s + l.custoTotal, 0) * 100) / 100;

  return {
    competence,
    linhas,
    receita: totalReceita,
    custoTotal: totalCusto,
    margem: Math.round((totalReceita - totalCusto) * 100) / 100,
    overheadForaDaConta: AVISO_OVERHEAD,
  };
}
