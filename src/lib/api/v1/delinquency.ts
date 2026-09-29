import { getDelinquentClients } from "@/lib/services/billing-metrics";
import { hojeCivil } from "@/lib/civil-date";
import { dia } from "./common";

/**
 * INADIMPLÊNCIA NA API (29/09/2026) — a POSIÇÃO ATUAL, com a mesma regra da
 * tela /inadimplencia (`filtroDeCobrancaVencida` + `getDelinquentClients`).
 * Leitura pura: nada de `markOverdueBillings`/`ensureMonthlyBillings`.
 *
 *  · sem `competence`: TODA cobrança vencida em aberto hoje, de qualquer mês;
 *  · com `competence`: só as cobranças DAQUELA competência que estão vencidas
 *    hoje (recorte; a regra é a mesma, só o conjunto de cobranças encolhe).
 *
 * Um registro por CLIENTE, sem telefone nem documento. Os totais cobrem o
 * filtro inteiro, não a página.
 */

const r2 = (n: number) => Math.round(n * 100) / 100;

export const REGRA_DA_INADIMPLENCIA =
  "Cobrança em aberto (pendente, parcial ou vencida) com vencimento antes de hoje ou já marcada vencida; fora: paga, removida do mês e renegociada. Mesma regra da tela Inadimplência.";

export async function posicaoDeInadimplenciaApi(f: { competence?: string; page: number; pageSize: number; agora?: Date }) {
  const agora = f.agora ?? new Date();
  const [ano, mes] = f.competence ? f.competence.split("-").map(Number) : [null, null];
  const clientes = await getDelinquentClients({
    agora,
    where: ano && mes ? { competenceYear: ano, competenceMonth: mes } : undefined,
    comContato: false,
  });
  const totais = clientes.reduce(
    (t, c) => ({ valor: t.valor + c.totalOverdue, cobrancas: t.cobrancas + c.billingCount }),
    { valor: 0, cobrancas: 0 }
  );
  const itens = clientes.slice((f.page - 1) * f.pageSize, f.page * f.pageSize).map((c) => ({
    client: { id: c.clientId, name: c.clientName },
    overdueAmount: r2(c.totalOverdue),
    billingCount: c.billingCount,
    oldestDueDate: dia(c.oldestDueDate),
    daysOverdue: c.daysOverdue,
    agingBucket: c.bucket,
  }));
  return {
    itens,
    total: clientes.length,
    meta: {
      asOf: dia(hojeCivil(agora)),
      scope: f.competence
        ? { kind: "competence", competence: f.competence, description: `Cobranças da competência ${f.competence} vencidas hoje` }
        : { kind: "all_open", competence: null, description: "Toda a inadimplência em aberto hoje, de qualquer competência" },
      rule: REGRA_DA_INADIMPLENCIA,
      totals: { clients: clientes.length, overdueAmount: r2(totais.valor), billings: totais.cobrancas },
      sort: "overdueAmount desc, client.name asc, client.id asc",
    },
  };
}
