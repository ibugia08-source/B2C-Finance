import { prisma } from "@/lib/prisma";
import type { ClientStatus } from "@prisma/client";
import {
  calendarParts, civilCompetenceKey, civilParts, expectationFromBase, monthIndex,
  parseCompetenceKey, rollForward,
} from "@/lib/renewal-expectation";

/**
 * EFEITOS DA TROCA DO STATUS ATUAL (movido de actions/clients.ts em
 * 26/09/2026). Um arquivo "use server" só pode exportar actions — e isto NÃO
 * pode ser action: não confere permissão, é o miolo que as actions e o job
 * de status programado chamam depois de decidir que a troca vale.
 *
 * Quem decide QUANDO um status vale é a linha do tempo
 * (src/lib/clients/status-history.ts). Isto aqui só acompanha a troca do
 * status VIGENTE HOJE: perda registrada, relação/termo, cobranças futuras.
 */

/** Mesmo dia de calendário (fuso do workspace)? Nulos só casam com nulos. */
function mesmoDia(a: Date | null | undefined, b: Date | null | undefined): boolean {
  if (!a || !b) return !a && !b;
  const x = civilParts(a);
  const y = civilParts(b);
  return x.year === y.year && x.month === y.month && x.day === y.day;
}

/**
 * Expectativa de renovação ao SALVAR o cadastro (25/09/2026). A regra é
 * entrada + prazo; ela só é refeita quando a BASE muda (entrada ou prazo) ou
 * quando o cliente ainda não tem expectativa — assim um agendamento manual
 * sobrevive a editar o telefone. Cliente que volta a ficar ativo com uma
 * expectativa já vencida anda em ciclos até o mês corrente.
 */
export function expectativaAoSalvar(
  antes: {
    startedAt: Date | null; contractMonths: number | null; contractIndefinite?: boolean;
    expectedRenewalAt: Date | null; status: string;
  } | null,
  depois: { startedAt: Date | null; contractMonths: number | null; contractIndefinite?: boolean; status: string }
): Date | null | undefined {
  // Prazo INDETERMINADO não gera expectativa: o cliente só aparece em
  // Renovações se alguém agendar à mão.
  const calculada = depois.contractIndefinite
    ? null
    : expectationFromBase(depois.startedAt, depois.contractMonths);
  if (!antes) return calculada;
  const baseMudou =
    !mesmoDia(antes.startedAt, depois.startedAt) ||
    antes.contractMonths !== depois.contractMonths ||
    !!antes.contractIndefinite !== !!depois.contractIndefinite;
  if (baseMudou) return calculada;
  if (!antes.expectedRenewalAt) return calculada ?? undefined;
  const reativou =
    (antes.status === "CHURNED" || antes.status === "INACTIVE") &&
    depois.status !== "CHURNED" && depois.status !== "INACTIVE";
  if (reativou)
    return depois.contractIndefinite ? null : rollForward(antes.expectedRenewalAt, depois.contractMonths ?? 12);
  return undefined; // não mexe
}

/**
 * Registra a PERDA (ClientLoss) dos clientes que estão virando CHURNED:
 * snapshot da receita perdida (MRR mensal / TCV de referência), modalidade,
 * responsável e motivo. Chamado em toda transição de status → Perdido.
 */
export async function recordLosses(
  clientIds: string[],
  reason?: string | null,
  lostAt?: Date,
  /** "Não renovou" do módulo Renovações: a competência em exibição. */
  renewalCompetence?: string | null
) {
  if (clientIds.length === 0) return;
  const { computeLossSnapshots, expectedRenewalValues } = await import("@/lib/services/revenue-metrics");
  const [snapshots, clientes] = await Promise.all([
    computeLossSnapshots(clientIds),
    prisma.client.findMany({
      where: { id: { in: clientIds } },
      select: { id: true, modality: true, monthlyValue: true, totalContractValue: true, expectedRenewalAt: true },
    }),
  ]);
  if (snapshots.length === 0) return;
  const esperado = await expectedRenewalValues(clientes);
  const quando = lostAt ?? new Date();
  const porId = new Map(clientes.map((c) => [c.id, c]));
  await prisma.clientLoss.createMany({
    data: snapshots.map((s) => {
      // É RENOVAÇÃO PERDIDA quando veio do módulo (competência explícita)
      // ou quando a expectativa do cliente já tinha chegado (mês dela ≤ mês
      // da perda). Saída no meio do contrato não conta como renovação.
      const exp = porId.get(s.clientId)?.expectedRenewalAt ?? null;
      const competencia =
        renewalCompetence && parseCompetenceKey(renewalCompetence)
          ? renewalCompetence
          : exp && monthIndex(civilParts(exp)) <= monthIndex(calendarParts(quando))
            ? civilCompetenceKey(exp)
            : null;
      return {
        clientId: s.clientId,
        modality: s.modality as any,
        monthlyValue: s.monthlyValue,
        referenceValue: s.referenceValue,
        salesOwner: s.salesOwner,
        reason: reason ?? null,
        renewalCompetence: competencia,
        expectedValue: competencia ? esperado.get(s.clientId) ?? null : null,
        // Data informada pelo gestor (botão Perda); default do banco = agora.
        ...(lostAt ? { lostAt } : {}),
      };
    }),
  });
}

/**
 * TRANSIÇÃO DE STATUS — caminho ÚNICO (auditoria 25/09/2026).
 *
 * O select da carteira, o botão Perda, a ação em massa e a edição do
 * cadastro mudavam só Client.status. A relação com a agência e o termo
 * comercial (fonte do NRR, das avaliações, do painel do gestor) não
 * acompanhavam, e as mensalidades futuras de quem saiu seguiam em aberto.
 * Agora toda troca de status passa por aqui e usa os MESMOS serviços do
 * dossiê: encerrarRelacoes (saída), pausarCliente, retomarCliente e
 * reativarCliente — além do registro de perda e da expectativa de renovação.
 */
export async function transicionarStatus(
  existing: {
    id: string; status: string; churnedAt: Date | null; startedAt: Date | null;
    contractMonths: number | null; contractIndefinite?: boolean; expectedRenewalAt: Date | null;
  },
  novo: ClientStatus,
  opts: { reason?: string | null; lostAt?: Date; renewalCompetence?: string | null } = {}
): Promise<void> {
  const id = existing.id;
  const antes = existing.status;
  if (antes === novo) return;
  const ciclo = await import("@/lib/services/lifecycle");

  if (novo === "CHURNED") {
    const saida = opts.lostAt ?? new Date();
    await recordLosses([id], opts.reason ?? null, opts.lostAt, opts.renewalCompetence ?? null);
    await prisma.client.update({ where: { id }, data: { status: "CHURNED", churnedAt: saida } });
    await ciclo.encerrarRelacoes(id, saida, opts.reason ?? null);
    return;
  }

  // Saindo de Perdido: reativa (relação, termo novo, expectativa em dia).
  if (antes === "CHURNED") {
    const r = await ciclo.reativarCliente(id, opts.reason ?? null);
    if (!r.ok) throw new Error(r.error);
  } else if (antes === "PAUSED" && novo !== "PAUSED") {
    const r = await ciclo.retomarCliente(id, opts.reason ?? null);
    if (!r.ok) throw new Error(r.error);
  }

  if (novo === "PAUSED") {
    const r = await ciclo.pausarCliente(id, { motivo: opts.reason ?? null });
    if (!r.ok) throw new Error(r.error);
    return;
  }

  // Reativar/retomar deixam ACTIVE; o status pedido pode ser outro (ex.:
  // Inadimplente, Renovação, Lead). Grava o final + expectativa coerente.
  const expectativa = expectativaAoSalvar(existing, {
    startedAt: existing.startedAt,
    contractMonths: existing.contractMonths,
    contractIndefinite: existing.contractIndefinite,
    status: novo,
  });
  await prisma.client.update({
    where: { id },
    data: {
      status: novo,
      churnedAt: null,
      ...(expectativa !== undefined && !(antes === "CHURNED" || antes === "PAUSED")
        ? { expectedRenewalAt: expectativa }
        : {}),
    },
  });
}

