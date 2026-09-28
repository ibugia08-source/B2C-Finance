import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { hojeCivil } from "@/lib/civil-date";
import { dinheiro, instante } from "../http";
import { dia } from "./common";

/**
 * DESPESAS NA API — leitura. Mesma seleção da tela de Despesas: lançamentos
 * `type = "despesa"`, período pela data de competência do lançamento
 * (`date`). "Vencida" é derivada como na tela: pendente/devendo com
 * vencimento antes de hoje.
 */

export const EXPENSE_STATUSES = ["pendente", "pago", "cancelado", "vencida"] as const;
export type ExpenseStatusFiltro = (typeof EXPENSE_STATUSES)[number];

const SELECT = {
  id: true, description: true, amount: true, date: true, dueDate: true, status: true, expenseType: true,
  recurrence: true, recurrenceGroupId: true, origin: true, notes: true, createdAt: true,
  category: { select: { id: true, name: true } },
  client: { select: { id: true, name: true } },
  account: { select: { id: true, name: true } },
} satisfies Prisma.TransactionSelect;

type Linha = Prisma.TransactionGetPayload<{ select: typeof SELECT }>;

export function whereDoStatus(s: ExpenseStatusFiltro | undefined, hoje: Date = hojeCivil()): Prisma.TransactionWhereInput {
  if (!s) return {};
  if (s === "vencida") return { status: { in: ["pendente", "devendo"] }, dueDate: { lt: hoje } };
  if (s === "pendente") return { status: { in: ["pendente", "devendo"] }, OR: [{ dueDate: null }, { dueDate: { gte: hoje } }] };
  return { status: s };
}

export function serializarDespesa(t: Linha, hoje: Date = hojeCivil()) {
  const aberta = t.status === "pendente" || t.status === "devendo";
  const vencida = aberta && !!t.dueDate && t.dueDate < hoje;
  return {
    id: t.id,
    description: t.description,
    amount: dinheiro(t.amount),
    date: dia(t.date),
    dueDate: dia(t.dueDate),
    status: vencida ? "vencida" : t.status,
    rawStatus: t.status,
    category: t.category,
    type: t.expenseType,
    recurrence: t.recurrence,
    recurring: !!t.recurrenceGroupId,
    paymentMethod: t.origin,
    client: t.client,
    account: t.account,
    createdAt: instante(t.createdAt),
  };
}

export async function listarDespesasApi(f: {
  periodo: { gte: Date; lt: Date };
  status?: ExpenseStatusFiltro;
  category?: string;
  page: number;
  pageSize: number;
}) {
  const hoje = hojeCivil();
  const AND: Prisma.TransactionWhereInput[] = [{ type: "despesa", date: f.periodo }, whereDoStatus(f.status, hoje)];
  if (f.category) {
    AND.push({ OR: [{ categoryId: f.category }, { category: { name: { equals: f.category, mode: "insensitive" } } }] });
  }
  const where: Prisma.TransactionWhereInput = { AND };
  const [total, linhas, soma] = await Promise.all([
    prisma.transaction.count({ where }),
    prisma.transaction.findMany({
      where,
      orderBy: [{ date: "desc" }, { id: "asc" }],
      skip: (f.page - 1) * f.pageSize,
      take: f.pageSize,
      select: SELECT,
    }),
    prisma.transaction.aggregate({ where, _sum: { amount: true } }),
  ]);
  return { itens: linhas.map((t) => serializarDespesa(t, hoje)), total, totalAmount: dinheiro(soma._sum.amount) ?? 0 };
}

export async function detalharDespesaApi(id: string) {
  const t = await prisma.transaction.findFirst({
    where: { id, type: "despesa" },
    select: { ...SELECT, installmentNumber: true, installmentTotal: true },
  });
  if (!t) return null;
  return {
    ...serializarDespesa(t),
    notes: t.notes,
    installment: t.installmentNumber ? { number: t.installmentNumber, total: t.installmentTotal } : null,
  };
}
