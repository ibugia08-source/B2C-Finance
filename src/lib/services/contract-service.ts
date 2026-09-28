import { z } from "zod";
import { ContractStatus, ContractType, RecurrenceType } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { type DomainContext, type DomainResult, inDomain } from "@/lib/engines/domain";

/**
 * CONTRATOS — regra de domínio (extraída de actions/contracts.ts em
 * 28/09/2026, sem mudança de comportamento): modalidade define a forma do
 * dinheiro (TCV = valor CHEIO único, sem recorrência nem rateio; MRR deriva
 * total⇄mensal pelo prazo), cliente do dono, serviços do contrato, encerrar e
 * cancelar (cancelar tira dos recebimentos as mensalidades FUTURAS sem
 * pagamento). Renovação: engines/renewal-engine. Não invalida cache.
 */

/** Meses de vigência (inclusivo por mês). */
function countMonths(start: Date, end: Date): number {
  return (
    (end.getFullYear() - start.getFullYear()) * 12 +
    (end.getMonth() - start.getMonth()) +
    1
  );
}

export const ContractInputSchema = z.object({
  id: z.string().optional(),
  clientId: z.string().min(1, "Selecione o cliente."),
  title: z.string().trim().min(1, "Informe o título do contrato."),
  type: z.nativeEnum(ContractType),
  status: z.nativeEnum(ContractStatus),
  recurrence: z.nativeEnum(RecurrenceType),
  monthlyValue: z.number().nonnegative(),
  totalValue: z.number().nonnegative(),
  setupFee: z.number().nonnegative().nullable(),
  startDate: z.date({ invalid_type_error: "Informe a data de início." }),
  endDate: z.date().nullable(),
  renewalDate: z.date().nullable(),
  billingDay: z.number().int().min(1, "Dia entre 1 e 31.").max(31, "Dia entre 1 e 31."),
  autoRenew: z.boolean().default(false),
  notes: z.string().trim().nullable(),
  services: z
    .array(z.object({ serviceId: z.string(), unitPrice: z.number().nonnegative() }))
    .default([]),
});
export type ContractInput = z.input<typeof ContractInputSchema>;

/** Cria (sem `id`) ou edita (com `id`) um contrato. */
export async function salvarContrato(
  ctx: DomainContext,
  input: ContractInput
): Promise<DomainResult<{ clientId?: string }>> {
  const parsed = ContractInputSchema.parse(input);
  return inDomain(ctx, async () => {
      if (parsed.endDate && parsed.endDate < parsed.startDate) {
        return { ok: false, error: "Data de fim anterior ao início." };
      }

      // ===== Modalidade define a forma do dinheiro =====
      // TCV = valor CHEIO único: sem recorrência, sem mensal derivado, sem rateio.
      //       A cobrança entra uma única vez no mês da venda/renovação.
      // MRR = mensal recorrente: deriva total⇄mensal pelo prazo quando faltar um
      //       (ex.: R$ 5.100 / 3 meses → 1.700/mês).
      let { monthlyValue, totalValue } = parsed;
      let recurrence = parsed.recurrence;
      if (parsed.type === "TCV") {
        recurrence = "NONE"; // trava anti-rateio: TCV nunca gera cobrança mensal
        monthlyValue = 0; // TCV não tem mensalidade recorrente
      } else if (parsed.endDate) {
        const months = countMonths(parsed.startDate, parsed.endDate);
        if (totalValue === 0 && monthlyValue > 0) totalValue = monthlyValue * months;
        else if (monthlyValue === 0 && totalValue > 0)
          monthlyValue = Number((totalValue / months).toFixed(2));
      } else if (totalValue === 0 && monthlyValue > 0) {
        totalValue = monthlyValue * 12; // MRR sem fim: total anualizado de referência
      }

      // Cliente pertence ao dono atual? (findFirst é escopado)
      const owned = await prisma.client.findFirst({
        where: { id: parsed.clientId },
        select: { id: true },
      });
      if (!owned) return { ok: false, error: "Cliente não encontrado." };

      const data = {
        clientId: parsed.clientId,
        title: parsed.title,
        type: parsed.type,
        status: parsed.status,
        recurrence,
        monthlyValue,
        totalValue,
        setupFee: parsed.setupFee,
        startDate: parsed.startDate,
        endDate: parsed.endDate,
        renewalDate: parsed.renewalDate,
        billingDay: parsed.billingDay,
        autoRenew: parsed.autoRenew,
        notes: parsed.notes,
      };

      let contractId = parsed.id;
      if (contractId) {
        const existing = await prisma.contract.findUnique({ where: { id: contractId } });
        if (!existing) return { ok: false, error: "Contrato não encontrado." };
        await prisma.contract.update({
          where: { id: contractId },
          data: {
            ...data,
            canceledAt:
              parsed.status === "CANCELED" ? existing.canceledAt ?? new Date() : null,
          },
        });
        await prisma.contractService.deleteMany({ where: { contractId } });
      } else {
        const created = await prisma.contract.create({ data });
        contractId = created.id;
      }
      if (parsed.services.length > 0) {
        await prisma.contractService.createMany({
          data: parsed.services.map((s) => ({
            contractId: contractId!,
            serviceId: s.serviceId,
            unitPrice: s.unitPrice,
          })),
        });
      }
    return { ok: true, id: contractId, clientId: parsed.clientId };
  });
}

/** Encerra o contrato (fim natural da vigência). */
export async function encerrarContrato(ctx: DomainContext, id: string): Promise<DomainResult<{ clientId?: string }>> {
  return inDomain(ctx, async () => {
      const c = await prisma.contract.findUnique({ where: { id } });
      if (!c) return { ok: false, error: "Contrato não encontrado." };
      await prisma.contract.update({
        where: { id },
        data: { status: "ENDED", endDate: c.endDate ?? new Date() },
      });
    return { ok: true, clientId: c.clientId };
  });
}

/** Cancela o contrato (interrupção antes do fim) e tira as mensalidades futuras sem pagamento. */
export async function cancelarContrato(ctx: DomainContext, id: string): Promise<DomainResult<{ clientId?: string }>> {
  return inDomain(ctx, async () => {
      const c = await prisma.contract.findUnique({ where: { id } });
      if (!c) return { ok: false, error: "Contrato não encontrado." };
      await prisma.contract.update({
        where: { id },
        data: { status: "CANCELED", canceledAt: new Date() },
      });
      // As mensalidades que o contrato gerou para os meses SEGUINTES, ainda sem
      // pagamento, saem dos recebimentos (auditoria 25/09/2026). O mês corrente
      // e o que já tem pagamento ficam.
      const { cancelarCobrancasFuturas } = await import("@/lib/services/lifecycle");
      const { currentYearMonth } = await import("@/lib/renewal-expectation");
      await cancelarCobrancasFuturas(prisma, { contractId: id }, currentYearMonth(), "Contrato cancelado");
    return { ok: true, clientId: c.clientId };
  });
}
