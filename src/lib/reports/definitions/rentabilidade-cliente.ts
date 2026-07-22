import { prisma } from "@/lib/prisma";
import { toNumber as n } from "@/lib/format";
import { type ReportQuery } from "../query";
import { type ReportDef, type ReportRow } from "../shared";

async function rentabilidade(
  q: ReportQuery,
  by: "client" | "service"
): Promise<ReportRow[]> {
  const { start, end } = q.period;
  const [payments, looseIncomes, expenses] = await Promise.all([
    prisma.payment.findMany({
      where: {
        status: "CONFIRMED",
        paidAt: { gte: start, lt: end },
        ...(q.clientId ? { billing: { clientId: q.clientId } } : {}),
        ...(q.serviceId ? { billing: { serviceId: q.serviceId } } : {}),
      },
      select: { amount: true, billing: { select: { clientId: true, serviceId: true } } },
    }),
    by === "client"
      ? prisma.income.findMany({
          where: {
            status: "RECEIVED",
            billingId: null,
            receivedAt: { gte: start, lt: end },
            clientId: q.clientId ?? { not: null },
          },
          select: { amount: true, clientId: true },
        })
      : Promise.resolve([] as { amount: unknown; clientId: string | null }[]),
    prisma.transaction.findMany({
      where: {
        type: "despesa",
        status: { not: "cancelado" },
        date: { gte: start, lt: end },
        ...(by === "client"
          ? { clientId: q.clientId ?? { not: null } }
          : { serviceId: q.serviceId ?? { not: null } }),
      },
      select: { amount: true, clientId: true, serviceId: true },
    }),
  ]);

  const receita = new Map<string, number>();
  const custo = new Map<string, number>();
  const add = (map: Map<string, number>, id: string | null | undefined, v: number) => {
    if (!id) return;
    map.set(id, (map.get(id) ?? 0) + v);
  };
  for (const p of payments)
    add(receita, by === "client" ? p.billing.clientId : p.billing.serviceId, n(p.amount));
  for (const i of looseIncomes) add(receita, i.clientId, n(i.amount));
  for (const e of expenses) add(custo, by === "client" ? e.clientId : e.serviceId, n(e.amount));

  const ids = Array.from(new Set([...receita.keys(), ...custo.keys()]));
  if (ids.length === 0) return [];
  const names =
    by === "client"
      ? await prisma.client.findMany({ where: { id: { in: ids } }, select: { id: true, name: true } })
      : await prisma.service.findMany({ where: { id: { in: ids } }, select: { id: true, name: true } });
  const nameMap = new Map(names.map((x) => [x.id, x.name]));

  return ids.map((id) => {
    const rec = receita.get(id) ?? 0;
    const cus = custo.get(id) ?? 0;
    const res = rec - cus;
    return {
      [by === "client" ? "cliente" : "servico"]: nameMap.get(id) ?? "—",
      receita: rec,
      despesasDiretas: cus,
      resultado: res,
      margem: rec > 0 ? Math.round((res / rec) * 100) : cus > 0 ? -100 : 0,
    };
  });
}

export const rentabilidadeClienteReport: ReportDef = {
  key: "rentabilidade-cliente",
  title: "Rentabilidade por cliente",
  description: "Receita recebida × despesas diretas alocadas por cliente.",
  columns: [
    { key: "cliente", label: "Cliente", kind: "text" },
    { key: "receita", label: "Receita", kind: "money", total: true },
    { key: "despesasDiretas", label: "Despesas diretas", kind: "money", total: true },
    { key: "resultado", label: "Resultado", kind: "money", total: true },
    { key: "margem", label: "Margem", kind: "percent" },
  ],
  filterFields: ["periodo", "cliente"],
  groupOptions: [],
  defaultSort: { key: "resultado", dir: "desc" },
  build: (q) => rentabilidade(q, "client"),
};
