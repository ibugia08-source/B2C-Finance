"use server";
import { prisma } from "@/lib/prisma";
import { requirePermission, can } from "@/lib/auth/viewer";
import { revalidateAgency, revalidateFinance } from "@/lib/revalidate";
import { parseBRL, parseMonthParam, toNumber as n } from "@/lib/format";
import { getValidDueDateForMonth } from "@/lib/financial/due-date";
import { settleBillingPayment } from "@/lib/services/payment-accounting";
import { ensureClientBillingForMonth } from "@/lib/services/receivables-cycle";
import type { ActionResult } from "./clients";

/** Soma meses com clamp de fim de mês (31/01 + 1m = 28/02, não 03/03). */
function addMonthsClamped(base: Date, months: number): Date {
  const y = base.getFullYear();
  const m = base.getMonth() + months;
  const lastDay = new Date(y, m + 1, 0).getDate();
  return new Date(y, m, Math.min(base.getDate(), lastDay));
}

/**
 * FLUXO COMPLETO DE RENOVAÇÃO — "Sim, renovou" da Gestão do Mês e do módulo
 * Renovações, num só passo atômico do ponto de vista do usuário:
 *
 *  1. Estende o contrato (quando existe) com o novo ciclo — prazo, valor,
 *     forma/modalidade de pagamento — e reativa o cliente.
 *  2. Atualiza o CADASTRO do cliente (prazo, valores, mês da próxima
 *     renovação = mês do novo fim de vigência).
 *  3. Opcionalmente LANÇA o valor no módulo de recebimentos, na competência
 *     escolhida (mês atual ou outro), como cobrança real (Billing).
 *  4. MRR: pergunta se o cliente permanece na lista de recebimentos mensais.
 *     "Não" = o cliente (e o contrato) passam a ser tratados como TCV — paga
 *     o ciclo cheio, sem mensalidade automática.
 *  5. Registra o histórico auditável em ClientRenewal (aparece na ficha do
 *     cliente e no módulo Renovações).
 *
 * REGRAS DE COBRANÇA (auditoria 2026-08-13):
 *  - NUNCA chamar generateBillingsForContract aqui: as mensalidades do dia a
 *    dia nascem SEM contractId (ensureMonthlyBillings) e o dedupe daquela
 *    função é por contractId — gerar aqui duplicaria cobranças em massa.
 *    As mensalidades futuras do MRR nascem do CADASTRO (monthlyValue novo)
 *    pelo ciclo normal.
 *  - MRR keepMonthly + lançamento: materializa a mensalidade da competência
 *    via ensureClientBillingForMonth e ATUALIZA o valor se a cobrança já
 *    existia em aberto com o mensal antigo.
 *  - Contrato + cadastro + histórico são gravados numa transação; o
 *    lançamento/pagamento roda depois e falha vira warning (nunca deixa
 *    contrato estendido sem histórico).
 */
export async function renewClientFlow(
  formData: FormData
): Promise<ActionResult & { renewalId?: string }> {
  const viewer = await requirePermission("contratos.editar");
  try {
    const clientId = String(formData.get("clientId") ?? "");
    const contractId = String(formData.get("contractId") ?? "").trim() || null;
    const months = Math.max(1, parseInt(String(formData.get("months") ?? "12"), 10) || 12);
    const totalRaw = String(formData.get("totalValue") ?? "").trim();
    const paymentMethod = String(formData.get("paymentMethod") ?? "").trim() || null;
    const paymentMode = String(formData.get("paymentMode") ?? "").trim() || null;
    const details = String(formData.get("details") ?? "").trim() || null;
    const launch = String(formData.get("launch") ?? "") === "1";
    const keepMonthly = String(formData.get("keepMonthly") ?? "1") !== "0";
    const payStatus = String(formData.get("payStatus") ?? "aberto"); // aberto | total | parcial
    const paidRaw = String(formData.get("paidAmount") ?? "").trim();

    const today = new Date();
    const comp = parseMonthParam(String(formData.get("competence") ?? "")) ?? {
      month: today.getMonth() + 1,
      year: today.getFullYear(),
    };

    const client = await prisma.client.findFirst({
      where: { id: clientId },
      select: {
        id: true, name: true, modality: true, paymentDay: true,
        monthlyValue: true, totalContractValue: true,
      },
    });
    if (!client) return { ok: false, error: "Cliente não encontrado." };

    const contract = contractId
      ? await prisma.contract.findFirst({ where: { id: contractId, clientId } })
      : null;
    if (contractId && !contract)
      return { ok: false, error: "Contrato não encontrado para este cliente." };

    const total = totalRaw ? parseBRL(totalRaw) : 0;
    if (!(total > 0)) return { ok: false, error: "Informe o valor do novo ciclo." };

    // Modalidade efetiva: contrato manda; sem contrato, vale o cadastro.
    const isMrr = contract ? contract.type === "MRR" : client.modality !== "TCV";
    const staysMonthly = isMrr && keepMonthly;
    const monthly = staysMonthly ? Math.round((total / months) * 100) / 100 : null;

    const base =
      contract?.endDate && contract.endDate > today ? contract.endDate : today;
    const previousEndDate = contract?.endDate ?? null;
    const newEnd = addMonthsClamped(base, months);

    // ===== 1-2-5) Contrato + cadastro + histórico numa TRANSAÇÃO =====
    const renewNote =
      `Renovado em ${today.toLocaleDateString("pt-BR")}: ${months} mês(es), R$ ${total.toFixed(2).replace(".", ",")}` +
      (paymentMethod ? `, ${paymentMethod}` : "") +
      (paymentMode ? ` (${paymentMode})` : "") +
      (details ? ` — ${details}` : "");

    const writes: any[] = [];
    if (contract) {
      writes.push(
        prisma.contract.update({
          where: { id: contract.id },
          data: {
            status: "ACTIVE",
            endDate: newEnd,
            renewalDate: newEnd,
            totalValue: n(contract.totalValue) + total,
            paymentMethod,
            paymentMode,
            canceledAt: null,
            notes: [contract.notes, renewNote].filter(Boolean).join("\n"),
            ...(staysMonthly
              ? { monthlyValue: monthly! }
              : isMrr
                ? // MRR que pagou o ciclo cheio: o CONTRATO também vira TCV —
                  // trava a geração de mensalidades em lote sobre o ciclo pago.
                  { type: "TCV" as const, recurrence: "NONE" as const, monthlyValue: 0 }
                : {}),
          },
        })
      );
    }
    writes.push(
      prisma.client.update({
        where: { id: clientId },
        data: {
          status: "ACTIVE",
          churnedAt: null,
          contractMonths: months,
          // Próxima janela de renovação = mês do novo fim de vigência.
          renewalMonth: newEnd.getMonth() + 1,
          ...(staysMonthly
            ? { monthlyValue: monthly }
            : isMrr
              ? { modality: "TCV", totalContractValue: total }
              : { totalContractValue: total }),
        },
      })
    );
    writes.push(
      prisma.clientRenewal.create({
        data: {
          clientId,
          contractId: contract?.id ?? null,
          months,
          totalValue: total,
          monthlyValue: monthly,
          modality: staysMonthly ? "MRR" : "TCV",
          paymentMethod,
          paymentMode,
          previousEndDate,
          newEndDate: newEnd,
          billingMonth: launch ? comp.month : null,
          billingYear: launch ? comp.year : null,
          keptMonthly: isMrr ? keepMonthly : null,
          paymentStatus: launch ? payStatus : null,
          notes: details,
          createdBy: viewer.email,
        },
      })
    );
    const results = await prisma.$transaction(writes);
    const renewal = results[results.length - 1] as { id: string };

    // ===== 3) Lançamento nos recebimentos (fora da transação; falha = warning) =====
    let billingId: string | null = null;
    let warning: string | undefined;
    if (launch) {
      if (staysMonthly) {
        // MRR que segue mensal: a "cobrança da renovação" é a própria
        // mensalidade da competência — materializa sem duplicar.
        const ensured = await ensureClientBillingForMonth(
          clientId, comp.month, comp.year, viewer.email
        );
        if (ensured.ok) {
          billingId = ensured.billingId;
          if (!ensured.created) {
            // Mensalidade já existia (valor antigo): atualiza se ainda em aberto.
            const existing = await prisma.billing.findUnique({
              where: { id: billingId },
              select: { paidTotal: true, status: true, amount: true },
            });
            if (
              existing &&
              existing.status !== "CANCELED" &&
              n(existing.paidTotal) === 0 &&
              monthly != null &&
              Math.abs(n(existing.amount) - monthly) > 0.005
            ) {
              await prisma.billing.update({
                where: { id: billingId },
                data: { amount: monthly },
              });
            }
          }
        } else {
          warning = `Renovado, mas a mensalidade não foi lançada: ${ensured.error}`;
        }
      } else {
        const due = getValidDueDateForMonth(
          comp.year, comp.month, client.paymentDay ?? contract?.billingDay ?? today.getDate()
        );
        const created = await prisma.billing.create({
          data: {
            clientId,
            contractId: contract?.id ?? null,
            description: `Renovação — ${contract?.title ?? client.name} (${String(comp.month).padStart(2, "0")}/${comp.year})`,
            competenceMonth: comp.month,
            competenceYear: comp.year,
            amount: total,
            dueDate: due,
            revenueType: "TCV",
            status: "PENDING",
          },
          select: { id: true },
        });
        billingId = created.id;
      }

      if (billingId) {
        await prisma.clientRenewal.update({
          where: { id: renewal.id },
          data: { billingId },
        });
      }

      // Situação do pagamento informada na renovação (total/parcial).
      if (billingId && payStatus !== "aberto") {
        if (!can(viewer, "recebimentos.registrar_pagamento")) {
          warning = "Renovado e lançado; sem permissão para registrar o pagamento.";
        } else {
          const billing = await prisma.billing.findUnique({
            where: { id: billingId },
            select: { amount: true, paidTotal: true },
          });
          const open = Math.max(0, n(billing?.amount) - n(billing?.paidTotal));
          const payAmount =
            payStatus === "parcial" ? Math.min(parseBRL(paidRaw), open) : open;
          if (payAmount > 0) {
            const settled = await settleBillingPayment({
              billingId,
              amount: payAmount,
              paidAt: today,
              method: "OTHER",
              accountId: null,
              notes: "Pagamento registrado na renovação do contrato.",
            });
            if (!settled.ok) warning = `Renovado, mas o pagamento falhou: ${settled.error}`;
          } else if (payStatus === "parcial") {
            warning = "Renovado; valor parcial inválido — pagamento não registrado.";
          }
        }
      }
    }

    revalidateAgency({ clientId, contractId: contract?.id ?? null });
    revalidateFinance();
    return { ok: true, id: renewal.id, renewalId: renewal.id, ...(warning ? { warning } : {}) };
  } catch (e: any) {
    return { ok: false, error: e?.message ?? "Falha ao renovar o contrato." };
  }
}

/**
 * Agenda (ou reagenda) manualmente a renovação de um cliente para um mês —
 * usada pelo "Agendar renovação" da Gestão do Mês e do módulo Renovações.
 * Grava Client.renewalMonth (mesma fonte dos KPIs/janelas de renovação).
 */
export async function scheduleClientRenewal(
  clientId: string,
  month: number
): Promise<ActionResult> {
  await requirePermission("clientes.editar");
  try {
    if (!Number.isInteger(month) || month < 1 || month > 12)
      return { ok: false, error: "Mês inválido." };
    const client = await prisma.client.findFirst({
      where: { id: clientId },
      select: { id: true },
    });
    if (!client) return { ok: false, error: "Cliente não encontrado." };
    await prisma.client.update({
      where: { id: clientId },
      data: { renewalMonth: month },
    });
    revalidateAgency({ clientId });
    return { ok: true };
  } catch (e: any) {
    return { ok: false, error: e?.message ?? "Falha ao agendar a renovação." };
  }
}
