import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { cycleStatusOf, CYCLE_STATUS_LABEL, type CycleStatus } from "@/lib/services/receivables-cycle";
import { dinheiro, instante } from "../http";
import { dia } from "./common";

/**
 * RECEBIMENTOS (cobranças) NA API — leitura pura. O status é o mesmo da tela
 * de Recebimentos (`cycleStatusOf`), derivado na hora a partir do vencimento:
 * a API NÃO roda `markOverdueBillings` nem `ensureMonthlyBillings` (escrita
 * durante leitura), então "vencido" aparece correto mesmo antes do job gravar.
 * Renegociada (RENEGOTIATED) sai com status próprio: a tela não a mostra no
 * ciclo, e chamá-la de vencida seria cobrar uma dívida já acordada.
 */

export const RECEIVABLE_STATUSES = [
  "UPCOMING", "PAID", "PAID_LATE", "PAID_OTHER_MONTH", "OVERDUE", "DELINQUENT", "PARTIAL", "REMOVED", "RENEGOTIATED",
] as const;
export type ReceivableStatus = (typeof RECEIVABLE_STATUSES)[number];
/** Atalho: tudo que ainda tem valor a receber. */
export const OPEN_GROUP: ReceivableStatus[] = ["UPCOMING", "OVERDUE", "DELINQUENT", "PARTIAL"];

const SELECT = {
  id: true, clientId: true, description: true, competence: true, competenceMonth: true, competenceYear: true,
  amount: true, paidTotal: true, dueDate: true, paidAt: true, status: true, isLate: true,
  paidInDifferentMonth: true, collectionStatus: true, billingKind: true, revenueType: true,
  installmentNumber: true, canceledAt: true,
  client: { select: { id: true, name: true } },
} satisfies Prisma.BillingSelect;

type Linha = Prisma.BillingGetPayload<{ select: typeof SELECT }>;

function statusDe(b: Linha, hoje: Date): { status: ReceivableStatus; daysLate: number } {
  if (b.status === "RENEGOTIATED") return { status: "RENEGOTIATED", daysLate: 0 };
  return cycleStatusOf(b, hoje);
}

const LABEL: Record<ReceivableStatus, string> = { ...CYCLE_STATUS_LABEL, RENEGOTIATED: "Renegociada" } as Record<
  ReceivableStatus,
  string
>;

export function serializarRecebivel(b: Linha, hoje: Date = new Date()) {
  const { status, daysLate } = statusDe(b, hoje);
  const amount = dinheiro(b.amount) ?? 0;
  const paid = dinheiro(b.paidTotal) ?? 0;
  const aberto = status === "REMOVED" || status === "RENEGOTIATED" ? 0 : Math.max(0, Math.round((amount - paid) * 100) / 100);
  return {
    id: b.id,
    client: b.client,
    description: b.description,
    competence: b.competence ?? `${b.competenceYear}-${String(b.competenceMonth).padStart(2, "0")}`,
    amount,
    paidAmount: paid,
    openAmount: aberto,
    dueDate: dia(b.dueDate),
    paidAt: instante(b.paidAt),
    status: { code: status, label: LABEL[status] },
    daysLate,
    kind: b.billingKind,
    revenueType: b.revenueType,
    installmentNumber: b.installmentNumber,
    collectionStatus: b.collectionStatus,
  };
}

export async function listarRecebiveisApi(f: {
  where: Prisma.BillingWhereInput;
  status?: ReceivableStatus[];
  page: number;
  pageSize: number;
}) {
  const hoje = new Date();
  // Removidas do ciclo só entram quando pedidas explicitamente.
  const where: Prisma.BillingWhereInput = f.status?.includes("REMOVED")
    ? f.where
    : { ...f.where, status: { not: "CANCELED" } };
  // O status é derivado (vencimento × hoje), então o filtro por ele roda em
  // memória sobre a janela — limitada por data/competência na rota.
  const linhas = await prisma.billing.findMany({
    where,
    orderBy: [{ dueDate: "asc" }, { id: "asc" }],
    select: SELECT,
    take: 5000,
  });
  const todas = linhas.map((b) => serializarRecebivel(b, hoje));
  const filtradas = f.status ? todas.filter((r) => f.status!.includes(r.status.code as ReceivableStatus)) : todas;
  const totals = filtradas.reduce(
    (t, r) => ({ amount: t.amount + r.amount, paid: t.paid + r.paidAmount, open: t.open + r.openAmount }),
    { amount: 0, paid: 0, open: 0 }
  );
  const r2 = (n: number) => Math.round(n * 100) / 100;
  return {
    itens: filtradas.slice((f.page - 1) * f.pageSize, f.page * f.pageSize),
    total: filtradas.length,
    totals: { amount: r2(totals.amount), paidAmount: r2(totals.paid), openAmount: r2(totals.open) },
    truncated: linhas.length === 5000,
  };
}

export async function detalharRecebivelApi(id: string) {
  const b = await prisma.billing.findFirst({
    where: { id },
    select: {
      ...SELECT,
      notes: true,
      payments: {
        orderBy: { paidAt: "asc" },
        select: { id: true, amount: true, paidAt: true, method: true, status: true },
      },
    },
  });
  if (!b) return null;
  return {
    ...serializarRecebivel(b),
    notes: b.notes,
    payments: b.payments.map((p) => ({
      id: p.id, amount: dinheiro(p.amount), paidAt: instante(p.paidAt), method: p.method, status: p.status,
    })),
  };
}

export type { CycleStatus };
