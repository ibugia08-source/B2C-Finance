import { prisma } from "@/lib/prisma";
import type { Prisma, ManagerRole } from "@prisma/client";

/**
 * GESTORES POR VIGÊNCIA (F1.3 · ref. 01 §4.3).
 *
 * Mesma lógica do termo comercial: quem responde pelo cliente é um fato
 * COM DATA. "Quem cuidava desta conta em março?" tem uma resposta certa, e
 * ela não é o campo atual do cadastro.
 *
 * Um papel tem no máximo um titular por vez. Trocar o titular FECHA a
 * atribuição anterior no instante em que a nova começa — nunca deixa duas
 * abertas, porque aí a pergunta acima passaria a ter duas respostas.
 */

export type AssignInput = {
  relationshipId: string;
  managerId: string;
  role: ManagerRole;
  validFrom: Date;
  changedBy?: string | null;
  reason?: string | null;
};

/** Quem respondia pela conta NA DATA, por papel. */
export async function managersAt(relationshipId: string, quando: Date) {
  return prisma.clientManagerAssignment.findMany({
    where: {
      relationshipId,
      validFrom: { lte: quando },
      OR: [{ validTo: null }, { validTo: { gt: quando } }],
    },
    include: { manager: { select: { id: true, name: true } } },
    orderBy: { role: "asc" },
  });
}

/** Titulares de hoje. */
export async function currentManagers(relationshipId: string) {
  return prisma.clientManagerAssignment.findMany({
    where: { relationshipId, validTo: null },
    include: { manager: { select: { id: true, name: true } } },
    orderBy: { role: "asc" },
  });
}

/** Histórico completo de um papel — quem entrou, quando e por quê. */
export async function assignmentHistory(relationshipId: string, role?: ManagerRole) {
  return prisma.clientManagerAssignment.findMany({
    where: { relationshipId, ...(role ? { role } : {}) },
    include: { manager: { select: { id: true, name: true } } },
    orderBy: { validFrom: "desc" },
  });
}

/** Troca o titular de um papel, fechando o anterior no mesmo instante. */
export async function assignManager(input: AssignInput) {
  return prisma.$transaction(async (tx: Prisma.TransactionClient) => {
    await tx.clientManagerAssignment.updateMany({
      where: { relationshipId: input.relationshipId, role: input.role, validTo: null },
      data: { validTo: input.validFrom },
    });
    return tx.clientManagerAssignment.create({
      data: {
        relationshipId: input.relationshipId,
        managerId: input.managerId,
        role: input.role,
        validFrom: input.validFrom,
        changedBy: input.changedBy ?? null,
        reason: input.reason ?? null,
      },
    });
  });
}
