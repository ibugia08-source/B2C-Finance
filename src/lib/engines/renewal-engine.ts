import { prisma } from "@/lib/prisma";
import { parseBRL, parseMonthParam, toNumber as n, formatDateBR } from "@/lib/format";
import { getValidDueDateForMonth, addMonthsClamped } from "@/lib/financial/due-date";
import { settleBilling as settleViaEngine } from "@/lib/engines/payment-engine";
import { ensureClientBillingForMonth } from "@/lib/services/receivables-cycle";
import {
  PRAZO_INDETERMINADO, addCalendarMonths, civilCompetenceKey, civilToday, competenceKeyOf,
  parseCompetenceKey, rollForward,
} from "@/lib/renewal-expectation";
import { type DomainContext, type DomainResult, domainActor, domainCan, inDomain } from "./domain";

/**
 * FLUXO COMPLETO DE RENOVAÇÃO (domínio — extraído de actions/renewals.ts em
 * 28/09/2026, sem mudança de regra; a action e a futura API chamam esta função) — "Sim, renovou" da Gestão do Mês e do módulo
 * Renovações, num só passo atômico do ponto de vista do usuário:
 *
 *  1. O dono escolhe a MODALIDADE do contrato renovado (mesma lógica do
 *     cadastro): MRR = mensalidade + dia de pagamento mensal (o cliente
 *     segue na lista de recebimentos todo mês; ciclo = mensal × prazo);
 *     TCV = valor total cheio, sem mensalidade automática.
 *  2. Estende o contrato (quando existe) e reativa o cliente; contrato e
 *     cadastro acompanham a modalidade escolhida (normalização do saveClient:
 *     MRR zera valor total; TCV zera mensalidade e dia recorrente).
 *  3. Opcionalmente LANÇA o valor no módulo de recebimentos, na competência
 *     escolhida (mês atual ou outro), como cobrança real (Billing).
 *  4. Registra o histórico auditável em ClientRenewal (aparece na ficha do
 *     cliente e no módulo Renovações).
 *
 * REGRAS DE COBRANÇA (auditoria 2026-08-13):
 *  - NUNCA chamar generateBillingsForContract aqui: as mensalidades do dia a
 *    dia nascem SEM contractId (ensureMonthlyBillings) e o dedupe daquela
 *    função é por contractId — gerar aqui duplicaria cobranças em massa.
 *    As mensalidades futuras do MRR nascem do CADASTRO (monthlyValue novo)
 *    pelo ciclo normal.
 *  - Renovação MRR + lançamento: materializa a mensalidade da competência
 *    via ensureClientBillingForMonth e ATUALIZA o valor se a cobrança já
 *    existia em aberto com o mensal antigo.
 *  - Contrato + cadastro + histórico são gravados numa transação; o
 *    lançamento/pagamento roda depois e falha vira warning (nunca deixa
 *    contrato estendido sem histórico).
 */
/**
 * Entrada da renovação — os MESMOS campos do diálogo "Sim, renovou", como
 * texto (valores em formato BR, ex.: "1.500,00"; meses ou "indeterminado").
 */
export type RenovarClienteInput = {
  clientId?: string | null;
  competence?: string | null;
  contractId?: string | null;
  details?: string | null;
  forCompetence?: string | null;
  launch?: string | null;
  modality?: string | null;
  monthlyValue?: string | null;
  months?: string | null;
  paidAmount?: string | null;
  payStatus?: string | null;
  paymentDay?: string | null;
  paymentMethod?: string | null;
  totalValue?: string | null;
};

export async function renovarCliente(
  ctx: DomainContext,
  entrada: RenovarClienteInput
): Promise<DomainResult<{ renewalId?: string; clientId?: string; contractId?: string | null }>> {
  // Leitura igual à do formulário: campo ausente = null.
  const input = {
    clientId: entrada.clientId ?? null,
    competence: entrada.competence ?? null,
    contractId: entrada.contractId ?? null,
    details: entrada.details ?? null,
    forCompetence: entrada.forCompetence ?? null,
    launch: entrada.launch ?? null,
    modality: entrada.modality ?? null,
    monthlyValue: entrada.monthlyValue ?? null,
    months: entrada.months ?? null,
    paidAmount: entrada.paidAmount ?? null,
    payStatus: entrada.payStatus ?? null,
    paymentDay: entrada.paymentDay ?? null,
    paymentMethod: entrada.paymentMethod ?? null,
    totalValue: entrada.totalValue ?? null,
  };
  return inDomain(ctx, async () => {
    const clientId = String(input.clientId ?? "");
    const contractId = String(input.contractId ?? "").trim() || null;
    // Prazo do novo ciclo em meses, ou INDETERMINADO (só MRR): sem término e
    // sem próxima expectativa automática.
    const indeterminado = String(input.months ?? "").trim().toLowerCase() === PRAZO_INDETERMINADO;
    const months = indeterminado ? 1 : Math.max(1, parseInt(String(input.months ?? "12"), 10) || 12);
    const paymentMethod = String(input.paymentMethod ?? "").trim() || null;
    const details = String(input.details ?? "").trim() || null;
    const launch = String(input.launch ?? "") === "1";
    const payStatus = String(input.payStatus ?? "aberto"); // aberto | total | parcial
    const paidRaw = String(input.paidAmount ?? "").trim();

    const today = new Date();
    const comp = parseMonthParam(String(input.competence ?? "")) ?? {
      month: today.getMonth() + 1,
      year: today.getFullYear(),
    };

    const client = await prisma.client.findFirst({
      where: { id: clientId },
      select: {
        id: true, name: true, modality: true, paymentDay: true,
        monthlyValue: true, totalContractValue: true, expectedRenewalAt: true,
      },
    });
    if (!client) return { ok: false, error: "Cliente não encontrado." };

    // EXPECTATIVA ATENDIDA: a competência que esta renovação resolve. Vem do
    // mês em exibição no módulo (forCompetence); sem ele, da expectativa
    // atual do cliente; sem as duas, do mês de hoje. E o valor que se
    // esperava, congelado ANTES de o cadastro mudar.
    const expectedCompetence =
      parseCompetenceKey(String(input.forCompetence ?? ""))
        ? String(input.forCompetence).trim()
        : client.expectedRenewalAt
          ? civilCompetenceKey(client.expectedRenewalAt)
          : competenceKeyOf(today);
    const { expectedRenewalValues } = await import("@/lib/services/revenue-metrics");
    const expectedValue = (await expectedRenewalValues([client])).get(client.id) ?? null;

    const contract = contractId
      ? await prisma.contract.findFirst({ where: { id: contractId, clientId } })
      : null;
    if (contractId && !contract)
      return { ok: false, error: "Contrato não encontrado para este cliente." };

    // GUARDA ANTI-DUPLO ENVIO (auditoria 2026-08-13): retry de rede ou duas
    // abas não podem estender o contrato 2× nem lançar duas cobranças. Uma
    // renovação do MESMO cliente registrada há poucos minutos bloqueia a
    // repetição — renovar de novo de verdade (caso raro) espera a janela.
    const recentRenewal = await prisma.clientRenewal.findFirst({
      where: {
        clientId,
        renewedAt: { gte: new Date(Date.now() - 10 * 60 * 1000) },
      },
      select: { id: true },
    });
    if (recentRenewal) {
      return {
        ok: false,
        error:
          "Este cliente já tem uma renovação registrada há poucos minutos — confira o histórico dele antes de renovar novamente.",
      };
    }

    // MODALIDADE do contrato renovado (mesma lógica do cadastro):
    //  MRR → mensalidade + dia de pagamento mensal; TCV → valor total cheio.
    const modRaw = String(input.modality ?? "").trim();
    const staysMonthly = modRaw
      ? modRaw === "MRR"
      : (contract ? contract.type === "MRR" : client.modality !== "TCV");

    let monthly: number | null = null;
    let paymentDay: number | null = null;
    let total: number;
    if (staysMonthly) {
      monthly = parseBRL(String(input.monthlyValue ?? "").trim());
      if (!(monthly > 0))
        return { ok: false, error: "Informe o valor da mensalidade." };
      paymentDay = parseInt(String(input.paymentDay ?? ""), 10);
      if (!Number.isInteger(paymentDay) || paymentDay < 1 || paymentDay > 31)
        return { ok: false, error: "Informe o dia de pagamento mensal (1-31)." };
      total = Math.round(monthly * months * 100) / 100;
    } else {
      if (indeterminado)
        return { ok: false, error: "TCV é um valor fechado por um prazo: Indeterminado vale só para MRR." };
      total = parseBRL(String(input.totalValue ?? "").trim());
      if (!(total > 0))
        return { ok: false, error: "Informe o valor total do contrato renovado." };
    }

    const base =
      contract?.endDate && contract.endDate > today ? contract.endDate : today;
    const previousEndDate = contract?.endDate ?? null;
    const newEnd = indeterminado ? null : addMonthsClamped(base, months);

    // ===== 1-2-5) Contrato + cadastro + histórico numa TRANSAÇÃO =====
    const renewNote =
      `Renovado em ${formatDateBR(today)}: ${indeterminado ? "prazo indeterminado" : `${months} mês(es)`}, R$ ${total.toFixed(2).replace(".", ",")} (${staysMonthly ? "MRR" : "TCV"})` +
      (paymentMethod ? `, ${paymentMethod}` : "") +
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
            canceledAt: null,
            notes: [contract.notes, renewNote].filter(Boolean).join("\n"),
            // O contrato acompanha a modalidade escolhida na renovação —
            // TCV trava a geração de mensalidades (recurrence NONE, mensal 0).
            ...(staysMonthly
              ? { type: "MRR" as const, recurrence: "MONTHLY" as const, monthlyValue: monthly! }
              : { type: "TCV" as const, recurrence: "NONE" as const, monthlyValue: 0 }),
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
          contractMonths: indeterminado ? null : months,
          contractIndefinite: indeterminado,
          // Próxima expectativa = a expectativa atendida + o novo prazo (o
          // ciclo segue a data do cliente, não o dia em que se registrou).
          // Renovação registrada com atraso anda até o mês corrente.
          // Indeterminado: nenhuma — só volta a Renovações se agendado.
          expectedRenewalAt: indeterminado
            ? null
            : rollForward(
                addCalendarMonths(client.expectedRenewalAt ?? civilToday(today), months),
                months,
                today
              ),
          // Normalização por modalidade — a MESMA regra do saveClient:
          // MRR zera o valor total; TCV zera mensalidade e dia recorrente.
          ...(staysMonthly
            ? {
                modality: "MRR" as const,
                monthlyValue: monthly,
                paymentDay,
                totalContractValue: null,
              }
            : {
                modality: "TCV" as const,
                totalContractValue: total,
                monthlyValue: null,
                paymentDay: null,
              }),
        },
      })
    );
    writes.push(
      prisma.clientRenewal.create({
        data: {
          clientId,
          contractId: contract?.id ?? null,
          months: indeterminado ? null : months,
          totalValue: total,
          monthlyValue: monthly,
          modality: staysMonthly ? "MRR" : "TCV",
          paymentMethod,
          previousEndDate,
          newEndDate: newEnd,
          billingMonth: launch ? comp.month : null,
          billingYear: launch ? comp.year : null,
          keptMonthly: staysMonthly,
          expectedCompetence,
          expectedValue,
          paymentStatus: launch ? payStatus : null,
          notes: details,
          createdBy: domainActor(ctx).email,
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
          clientId, comp.month, comp.year, domainActor(ctx).email ?? undefined
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
        // Idempotência do lançamento TCV: reusa APENAS cobrança que nasceu de
        // renovação (descrição "Renovação — …") com o mesmo valor nesta
        // competência — repetição do fluxo não cria segunda cobrança cheia.
        // O filtro de descrição é essencial: sem ele, a cobrança de ADESÃO
        // TCV do mesmo valor no mesmo mês seria "reusada" e o ciclo renovado
        // nunca seria faturado (revisão adversarial 2026-08-13).
        const existingTcv = await prisma.billing.findFirst({
          where: {
            clientId,
            competenceMonth: comp.month,
            competenceYear: comp.year,
            revenueType: "TCV",
            status: { not: "CANCELED" },
            amount: total,
            description: { startsWith: "Renovação — " },
          },
          select: { id: true },
        });
        if (existingTcv) {
          billingId = existingTcv.id;
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
      }

      if (billingId) {
        await prisma.clientRenewal.update({
          where: { id: renewal.id },
          data: { billingId },
        });
      }

      // Situação do pagamento informada na renovação (total/parcial).
      if (billingId && payStatus !== "aberto") {
        if (!domainCan(ctx, "recebimentos.registrar_pagamento")) {
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
            const settled = await settleViaEngine({
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
    return { ok: true, id: renewal.id, renewalId: renewal.id, clientId, contractId: contract?.id ?? null, ...(warning ? { warning } : {}) };
  });
}
