import { prisma } from "@/lib/prisma";
import { toNumber as n } from "@/lib/format";

/**
 * PAUSAR · RETOMAR · REATIVAR (F1.16 · ref. 01 §3.9).
 *
 * A regra da spec, por extenso: "Pausar suspende geração recorrente a partir
 * da competência escolhida; retomar cria evento e NOVO TERMO; (…) Retornou
 * não é estado: encerra o churn e inicia novo vínculo/termo".
 *
 * O que muda de verdade em cada gesto — e é por isso que eles são serviço, e
 * não um select de status:
 *
 *  - PAUSAR fecha o termo vigente (validTo = data da pausa). É o que faz o
 *    MRR do cliente SAIR da base a partir dali (contração no NRR, não churn)
 *    e a geração recorrente parar — o status PAUSED já está fora do ciclo.
 *  - RETOMAR abre termo NOVO com o valor do último termo fechado. O buraco
 *    entre as vigências é o registro fiel da pausa: quem perguntar "quanto
 *    valia em julho?" recebe zero, porque valia zero.
 *  - REATIVAR (churnado que voltou) faz o mesmo caminho da retomada e limpa
 *    o churn do vínculo. A ficha é a MESMA (01 §4.6: "churnado reativa sem
 *    duplicar") — o histórico inteiro continua nela.
 *
 * Tudo passa pelo AuditLog: são os gestos que reescrevem o ciclo de vida, e
 * a linha do tempo do cliente precisa mostrá-los.
 */

type Resultado = { ok: true } | { ok: false; error: string };

async function relacoesDe(clientId: string) {
  return prisma.clientAgencyRelationship.findMany({
    where: { clientId },
    select: {
      id: true,
      lifecycleStatus: true,
      pausedAt: true,
      churnedAt: true,
      currentCommercialTermId: true,
      currentCommercialTerm: {
        select: { id: true, monthlyValue: true, modality: true, totalContractValue: true, contractMonths: true },
      },
    },
  });
}

export async function pausarCliente(
  clientId: string,
  opts: { aPartirDe?: Date; motivo?: string | null } = {}
): Promise<Resultado> {
  const cliente = await prisma.client.findUnique({
    where: { id: clientId },
    select: { id: true, status: true },
  });
  if (!cliente) return { ok: false, error: "Cliente não encontrado." };
  if (cliente.status === "PAUSED") return { ok: false, error: "Este cliente já está pausado." };
  if (cliente.status === "CHURNED")
    return { ok: false, error: "Cliente que saiu não pausa — o caminho é reativar." };

  const data = opts.aPartirDe ?? new Date();
  const relacoes = await relacoesDe(clientId);

  const { contextFromRequest } = await import("@/lib/engines/context");
  const { auditUpdate } = await import("@/lib/audit");
  const ctx = await contextFromRequest({ reason: opts.motivo ?? "Pausa da relação." });

  await prisma.$transaction(async (tx) => {
    await tx.client.update({ where: { id: clientId }, data: { status: "PAUSED" } });
    for (const r of relacoes) {
      if (r.lifecycleStatus === "CHURNED") continue;
      await tx.clientAgencyRelationship.update({
        where: { id: r.id },
        data: {
          lifecycleStatus: "PAUSED",
          pausedAt: data,
          currentCommercialTermId: null,
        },
      });
      // Fecha o termo vigente: pausado não fatura, e o histórico de preço
      // registra ATÉ QUANDO valeu.
      if (r.currentCommercialTermId) {
        await tx.commercialTerm.update({
          where: { id: r.currentCommercialTermId },
          data: { validTo: data },
        });
      }
      await auditUpdate(
        tx as any,
        "ClientAgencyRelationship",
        r.id,
        { lifecycleStatus: r.lifecycleStatus, pausedAt: r.pausedAt },
        { lifecycleStatus: "PAUSED", pausedAt: data },
        ctx
      );
    }
  });
  return { ok: true };
}

/** Retomada de pausa e reativação de churn compartilham o miolo. */
async function voltarAtivo(
  clientId: string,
  modo: "RETOMADA" | "REATIVACAO",
  motivo: string | null
): Promise<Resultado> {
  const cliente = await prisma.client.findUnique({
    where: { id: clientId },
    select: { id: true, status: true },
  });
  if (!cliente) return { ok: false, error: "Cliente não encontrado." };
  if (modo === "RETOMADA" && cliente.status !== "PAUSED")
    return { ok: false, error: "Só se retoma um cliente pausado." };
  if (modo === "REATIVACAO" && cliente.status !== "CHURNED")
    return { ok: false, error: "Só se reativa um cliente que saiu." };

  const agora = new Date();
  const relacoes = await relacoesDe(clientId);

  const { contextFromRequest } = await import("@/lib/engines/context");
  const { auditUpdate } = await import("@/lib/audit");
  const ctx = await contextFromRequest({
    reason: motivo ?? (modo === "RETOMADA" ? "Retomada após pausa." : "Reativação após churn."),
  });

  // Expectativa de renovação que venceu durante a pausa/saída anda em
  // ciclos até o mês corrente — a mesma regra do select de status.
  const exp = await prisma.client.findUnique({
    where: { id: clientId },
    select: { expectedRenewalAt: true, contractMonths: true },
  });
  const { rollForward } = await import("@/lib/renewal-expectation");
  const novaExpectativa = exp?.expectedRenewalAt
    ? rollForward(exp.expectedRenewalAt, exp.contractMonths ?? 12)
    : null;

  await prisma.$transaction(async (tx) => {
    await tx.client.update({
      where: { id: clientId },
      data: {
        status: "ACTIVE",
        churnedAt: null,
        ...(novaExpectativa ? { expectedRenewalAt: novaExpectativa } : {}),
      },
    });
    for (const r of relacoes) {
      // O último termo (fechado na pausa/churn) dá o valor da volta. Se a
      // volta for com valor NOVO, o gesto seguinte é um reajuste na aba de
      // termos — aqui não se inventa preço.
      const ultimo = await tx.commercialTerm.findFirst({
        where: { relationshipId: r.id },
        orderBy: { validFrom: "desc" },
        select: { monthlyValue: true, modality: true, totalContractValue: true, contractMonths: true },
      });
      let novoTermoId: string | null = null;
      if (ultimo && (n(ultimo.monthlyValue) > 0 || n(ultimo.totalContractValue) > 0)) {
        const termo = await tx.commercialTerm.create({
          data: {
            relationshipId: r.id,
            modality: ultimo.modality,
            monthlyValue: ultimo.monthlyValue,
            totalContractValue: ultimo.totalContractValue,
            contractMonths: ultimo.contractMonths,
            validFrom: agora,
            validTo: null,
            reason: modo === "RETOMADA" ? "Retomada após pausa" : "Reativação após churn",
          },
          select: { id: true },
        });
        novoTermoId = termo.id;
      }
      await tx.clientAgencyRelationship.update({
        where: { id: r.id },
        data: {
          lifecycleStatus: "ACTIVE",
          pausedAt: null,
          churnedAt: null,
          currentCommercialTermId: novoTermoId,
        },
      });
      await auditUpdate(
        tx as any,
        "ClientAgencyRelationship",
        r.id,
        { lifecycleStatus: r.lifecycleStatus },
        { lifecycleStatus: "ACTIVE" },
        ctx
      );
    }
  });
  return { ok: true };
}

export async function retomarCliente(clientId: string, motivo?: string | null): Promise<Resultado> {
  return voltarAtivo(clientId, "RETOMADA", motivo ?? null);
}

export async function reativarCliente(clientId: string, motivo?: string | null): Promise<Resultado> {
  return voltarAtivo(clientId, "REATIVACAO", motivo ?? null);
}

/**
 * COBRANÇAS FUTURAS de quem saiu (auditoria 25/09/2026). O cadastro MRR com
 * prazo gera todas as mensalidades do contrato de uma vez; sem isto, o
 * cliente perdido em novembro seguia com dezembro…agosto em aberto, virando
 * OVERDUE e inadimplência de quem já não é cliente. Cancela (com motivo, e
 * sem apagar) as cobranças SEM NENHUM PAGAMENTO com competência depois do
 * mês de saída. Cobrança já paga ou parcial fica: é fato de caixa.
 */
export async function cancelarCobrancasFuturas(
  db: any,
  filtro: { clientId?: string; contractId?: string },
  aPartirDe: { year: number; month: number },
  motivo: string
): Promise<number> {
  const depois = {
    OR: [
      { competenceYear: { gt: aPartirDe.year } },
      { competenceYear: aPartirDe.year, competenceMonth: { gt: aPartirDe.month } },
    ],
  };
  const r = await db.billing.updateMany({
    where: {
      ...filtro,
      status: { in: ["PENDING", "OVERDUE"] },
      paidTotal: 0,
      ...depois,
    },
    data: { status: "CANCELED", canceledAt: new Date(), cancelReason: motivo },
  });
  return r.count;
}

/**
 * ENCERRAR A RELAÇÃO (churn) — o par de pausarCliente para a saída.
 *
 * Antes, "Perdido" pela carteira (select, botão Perda, ação em massa ou
 * edição) mudava só Client.status: a relação com a agência seguia ACTIVE, o
 * termo seguia vigente e o NRR, a grade de avaliações, o painel do gestor e
 * as notificações continuavam contando o cliente (auditoria 25/09/2026).
 * Aqui: relação vira CHURNED com a data da saída, o termo vigente fecha
 * nela, e as mensalidades futuras sem pagamento são canceladas.
 */
export async function encerrarRelacoes(
  clientId: string,
  saida: Date,
  motivo: string | null
): Promise<void> {
  const relacoes = await relacoesDe(clientId);
  const { contextFromRequest } = await import("@/lib/engines/context");
  const { auditUpdate } = await import("@/lib/audit");
  const ctx = await contextFromRequest({ reason: motivo ?? "Saída do cliente." });
  const mesSaida = { year: saida.getUTCFullYear(), month: saida.getUTCMonth() + 1 };

  await prisma.$transaction(async (tx) => {
    for (const r of relacoes) {
      if (r.lifecycleStatus === "CHURNED") continue;
      await tx.clientAgencyRelationship.update({
        where: { id: r.id },
        data: { lifecycleStatus: "CHURNED", churnedAt: saida, currentCommercialTermId: null },
      });
      if (r.currentCommercialTermId) {
        await tx.commercialTerm.update({
          where: { id: r.currentCommercialTermId },
          data: { validTo: saida },
        });
      }
      await auditUpdate(
        tx as any,
        "ClientAgencyRelationship",
        r.id,
        { lifecycleStatus: r.lifecycleStatus, churnedAt: r.churnedAt },
        { lifecycleStatus: "CHURNED", churnedAt: saida },
        ctx
      );
    }
    await cancelarCobrancasFuturas(tx, { clientId }, mesSaida, "Cliente saiu da carteira");
  });
}
