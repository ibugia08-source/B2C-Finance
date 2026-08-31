import { prisma } from "@/lib/prisma";
import type { ClientModality } from "@prisma/client";

/**
 * TERMO COMERCIAL — leitura e sucessão (F1.2 · ref. 01 §4.4).
 *
 * Este módulo é o ÚNICO lugar que sabe abrir e fechar vigência. A regra é
 * simples e não pode ser reimplementada em tela nenhuma: criar um termo
 * novo FECHA o anterior no instante em que o novo começa, e o cache
 * currentCommercialTermId da relação passa a apontar para o novo.
 *
 * "Quanto o cliente valia em março?" tem UMA resposta correta —
 * termAt(relationshipId, marco) — e ela nunca é Client.monthlyValue.
 */

export type TermInput = {
  relationshipId: string;
  modality: ClientModality;
  monthlyValue?: number | null;
  totalContractValue?: number | null;
  contractMonths?: number | null;
  validFrom: Date;
  contractId?: string | null;
  reason?: string | null;
};

/** Termo em vigor NA DATA — a pergunta que o v1 não sabia responder. */
export async function termAt(relationshipId: string, quando: Date) {
  return prisma.commercialTerm.findFirst({
    where: {
      relationshipId,
      validFrom: { lte: quando },
      OR: [{ validTo: null }, { validTo: { gt: quando } }],
    },
    orderBy: { validFrom: "desc" },
  });
}

/** Termo vigente hoje. */
export async function currentTerm(relationshipId: string) {
  return prisma.commercialTerm.findFirst({
    where: { relationshipId, validTo: null },
    orderBy: { validFrom: "desc" },
  });
}

/** Linha do tempo completa — é o "Histórico de preço/termos" de 02 §4.1. */
export async function termHistory(relationshipId: string) {
  return prisma.commercialTerm.findMany({
    where: { relationshipId },
    orderBy: { validFrom: "desc" },
  });
}

/**
 * Abre um termo novo e fecha o anterior no mesmo instante.
 *
 * Em transação de propósito: fechar o antigo sem abrir o novo deixaria o
 * cliente sem valor vigente, e abrir o novo sem fechar o antigo deixaria
 * DOIS termos vigentes — e aí termAt passa a devolver resposta ambígua,
 * que é pior que erro.
 */
export async function openTerm(input: TermInput) {
  return prisma.$transaction(async (tx) => {
    await tx.commercialTerm.updateMany({
      where: { relationshipId: input.relationshipId, validTo: null },
      data: { validTo: input.validFrom },
    });

    const termo = await tx.commercialTerm.create({
      data: {
        relationshipId: input.relationshipId,
        modality: input.modality,
        monthlyValue: input.monthlyValue ?? null,
        totalContractValue: input.totalContractValue ?? null,
        contractMonths: input.contractMonths ?? null,
        validFrom: input.validFrom,
        contractId: input.contractId ?? null,
        reason: input.reason ?? null,
      },
    });

    await tx.clientAgencyRelationship.update({
      where: { id: input.relationshipId },
      data: { currentCommercialTermId: termo.id },
    });

    return termo;
  });
}
