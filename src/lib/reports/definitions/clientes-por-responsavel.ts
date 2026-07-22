import { prisma } from "@/lib/prisma";
import { toNumber as n } from "@/lib/format";
import { type ReportDef, type ReportRow } from "../shared";

/** Carteira agrupada por responsável (ativos, MRR base, perdas 3m). */
async function buildClientesPorResponsavel(): Promise<ReportRow[]> {
  const threeMonthsAgo = new Date();
  threeMonthsAgo.setMonth(threeMonthsAgo.getMonth() - 2);
  threeMonthsAgo.setDate(1);
  const [clients, losses] = await Promise.all([
    prisma.client.findMany({
      where: { status: { notIn: ["INACTIVE", "PROSPECT", "LEAD"] } },
      select: { salesOwner: true, status: true, modality: true, monthlyValue: true },
    }),
    prisma.clientLoss.findMany({
      where: { lostAt: { gte: threeMonthsAgo } },
      select: { salesOwner: true },
    }),
  ]);
  const agg = new Map<
    string,
    { ativos: number; pausados: number; perdidos: number; mrr: number; tcv: number; mrrBase: number; perdas3m: number }
  >();
  const get = (owner: string | null) => {
    const key = owner ?? "Sem responsável";
    if (!agg.has(key))
      agg.set(key, { ativos: 0, pausados: 0, perdidos: 0, mrr: 0, tcv: 0, mrrBase: 0, perdas3m: 0 });
    return agg.get(key)!;
  };
  for (const c of clients) {
    const a = get(c.salesOwner);
    if (c.status === "ACTIVE" || c.status === "RENEWAL" || c.status === "DELINQUENT") {
      a.ativos += 1;
      if (c.modality === "MRR") {
        a.mrr += 1;
        a.mrrBase += n(c.monthlyValue);
      }
      if (c.modality === "TCV") a.tcv += 1;
    }
    if (c.status === "PAUSED") a.pausados += 1;
    if (c.status === "CHURNED") a.perdidos += 1;
  }
  for (const l of losses) get(l.salesOwner).perdas3m += 1;
  return Array.from(agg.entries()).map(([responsavel, a]) => ({
    responsavel,
    clientesAtivos: a.ativos,
    clientesMrr: a.mrr,
    clientesTcv: a.tcv,
    mrrBase: a.mrrBase,
    pausados: a.pausados,
    perdidosTotal: a.perdidos,
    perdas3m: a.perdas3m,
  }));
}

export const clientesPorResponsavelReport: ReportDef = {
  key: "clientes-por-responsavel",
  title: "Clientes por responsável",
  description: "Carteira agrupada por responsável: ativos, MRR base e perdas.",
  columns: [
    { key: "responsavel", label: "Responsável", kind: "text" },
    { key: "clientesAtivos", label: "Ativos", kind: "int", total: true },
    { key: "clientesMrr", label: "MRR", kind: "int", total: true },
    { key: "clientesTcv", label: "TCV", kind: "int", total: true },
    { key: "mrrBase", label: "MRR base", kind: "money", total: true },
    { key: "pausados", label: "Pausados", kind: "int", total: true },
    { key: "perdidosTotal", label: "Perdidos (total)", kind: "int", total: true },
    { key: "perdas3m", label: "Perdas 3m", kind: "int", total: true },
  ],
  filterFields: [],
  groupOptions: [],
  defaultSort: { key: "mrrBase", dir: "desc" },
  build: buildClientesPorResponsavel,
};
