import { prisma } from "@/lib/prisma";
import { revertPayment } from "@/lib/engines/payment-engine";

/**
 * REVERSÃO DO LOTE (F1.13 v2).
 *
 * Desfaz TUDO o que o lote CRIOU, na ordem inversa de dependência:
 * pagamentos (pelo motor, que estorna aplicação, Income e status) →
 * cobranças → avaliações → termos (reabrindo o anterior) → vigências de
 * gestor (reabrindo a anterior) → serviços (se seguem sem uso) → clientes.
 *
 * O que o lote ATUALIZOU não é tocado: atualização não tem imagem anterior
 * e "reverter" seria inventar um passado — o resultado lista cada uma.
 */

export type ResultadoReversao = {
  ok: true;
  desfeitos: Record<string, number>;
  naoDesfeitos: { entity: string; motivo: string }[];
} | { ok: false; error: string };

export async function reverterLoteTotal(batchId: string): Promise<ResultadoReversao> {
  const batch = await prisma.importBatch.findFirst({
    where: { id: batchId, module: "total" },
    select: { id: true, fileName: true },
  });
  if (!batch) return { ok: false, error: "Lote de Importação Total não encontrado." };
  if (batch.fileName?.includes("[REVERTIDO]"))
    return { ok: false, error: "Este lote já foi revertido." };

  const registros = await prisma.importedRecord.findMany({
    where: { batchId },
    orderBy: { createdAt: "asc" },
  });

  const desfeitos: Record<string, number> = {};
  const naoDesfeitos: { entity: string; motivo: string }[] = [];
  const conta = (e: string) => { desfeitos[e] = (desfeitos[e] ?? 0) + 1; };
  const criados = (entity: string) =>
    registros.filter((r) => r.entity === entity && r.operation === "CRIOU" && r.entityId);

  // 1) Pagamentos — pelo motor, nunca por delete.
  for (const reg of criados("pagamento")) {
    const res = await revertPayment(reg.entityId!, "Reversão do lote de importação total");
    if (res.ok) conta("pagamentos");
    else naoDesfeitos.push({ entity: "pagamento", motivo: res.error });
  }

  // 2) Cobranças criadas pelo lote.
  for (const reg of criados("mensal")) {
    const aplicacoes = await prisma.paymentApplication.count({ where: { billingId: reg.entityId! } });
    if (aplicacoes > 0) {
      naoDesfeitos.push({ entity: "cobrança", motivo: "ainda tem pagamento aplicado (estorno falhou?)" });
      continue;
    }
    await prisma.collectionHistory.deleteMany({ where: { billingId: reg.entityId! } });
    await prisma.billing.deleteMany({ where: { id: reg.entityId! } });
    conta("cobranças");
  }

  // 3) Avaliações.
  for (const reg of criados("avaliacao")) {
    await prisma.avaliacaoMensal.deleteMany({ where: { id: reg.entityId! } });
    conta("avaliações");
  }

  // 4) Termos — apaga o criado e REABRE o anterior (vigência de volta).
  for (const reg of [...criados("termo")].reverse()) {
    const raw = (reg.raw ?? {}) as { anterior?: string | null };
    const termo = await prisma.commercialTerm.findUnique({
      where: { id: reg.entityId! },
      select: { id: true, relationshipId: true },
    });
    if (!termo) continue;
    await prisma.commercialTerm.delete({ where: { id: termo.id } });
    if (raw.anterior) {
      await prisma.commercialTerm.update({
        where: { id: raw.anterior },
        data: { validTo: null },
      });
    }
    await prisma.clientAgencyRelationship.update({
      where: { id: termo.relationshipId },
      data: { currentCommercialTermId: raw.anterior ?? null },
    });
    conta("termos");
  }

  // 5) Vigências de gestor — reabre a que foi fechada pela criada.
  for (const reg of [...criados("gestor")].reverse()) {
    const criada = await prisma.clientManagerAssignment.findUnique({
      where: { id: reg.entityId! },
      select: { id: true, relationshipId: true, role: true, validFrom: true },
    });
    if (!criada) continue;
    await prisma.clientManagerAssignment.delete({ where: { id: criada.id } });
    await prisma.clientManagerAssignment.updateMany({
      where: {
        relationshipId: criada.relationshipId,
        role: criada.role,
        validTo: criada.validFrom,
      },
      data: { validTo: null },
    });
    conta("gestores");
  }

  // 6) Serviços criados inativos — só se ninguém passou a usá-los.
  for (const reg of criados("servico")) {
    const emUso = await prisma.contractService.count({ where: { serviceId: reg.entityId! } });
    if (emUso > 0) {
      naoDesfeitos.push({ entity: "serviço", motivo: "já está em uso em contrato" });
      continue;
    }
    await prisma.service.deleteMany({ where: { id: reg.entityId!, active: false } });
    conta("serviços");
  }

  // 7) Clientes criados pelo lote (relação junto). Só o que o lote criou:
  //    cliente ATUALIZOU fica exatamente como está.
  for (const reg of criados("cliente")) {
    const clientId = reg.entityId!;
    const [cobrancas, pagamentos] = await Promise.all([
      prisma.billing.count({ where: { clientId } }),
      prisma.payment.count({ where: { applications: { some: { billing: { clientId } } } } }),
    ]);
    if (cobrancas > 0 || pagamentos > 0) {
      naoDesfeitos.push({
        entity: "cliente",
        motivo: "ganhou movimento fora do lote depois da importação — não foi apagado",
      });
      continue;
    }
    const rels = await prisma.clientAgencyRelationship.findMany({
      where: { clientId }, select: { id: true },
    });
    for (const rel of rels) {
      await prisma.commercialTerm.deleteMany({ where: { relationshipId: rel.id } });
      await prisma.clientManagerAssignment.deleteMany({ where: { relationshipId: rel.id } });
      await prisma.avaliacaoMensal.deleteMany({ where: { relationshipId: rel.id } });
      await prisma.onboardingTask.deleteMany({ where: { relationshipId: rel.id } });
      await prisma.clientAgencyRelationship.delete({ where: { id: rel.id } });
    }
    await prisma.client.delete({ where: { id: clientId } });
    conta("clientes");
  }

  for (const reg of registros.filter((r) => r.operation === "ATUALIZOU")) {
    naoDesfeitos.push({
      entity: reg.entity,
      motivo: `linha ${reg.sourceRow} da aba ${reg.sourceSheet ?? "?"}: atualização não tem imagem anterior`,
    });
  }

  await prisma.importBatch.update({
    where: { id: batchId },
    data: { fileName: `${batch.fileName ?? "importacao-total"} [REVERTIDO]` },
  });

  return { ok: true, desfeitos, naoDesfeitos };
}
