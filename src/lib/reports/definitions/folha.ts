import { prisma } from "@/lib/prisma";
import { toNumber as n } from "@/lib/format";
import { type ReportQuery } from "../query";
import { type ReportDef, type ReportRow } from "../shared";

const ITEM_KIND_LABEL: Record<string, string> = {
  SALARY: "Salário",
  BONUS: "Bônus",
  COMMISSION: "Comissão",
  BENEFIT: "Benefício",
  REIMBURSEMENT: "Reembolso",
  DEDUCTION: "Desconto",
};

async function buildFolha(q: ReportQuery): Promise<ReportRow[]> {
  const now = new Date();
  const comp = q.competencia ?? { month: now.getMonth() + 1, year: now.getFullYear() };
  const run = await prisma.payroll.findFirst({
    where: { month: comp.month, year: comp.year },
    include: {
      items: {
        orderBy: { createdAt: "asc" },
        include: { employee: { select: { name: true, role: true } } },
      },
    },
  });
  if (!run) return [];
  const RUN_LABEL: Record<string, string> = { DRAFT: "Rascunho", APPROVED: "Aprovada", PAID: "Paga" };
  let rows = run.items.map((i) => ({
    colaborador: i.employee.name,
    cargo: i.employee.role,
    item: ITEM_KIND_LABEL[i.kind] ?? i.kind,
    observacao: i.notes,
    valor: n(i.amount) * (i.kind === "DEDUCTION" ? -1 : 1),
    statusFolha: RUN_LABEL[run.status] ?? run.status,
    competencia: `${String(comp.month).padStart(2, "0")}/${comp.year}`,
  }));
  if (q.responsavel)
    rows = rows.filter((r) => r.colaborador.toLowerCase().includes(q.responsavel!.toLowerCase()));
  return rows;
}

export const folhaReport: ReportDef = {
  key: "folha",
  title: "Folha de pagamento",
  description: "Itens da folha por competência e colaborador.",
  columns: [
    { key: "colaborador", label: "Colaborador", kind: "text" },
    { key: "cargo", label: "Cargo", kind: "text" },
    { key: "item", label: "Item", kind: "text" },
    { key: "observacao", label: "Observação", kind: "text" },
    { key: "valor", label: "Valor", kind: "money", total: true },
    { key: "statusFolha", label: "Status da folha", kind: "text" },
    { key: "competencia", label: "Competência", kind: "text" },
  ],
  filterFields: ["competencia", "responsavel"],
  groupOptions: ["colaborador", "item"],
  defaultSort: { key: "colaborador", dir: "asc" },
  build: buildFolha,
};
