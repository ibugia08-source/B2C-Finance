"use server";
import { BILLING_OPEN_STATUSES } from "@/lib/billing-status";
import { prisma } from "@/lib/prisma";
import { revalidateAgency, revalidateFinance } from "@/lib/revalidate";
import { tryPermission, NO_PERMISSION } from "@/lib/auth/viewer";
import { parseBRL, toNumber as n } from "@/lib/format";
import { getValidDueDateForMonth } from "@/lib/financial/due-date";
import type { ActionResult } from "./clients";

/**
 * Edição INLINE da lista de Recebimentos (ciclo mensal).
 * Regra do briefing: alterar na linha atualiza também o CADASTRO do cliente
 * (Gestão de Carteira) — vencimento, valor, modalidade e prazo são atributos
 * do cliente; o status é do recebimento do mês.
 */


function revalidateAll(clientId?: string) {
  revalidateAgency({ clientId });
}

/** Cobrança em aberto do cliente na competência (para sincronizar edições). */
async function openBillingOf(clientId: string, month: number, year: number) {
  return prisma.billing.findFirst({
    where: {
      clientId,
      competenceMonth: month,
      competenceYear: year,
      status: { in: [...BILLING_OPEN_STATUSES] },
    },
    orderBy: { dueDate: "asc" },
  });
}

/**
 * Vencimento recorrente (dia do mês) — atualiza o cadastro do cliente e a
 * cobrança em aberto do mês visualizado (mantém o ciclo coerente).
 */
export async function setClientPaymentDay(
  clientId: string,
  day: number,
  month: number,
  year: number
): Promise<ActionResult> {
  if (!(await tryPermission("recebimentos.alterar_vencimento"))) return NO_PERMISSION;
  try {
    if (!Number.isInteger(day) || day < 1 || day > 31)
      return { ok: false, error: "Dia de vencimento deve ser entre 1 e 31." };
    const client = await prisma.client.findFirst({ where: { id: clientId } });
    if (!client) return { ok: false, error: "Cliente não encontrado." };

    await prisma.client.update({ where: { id: clientId }, data: { paymentDay: day } });

    const open = await openBillingOf(clientId, month, year);
    if (open) {
      const dueDate = getValidDueDateForMonth(year, month, day);
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      await prisma.billing.update({
        where: { id: open.id },
        data: {
          dueDate,
          status:
            n(open.paidTotal) > 0 ? "PARTIAL" : dueDate < today ? "OVERDUE" : "PENDING",
        },
      });
    }
    revalidateAll(clientId);
    return { ok: true };
  } catch (e: any) {
    return { ok: false, error: e?.message ?? "Falha ao atualizar o vencimento." };
  }
}

/**
 * Valor devido — atualiza o valor de referência do cliente (mensal para MRR,
 * contrato para TCV) e a cobrança em aberto do mês visualizado.
 */
export async function setClientChargeAmount(
  clientId: string,
  amountRaw: string,
  month: number,
  year: number
): Promise<ActionResult> {
  if (!(await tryPermission("recebimentos.editar"))) return NO_PERMISSION;
  try {
    const amount = parseBRL(amountRaw);
    if (!Number.isFinite(amount) || amount <= 0)
      return { ok: false, error: "Informe um valor maior que zero." };
    const client = await prisma.client.findFirst({ where: { id: clientId } });
    if (!client) return { ok: false, error: "Cliente não encontrado." };

    const open = await openBillingOf(clientId, month, year);
    if (open && amount < n(open.paidTotal))
      return {
        ok: false,
        error: "Valor menor que o já pago nesta cobrança — exclua o pagamento antes.",
      };

    await prisma.client.update({
      where: { id: clientId },
      data: { monthlyValue: amount },
    });
    if (open) {
      await prisma.billing.update({ where: { id: open.id }, data: { amount } });
    }
    revalidateAll(clientId);
    return { ok: true };
  } catch (e: any) {
    return { ok: false, error: e?.message ?? "Falha ao atualizar o valor." };
  }
}

/** Prazo do contrato (meses) — atributo do cadastro do cliente. */
export async function setClientContractMonths(
  clientId: string,
  months: number | null
): Promise<ActionResult> {
  if (!(await tryPermission("recebimentos.editar"))) return NO_PERMISSION;
  try {
    if (months != null && (!Number.isInteger(months) || months < 1 || months > 120))
      return { ok: false, error: "Prazo inválido (1 a 120 meses)." };
    const client = await prisma.client.findFirst({ where: { id: clientId } });
    if (!client) return { ok: false, error: "Cliente não encontrado." };
    await prisma.client.update({
      where: { id: clientId },
      data: { contractMonths: months },
    });
    revalidateAll(clientId);
    return { ok: true };
  } catch (e: any) {
    return { ok: false, error: e?.message ?? "Falha ao atualizar o prazo." };
  }
}

// ===== Status do recebimento do mês (coluna Status) =====

export type MonthChargeStatus = "UPCOMING" | "PAID" | "OVERDUE" | "DELINQUENT";

/**
 * Muda o status da cobrança do mês direto na lista:
 *  - A vencer / Vencido → reabre/marca vencida (sem mexer em pagamentos);
 *  - Inadimplente → marcação MANUAL (collectionStatus ESCALATED);
 *  - Pago → registra pagamento do saldo em aberto HOJE pelo núcleo contábil
 *    oficial (sem duplicidade; Receita Extra automática só se a competência
 *    for de mês anterior — regra padrão do fechamento).
 * Cobrança já quitada não pode ser reaberta por aqui (excluir o pagamento
 * na aba Pagamentos).
 */
export async function setMonthChargeStatus(
  billingId: string,
  status: MonthChargeStatus
): Promise<ActionResult> {
  if (!(await tryPermission("recebimentos.editar"))) return NO_PERMISSION;
  try {
    const b = await prisma.billing.findUnique({ where: { id: billingId } });
    if (!b) return { ok: false, error: "Cobrança não encontrada." };
    if (b.status === "CANCELED")
      return { ok: false, error: "Cobrança removida do mês — recoloque-a antes." };

    if (status === "PAID") {
      if (b.status === "PAID") return { ok: true };
      const open = n(b.amount) - n(b.paidTotal);
      if (open <= 0) return { ok: false, error: "Sem saldo em aberto." };
      const { settleBilling: settleViaEngine } = await import(
        "@/lib/engines/payment-engine"
      );
      const res = await settleViaEngine({
        billingId: b.id,
        amount: open,
        paidAt: new Date(),
        method: "OTHER",
        accountId: null,
        notes: "Marcado como pago na lista de Recebimentos.",
      });
      if (!res.ok) return res;
      revalidateAll(b.clientId);
      revalidateFinance(); // pagamento pode gerar Receita Extra (Income)
      return { ok: true };
    }

    if (b.status === "PAID")
      return {
        ok: false,
        error:
          "Cobrança já quitada. Para reabrir, use a ação 'Excluir pagamento' na própria linha.",
      };

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const clearManual =
      b.collectionStatus === "ESCALATED"
        ? { collectionStatus: "NOT_CONTACTED" as any }
        : {};
    const data: Record<string, any> =
      status === "UPCOMING"
        ? { status: n(b.paidTotal) > 0 ? "PARTIAL" : "PENDING", ...clearManual }
        : status === "OVERDUE"
          ? { status: "OVERDUE", ...clearManual }
          : {
              status: b.dueDate < today ? "OVERDUE" : b.status,
              collectionStatus: "ESCALATED",
            };

    await prisma.billing.update({ where: { id: b.id }, data });
    if (status === "DELINQUENT") {
      await prisma.collectionHistory.create({
        data: {
          billingId: b.id,
          clientId: b.clientId,
          status: "ESCALATED",
          message: "Marcado manualmente como inadimplente na lista de Recebimentos.",
        },
      });
    }
    revalidateAll(b.clientId);
    return { ok: true };
  } catch (e: any) {
    return { ok: false, error: e?.message ?? "Falha ao atualizar o status." };
  }
}

// ===== Pagamento do mês pela CARTEIRA (célula "Pagamento (mês)") =====

/**
 * A célula "Pagamento (mês)" de /clientes agora opera a cobrança REAL da
 * competência (fim dos dois "pagos" que não conversavam — o override
 * cosmético ClientMonthDelinquency não é mais gravado pela UI):
 *  - PAGO → quita o saldo pelo núcleo contábil (1 clique; mês passado entra
 *    com a data do vencimento, backfill "pagou em dia"); retorna o id do
 *    pagamento em `id` para o toast Desfazer;
 *  - DEVENDO → marca Inadimplente (collectionStatus ESCALATED);
 *  - limpar (null) → volta para A vencer/Parcial (remove a marcação manual).
 * Se o mês ainda não tem cobrança, ela é MATERIALIZADA do cadastro
 * (ensureClientBillingForMonth) — preencher a célula É o registro, como na
 * planilha. Qualquer override legado da competência é removido para a
 * verdade automática (agora real) aparecer.
 */
export async function setClientMonthPayment(
  clientId: string,
  status: "PAGO" | "DEVENDO" | null,
  month: number,
  year: number
): Promise<ActionResult> {
  const viewer = await tryPermission(
    status === "PAGO" ? "recebimentos.registrar_pagamento" : "recebimentos.editar"
  );
  if (!viewer) return NO_PERMISSION;
  try {
    if (!Number.isInteger(month) || month < 1 || month > 12 || !Number.isInteger(year))
      return { ok: false, error: "Competência inválida." };

    const { ensureClientBillingForMonth } = await import(
      "@/lib/services/receivables-cycle"
    );

    // Cobrança viva da competência (qualquer status ≠ CANCELED).
    let billing = await prisma.billing.findFirst({
      where: {
        clientId,
        competenceMonth: month,
        competenceYear: year,
        status: { not: "CANCELED" },
      },
      orderBy: { dueDate: "asc" },
    });

    if (status === null) {
      // Limpar: sem cobrança não há o que limpar; quitada exige excluir pagamento.
      await clearDelinquencyOverride(clientId, month, year);
      if (!billing) {
        revalidateAll(clientId);
        return { ok: true };
      }
      if (billing.status === "PAID")
        return {
          ok: false,
          error:
            "Cobrança já quitada — para reabrir, exclua o pagamento na ficha do cliente.",
        };
      const res = await setMonthChargeStatus(billing.id, "UPCOMING");
      if (!res.ok) return res;
      revalidateAll(clientId);
      return { ok: true };
    }

    if (!billing) {
      const ensured = await ensureClientBillingForMonth(
        clientId,
        month,
        year,
        viewer.email
      );
      if (!ensured.ok) return ensured;
      billing = await prisma.billing.findUnique({
        where: { id: ensured.billingId },
      });
      if (!billing) return { ok: false, error: "Falha ao materializar a cobrança." };
    }

    await clearDelinquencyOverride(clientId, month, year);

    if (status === "PAGO") {
      if (billing.status === "PAID") {
        revalidateAll(clientId);
        return { ok: true };
      }
      const open = n(billing.amount) - n(billing.paidTotal);
      if (open <= 0) return { ok: false, error: "Sem saldo em aberto." };

      // Mesma regra e mesmo marcador do 1 clique da Gestão do Mês — importados
      // do motor para o Desfazer reconhecer o pagamento dos dois caminhos.
      const { settleBilling: settleViaEngine, quickSettlePaidAt, QUICK_SETTLE_NOTE } =
        await import("@/lib/engines/payment-engine");
      const res = await settleViaEngine({
        billingId: billing.id,
        amount: open,
        paidAt: quickSettlePaidAt(year, month, billing.dueDate),
        method: "OTHER",
        accountId: null,
        notes: QUICK_SETTLE_NOTE,
      });
      if (!res.ok) return res;
      revalidateAll(clientId);
      revalidateFinance();
      return { ok: true, id: res.paymentId };
    }

    // DEVENDO
    if (billing.status === "PAID")
      return {
        ok: false,
        error:
          "Cobrança já quitada — para marcar como devendo, exclua o pagamento antes.",
      };
    const res = await setMonthChargeStatus(billing.id, "DELINQUENT");
    if (!res.ok) return res;
    revalidateAll(clientId);
    return { ok: true };
  } catch (e: any) {
    return { ok: false, error: e?.message ?? "Falha ao atualizar o pagamento do mês." };
  }
}

/** Remove o override legado da competência — a verdade agora é a cobrança. */
async function clearDelinquencyOverride(clientId: string, month: number, year: number) {
  await prisma.clientMonthDelinquency.deleteMany({
    where: { clientId, month, year },
  });
}

// ===== Inadimplência anterior (registro manual de meses passados) =====

/**
 * Registra manualmente uma inadimplência de MÊS ANTERIOR: cria a cobrança
 * vencida na competência informada (entra no histórico financeiro do
 * cliente e nos relatórios). NÃO cria Receita Extra — se for paga depois,
 * fica como inadimplência regularizada pela regra padrão.
 */
export async function addPastDelinquency(formData: FormData): Promise<ActionResult> {
  const viewer = await tryPermission("recebimentos.editar");
  if (!viewer) return NO_PERMISSION;
  try {
    const clientId = String(formData.get("clientId") ?? "");
    const refMonth = parseInt(String(formData.get("refMonth") ?? ""), 10);
    const refYear = parseInt(String(formData.get("refYear") ?? ""), 10);
    const amount = parseBRL(String(formData.get("amount") ?? "0"));
    const dueRaw = String(formData.get("dueDate") ?? ""); // YYYY-MM-DD (input date)
    const notes = String(formData.get("notes") ?? "").trim() || null;

    if (!clientId) return { ok: false, error: "Selecione o cliente." };
    if (!Number.isInteger(refMonth) || refMonth < 1 || refMonth > 12)
      return { ok: false, error: "Mês de referência inválido." };
    if (!Number.isInteger(refYear) || refYear < 2000 || refYear > 2100)
      return { ok: false, error: "Ano de referência inválido." };
    if (!Number.isFinite(amount) || amount <= 0)
      return { ok: false, error: "Informe o valor inadimplente." };

    const now = new Date();
    const compKey = refYear * 12 + (refMonth - 1);
    const nowKey = now.getFullYear() * 12 + now.getMonth();
    if (compKey >= nowKey)
      return {
        ok: false,
        error: "Inadimplência anterior é só de meses passados — para o mês atual use o ciclo normal.",
      };

    const client = await prisma.client.findFirst({
      where: { id: clientId },
      select: { id: true, name: true, modality: true, paymentDay: true },
    });
    if (!client) return { ok: false, error: "Cliente não encontrado." };

    let dueDate: Date | null = null;
    if (/^\d{4}-\d{2}-\d{2}$/.test(dueRaw)) dueDate = new Date(`${dueRaw}T00:00:00`);
    if (!dueDate || Number.isNaN(dueDate.getTime())) {
      dueDate = getValidDueDateForMonth(refYear, refMonth, client.paymentDay);
    }

    // O índice único de MRR não permite segunda mensalidade viva na mesma
    // competência — checa antes para responder com mensagem de negócio.
    if (client.modality === "MRR") {
      const existing = await prisma.billing.findFirst({
        where: {
          clientId: client.id,
          competenceMonth: refMonth,
          competenceYear: refYear,
          revenueType: "MRR",
          status: { not: "CANCELED" },
        },
        select: { id: true, status: true },
      });
      if (existing)
        return {
          ok: false,
          error: `Este cliente já tem a mensalidade de ${String(refMonth).padStart(2, "0")}/${refYear} registrada — edite/marque como Devendo a cobrança existente, ou lance um valor adicional como Cobrança avulsa.`,
        };
    }

    const billing = await prisma.billing.create({
      data: {
        clientId: client.id,
        description: `Inadimplência anterior ${String(refMonth).padStart(2, "0")}/${refYear} — ${client.name}`,
        competenceMonth: refMonth,
        competenceYear: refYear,
        amount,
        dueDate,
        status: "OVERDUE",
        collectionStatus: "ESCALATED", // aparece como Inadimplente
        revenueType:
          client.modality === "MRR" || client.modality === "TCV"
            ? client.modality
            : "ONE_TIME",
        notes,
      },
    });
    await prisma.collectionHistory.create({
      data: {
        billingId: billing.id,
        clientId: client.id,
        status: "ESCALATED",
        message: `Inadimplência de ${String(refMonth).padStart(2, "0")}/${refYear} registrada manualmente por ${viewer.email}.${notes ? ` Obs.: ${notes}` : ""}`,
      },
    });

    revalidateAll(client.id);
    return { ok: true, id: billing.id };
  } catch (e: any) {
    if (e?.code === "P2002")
      return {
        ok: false,
        error:
          "Este cliente já tem mensalidade nesta competência — edite a cobrança existente.",
      };
    return { ok: false, error: e?.message ?? "Falha ao registrar a inadimplência." };
  }
}

// ===== Excluir pagamento de cobrança quitada (reabre a cobrança) =====

/**
 * Exclui TODOS os pagamentos de uma cobrança (linha "Paga" da lista):
 * reverte cada um pelo núcleo contábil oficial (saldo, status, flags de
 * fechamento e conciliação de caixa) — a cobrança volta a Em aberto/Vencida.
 */
export async function deleteBillingPayments(billingId: string): Promise<ActionResult> {
  const viewer = await tryPermission("recebimentos.excluir");
  if (!viewer) return NO_PERMISSION;
  try {
    const b = await prisma.billing.findUnique({ where: { id: billingId } });
    if (!b) return { ok: false, error: "Cobrança não encontrada." };
    const payments = await prisma.payment.findMany({
      where: { billingId },
      orderBy: { paidAt: "desc" },
      select: { id: true },
    });
    if (payments.length === 0)
      return { ok: false, error: "Esta cobrança não tem pagamentos registrados." };

    const { revertPayment } = await import("@/lib/engines/payment-engine");
    for (const p of payments) {
      const res = await revertPayment(p.id, "Exclusão dos pagamentos da cobrança");
      if (!res.ok) return res;
    }
    await prisma.collectionHistory.create({
      data: {
        billingId,
        clientId: b.clientId,
        status: "NOT_CONTACTED",
        message: `Pagamento(s) excluído(s) por ${viewer.email} — cobrança reaberta.`,
      },
    });
    revalidateAll(b.clientId);
    revalidateFinance(); // reverte a Receita Extra (Income)
    return { ok: true };
  } catch (e: any) {
    return { ok: false, error: e?.message ?? "Falha ao excluir o pagamento." };
  }
}

// ===== Ações em massa da lista de Recebimentos =====

/** Status do mês em massa (Pago fica de fora — pagamento é individual). */
export async function bulkSetMonthStatus(
  billingIds: string[],
  status: Exclude<MonthChargeStatus, "PAID">
): Promise<ActionResult> {
  if (!(await tryPermission("recebimentos.editar"))) return NO_PERMISSION;
  try {
    if (billingIds.length === 0)
      return { ok: false, error: "Nenhuma cobrança selecionada." };
    let changed = 0;
    for (const id of billingIds) {
      const res = await setMonthChargeStatus(id, status);
      if (res.ok) changed++;
    }
    revalidateAll();
    return changed > 0
      ? { ok: true }
      : {
          ok: false,
          error:
            "Nenhuma cobrança pôde ser atualizada (quitadas/removidas ficam de fora).",
        };
  } catch (e: any) {
    return { ok: false, error: e?.message ?? "Falha na atualização em massa." };
  }
}

/**
 * Remove CLIENTES SELECIONADOS da lista do mês (checkbox → Remover da lista).
 * - Com cobrança no mês: cancela a cobrança (auditado).
 * - Sem cobrança no mês ("Sem cobrança"): cria um marcador CANCELADO na
 *   competência — o cliente some da lista, aparece em "Removidos do mês",
 *   pode ser recolocado e a geração automática não o recria.
 * NUNCA apaga o cliente da Gestão de Carteira.
 */
export async function bulkRemoveClientsFromList(
  entries: { clientId: string; billingId: string | null }[],
  month: number,
  year: number,
  reason: string | null
): Promise<ActionResult> {
  const viewer = await tryPermission("recebimentos.excluir");
  if (!viewer) return NO_PERMISSION;
  try {
    if (!Number.isInteger(month) || month < 1 || month > 12 || !Number.isInteger(year))
      return { ok: false, error: "Competência inválida." };
    const cleanReason = (reason ?? "").trim() || null;

    const billingIds = entries.filter((e) => e.billingId).map((e) => e.billingId!);
    const bareClientIds = Array.from(
      new Set(entries.filter((e) => !e.billingId).map((e) => e.clientId))
    );

    let removed = 0;

    // 1) Cancela as cobranças existentes (quitadas ficam de fora).
    if (billingIds.length) {
      const bills = await prisma.billing.findMany({
        where: { id: { in: billingIds }, status: { notIn: ["PAID", "CANCELED"] } },
        select: { id: true, clientId: true },
      });
      if (bills.length) {
        await prisma.billing.updateMany({
          where: { id: { in: bills.map((b) => b.id) } },
          data: {
            status: "CANCELED",
            canceledAt: new Date(),
            canceledBy: viewer.email,
            cancelReason: cleanReason,
          },
        });
        await prisma.collectionHistory.createMany({
          data: bills.map((b) => ({
            billingId: b.id,
            clientId: b.clientId,
            status: "NOT_CONTACTED" as any,
            message: `Removido da lista de ${String(month).padStart(2, "0")}/${year} por ${viewer.email}.${cleanReason ? ` Motivo: ${cleanReason}` : ""}`,
          })),
        });
        removed += bills.length;
      }
    }

    // 2) Clientes sem cobrança no mês: marcador cancelado na competência.
    if (bareClientIds.length) {
      const clients = await prisma.client.findMany({
        where: { id: { in: bareClientIds } },
        select: { id: true, name: true, monthlyValue: true, paymentDay: true },
      });
      // Batch query to find existing billings for all clients at once
      const existingBillings = await prisma.billing.findMany({
        where: {
          clientId: { in: bareClientIds },
          competenceMonth: month,
          competenceYear: year,
        },
        select: { clientId: true, id: true },
      });
      const existingClientIds = new Set(existingBillings.map((b) => b.clientId));
      for (const c of clients) {
        // Se já existir cobrança na competência (corrida), não duplica.
        if (existingClientIds.has(c.id)) continue;
        const marker = await prisma.billing.create({
          data: {
            clientId: c.id,
            description: `Mensalidade ${String(month).padStart(2, "0")}/${year} — ${c.name}`,
            competenceMonth: month,
            competenceYear: year,
            amount: Number(c.monthlyValue ?? 0),
            dueDate: getValidDueDateForMonth(year, month, c.paymentDay),
            status: "CANCELED",
            canceledAt: new Date(),
            canceledBy: viewer.email,
            cancelReason: cleanReason,
            revenueType: "MRR",
          },
        });
        await prisma.collectionHistory.create({
          data: {
            billingId: marker.id,
            clientId: c.id,
            status: "NOT_CONTACTED",
            message: `Removido da lista de ${String(month).padStart(2, "0")}/${year} por ${viewer.email} (cliente sem cobrança no mês).${cleanReason ? ` Motivo: ${cleanReason}` : ""}`,
          },
        });
        removed += 1;
      }
    }

    if (removed === 0)
      return {
        ok: false,
        error: "Nada para remover (cobranças quitadas ficam de fora).",
      };
    revalidateAll();
    return { ok: true };
  } catch (e: any) {
    return { ok: false, error: e?.message ?? "Falha ao remover da lista." };
  }
}
