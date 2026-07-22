import { prisma } from "@/lib/prisma";
import { limitesUsadosPorCartao } from "@/lib/services/calculations";
import { toNumber as n } from "@/lib/format";
import { type ReportDef, type ReportRow } from "../shared";

/** Cartões e limites (usado × disponível). */
async function buildCartoesLimites(): Promise<ReportRow[]> {
  const cards = await prisma.creditCard.findMany({
    orderBy: { name: "asc" },
    select: {
      id: true, name: true, bank: true, type: true,
      limitTotal: true, closingDay: true, dueDay: true, active: true,
    },
  });
  const used = await limitesUsadosPorCartao(cards.map((c) => c.id));
  return cards.map((c) => {
    const u = used.get(c.id) ?? 0;
    return {
      cartao: c.name,
      banco: c.bank,
      tipo: c.type,
      limiteTotal: n(c.limitTotal),
      limiteUsado: u,
      limiteDisponivel: Math.max(0, n(c.limitTotal) - u),
      fechaDia: c.closingDay,
      venceDia: c.dueDay,
      situacao: c.active ? "Ativo" : "Inativo",
    };
  });
}

export const cartoesLimitesReport: ReportDef = {
  key: "cartoes-limites",
  title: "Cartões e limites",
  description: "Limite total, usado e disponível por cartão/conta.",
  columns: [
    { key: "cartao", label: "Cartão/Conta", kind: "text" },
    { key: "banco", label: "Banco", kind: "text" },
    { key: "tipo", label: "Tipo", kind: "text" },
    { key: "limiteTotal", label: "Limite total", kind: "money", total: true },
    { key: "limiteUsado", label: "Usado", kind: "money", total: true },
    { key: "limiteDisponivel", label: "Disponível", kind: "money", total: true },
    { key: "fechaDia", label: "Fecha dia", kind: "int" },
    { key: "venceDia", label: "Vence dia", kind: "int" },
    { key: "situacao", label: "Situação", kind: "text" },
  ],
  filterFields: [],
  groupOptions: ["banco", "situacao"],
  defaultSort: { key: "limiteUsado", dir: "desc" },
  build: buildCartoesLimites,
};
