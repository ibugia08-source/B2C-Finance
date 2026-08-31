"use server";
import { prisma } from "@/lib/prisma";
import { revalidateAgency, revalidateFinance } from "@/lib/revalidate";
import { z } from "zod";
import {
  BillingStatus,
  CollectionStatus,
  PaymentMethod,
  RevenueType,
} from "@prisma/client";
import { tryPermission, NO_PERMISSION } from "@/lib/auth/viewer";
import { formatBRL, parseBRL, parseDateBR, toNumber as n, clean } from "@/lib/format";
import type { ActionResult } from "./clients";


function revalidateBilling(clientId?: string) {
  revalidateAgency({ clientId });
}

// ---------- Criação / edição manual ----------

const BillingSchema = z.object({
  id: z.string().optional(),
  clientId: z.string().min(1, "Selecione o cliente."),
  contractId: z.string().nullable(),
  serviceId: z.string().nullable(),
  description: z.string().trim().min(1, "Descreva a cobrança."),
  competenceMonth: z.number().int().min(1).max(12),
  competenceYear: z.number().int().min(2000).max(2100),
  amount: z.number().positive("Valor deve ser maior que zero."),
  dueDate: z.date({ invalid_type_error: "Informe o vencimento." }),
  revenueType: z.nativeEnum(RevenueType),
  collector: z.string().trim().nullable(),
  notes: z.string().trim().nullable(),
});

export async function saveBilling(formData: FormData): Promise<ActionResult> {
  if (!(await tryPermission("recebimentos.editar"))) return NO_PERMISSION;
  try {
    const comp = clean(formData.get("competence")) ?? ""; // "YYYY-MM"
    const [cy, cm] = comp.split("-").map(Number);
    const parsed = BillingSchema.parse({
      id: clean(formData.get("id")) ?? undefined,
      clientId: String(formData.get("clientId") ?? ""),
      contractId: clean(formData.get("contractId")),
      serviceId: clean(formData.get("serviceId")),
      description: String(formData.get("description") ?? "").trim(),
      competenceMonth: cm || new Date().getMonth() + 1,
      competenceYear: cy || new Date().getFullYear(),
      amount: parseBRL(String(formData.get("amount") ?? "0")),
      dueDate: parseDateBR(String(formData.get("dueDate") ?? "")) ?? (undefined as any),
      revenueType: (clean(formData.get("revenueType")) ?? "MRR") as RevenueType,
      collector: clean(formData.get("collector")),
      notes: clean(formData.get("notes")),
    });

    const owned = await prisma.client.findFirst({
      where: { id: parsed.clientId },
      select: { id: true },
    });
    if (!owned) return { ok: false, error: "Cliente não encontrado." };

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const { id, ...data } = parsed;

    // Uma mensalidade (MRR) viva por competência — mesma invariante do
    // índice único do banco; checa antes para o erro ser de negócio, não
    // o P2002 cru do Prisma.
    if (data.revenueType === "MRR") {
      const dup = await prisma.billing.findFirst({
        where: {
          clientId: data.clientId,
          competenceMonth: data.competenceMonth,
          competenceYear: data.competenceYear,
          revenueType: "MRR",
          status: { not: "CANCELED" },
          ...(id ? { id: { not: id } } : {}),
        },
        select: { id: true },
      });
      if (dup)
        return {
          ok: false,
          error: `Este cliente já tem a mensalidade de ${String(data.competenceMonth).padStart(2, "0")}/${data.competenceYear} — edite a cobrança existente ou registre como Avulsa.`,
        };
    }

    let billingId = id;
    if (billingId) {
      const existing = await prisma.billing.findUnique({ where: { id: billingId } });
      if (!existing) return { ok: false, error: "Cobrança não encontrada." };
      if (existing.status === "PAID") {
        return { ok: false, error: "Cobrança quitada não pode ser editada." };
      }
      // Reavalia vencida/pendente ao trocar o vencimento (mantém PARTIAL).
      const status =
        existing.status === "PARTIAL"
          ? "PARTIAL"
          : data.dueDate < today
            ? "OVERDUE"
            : "PENDING";
      await prisma.billing.update({ where: { id: billingId }, data: { ...data, status } });
    } else {
      const created = await prisma.billing.create({
        data: { ...data, status: data.dueDate < today ? "OVERDUE" : "PENDING" },
      });
      billingId = created.id;
      await prisma.collectionHistory.create({
        data: { billingId, clientId: data.clientId, status: "NOT_CONTACTED", message: "Cobrança criada manualmente." },
      });
    }

    revalidateBilling(parsed.clientId);
    return { ok: true, id: billingId };
  } catch (e: any) {
    if (e?.code === "P2002")
      return {
        ok: false,
        error:
          "Este cliente já tem mensalidade nesta competência — edite a cobrança existente ou registre como Avulsa.",
      };
    return {
      ok: false,
      error: e?.issues?.[0]?.message ?? e?.message ?? "Falha ao salvar a cobrança.",
    };
  }
}

// ---------- Pagamento (total ou parcial) ----------

const PaymentSchema = z.object({
  billingId: z.string().min(1),
  amount: z.number().positive("Valor deve ser maior que zero."),
  paidAt: z.date(),
  method: z.nativeEnum(PaymentMethod),
  accountId: z.string().nullable(),
  notes: z.string().trim().nullable(),
});

export async function registerBillingPayment(
  formData: FormData
): Promise<ActionResult> {
  if (!(await tryPermission("recebimentos.registrar_pagamento"))) return NO_PERMISSION;
  try {
    const parsed = PaymentSchema.parse({
      billingId: String(formData.get("billingId") ?? ""),
      amount: parseBRL(String(formData.get("amount") ?? "0")),
      paidAt: parseDateBR(String(formData.get("paidAt") ?? "")) ?? new Date(),
      method: (clean(formData.get("method")) ?? "PIX") as PaymentMethod,
      accountId: clean(formData.get("accountId")),
      notes: clean(formData.get("notes")),
    });

    // 03 §4.1: nenhuma action toca fato contábil direto. A permissão, a
    // guarda de período e a de idempotência ficam no motor — aqui só chega
    // o que já passou por elas.
    const { settleBilling: settleViaEngine } = await import("@/lib/engines/payment-engine");
    const result = await settleViaEngine(parsed);
    if (!result.ok) return result;

    revalidateBilling(result.clientId);
    revalidateFinance(); // pagamento gera Receita Extra (Income)
    // F1.8 — o texto é o da Camada de Simplicidade (02 §1), palavra por
    // palavra: nada de "excedente", "CustomerCredit" ou qualquer termo de
    // arquitetura na tela.
    return result.creditGenerated > 0
      ? {
          ok: true,
          warning: `${formatBRL(result.creditGenerated)} ficaram como crédito para a próxima cobrança.`,
        }
      : { ok: true };
  } catch (e: any) {
    return {
      ok: false,
      error: e?.issues?.[0]?.message ?? e?.message ?? "Falha ao registrar o pagamento.",
    };
  }
}

// ---------- Pagamento em 1 clique + Desfazer (gesto da planilha) ----------

/** Marcador que identifica pagamentos feitos pelo gesto de 1 clique. */
const QUICK_SETTLE_NOTE = "Pago com 1 clique (Gestão do Mês).";
/** Janela em que o próprio gesto pode ser desfeito sem permissão de exclusão. */
const QUICK_UNDO_WINDOW_MS = 15 * 60 * 1000;

/**
 * PAGO em 1 clique: quita o saldo em aberto da cobrança.
 * - Competência do mês corrente/futuro → data de HOJE.
 * - Competência PASSADA → data do VENCIMENTO (backfill "pagou em dia",
 *   como preencher a célula verde da planilha do mês antigo). Quem pagou
 *   atrasado de verdade usa o dialog $ com a data real.
 * Retorna o id do PAGAMENTO em `id` para o toast "Desfazer".
 */
export async function quickSettleBilling(billingId: string): Promise<ActionResult> {
  if (!(await tryPermission("recebimentos.registrar_pagamento"))) return NO_PERMISSION;
  try {
    const b = await prisma.billing.findUnique({ where: { id: billingId } });
    if (!b) return { ok: false, error: "Cobrança não encontrada." };
    if (b.status === "CANCELED")
      return { ok: false, error: "Cobrança removida do mês — recoloque-a antes." };
    if (b.status === "PAID") return { ok: false, error: "Cobrança já quitada." };
    const open = n(b.amount) - n(b.paidTotal);
    if (open <= 0) return { ok: false, error: "Sem saldo em aberto." };

    const now = new Date();
    const compKey = b.competenceYear * 12 + (b.competenceMonth - 1);
    const nowKey = now.getFullYear() * 12 + now.getMonth();
    const paidAt = compKey < nowKey ? b.dueDate : now;

    const { settleBilling: settleViaEngine } = await import("@/lib/engines/payment-engine");
    const res = await settleViaEngine({
      billingId: b.id,
      amount: open,
      paidAt,
      method: "OTHER",
      accountId: null,
      notes: QUICK_SETTLE_NOTE,
    });
    if (!res.ok) return res;

    revalidateBilling(res.clientId);
    revalidateFinance(); // pagamento cria Income de conciliação
    return { ok: true, id: res.paymentId };
  } catch (e: any) {
    return { ok: false, error: e?.message ?? "Falha ao registrar o pagamento." };
  }
}

/**
 * Desfaz o pagamento recém-feito pelo 1 clique (botão "Desfazer" do toast).
 * Restrito ao próprio gesto: só pagamentos com o marcador de 1 clique e
 * dentro da janela de 15 minutos — exclusões além disso continuam na aba
 * Pagamentos do cliente, com a permissão de excluir.
 */
export async function undoQuickSettle(paymentId: string): Promise<ActionResult> {
  if (!(await tryPermission("recebimentos.registrar_pagamento"))) return NO_PERMISSION;
  try {
    const p = await prisma.payment.findUnique({ where: { id: paymentId } });
    if (!p) return { ok: false, error: "Pagamento não encontrado." };
    if (p.notes !== QUICK_SETTLE_NOTE)
      return {
        ok: false,
        error: "Só o pagamento de 1 clique pode ser desfeito por aqui.",
      };
    if (Date.now() - p.createdAt.getTime() > QUICK_UNDO_WINDOW_MS)
      return {
        ok: false,
        error:
          "Janela de desfazer expirou — exclua o pagamento na ficha do cliente (aba Pagamentos).",
      };

    const { revertPayment } = await import("@/lib/engines/payment-engine");
    // O motivo é obrigatório na trilha (01 §4.10). Aqui ele é conhecido: o
    // usuário clicou "Desfazer" no toast do próprio gesto, dentro da janela.
    const res = await revertPayment(paymentId, "Desfazer do gesto de 1 clique");
    if (!res.ok) return res;

    revalidateBilling(res.clientId);
    revalidateFinance();
    return { ok: true };
  } catch (e: any) {
    return { ok: false, error: e?.message ?? "Falha ao desfazer o pagamento." };
  }
}

// ---------- Incluir cliente no mês (histórico e ciclo) ----------

const IncludeClientSchema = z.object({
  clientId: z.string().min(1, "Selecione o cliente."),
  contractId: z.string().nullable(),
  competenceMonth: z.number().int().min(1).max(12),
  competenceYear: z.number().int().min(2000).max(2100),
  amount: z.number().positive("Valor deve ser maior que zero."),
  dueDate: z.date({ invalid_type_error: "Informe o vencimento." }),
  description: z.string().trim().min(1),
  paid: z.boolean(),
  paidAt: z.date().nullable(),
  paidAmount: z.number().positive().nullable(),
  method: z.nativeEnum(PaymentMethod),
  accountId: z.string().nullable(),
});

/**
 * Inclui um cliente da base no ciclo de um mês (qualquer competência,
 * inclusive PASSADA — é o caminho oficial de preenchimento de histórico).
 * Diferente da cobrança manual, os dados vêm do CADASTRO do cliente:
 * valor (mensalidade MRR ou total TCV), vencimento (paymentDay) e descrição
 * são recalculados no servidor quando não informados. Opcionalmente já
 * registra o pagamento (data retroativa) no mesmo passo, via núcleo contábil.
 * Se o cliente foi "removido do mês" (marcador CANCELED), restaura o marcador
 * em vez de duplicar — consistente com ensureMonthlyBillings.
 */
export async function includeClientInMonth(formData: FormData): Promise<ActionResult> {
  const viewer = await tryPermission("recebimentos.editar");
  if (!viewer) return NO_PERMISSION;
  try {
    const comp = clean(formData.get("competence")) ?? ""; // "YYYY-MM"
    const [cy, cm] = comp.split("-").map(Number);
    const paid = formData.get("paid") === "true";
    if (paid && !(await tryPermission("recebimentos.registrar_pagamento")))
      return NO_PERMISSION;

    const client = await prisma.client.findFirst({
      where: { id: String(formData.get("clientId") ?? "") },
      select: {
        id: true,
        name: true,
        modality: true,
        monthlyValue: true,
        totalContractValue: true,
        paymentDay: true,
      },
    });
    if (!client) return { ok: false, error: "Cliente não encontrado." };

    const revenueType: RevenueType = client.modality === "TCV" ? "TCV" : "MRR";
    const registeredValue =
      revenueType === "TCV" ? n(client.totalContractValue) : n(client.monthlyValue);

    const { getValidDueDateForMonth } = await import("@/lib/financial/due-date");
    const fallbackDue =
      cy && cm ? getValidDueDateForMonth(cy, cm, client.paymentDay) : new Date();
    const compLabel = `${String(cm).padStart(2, "0")}/${cy}`;

    const parsed = IncludeClientSchema.parse({
      clientId: client.id,
      contractId: clean(formData.get("contractId")),
      competenceMonth: cm,
      competenceYear: cy,
      amount: parseBRL(String(formData.get("amount") ?? "0")) || registeredValue,
      dueDate: parseDateBR(String(formData.get("dueDate") ?? "")) ?? fallbackDue,
      description:
        clean(formData.get("description")) ??
        (revenueType === "TCV" ? `Contrato — ${compLabel}` : `Mensalidade — ${compLabel}`),
      paid,
      paidAt: paid ? parseDateBR(String(formData.get("paidAt") ?? "")) : null,
      paidAmount: paid ? parseBRL(String(formData.get("paidAmount") ?? "0")) || null : null,
      method: (clean(formData.get("method")) ?? "PIX") as PaymentMethod,
      accountId: clean(formData.get("accountId")),
    });

    // Já incluído neste mês? (cobrança viva com o mesmo tipo de receita)
    const existing = await prisma.billing.findFirst({
      where: {
        clientId: client.id,
        competenceMonth: parsed.competenceMonth,
        competenceYear: parsed.competenceYear,
        revenueType,
        status: { not: "CANCELED" },
      },
      select: { id: true },
    });
    if (existing) {
      return {
        ok: false,
        error: `${client.name} já está incluído em ${compLabel}. Use a ação $ da linha para registrar o pagamento.`,
      };
    }

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const openStatus: BillingStatus = parsed.dueDate < today ? "OVERDUE" : "PENDING";

    // Removido do mês? Restaura o marcador CANCELED em vez de duplicar.
    const canceledMarker = await prisma.billing.findFirst({
      where: {
        clientId: client.id,
        competenceMonth: parsed.competenceMonth,
        competenceYear: parsed.competenceYear,
        revenueType,
        status: "CANCELED",
      },
      select: { id: true },
    });

    let billingId: string;
    if (canceledMarker) {
      await prisma.billing.update({
        where: { id: canceledMarker.id },
        data: {
          amount: parsed.amount,
          dueDate: parsed.dueDate,
          description: parsed.description,
          contractId: parsed.contractId,
          status: openStatus,
          canceledAt: null,
          canceledBy: null,
          cancelReason: null,
        },
      });
      billingId = canceledMarker.id;
    } else {
      const created = await prisma.billing.create({
        data: {
          clientId: client.id,
          contractId: parsed.contractId,
          description: parsed.description,
          competenceMonth: parsed.competenceMonth,
          competenceYear: parsed.competenceYear,
          amount: parsed.amount,
          dueDate: parsed.dueDate,
          revenueType,
          status: openStatus,
        },
      });
      billingId = created.id;
    }
    await prisma.collectionHistory.create({
      data: {
        billingId,
        clientId: client.id,
        status: "NOT_CONTACTED",
        message: `${canceledMarker ? "Recolocado" : "Incluído"} no mês ${compLabel} por ${viewer.email}.`,
      },
    });

    // Pagamento no mesmo passo (histórico): data livre, núcleo contábil cuida
    // de atraso/mês diferente e do Income de conciliação.
    if (parsed.paid) {
      const { settleBilling: settleViaEngine } = await import("@/lib/engines/payment-engine");
      const result = await settleViaEngine({
        billingId,
        amount: parsed.paidAmount ?? parsed.amount,
        paidAt: parsed.paidAt ?? parsed.dueDate,
        method: parsed.method,
        accountId: parsed.accountId,
        notes: null,
      });
      revalidateBilling(client.id);
      if (!result.ok) {
        return {
          ok: true,
          id: billingId,
          warning: `Cobrança incluída em ${compLabel}, mas o pagamento não foi registrado: ${result.error}`,
        };
      }
      revalidateFinance();
      return { ok: true, id: billingId };
    }

    revalidateBilling(client.id);
    return { ok: true, id: billingId };
  } catch (e: any) {
    return {
      ok: false,
      error: e?.issues?.[0]?.message ?? e?.message ?? "Falha ao incluir o cliente no mês.",
    };
  }
}

/**
 * Registra o pagamento de VÁRIAS cobranças de uma vez (backfill de meses
 * passados): quita o saldo em aberto de cada uma, com data única ou o
 * vencimento de cada cobrança ("pagaram em dia"). Cada quitação usa o núcleo
 * contábil (atômica por item); pulos e falhas viram warning — nunca sucesso
 * silencioso.
 */
export async function registerBillingPaymentsBulk(
  ids: string[],
  opts: { mode: "due" | "single"; paidAt?: string; method: string; accountId?: string | null }
): Promise<ActionResult> {
  if (!(await tryPermission("recebimentos.registrar_pagamento"))) return NO_PERMISSION;
  try {
    const unique = Array.from(new Set(ids.filter(Boolean)));
    if (unique.length === 0) return { ok: false, error: "Nenhuma cobrança selecionada." };

    const method = (
      Object.values(PaymentMethod).includes(opts.method as PaymentMethod)
        ? opts.method
        : "PIX"
    ) as PaymentMethod;
    const singleDate = opts.mode === "single" ? parseDateBR(opts.paidAt ?? "") : null;
    if (opts.mode === "single" && !singleDate) {
      return { ok: false, error: "Informe a data do pagamento." };
    }

    const billings = await prisma.billing.findMany({
      where: { id: { in: unique } },
      select: {
        id: true,
        clientId: true,
        status: true,
        amount: true,
        paidTotal: true,
        dueDate: true,
      },
    });
    const payable = billings.filter(
      (b) =>
        b.status !== "CANCELED" &&
        b.status !== "PAID" &&
        n(b.amount) - n(b.paidTotal) > 0
    );
    if (payable.length === 0) {
      return {
        ok: false,
        error: "As cobranças selecionadas já estão quitadas ou removidas do mês.",
      };
    }
    const skipped = billings.length - payable.length;

    // Pagamento em massa: cada linha passa pelo motor, com as mesmas
    // guardas. Uma falha não derruba as outras — o resumo diz quantas.
    const { settleBilling: settleViaEngine } = await import("@/lib/engines/payment-engine");
    const affectedClients = new Set<string>();
    const failures: string[] = [];
    for (const b of payable) {
      const result = await settleViaEngine({
        billingId: b.id,
        amount: n(b.amount) - n(b.paidTotal),
        paidAt: opts.mode === "due" ? b.dueDate : singleDate!,
        method,
        accountId: opts.accountId ?? null,
        notes: null,
      });
      if (result.ok) affectedClients.add(result.clientId);
      else failures.push(result.error);
    }

    if (affectedClients.size === 0) {
      return { ok: false, error: failures[0] ?? "Falha ao registrar os pagamentos." };
    }
    for (const clientId of affectedClients) revalidateBilling(clientId);
    revalidateFinance();

    const paidCount = payable.length - failures.length;
    const notes: string[] = [];
    if (skipped > 0) notes.push(`${skipped} ignorada${skipped === 1 ? "" : "s"} (quitada ou removida)`);
    if (failures.length > 0) notes.push(`${failures.length} ${failures.length === 1 ? "falhou" : "falharam"} (${failures[0]})`);
    if (notes.length > 0) {
      return {
        ok: true,
        warning: `${paidCount} pagamento${paidCount === 1 ? "" : "s"} registrado${paidCount === 1 ? "" : "s"}; ${notes.join("; ")}.`,
      };
    }
    return { ok: true };
  } catch (e: any) {
    return { ok: false, error: e?.message ?? "Falha ao registrar os pagamentos." };
  }
}

// ---------- Ciclo de vida ----------

/**
 * Remove a cobrança do ciclo do MÊS (não apaga o cliente nem o cadastro):
 * status CANCELED + auditoria (quem/quando/por quê). A geração automática
 * nunca recria uma cobrança removida.
 */
export async function cancelBilling(
  id: string,
  reason?: string | null
): Promise<ActionResult> {
  const viewer = await tryPermission("recebimentos.excluir");
  if (!viewer) return NO_PERMISSION;
  try {
    const b = await prisma.billing.findUnique({ where: { id } });
    if (!b) return { ok: false, error: "Cobrança não encontrada." };
    if (b.status === "PAID")
      return { ok: false, error: "Cobrança quitada não pode ser removida do mês." };
    const cleanReason = (reason ?? "").trim() || null;
    await prisma.billing.update({
      where: { id },
      data: {
        status: "CANCELED",
        canceledAt: new Date(),
        canceledBy: viewer.email,
        cancelReason: cleanReason,
      },
    });
    await prisma.collectionHistory.create({
      data: {
        billingId: id,
        clientId: b.clientId,
        status: b.collectionStatus,
        message: `Removida do ciclo de ${String(b.competenceMonth).padStart(2, "0")}/${b.competenceYear} por ${viewer.email}.${cleanReason ? ` Motivo: ${cleanReason}` : ""}`,
      },
    });
    revalidateBilling(b.clientId);
    return { ok: true };
  } catch (e: any) {
    return { ok: false, error: e?.message ?? "Falha ao remover a cobrança do mês." };
  }
}

/**
 * Exclusão em massa (soft-delete auditado) das cobranças selecionadas na aba
 * Recebimentos do cliente. Mesma semântica de `cancelBilling`: status CANCELED
 * + auditoria, sem apagar cliente/contrato/pagamento. Cobranças quitadas (PAID)
 * são ignoradas — o dinheiro já entrou — e as já canceladas também (não
 * sobrescreve auditoria nem duplica histórico); os pulos são reportados no
 * `warning`. Sem query em loop (updateMany/createMany numa transação).
 */
export async function cancelBillingsBulk(
  ids: string[],
  reason?: string | null
): Promise<ActionResult> {
  const viewer = await tryPermission("recebimentos.excluir");
  if (!viewer) return NO_PERMISSION;
  try {
    const unique = Array.from(new Set(ids.filter(Boolean)));
    if (unique.length === 0) return { ok: false, error: "Nenhuma cobrança selecionada." };

    const billings = await prisma.billing.findMany({
      where: { id: { in: unique } },
      select: {
        id: true,
        clientId: true,
        status: true,
        collectionStatus: true,
        competenceMonth: true,
        competenceYear: true,
      },
    });
    const removable = billings.filter(
      (b) => b.status !== "PAID" && b.status !== "CANCELED"
    );
    if (removable.length === 0) {
      return {
        ok: false,
        error:
          "Nenhuma das cobranças selecionadas pode ser excluída (já estão quitadas ou canceladas).",
      };
    }
    const skippedPaid = billings.filter((b) => b.status === "PAID").length;
    const skippedCanceled = billings.filter((b) => b.status === "CANCELED").length;

    const cleanReason = (reason ?? "").trim() || null;
    const now = new Date();
    await prisma.$transaction([
      prisma.billing.updateMany({
        where: { id: { in: removable.map((b) => b.id) } },
        data: {
          status: "CANCELED",
          canceledAt: now,
          canceledBy: viewer.email,
          cancelReason: cleanReason,
        },
      }),
      prisma.collectionHistory.createMany({
        data: removable.map((b) => ({
          billingId: b.id,
          clientId: b.clientId,
          status: b.collectionStatus,
          actionType: "DELETED",
          createdBy: viewer.email,
          message: `Excluída (em massa) do ciclo de ${String(b.competenceMonth).padStart(2, "0")}/${b.competenceYear} por ${viewer.email}.${cleanReason ? ` Motivo: ${cleanReason}` : ""}`,
        })),
      }),
    ]);

    const affectedClients = Array.from(new Set(removable.map((b) => b.clientId)));
    for (const clientId of affectedClients) revalidateBilling(clientId);

    const skips: string[] = [];
    if (skippedPaid > 0)
      skips.push(`${skippedPaid} quitada${skippedPaid === 1 ? "" : "s"} (o dinheiro já entrou)`);
    if (skippedCanceled > 0)
      skips.push(`${skippedCanceled} já cancelada${skippedCanceled === 1 ? "" : "s"}`);
    if (skips.length > 0) {
      return {
        ok: true,
        warning: `${removable.length} cobrança${removable.length === 1 ? "" : "s"} excluída${removable.length === 1 ? "" : "s"}; ignorada${skippedPaid + skippedCanceled === 1 ? "" : "s"}: ${skips.join(" e ")}.`,
      };
    }
    return { ok: true };
  } catch (e: any) {
    return { ok: false, error: e?.message ?? "Falha ao excluir as cobranças." };
  }
}

/** Recoloca no ciclo do mês uma cobrança removida por engano. */
export async function restoreBilling(id: string): Promise<ActionResult> {
  const viewer = await tryPermission("recebimentos.excluir");
  if (!viewer) return NO_PERMISSION;
  try {
    const b = await prisma.billing.findUnique({ where: { id } });
    if (!b) return { ok: false, error: "Cobrança não encontrada." };
    if (b.status !== "CANCELED")
      return { ok: false, error: "A cobrança não está removida do mês." };

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const status =
      n(b.paidTotal) > 0 ? "PARTIAL" : b.dueDate < today ? "OVERDUE" : "PENDING";
    await prisma.billing.update({
      where: { id },
      data: { status, canceledAt: null, canceledBy: null, cancelReason: null },
    });
    await prisma.collectionHistory.create({
      data: {
        billingId: id,
        clientId: b.clientId,
        status: b.collectionStatus,
        message: `Recolocada no ciclo de ${String(b.competenceMonth).padStart(2, "0")}/${b.competenceYear} por ${viewer.email}.`,
      },
    });
    revalidateBilling(b.clientId);
    return { ok: true };
  } catch (e: any) {
    return { ok: false, error: e?.message ?? "Falha ao recolocar a cobrança no mês." };
  }
}

/**
 * Registra no histórico que a mensagem de cobrança foi enviada/copiada
 * (WhatsApp aberto ou texto copiado) e marca o cliente como contatado.
 */
export async function registerBillingContact(
  billingId: string,
  channel: "whatsapp" | "copia",
  excerpt: string
): Promise<ActionResult> {
  if (!(await tryPermission("recebimentos.gerar_cobranca"))) return NO_PERMISSION;
  try {
    const b = await prisma.billing.findUnique({ where: { id: billingId } });
    if (!b) return { ok: false, error: "Cobrança não encontrada." };
    await prisma.collectionHistory.create({
      data: {
        billingId: b.id,
        clientId: b.clientId,
        status: "CONTACTED",
        channel,
        message:
          channel === "whatsapp"
            ? `Cobrança enviada via WhatsApp: "${excerpt.slice(0, 180)}…"`
            : `Mensagem de cobrança copiada: "${excerpt.slice(0, 180)}…"`,
      },
    });
    if (b.collectionStatus === "NOT_CONTACTED") {
      await prisma.billing.update({
        where: { id: b.id },
        data: { collectionStatus: "CONTACTED" },
      });
    }
    revalidateBilling(b.clientId);
    return { ok: true };
  } catch (e: any) {
    return { ok: false, error: e?.message ?? "Falha ao registrar o contato." };
  }
}

/** Reagenda o vencimento (registra no histórico; reavalia OVERDUE). */
export async function rescheduleBilling(
  id: string,
  formData: FormData
): Promise<ActionResult> {
  if (!(await tryPermission("recebimentos.alterar_vencimento"))) return NO_PERMISSION;
  try {
    const newDue = parseDateBR(String(formData.get("dueDate") ?? ""));
    if (!newDue) return { ok: false, error: "Informe a nova data de vencimento." };
    const b = await prisma.billing.findUnique({ where: { id } });
    if (!b) return { ok: false, error: "Cobrança não encontrada." };
    if (b.status === "PAID" || b.status === "CANCELED")
      return { ok: false, error: "Cobrança encerrada não pode ser reagendada." };

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    await prisma.billing.update({
      where: { id },
      data: {
        dueDate: newDue,
        status:
          n(b.paidTotal) > 0 ? "PARTIAL" : newDue < today ? "OVERDUE" : "PENDING",
      },
    });
    await prisma.collectionHistory.create({
      data: {
        billingId: id,
        clientId: b.clientId,
        status: b.collectionStatus,
        message: `Vencimento reagendado para ${newDue.toLocaleDateString("pt-BR")}.`,
      },
    });
    revalidateBilling(b.clientId);
    return { ok: true };
  } catch (e: any) {
    return { ok: false, error: e?.message ?? "Falha ao reagendar." };
  }
}

// ---------- Interações de cobrança (observação / promessa) ----------

const NoteSchema = z.object({
  billingId: z.string().min(1),
  status: z.nativeEnum(CollectionStatus),
  channel: z.string().trim().nullable(),
  message: z.string().trim().min(1, "Escreva a observação."),
  nextActionAt: z.date().nullable(),
});

export async function addCollectionNote(formData: FormData): Promise<ActionResult> {
  if (!(await tryPermission("recebimentos.gerar_cobranca"))) return NO_PERMISSION;
  try {
    const parsed = NoteSchema.parse({
      billingId: String(formData.get("billingId") ?? ""),
      status: (clean(formData.get("status")) ?? "CONTACTED") as CollectionStatus,
      channel: clean(formData.get("channel")),
      message: String(formData.get("message") ?? "").trim(),
      nextActionAt: (() => {
        const raw = clean(formData.get("nextActionAt"));
        return raw == null ? null : parseDateBR(raw);
      })(),
    });

    const b = await prisma.billing.findUnique({ where: { id: parsed.billingId } });
    if (!b) return { ok: false, error: "Cobrança não encontrada." };

    await prisma.collectionHistory.create({
      data: {
        billingId: b.id,
        clientId: b.clientId,
        status: parsed.status,
        channel: parsed.channel,
        message: parsed.message,
        nextActionAt: parsed.nextActionAt,
      },
    });
    await prisma.billing.update({
      where: { id: b.id },
      data: { collectionStatus: parsed.status },
    });

    revalidateBilling(b.clientId);
    return { ok: true };
  } catch (e: any) {
    return {
      ok: false,
      error: e?.issues?.[0]?.message ?? e?.message ?? "Falha ao registrar a observação.",
    };
  }
}
